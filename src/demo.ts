/** Deterministic, isolated presentation mode for documentation recording.
 * Open ?demo=1. Right arrow advances one 100 ms frame. No local data is read or saved.
 */
import { defaults, type Manifest, type Palette } from './domain';
import type { Viewer } from './viewer';
import type { Inventory } from './recommend';
export function setupDemo(
  model: Manifest,
  viewer: Viewer,
  apply: (p: Palette) => void,
  select: (id: string) => void,
  stock: { setInventory: (i: unknown) => Inventory; open: () => void },
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
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight') return;
    e.preventDefault();
    frame++;
    if (frame === 0) {
      apply(base);
      select(head);
      viewer.select(null);
    }
    if (frame < 30) {
      const a = -45 + frame * 2.7;
      viewer.orbit(a, 12);
    }
    if (frame === 30) {
      const p = structuredClone(base);
      p.name = '鸭鸭黄';
      for (const part of model.parts)
        if (part.role === 'primary') p.parts[part.id].color = '#F2C94C';
      apply(p);
      viewer.select(null);
    }
    if (frame === 50) {
      const p = structuredClone(base);
      p.parts[head] = { color: '#8DAB8A', material: 'matte-pla' };
      apply(p);
      select(head);
    }
    if (frame === 70) {
      const p = structuredClone(base);
      p.parts[head] = { color: '#8DAB8A', material: 'petg' };
      apply(p);
      select(head);
    }
    if (frame >= 90 && frame < 110) {
      const p = structuredClone(base);
      p.parts[head] = { color: '#8DAB8A', material: 'petg' };
      p.lighting = { preset: 'warm', intensity: 1.15, azimuth: -90 + (frame - 90) * 9 };
      apply(p);
      viewer.select(null);
      document.querySelector('.inspector-scroll')?.scrollTo({ top: 365 });
    }
    if (frame === 110) {
      document.querySelector('.inspector-scroll')?.scrollTo({ top: 0 });
      stock.open();
      (document.querySelector('[data-mode="add-one"]') as HTMLButtonElement)?.click();
    }
    if (frame === 130)
      (document.querySelector('[data-mode="paint"]') as HTMLButtonElement)?.click();
  });
}
