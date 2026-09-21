export const MATERIALS = [
  'pla',
  'matte-pla',
  'silk-pla',
  'pla-cf',
  'petg',
  'matte-petg',
  'metallic-petg',
  'petg-cf',
  'abs',
  'asa',
  'pc',
  'pa',
  'pa-cf',
  'tpu',
] as const;
export type MaterialKind = (typeof MATERIALS)[number];
/** Display names only. Slugs stay stable in palettes, inventory and print profiles. */
export const MATERIAL_LABELS: Record<MaterialKind, string> = {
  pla: 'PLA',
  'matte-pla': '哑光 PLA',
  'silk-pla': '丝绸 PLA',
  'pla-cf': 'PLA-CF',
  petg: 'PETG',
  'matte-petg': '哑光 PETG',
  'metallic-petg': '金属质感 PETG',
  'petg-cf': '碳纤 PETG',
  abs: 'ABS',
  asa: 'ASA',
  pc: 'PC',
  pa: '尼龙 PA',
  'pa-cf': '碳纤尼龙',
  tpu: 'TPU',
};
/** Materials a flexible part may be printed in; everything else is rigid. */
export const FLEXIBLE_MATERIALS: readonly MaterialKind[] = ['tpu'];
export type Part = {
  id: string;
  name: string;
  sourceName: string;
  assembly: string;
  assemblyId: string;
  role: string;
  printable: boolean;
  plate: number | null;
  defaultColor: string;
  bounds: number[][];
  triangles: number;
  defaultMaterial: MaterialKind;
  metalness: number;
  paintable?: boolean;
};
export type Manifest = {
  schemaVersion: number;
  modelId: string;
  name: string;
  units: string;
  bounds: number[][];
  geometryNote: string;
  parts: Part[];
  displayTriangles: number;
  geometryUrl: string;
  mobileGeometryUrl?: string;
  mobileDisplayTriangles?: number;
  uiNote: string;
  viewDirections?: Partial<
    Record<'front' | 'back' | 'left' | 'right' | 'three-quarter', [number, number, number]>
  >;
  colorGroups: { id: string; name: string }[];
};
export type Finish = {
  color: string;
  material: MaterialKind;
  coating?: { kind: 'acrylic'; color: string };
  /** Filament in "my filaments" this part is bound to. While set, the part follows that spool. */
  stockId?: string;
};
export type StockItem = { id: string; name: string; color: string; material: MaterialKind };
export const LIGHT_PRESETS = ['studio', 'daylight', 'warm', 'cinema'] as const;
export type LightPreset = (typeof LIGHT_PRESETS)[number];
/**
 * Classic film-lighting setups for the cinema stage: they re-aim its lamps and set the
 * key/fill/rim balance. The other presets keep their own lamp placement.
 */
export const LIGHT_PATTERNS = ['butterfly', 'rembrandt', 'split', 'rim'] as const;
export type LightPattern = (typeof LIGHT_PATTERNS)[number];
export type Lighting = {
  preset: LightPreset;
  intensity: number;
  azimuth: number;
  /** Height of the lamps above the horizon, in degrees. Absent keeps the preset's own. */
  elevation?: number;
  /** Lamp setup. Absent means the preset's own default placement. */
  pattern?: LightPattern;
};
/** Lamp heights above the horizon the angle control accepts. */
export const ELEVATION_RANGE = { min: 5, max: 85, default: 45 } as const;
export type Surface = { layers: boolean };
export type Palette = {
  schemaVersion: 1;
  modelId: string;
  name: string;
  lighting: Lighting;
  surface: Surface;
  parts: Record<string, Finish>;
};
export const isColor = (x: unknown): x is string =>
  typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x);
export const isStockId = (x: unknown): x is string =>
  typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
