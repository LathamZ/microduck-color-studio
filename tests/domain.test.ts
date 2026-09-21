import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaults, validatePalette, EditorState, type Manifest } from '../src/domain';
import { footTarget, legForward, solveLeg, walk } from '../src/motion';
import { resolveRig } from '../src/viewer';
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

describe('filament binding', () => {
  const printable = m.parts.filter((p) => p.printable);
  const spool = { id: 'spool-white', name: '白色 PLA', color: '#F1EFE7', material: 'pla' as const };
  it('keeps a bound part in sync with its spool and leaves others alone', () => {
    const s = new EditorState(m);
    const [a, b] = printable;
    s.update([a.id], { color: spool.color, material: spool.material, stockId: spool.id });
    s.update([b.id], { color: '#123456' });
    const changed = s.syncStock([{ ...spool, color: '#00AAFF', material: 'petg' }]);
    expect(changed).toEqual([a.id]);
    expect(s.palette.parts[a.id]).toMatchObject({
      color: '#00AAFF',
      material: 'petg',
      stockId: spool.id,
    });
    expect(s.palette.parts[b.id].color).toBe('#123456');
  });
  it('is undoable and round-trips through JSON and validation', () => {
    const s = new EditorState(m);
    const [a] = printable;
    s.update([a.id], { color: spool.color, material: 'pla', stockId: spool.id });
    const before = structuredClone(s.palette);
    s.syncStock([{ ...spool, color: '#00AAFF', material: 'pla' }]);
    expect(validatePalette(JSON.parse(JSON.stringify(s.palette)), m).parts[a.id].stockId).toBe(
      spool.id,
    );
    s.undo();
    expect(s.palette).toEqual(before);
  });
  it('releases parts when the spool disappears instead of leaving a dangling link', () => {
    const s = new EditorState(m);
    const [a] = printable;
    s.update([a.id], { color: '#00AAFF', material: 'pla', stockId: 'gone' });
    expect(s.syncStock([])).toEqual([a.id]);
    expect(s.palette.parts[a.id]).toMatchObject({ color: '#00AAFF' });
    expect(s.palette.parts[a.id].stockId).toBeUndefined();
  });
  it('detaches the moment a color is chosen by hand, and keeps it when asked', () => {
    const s = new EditorState(m);
    const [a] = printable;
    s.update([a.id], { color: spool.color, material: 'pla', stockId: spool.id });
    s.update([a.id], { color: '#445566' });
    expect(s.palette.parts[a.id].stockId).toBeUndefined();
    s.update([a.id], { color: spool.color, material: 'pla', stockId: spool.id });
    s.update([a.id], { material: 'petg', stockId: spool.id });
    expect(s.palette.parts[a.id].stockId).toBe(spool.id);
  });
  it('rejects malformed filament links', () => {
    const p = defaults(m);
    p.parts[printable[0].id].stockId = '../etc/passwd';
    expect(() => validatePalette(p, m)).toThrow('耗材绑定');
  });
  it('carries links through a whole-palette commit', () => {
    const s = new EditorState(m),
      [a] = printable;
    const next = structuredClone(s.palette);
    next.parts[a.id].stockId = spool.id;
    s.commit(next);
    expect(s.palette.parts[a.id].stockId).toBe(spool.id);
  });
});

describe('lighting presets and patterns', () => {
  const base = () => {
    const p = defaults(m);
    return p;
  };
  it('accepts the cinema preset and every pattern, and stores them', () => {
    for (const pattern of ['butterfly', 'rembrandt', 'split', 'rim'] as const) {
      const p = base();
      p.lighting = { preset: 'cinema', intensity: 1.1, azimuth: 20, pattern };
      expect(validatePalette(p, m).lighting).toEqual({
        preset: 'cinema',
        intensity: 1.1,
        azimuth: 20,
        pattern,
      });
    }
    const plain = base();
    plain.lighting = { preset: 'cinema', intensity: 1, azimuth: 0 };
    expect(validatePalette(plain, m).lighting.pattern).toBeUndefined();
  });
  it('stores a pattern whatever the preset, and only cinema renders it', () => {
    for (const preset of ['studio', 'daylight', 'warm', 'cinema'] as const) {
      const p = base();
      p.lighting = { preset, intensity: 1, azimuth: 0, pattern: 'split' };
      expect(validatePalette(p, m).lighting).toEqual({
        preset,
        intensity: 1,
        azimuth: 0,
        pattern: 'split',
      });
    }
    const cinema = resolveRig({
      preset: 'cinema',
      intensity: 1,
      azimuth: 0,
      pattern: 'split',
    });
    const studio = resolveRig({ preset: 'studio', intensity: 1, azimuth: 0, pattern: 'split' });
    expect(cinema.key.azimuth).toBe(88);
    expect(studio.key.azimuth).toBe(0);
    expect(studio.rim.intensity).toBe(0);
  });
  it('rejects unknown presets and patterns', () => {
    for (const mutation of [
      (p: any) => (p.lighting.preset = 'custom'),
      (p: any) => (p.lighting.preset = 'clinic'),
      (p: any) => (p.lighting.pattern = 'butterfly-light'),
      (p: any) => (p.lighting.pattern = ''),
    ]) {
      const p = base();
      mutation(p);
      expect(() => validatePalette(p, m)).toThrow();
    }
  });
  it('keeps a pattern through save, JSON and undo', () => {
    const s = new EditorState(m);
    const next = structuredClone(s.palette);
    next.lighting = { preset: 'warm', intensity: 1.2, azimuth: 45, pattern: 'rim' };
    s.commit(next);
    expect(validatePalette(JSON.parse(JSON.stringify(s.palette)), m).lighting.pattern).toBe('rim');
    s.undo();
    expect(s.palette.lighting.pattern).toBeUndefined();
  });
});

