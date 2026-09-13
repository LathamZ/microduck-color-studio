export const MATERIALS = [
  'pla',
  'matte-pla',
  'petg',
  'matte-petg',
  'metallic-petg',
  'pla-cf',
  'tpu',
] as const;
export type MaterialKind = (typeof MATERIALS)[number];
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
};
export type Lighting = {
  preset: 'studio' | 'daylight' | 'warm';
  intensity: number;
  azimuth: number;
};
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
    !['studio', 'daylight', 'warm'].includes(l.preset) ||
    !Number.isFinite(l.intensity) ||
    l.intensity < 0.3 ||
    l.intensity > 1.8 ||
    !Number.isFinite(l.azimuth) ||
    l.azimuth < -180 ||
    l.azimuth > 180
  )
    throw new Error('灯光参数无效');
  if (!p.surface || typeof p.surface.layers !== 'boolean') throw new Error('表面设置无效');
  const ids = new Set(model.parts.map((x) => x.id));
  if (Object.keys(p.parts).length !== ids.size) throw new Error('方案必须包含模型的全部零件');
  const clean: Record<string, Finish> = {};
  for (const [id, finish] of Object.entries(p.parts)) {
    if (!ids.has(id)) throw new Error(`未知零件：${id}`);
    if (!finish || !isColor(finish.color) || !MATERIALS.includes(finish.material))
      throw new Error(`零件参数无效：${id}`);
    clean[id] = { color: finish.color.toUpperCase(), material: finish.material };
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
  return {
    schemaVersion: 1,
    modelId: model.modelId,
    name: p.name,
    lighting: { preset: l.preset, intensity: l.intensity, azimuth: l.azimuth },
    surface: { layers: p.surface.layers },
    parts: clean,
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
    }
    this.commit(p);
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
