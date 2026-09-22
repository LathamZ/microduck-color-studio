import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_LOOKS,
  LOOKS_KEY,
  lookPalette,
  parseLooks,
  readLooks,
  relativeTime,
  samePalette,
  suggestedName,
  writeLooks,
  type SavedLook,
} from '../src/looks';
import { defaults, repairPalette, type Manifest, type Palette } from '../src/domain';
import { readStoredInventory } from '../src/recommend';
const model = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
const now = 1_700_000_000_000;
const stored = (id: string, savedAt: number, name = id): SavedLook => ({
  id,
  name,
  savedAt,
  palette: { ...defaults(model), name },
});
const memory = (initial?: string) => {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(LOOKS_KEY(model.modelId), initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: map.size,
  } as Storage;
};
describe('saved looks store', () => {
  it('round-trips through storage and sorts newest first', () => {
    const storage = memory();
    const looks = [stored('a', now - 5000), stored('b', now)];
    expect(writeLooks(model, storage, looks)).toBe(true);
    expect(readLooks(model, storage, now).map((l) => l.id)).toEqual(['b', 'a']);
  });
  it('drops entries that are corrupt, mismatched or belong to another model', () => {
    const other = { ...defaults(model), modelId: 'other-duck' };
    const looks = parseLooks(
      [
        { id: 'ok', name: '好的', savedAt: now, palette: defaults(model) },
        { id: 'wrong-model', name: 'x', savedAt: now, palette: other },
        { id: 'no-palette', name: 'x', savedAt: now },
        { id: '../escape', name: 'x', savedAt: now, palette: defaults(model) },
        { id: 'ok', name: 'duplicate', savedAt: now, palette: defaults(model) },
        { id: 'no-time', name: 'x', savedAt: 'yesterday', palette: defaults(model) },
        null,
        'nope',
      ],
      model,
      now,
    );
    expect(looks.map((l) => l.id)).toEqual(['ok']);
  });
  it('survives unreadable storage instead of throwing', () => {
    expect(readLooks(model, memory('{not json'), now)).toEqual([]);
    expect(readLooks(model, null, now)).toEqual([]);
    expect(readLooks(model, memory('{"schemaVersion":1}'), now)).toEqual([]);
  });
  it('caps the shelf and keeps the newest', () => {
    const many = Array.from({ length: MAX_LOOKS + 12 }, (_, i) =>
      stored(`look-${i}`, now - i * 1000),
    );
    const kept = parseLooks(many, model, now);
    expect(kept).toHaveLength(MAX_LOOKS);
    expect(kept[0].id).toBe('look-0');
    expect(kept.at(-1)!.id).toBe(`look-${MAX_LOOKS - 1}`);
  });
  it('falls back to the palette name when a stored name is empty', () => {
    const palette = { ...defaults(model), name: '夜色' };
    expect(parseLooks([{ id: 'a', name: '  ', savedAt: now, palette }], model, now)[0].name).toBe(
      '夜色',
    );
  });
  it('compares the parts of a palette: light and surface are not part of a scheme', () => {
    const base = defaults(model);
    const clone: Palette = structuredClone(base);
    expect(samePalette(base, clone)).toBe(true);
    clone.lighting.preset = 'warm';
    clone.surface.layers = false;
    expect(samePalette(base, clone)).toBe(true);
    const linked: Palette = structuredClone(base);
    linked.parts[model.parts[0].id].stockId = 'spool-1';
    expect(samePalette(base, linked)).toBe(false);
  });
  it('applies a look without moving the lamp or the layer-line shading', () => {
    const saved: SavedLook = {
      id: 'look-1',
      name: '夜色',
      savedAt: 1,
      palette: { ...defaults(model), lighting: { preset: 'cinema', intensity: 1.4, azimuth: 20 } },
    };
    const current: Palette = {
      ...defaults(model),
      lighting: { preset: 'warm', intensity: 0.8, azimuth: -60 },
      surface: { layers: false },
    };
    current.parts[model.parts[0].id].color = '#123456';
    const applied = lookPalette(saved, current);
    expect(applied.parts).toEqual(saved.palette.parts);
    expect(applied.lighting).toEqual(current.lighting);
    expect(applied.surface).toEqual(current.surface);
    // The saved look itself is untouched, so applying twice gives the same result.
    expect(saved.palette.lighting.preset).toBe('cinema');
    applied.parts[model.parts[0].id].color = '#ffffff';
    expect(saved.palette.parts[model.parts[0].id].color).not.toBe('#ffffff');
  });
  it('names a save after the palette, falling back to a numbered look', () => {
    expect(suggestedName('暖白与橙 · 已有耗材', 1)).toBe('暖白与橙');
    expect(suggestedName('默认配色', 3)).toBe('配色 3');
    expect(suggestedName('', 2)).toBe('配色 2');
  });
  it('describes when a look was saved in both languages', () => {
    expect(relativeTime(now - 30_000, now, 'zh-CN')).toBe('刚刚');
    expect(relativeTime(now - 10 * 60_000, now, 'en')).toBe('10 min ago');
    expect(relativeTime(now - 5 * 3600_000, now, 'zh-CN')).toBe('5 小时前');
    expect(relativeTime(now - 3 * 86400_000, now, 'zh-CN')).toBe('3 天前');
    expect(relativeTime(now - 90 * 86400_000, now, 'en')).toMatch(/^saved \d{4}/);
  });
});

