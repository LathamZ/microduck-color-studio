import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaults, validatePalette, EditorState, type Manifest } from '../src/domain';
import { recommend, validateInventory, distance, type Inventory } from '../src/recommend';
import { presets } from '../src/models/active';
const model = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
const inventory: Inventory = {
  schemaVersion: 1,
  items: [
    { id: 'white', name: 'White PLA', color: '#F1EFE7', material: 'pla' },
    { id: 'black', name: 'Black PETG', color: '#30343B', material: 'petg' },
    { id: 'orange', name: 'Orange PLA', color: '#F28C28', material: 'pla' },
    { id: 'soft', name: 'Black TPU', color: '#30343B', material: 'tpu' },
  ],
};
describe('inventory-aware recommendations', () => {
  it('uses only owned compatible materials in stock mode', () => {
    for (const plan of recommend(model, defaults(model), inventory, presets, 'stock')) {
      expect(plan.missing).toHaveLength(0);
      for (const p of model.parts.filter((x) => x.printable)) {
        const f = plan.palette.parts[p.id];
        expect(inventory.items.some((s) => s.color === f.color && s.material === f.material)).toBe(
          true,
        );
        expect(f.material === 'tpu').toBe(p.defaultMaterial === 'tpu');
      }
    }
  });
  it('never substitutes rigid filament for a required flexible part', () => {
    const stock = { ...inventory, items: inventory.items.filter((x) => x.material !== 'tpu') };
    const plans = recommend(model, defaults(model), stock, presets, 'stock');
    expect(plans.every((x) => !x.complete && x.missing.some((m) => m.material === 'tpu'))).toBe(
      true,
    );
  });
  it('limits discretionary purchases to one spool', () => {
    for (const p of recommend(model, defaults(model), inventory, presets, 'add-one'))
      expect(p.missing.filter((x) => x.reason.startsWith('补一卷')).length).toBeLessThanOrEqual(1);
  });
  it('preserves filament color and stores paint separately only on allowed parts', () => {
    const mono: Inventory = { schemaVersion: 1, items: [inventory.items[0], inventory.items[3]] };
    const plans = recommend(model, defaults(model), mono, presets, 'paint');
    expect(plans.some((p) => p.paint.length > 0)).toBe(true);
    for (const p of plans)
      for (const [id, f] of Object.entries(p.palette.parts))
        if (f.coating) {
          expect(model.parts.find((x) => x.id === id)?.paintable).toBe(true);
          expect(f.material).not.toBe('tpu');
          expect(f.color).toBe('#F1EFE7');
          expect(f.coating.kind).toBe('acrylic');
        }
  });
  it('rejects unsafe coating targets and invalid inventory', () => {
    const p = defaults(model);
    const id = model.parts.find((x) => !x.paintable)!.id;
    p.parts[id].coating = { kind: 'acrylic', color: '#ffffff' };
    expect(() => validatePalette(p, model)).toThrow();
    expect(() =>
      validateInventory({ ...inventory, items: [inventory.items[0], inventory.items[0]] }),
    ).toThrow();
  });
  it('is deterministic and keeps hardware unchanged', () => {
    const base = defaults(model);
    const a = recommend(model, base, inventory, presets, 'stock'),
      b = recommend(model, base, inventory, presets, 'stock');
    expect(a).toEqual(b);
    for (const p of model.parts.filter((x) => !x.printable))
      expect(a[0].palette.parts[p.id]).toEqual(base.parts[p.id]);
  });
  it('uses zero distance for identical colors', () => {
    expect(distance('#FFFFFF', '#ffffff')).toBe(0);
    expect(distance('#000000', '#ffffff')).toBeGreaterThan(90);
  });
  it('clears a simulated coating when changing the base color', () => {
    const state = new EditorState(model);
    const id = model.parts.find((x) => x.paintable)!.id;
    state.update([id], { coating: { kind: 'acrylic', color: '#ABCDEF' } });
    state.update([id], { color: '#112233' });
    expect(state.palette.parts[id].coating).toBeUndefined();
    state.undo();
    expect(state.palette.parts[id].coating?.color).toBe('#ABCDEF');
  });
});
