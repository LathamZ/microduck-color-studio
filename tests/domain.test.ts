import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaults, validatePalette, EditorState, type Manifest } from '../src/domain';
const m = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
describe('palette contract', () => {
  it('covers every model instance with a stable unique ID', () => {
    expect(new Set(m.parts.map((p) => p.id)).size).toBe(m.parts.length);
    expect(Object.keys(validatePalette(defaults(m), m).parts)).toHaveLength(m.parts.length);
  });
  it('rejects cross-model imports', () => {
    const p = defaults(m);
    p.modelId = 'other';
    expect(() => validatePalette(p, m)).toThrow('其他模型');
  });
  it('rejects missing and unknown IDs', () => {
    const p = defaults(m);
    delete p.parts[m.parts[0].id];
    expect(() => validatePalette(p, m)).toThrow();
    p.parts.unknown = { color: '#ffffff', material: 'pla' };
    expect(() => validatePalette(p, m)).toThrow('未知零件');
  });
  it('rejects invalid color, material, lighting and surface values', () => {
    for (const mutation of [
      (p: any) => (p.parts[m.parts[0].id].color = 'red'),
      (p: any) => (p.parts[m.parts[0].id].material = 'silver'),
      (p: any) => (p.lighting.intensity = NaN),
      (p: any) => (p.lighting.azimuth = 181),
      (p: any) => (p.surface.layers = 'yes'),
    ]) {
      const p = defaults(m);
      mutation(p);
      expect(() => validatePalette(p, m)).toThrow();
    }
  });
  it('updates only requested instance and supports atomic undo/redo', () => {
    const s = new EditorState(m);
    const before = structuredClone(s.palette);
    const id = m.parts[0].id;
    s.update([id], { color: '#123456', material: 'petg' });
    expect(s.palette.parts[id].material).toBe('petg');
    expect(s.palette.parts[m.parts[1].id]).toEqual(before.parts[m.parts[1].id]);
    s.undo();
    expect(s.palette).toEqual(before);
    s.redo();
    expect(s.palette.parts[id].color).toBe('#123456');
  });
  it('never partially applies an invalid batch', () => {
    const s = new EditorState(m);
    const before = structuredClone(s.palette);
    expect(() => s.update([m.parts[0].id, 'unknown'], { color: '#123456' })).toThrow();
    expect(s.palette).toEqual(before);
    expect(s.canUndo).toBe(false);
  });
  it('lighting and surface are saved, imported and undoable with colors', () => {
    const s = new EditorState(m);
    const next = structuredClone(s.palette);
    next.lighting = { preset: 'warm', intensity: 1.4, azimuth: 90 };
    next.surface.layers = false;
    s.commit(next);
    expect(validatePalette(JSON.parse(JSON.stringify(s.palette)), m)).toEqual(next);
    s.undo();
    expect(s.palette.lighting.preset).toBe('studio');
  });
  it('domain also works with an unrelated model and roles', () => {
    const other = {
      ...m,
      modelId: 'test-chair',
      parts: [
        {
          ...m.parts[0],
          id: 'chair-leg-a',
          name: 'Chair leg',
          sourceName: 'leg',
          role: 'wood',
          defaultColor: '#AA7755',
          defaultMaterial: 'matte-pla',
        },
      ],
    } as Manifest;
    const s = new EditorState(other);
    s.update(['chair-leg-a'], { color: '#998877' });
    expect(s.palette.modelId).toBe('test-chair');
    expect(s.palette.parts['chair-leg-a'].material).toBe('matte-pla');
  });
});
