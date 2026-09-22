/** Deterministic, isolated presentation mode for documentation recording.
 * Open ?demo=1. Right arrow advances one 100 ms frame. No local data is read or saved.
 */
import { defaults, type Manifest, type Palette } from './domain';
import type { Viewer } from './viewer';
import type { Inventory } from './recommend';

/** A walk through every capability, one beat per range of frames: 30 seconds at 10 fps. */
export const DEMO_FRAMES = 300;

export function setupDemo(
  model: Manifest,
  viewer: Viewer,
  apply: (p: Palette) => void,
  select: (id: string) => void,
  stock: { setInventory: (i: unknown) => Inventory; open: () => void },
  print: { load(bytes: Uint8Array, name: string): Promise<unknown> },
) {
  let frame = -1;
  const head = model.parts.find((p) => p.sourceName === 'top_head_shell')?.id;
  const body =
    model.parts.find((p) => p.sourceName === 'right_shell')?.id ||
    model.parts.find((p) => p.printable)!.id;
  const base = defaults(model);
  viewer.controls.enableDamping = false;
  const inventory: Inventory = {
    schemaVersion: 1,
    items: [
      { id: 'demo-ivory', name: '象牙白', color: '#F1EFE7', material: 'matte-pla' },
      { id: 'demo-dark', name: '石墨灰', color: '#30343B', material: 'petg' },
      { id: 'demo-sage', name: '鼠尾草绿', color: '#8DAB8A', material: 'pla' },
      { id: 'demo-soft', name: '柔性黑', color: '#30343B', material: 'tpu' },
    ],
  };
  stock.setInventory(inventory);
  // A visible pointer: the demo scrolls each control into view, moves the cursor onto it
  // and lets the click pulse, so the recording shows what is being used and where.
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5l13 7.6-5.9 1.4-2.6 5.9z"/></svg>';
  document.body.append(cursor);
  /** Keep the pointer on a slider that was already located by its element. */
  const aimRendered = (el: HTMLElement, id: string) => {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = el.getBoundingClientRect();
    cursor.style.left = `${rect.left + rect.width * (Number((el as HTMLInputElement).value) / (Number((el as HTMLInputElement).max) || 100))}px`;
    cursor.style.top = `${rect.top + rect.height / 2}px`;
    cursor.classList.add('visible');
    void id;
  };
  const aim = (selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = el.getBoundingClientRect();
    cursor.style.left = `${rect.left + rect.width / 2}px`;
    cursor.style.top = `${rect.top + rect.height / 2}px`;
    cursor.classList.add('visible');
    return el;
  };
  const click = (selector: string) => {
    const el = aim(selector);
    if (!el) return;
    el.classList.add('demo-press');
    setTimeout(() => el.classList.remove('demo-press'), 300);
    el.click();
  };
  const scrollTo = (top: number) =>
    document.querySelector('.inspector-scroll')?.scrollTo({ top, behavior: 'auto' });
  const setSlider = (id: string, value: number) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    aimRendered(input, id);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** A four-object 3MF, so the print dialog has something real to match. */
  const samplePrint = () => {
    const mesh =
      '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="26" y="0" z="0"/><vertex x="0" y="26" z="0"/><vertex x="0" y="0" z="26"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
    const names = [
      model.parts.filter((p) => p.printable)[0].sourceName + '.stl',
      'shell.stl',
      'sole_left_v2.stl',
      'unknown_bracket.stl',
    ];
    const resources = names
      .map((name, i) => `<object id="${i + 1}" name="${name}">${mesh}</object>`)
      .join('');
    const items = names
      .map((_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${i * 40} 0 0"/>`)
      .join('');
    return import('fflate').then(({ zipSync, strToU8 }) =>
      zipSync({
        '3D/3dmodel.model': strToU8(
          `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources}</resources><build>${items}</build></model>`,
        ),
      }),
    );
  };
  const hover = (selector: string, on: boolean) =>
    document
      .querySelector(selector)
      ?.dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave', { bubbles: true }));
  const mix = (from: string, to: string, t: number) => {
    const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [a, b] = [parse(from), parse(to)];
    return (
      '#' +
      a
        .map((v, i) =>
          Math.round(v + (b[i] - v) * t)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };
  /** Drive the part colour picker the way a hand does: an input per frame, then commit. */
  const dragColour = (stops: string[], t: number) => {
    const span = (stops.length - 1) * 12;
    const scaled = Math.min(0.999, t) * span;
    const index = Math.floor(scaled / 12);
    const colour = mix(stops[index], stops[index + 1], (scaled % 12) / 12);
    const input = document.getElementById('part-color') as HTMLInputElement | null;
    if (!input) return;
    input.value = colour;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight') return;
    e.preventDefault();
    frame++;
    // 0-24: orbit the assembled duck.
    if (frame === 0) {
      apply(base);
      viewer.select(null);
    }
    if (frame < 25) viewer.orbit(-45 + frame * 3, 12);
    if (frame === 25) click('[data-preset="1"]');
    if (frame === 30) click(`[data-part="${body}"]`);
    // 32-56: the colour picker dragged over the torso while the model follows live.
    if (frame === 31) aim('#part-color');
    if (frame >= 32 && frame <= 54)
      dragColour(['#F2C94C', '#F28C28', '#ECC6C5', '#3AC9BD', '#254D70'], (frame - 32) / 22);
    if (frame === 56) {
      const input = document.getElementById('part-color') as HTMLInputElement | null;
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // 60-89: the lights dragged live, then switched between presets.
    if (frame === 60) aim('#direction');
    if (frame >= 62 && frame <= 74) setSlider('direction', -150 + (frame - 62) * 25);
    if (frame === 76) setSlider('direction', -35);
    if (frame >= 78 && frame <= 83) setSlider('intensity', 60 + (frame - 78) * 20);
    if (frame === 85) setSlider('intensity', 100);
    if (frame === 87) click('[data-light="daylight"]');
    if (frame === 90) click('[data-light="warm"]');
    if (frame === 94) click('[data-light="cinema"]');
    // 98-122: materials, one after another, on the same torso part.
    const materials = ['matte-pla', 'silk-pla', 'metallic-petg', 'petg-cf', 'pa-cf', 'pla'];
    materials.forEach((material, index) => {
      if (frame === 100 + index * 4) {
        scrollTo(0);
        click(`[data-material="${material}"]`);
      }
    });
    // 124-148: link a part to a spool, then edit that filament in the library.
    if (frame === 124) click(`[data-part="${body}"]`);
    if (frame === 128) click('[data-owned="demo-sage"]');
    if (frame === 133) {
      click('#inventory-open');
      const swatch = document.querySelector(
        '[data-stock="demo-sage"] [data-field="color"]',
      ) as HTMLInputElement | null;
      if (swatch) {
        swatch.value = '#F2C94C';
        swatch.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 146) click('.inventory-close');
    // 149-174: save the look, change it, then switch back and let it sit.
    if (frame === 149) click('#looks-toggle');
    if (frame === 152) {
      const name = document.getElementById('looks-name') as HTMLInputElement | null;
      if (name) {
        name.value = '我的第一版';
        name.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (frame === 155) click('#looks-save-button');
    if (frame === 158) {
      click('#looks-toggle');
      click('[data-preset="3"]');
    }
    if (frame === 163) {
      click('#looks-toggle');
      click('[data-apply]');
    }
    if (frame === 173) click('#looks-toggle');
    // 176-209: recommendations from the real stock: shuffle, shuffle, apply, hold.
    if (frame === 176) click('#inventory-open');
    if (frame === 182) click('#shuffle-recommend');
    if (frame === 190) click('#shuffle-recommend');
    if (frame === 196) click('[data-plan]');
    // 204-232: assembly view: explode, then isolate the selected part.
    if (frame === 204) click(`[data-part="${body}"]`);
    if (frame >= 208 && frame <= 216) setSlider('explode', (frame - 208) * 7);
    if (frame === 224) setSlider('explode', 0);
    if (frame === 226) click('#isolate');
    if (frame === 232) click('#isolate');
    // 234-244: the actions menu, playing a head shake.
    if (frame === 234) {
      click('[data-view="three-quarter"]');
      viewer.view('three-quarter');
    }
    if (frame === 236) hover('.motion-tools', true);
    if (frame === 239) click('[data-motion="shake"]');
    if (frame === 244) click('#motion-toggle');
    // 246-299: export, with the print model matched against the look.
    if (frame === 246) void samplePrint().then((bytes) => print.load(bytes, 'duck-plates.3mf'));
    if (frame === 254) {
      click('#export-menu-toggle');
      click('#export-print-open');
    }
    if (frame === 262) {
      const picker = document.getElementById('print-printer') as HTMLSelectElement | null;
      if (picker) {
        picker.value = 'p1s';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 268) {
      const list = document.getElementById('print-object-list');
      list?.scrollTo({ top: 260, behavior: 'auto' });
    }
    if (frame === 278) {
      const list = document.getElementById('print-object-list');
      list?.scrollTo({ top: 0, behavior: 'auto' });
    }
    if (frame === 284) click('#print-plan');
  });
}