describe('restoring data written by earlier versions', () => {
  const part = model.parts[0].id;
  it('keeps every valid filament item and skips only what it cannot read', () => {
    const storage = memory();
    storage.setItem(
      'color-studio:inventory',
      JSON.stringify({
        schemaVersion: 1,
        items: [
          { id: 'good-one', name: '白色 PLA', color: '#F1EFE7', material: 'pla' },
          { id: 'unknown-material', name: '未来材质', color: '#123456', material: 'unobtainium' },
          { id: 'bad-color', name: '坏颜色', color: 'red', material: 'pla' },
          { id: 'good-two', name: '黑色 PETG', color: '#30343B', material: 'petg' },
        ],
      }),
    );
    const read = readStoredInventory(storage);
    expect(read.inventory.items.map((i) => i.id)).toEqual(['good-one', 'good-two']);
    expect(read.dropped).toBe(2);
    expect(read.readable).toBe(true);
    expect(read.raw).toContain('unobtainium');
  });
  it('hands back an unreadable payload untouched instead of replacing it with defaults', () => {
    const storage = memory();
    storage.setItem('color-studio:inventory', '{ this is not json');
    const read = readStoredInventory(storage);
    expect(read.readable).toBe(false);
    expect(read.inventory.items).toEqual([]);
    expect(read.raw).toBe('{ this is not json');
    expect(storage.getItem('color-studio:inventory')).toBe('{ this is not json');
  });
  it('still accepts an inventory written before new materials existed', () => {
    const storage = memory();
    const old = {
      schemaVersion: 1,
      items: [
        { id: 'legacy', name: '老库存', color: '#F1EFE7', material: 'metallic-petg' },
        { id: 'legacy-tpu', name: '柔性', color: '#30343B', material: 'tpu' },
      ],
    };
    storage.setItem('color-studio:inventory', JSON.stringify(old));
    const read = readStoredInventory(storage);
    expect(read.readable).toBe(true);
    expect(read.dropped).toBe(0);
    expect(read.inventory.items).toHaveLength(2);
  });
  it('repairs a palette whose lighting block is from another version', () => {
    const stored = {
      ...defaults(model),
      lighting: { preset: 'custom', intensity: 1.2, azimuth: 10, temperature: 4200 },
    };
    const repaired = repairPalette(JSON.parse(JSON.stringify(stored)), model);
    expect(repaired).not.toBeNull();
    expect(repaired!.lighting.preset).toBe('studio');
    expect(repaired!.lighting.intensity).toBe(1.2);
    expect((repaired!.lighting as Record<string, unknown>).temperature).toBeUndefined();
  });
  it('fills in parts an older palette never knew about', () => {
    const stored = structuredClone(defaults(model));
    delete stored.parts[part];
    stored.parts['unknown-part'] = { color: '#123456', material: 'pla' };
    const repaired = repairPalette(stored, model)!;
    expect(Object.keys(repaired.parts)).toHaveLength(model.parts.length);
    expect(repaired.parts[part]).toEqual(defaults(model).parts[part]);
  });
  it('returns null when the data is not ours at all', () => {
    expect(repairPalette({ schemaVersion: 1, modelId: 'another-duck' }, model)).toBeNull();
    expect(repairPalette({ hello: 'world' }, model)).toBeNull();
    expect(repairPalette(null, model)).toBeNull();
  });
  it('keeps a saved scheme that an older version wrote', () => {
    const storage = memory();
    const oldPalette = {
      ...defaults(model),
      lighting: { preset: 'warm', intensity: 1.4, azimuth: 0, unknownField: true },
    };
    storage.setItem(
      LOOKS_KEY(model.modelId),
      JSON.stringify([{ id: 'old-look', name: '旧方案', savedAt: now, palette: oldPalette }]),
    );
    const looks = readLooks(model, storage, now);
    expect(looks).toHaveLength(1);
    expect(looks[0].name).toBe('旧方案');
    expect(looks[0].palette.lighting.preset).toBe('warm');
  });
});