/** Lamp setup of a lighting block; anything unknown falls back to the preset's own. */
export function normalizePattern(value: unknown): LightPattern | undefined {
  if (value === undefined || value === null) return undefined;
  if (!LIGHT_PATTERNS.includes(value as LightPattern)) throw new Error('未知的打光方式');
  return value as LightPattern;
}
export function defaults(model: Manifest): Palette {
  return {
    schemaVersion: 1,
    modelId: model.modelId,
    name: '默认配色',
    lighting: { preset: 'studio', intensity: 1, azimuth: -35 },
    surface: { layers: true },
    parts: Object.fromEntries(
      model.parts.map((p) => [p.id, { color: p.defaultColor, material: p.defaultMaterial }]),
    ),
  };
}
export function validatePalette(input: unknown, model: Manifest): Palette {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('方案必须是 JSON 对象');
  const p = input as Partial<Palette>;
  if (p.schemaVersion !== 1) throw new Error('不支持的方案版本');
  if (p.modelId !== model.modelId) throw new Error('此方案属于其他模型');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 120)
    throw new Error('方案名称须为 1–120 个字符');
  if (!p.parts || typeof p.parts !== 'object' || Array.isArray(p.parts))
    throw new Error('缺少 parts 字段');
  const l = p.lighting;
  if (
    !l ||
    !LIGHT_PRESETS.includes(l.preset) ||
    !Number.isFinite(l.intensity) ||
    l.intensity < 0.3 ||
    l.intensity > 1.8 ||
    !Number.isFinite(l.azimuth) ||
    l.azimuth < -180 ||
    l.azimuth > 180
  )
    throw new Error('灯光参数无效');
  const pattern = normalizePattern(l.pattern);
  let elevation: number | undefined;
  if (l.elevation !== undefined && l.elevation !== null) {
    if (
      !Number.isFinite(l.elevation) ||
      l.elevation < ELEVATION_RANGE.min ||
      l.elevation > ELEVATION_RANGE.max
    )
      throw new Error('光源角度须为 5–85 度');
    elevation = Math.round(l.elevation);
  }
  if (!p.surface || typeof p.surface.layers !== 'boolean') throw new Error('表面设置无效');
  const ids = new Set(model.parts.map((x) => x.id));
  if (Object.keys(p.parts).length !== ids.size) throw new Error('方案必须包含模型的全部零件');
  const clean: Record<string, Finish> = {};
  for (const [id, finish] of Object.entries(p.parts)) {
    if (!ids.has(id)) throw new Error(`未知零件：${id}`);
    if (!finish || !isColor(finish.color) || !MATERIALS.includes(finish.material))
      throw new Error(`零件参数无效：${id}`);
    clean[id] = { color: finish.color.toUpperCase(), material: finish.material };
    if (finish.stockId !== undefined) {
      if (!isStockId(finish.stockId)) throw new Error(`耗材绑定无效：${id}`);
      clean[id].stockId = finish.stockId;
    }
    if (finish.coating !== undefined) {
      if (
        finish.coating.kind !== 'acrylic' ||
        !isColor(finish.coating.color) ||
        !model.parts.find((p) => p.id === id)?.paintable
      )
        throw new Error(`此零件不支持丙烯涂色或涂色参数无效：${id}`);
      clean[id].coating = { kind: 'acrylic', color: finish.coating.color.toUpperCase() };
    }
  }
  const lighting: Lighting = { preset: l.preset, intensity: l.intensity, azimuth: l.azimuth };
  if (pattern !== undefined) lighting.pattern = pattern;
  if (elevation !== undefined) lighting.elevation = elevation;
  return {
    schemaVersion: 1,
    modelId: model.modelId,
    name: p.name,
    lighting,
    surface: { layers: p.surface.layers },
    parts: clean,
  };
}
/**
 * Tolerant reader for data this app wrote earlier. Import and the agent API stay strict;
 * this is only for restoring what is already in the browser, where dropping a palette or a
 * saved scheme for one changed field would cost the user their work.
 */
