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
  const head =
    model.parts.find((p) => p.sourceName === 'top_head_shell')?.id ||
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
  const click = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
  const scrollTo = (top: number) =>
    document.querySelector('.inspector-scroll')?.scrollTo({ top, behavior: 'auto' });
  const setSlider = (id: string, value: number) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
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
      select(head);
      viewer.select(null);
    }
    if (frame < 25) viewer.orbit(-45 + frame * 3, 12);
    if (frame === 25) click('[data-preset="1"]');
    if (frame === 30) select(head);
    // 32-79: the colour picker dragged through a ramp while the model follows live.
    if (frame >= 32 && frame <= 76)
      dragColour(
        ['#8DAB8A', '#F2C94C', '#F28C28', '#ECC6C5', '#3AC9BD', '#254D70'],
        (frame - 32) / 44,
      );
    if (frame === 78) {
      const input = document.getElementById('part-color') as HTMLInputElement | null;
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    }
    // 80-119: the lights, dragged live and then switched between presets.
    if (frame === 80) scrollTo(360);
    if (frame >= 82 && frame <= 98) setSlider('direction', -150 + (frame - 82) * 20);
    if (frame === 100) setSlider('direction', -35);
    if (frame >= 102 && frame <= 108) setSlider('intensity', 60 + (frame - 102) * 18);
    if (frame === 110) setSlider('intensity', 100);
    if (frame === 112) click('[data-light="daylight"]');
    if (frame === 116) click('[data-light="warm"]');
    if (frame === 120) click('[data-light="cinema"]');
    // 124-154: materials, one after another, on the same part.
    const materials = ['matte-pla', 'silk-pla', 'metallic-petg', 'petg-cf', 'pa-cf', 'pla'];
    materials.forEach((material, index) => {
      if (frame === 126 + index * 5) {
        scrollTo(0);
        click(`[data-material="${material}"]`);
      }
    });
    // 158-179: link a part to a spool, then edit that filament in the library.
    if (frame === 158) {
      scrollTo(420);
      click('[data-light="studio"]');
      select(head);
    }
    if (frame === 162) click('[data-owned="demo-sage"]');
    if (frame === 168) {
      stock.open();
      const swatch = document.querySelector(
        '[data-stock="demo-sage"] [data-field="color"]',
      ) as HTMLInputElement | null;
      if (swatch) {
        swatch.value = '#F2C94C';
        swatch.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 177) click('.inventory-close');
    // 180-204: save the look, change it, then switch back to it.
    if (frame === 180) {
      scrollTo(0);
      click('#looks-toggle');
    }
    if (frame === 184) {
      const name = document.getElementById('looks-name') as HTMLInputElement | null;
      if (name) {
        name.value = '我的第一版';
        name.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (frame === 187) click('#looks-save-button');
    if (frame === 191) {
      click('#looks-toggle');
      click('[data-preset="3"]');
    }
    if (frame === 197) {
      click('#looks-toggle');
      click('[data-apply]');
    }
    if (frame === 203) click('#looks-toggle');
    // 205-229: recommendations from the real stock: shuffle, then apply one.
    if (frame === 205) stock.open();
    if (frame === 212) click('#shuffle-recommend');
    if (frame === 220) click('#shuffle-recommend');
    if (frame === 226) click('[data-plan]');
    // 230-249: assembly view: explode, then isolate the selected part.
    if (frame === 230) {
      scrollTo(900);
      select(head);
    }
    if (frame >= 234 && frame <= 242) setSlider('explode', (frame - 234) * 7);
    if (frame >= 244 && frame <= 248) setSlider('explode', 56 - (frame - 244) * 14);
    if (frame === 250) click('#isolate');
    if (frame === 256) click('#isolate');
    // 258-272: the actions menu, playing a head shake.
    if (frame === 258) {
      scrollTo(0);
      viewer.view('three-quarter');
    }
    if (frame === 262) hover('.motion-tools', true);
    if (frame === 266) click('[data-motion="shake"]');
    if (frame === 272) click('#motion-toggle');
    // 274-299: export, with the print model matched against the look.
    if (frame === 274) void samplePrint().then((bytes) => print.load(bytes, 'duck-plates.3mf'));
    if (frame === 282) {
      click('#export-menu-toggle');
      click('#export-print-open');
    }
    if (frame === 290) {
      const picker = document.getElementById('print-printer') as HTMLSelectElement | null;
      if (picker) {
        picker.value = 'p1s';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 294) click('#print-plan');
  });
}
