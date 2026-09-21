/** Deterministic, isolated presentation mode for documentation recording.
 * Open ?demo=1. Right arrow advances one 100 ms frame. No local data is read or saved.
 */
import { defaults, type Manifest, type Palette } from './domain';
import type { Viewer } from './viewer';
import type { Inventory } from './recommend';

/** A walk through every capability, one beat per range of frames. */
export const DEMO_FRAMES = 190;

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
    // 25-39: apply a palette from the tray.
    if (frame === 25) click('[data-preset="1"]');
    // 40-54: a matte head, then a silk PLA finish from the material grid.
    if (frame === 40) {
      const p = structuredClone(base);
      p.parts[head] = { color: '#8DAB8A', material: 'matte-pla' };
      apply(p);
      select(head);
      scrollTo(0);
    }
    if (frame === 46) click('[data-material="silk-pla"]');
    // 55-79: link a part to a spool, then edit that filament in the library.
    if (frame === 55) {
      scrollTo(360);
      select(head);
    }
    if (frame === 60) click('[data-owned="demo-sage"]');
    if (frame === 68) {
      stock.open();
      const swatch = document.querySelector(
        '[data-stock="demo-sage"] [data-field="color"]',
      ) as HTMLInputElement | null;
      if (swatch) {
        swatch.value = '#F2C94C';
        swatch.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 78) click('.inventory-close');
    // 80-104: save the current look, change it, then switch back to it.
    if (frame === 80) {
      scrollTo(0);
      click('#looks-toggle');
    }
    if (frame === 86) {
      const name = document.getElementById('looks-name') as HTMLInputElement | null;
      if (name) {
        name.value = '我的第一版';
        name.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (frame === 90) click('#looks-save-button');
    if (frame === 94) {
      click('#looks-toggle');
      click('[data-preset="3"]');
    }
    if (frame === 100) {
      click('#looks-toggle');
      click('[data-apply]');
    }
    if (frame === 104) click('#looks-toggle');
    // 105-140: the cinema stage, a lamp setup, then aiming the lights.
    if (frame === 105) {
      scrollTo(420);
      click('[data-light="cinema"]');
    }
    if (frame === 110) click('[data-pattern="butterfly"]');
    if (frame >= 116 && frame <= 128) setSlider('direction', -150 + (frame - 116) * 25);
    if (frame === 130) setSlider('direction', -40);
    if (frame >= 132 && frame <= 140) setSlider('elevation', 20 + (frame - 132) * 8);
    // 141-164: make it walk, then stop.
    if (frame === 145) {
      scrollTo(0);
      click('#motion-toggle');
    }
    if (frame === 164) click('#motion-toggle');
    // 165-189: export, with the print model matched against the look.
    if (frame === 165) void samplePrint().then((bytes) => print.load(bytes, 'duck-plates.3mf'));
    if (frame === 172) {
      click('#export-menu-toggle');
      click('#export-print-open');
    }
    if (frame === 182) {
      const picker = document.getElementById('print-printer') as HTMLSelectElement | null;
      if (picker) {
        picker.value = 'p1s';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (frame === 186) click('#print-plan');
    if (frame === 189) click('#print-close');
  });
}