export function repairPalette(input: unknown, model: Manifest): Palette | null {
  try {
    return validatePalette(input, model);
  } catch {
    /* fall through and repair what can be repaired */
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, any>;
  if (raw.modelId && raw.modelId !== model.modelId) return null;
  const base = defaults(model);
  const lighting: Lighting = { ...base.lighting };
  const source = raw.lighting;
  if (source && typeof source === 'object') {
    if (LIGHT_PRESETS.includes(source.preset)) lighting.preset = source.preset;
    if (Number.isFinite(source.intensity) && source.intensity >= 0.3 && source.intensity <= 1.8)
      lighting.intensity = source.intensity;
    if (Number.isFinite(source.azimuth) && source.azimuth >= -180 && source.azimuth <= 180)
      lighting.azimuth = source.azimuth;
    if (LIGHT_PATTERNS.includes(source.pattern)) lighting.pattern = source.pattern;
  }
  const parts: Record<string, Finish> = {};
  let kept = 0;
  for (const part of model.parts) {
    const stored = raw.parts?.[part.id];
    const fallback = base.parts[part.id];
    if (!stored || !isColor(stored.color) || !MATERIALS.includes(stored.material)) {
      parts[part.id] = { ...fallback };
      continue;
    }
    kept++;
    const finish: Finish = { color: stored.color.toUpperCase(), material: stored.material };
    if (isStockId(stored.stockId)) finish.stockId = stored.stockId;
    if (stored.coating?.kind === 'acrylic' && isColor(stored.coating.color) && part.paintable)
      finish.coating = { kind: 'acrylic', color: stored.coating.color.toUpperCase() };
    parts[part.id] = finish;
  }
  // Nothing recognizable: not a palette of ours, so there is nothing to migrate.
  if (!kept) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 120) : base.name;
  return {
    schemaVersion: 1,
    modelId: model.modelId,
    name,
    lighting,
    surface: { layers: raw.surface?.layers !== false },
    parts,
  };
}
export class EditorState {
  palette: Palette;
  private undoStack: Palette[] = [];
  private redoStack: Palette[] = [];
  constructor(public model: Manifest) {
    this.palette = defaults(model);
  }
  commit(next: Palette) {
    const clean = validatePalette(next, this.model);
    if (JSON.stringify(clean) === JSON.stringify(this.palette)) return;
    this.undoStack.push(structuredClone(this.palette));
    this.undoStack = this.undoStack.slice(-60);
    this.redoStack = [];
    this.palette = clean;
  }
  update(ids: string[], patch: Partial<Finish>) {
    const p = structuredClone(this.palette);
    for (const id of ids) {
      if (!p.parts[id]) throw new Error(`未知零件：${id}`);
      p.parts[id] = { ...p.parts[id], ...patch };
      if (patch.color && !('coating' in patch)) delete p.parts[id].coating;
      // Choosing a color or material by hand detaches the part from its spool.
      if ((patch.color || patch.material) && !('stockId' in patch)) delete p.parts[id].stockId;
    }
    this.commit(p);
  }
  /**
   * Follow the local filament library: every bound part takes its spool's color and material.
   * Spools that disappeared release their parts, keeping the last color. Returns changed part IDs.
   */
  syncStock(items: StockItem[]) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const p = structuredClone(this.palette);
    const changed: string[] = [];
    for (const [id, finish] of Object.entries(p.parts)) {
      if (!finish.stockId) continue;
      const item = byId.get(finish.stockId);
      if (!item) {
        delete finish.stockId;
        changed.push(id);
      } else if (finish.color !== item.color.toUpperCase() || finish.material !== item.material) {
        finish.color = item.color.toUpperCase();
        finish.material = item.material;
        changed.push(id);
      }
    }
    if (changed.length) this.commit(p);
    return changed;
  }
  undo() {
    const p = this.undoStack.pop();
    if (p) {
      this.redoStack.push(this.palette);
      this.palette = p;
    }
    return !!p;
  }
  redo() {
    const p = this.redoStack.pop();
    if (p) {
      this.undoStack.push(this.palette);
      this.palette = p;
    }
    return !!p;
  }
  get canUndo() {
    return !!this.undoStack.length;
  }
  get canRedo() {
    return !!this.redoStack.length;
  }
}