describe('walking is solved from the measured linkage', () => {
  // The linkage measured on the Microduck: hip → knee → ankle, sole hanging below.
  const geom = {
    hipToKnee: [-35.7, -21.9] as [number, number],
    kneeToAnkle: [0, -42] as [number, number],
    ankleToSole: 25.1,
  };
  const legs = { L: geom, R: geom };
  it('solves joint angles that put the ankle exactly on the requested foot path', () => {
    for (let i = 0; i < 12; i++) {
      const phase = (i / 12) * Math.PI * 2;
      const [x, y] = footTarget(phase);
      const solved = solveLeg(geom, [x, geom.hipToKnee[1] + geom.kneeToAnkle[1] - y]);
      const reached = legForward(geom, solved);
      expect(reached.ankle[0]).toBeCloseTo(x, 6);
      expect(reached.ankle[1]).toBeCloseTo(geom.hipToKnee[1] + geom.kneeToAnkle[1] - y, 6);
    }
  });
  it('keeps the sole flat and exactly on the ground while the foot is planted', () => {
    // Measured from the hip: the sole rests this far below it, and must not move.
    const restSole = geom.hipToKnee[1] + geom.kneeToAnkle[1] - geom.ankleToSole;
    for (let i = 0; i <= 10; i++) {
      const phase = (i / 20) * Math.PI * 2; // first half of the cycle: stance
      const pose = walk(phase * (0.9 / (Math.PI * 2)), legs);
      const solved = {
        hip: pose.hipL!.angle!,
        knee: pose.kneeL!.angle!,
        ankle: pose.ankleL!.angle!,
      };
      const reached = legForward(geom, solved);
      expect(reached.footAngle).toBeCloseTo(0, 9); // sole stays level
      // The body rises by `dy`, so the sole measured from the hip drops by the same amount.
      expect(reached.sole[1] + pose.root!.dy!).toBeCloseTo(restSole, 6);
    }
  });
  it('lifts the swinging foot instead of dragging it through the floor', () => {
    const heights: number[] = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * 0.9;
      const pose = walk(t, legs);
      const reached = legForward(geom, {
        hip: pose.hipL!.angle!,
        knee: pose.kneeL!.angle!,
        ankle: pose.ankleL!.angle!,
      });
      heights.push(reached.sole[1] + pose.root!.dy!);
    }
    const rest = heights[0];
    expect(Math.min(...heights)).toBeGreaterThan(rest - 0.4); // never sinks into the floor
    expect(Math.max(...heights) - rest).toBeGreaterThan(8); // and does lift clear of it
  });
  it('never over-extends the linkage', () => {
    for (const target of [
      [999, 0],
      [-999, 0],
      [0, 999],
      [0, 0],
    ] as [number, number][]) {
      const solved = solveLeg(geom, target);
      const reached = legForward(geom, solved);
      const span = Math.hypot(reached.ankle[0], reached.ankle[1]);
      expect(Number.isFinite(span)).toBe(true);
      expect(span).toBeLessThanOrEqual(Math.hypot(35.7, 21.9) + 42 - 0.005);
    }
  });
});

describe('light angle', () => {
  it('stores an elevation and keeps it through a round trip', () => {
    const s = new EditorState(m);
    const next = structuredClone(s.palette);
    next.lighting = { preset: 'studio', intensity: 1, azimuth: 0, elevation: 70 };
    s.commit(next);
    expect(validatePalette(JSON.parse(JSON.stringify(s.palette)), m).lighting.elevation).toBe(70);
    s.undo();
    expect(s.palette.lighting.elevation).toBeUndefined();
  });
  it('tilts every lamp of the rig by the stored angle', () => {
    const flat = resolveRig({ preset: 'studio', intensity: 1, azimuth: 0, elevation: 20 });
    const high = resolveRig({ preset: 'studio', intensity: 1, azimuth: 0, elevation: 75 });
    expect(high.key.height).toBeGreaterThan(flat.key.height);
    expect(high.fill.height).toBeGreaterThan(flat.fill.height);
    // The key lands on the requested angle above the horizon.
    const angle = (Math.atan2(high.key.height, 420) * 180) / Math.PI;
    expect(angle).toBeCloseTo(75, 2);
  });
  it('keeps the preset angle when nothing is stored', () => {
    const plain = resolveRig({ preset: 'warm', intensity: 1, azimuth: 0 });
    const warm = resolveRig({ preset: 'warm', intensity: 1, azimuth: 0, elevation: undefined });
    expect(plain.key.height).toBe(warm.key.height);
  });
  it('rejects angles outside the useful range', () => {
    for (const elevation of [0, 4, 86, 200, NaN, 'high']) {
      const p = defaults(m);
      p.lighting = { preset: 'studio', intensity: 1, azimuth: 0, elevation: elevation as number };
      expect(() => validatePalette(p, m)).toThrow();
    }
  });
});
