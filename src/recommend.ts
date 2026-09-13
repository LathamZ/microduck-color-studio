import {
  isColor,
  MATERIALS,
  validatePalette,
  type Manifest,
  type MaterialKind,
  type Palette,
} from './domain';
export type StockItem = { id: string; name: string; color: string; material: MaterialKind };
export type Inventory = { schemaVersion: 1; items: StockItem[] };
export type RecommendationMode = 'stock' | 'add-one' | 'paint';
export type ColorPreset = { name: string; tag: string; colors: string[] };
export type Recommendation = {
  id: string;
  name: string;
  mode: RecommendationMode;
  palette: Palette;
  complete: boolean;
  used: { stockId: string; name: string; color: string; material: MaterialKind; count: number }[];
  missing: { color: string; material: MaterialKind; reason: string; count: number }[];
  paint: { color: string; partIds: string[]; reason: string }[];
  distance: number;
};
export function validateInventory(input: unknown): Inventory {
  if (!input || typeof input !== 'object') throw new Error('库存必须是 JSON 对象');
  const x = input as Inventory;
  if (x.schemaVersion !== 1 || !Array.isArray(x.items) || x.items.length > 200)
    throw new Error('库存格式不正确，最多 200 项');
  const ids = new Set<string>();
  return {
    schemaVersion: 1,
    items: x.items.map((i) => {
      if (
        !i ||
        typeof i.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(i.id) ||
        ids.has(i.id) ||
        typeof i.name !== 'string' ||
        !i.name.trim() ||
        i.name.length > 80 ||
        !isColor(i.color) ||
        !MATERIALS.includes(i.material)
      )
        throw new Error('库存包含重复 ID 或无效的名称、颜色、材质');
      ids.add(i.id);
      return { id: i.id, name: i.name.trim(), color: i.color.toUpperCase(), material: i.material };
    }),
  };
}
// CIE76 in D65 Lab: transparent, deterministic proximity, not a subjective beauty score.
export function lab(hex: string): number[] {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x > 0.04045 ? ((x + 0.055) / 1.055) ** 2.4 : x / 12.92));
  const [r, g, b] = rgb;
  const xyz = [
    (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883,
  ].map((x) => (x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116));
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
}
export function distance(a: string, b: string) {
  const x = lab(a),
    y = lab(b);
  return Math.hypot(...x.map((v, i) => v - y[i]));
}
export type RecommendationOptions = { seed?: number };
function variedPresets(
  stock: StockItem[],
  count: number,
  mode: RecommendationMode,
  seed: number,
): ColorPreset[] {
  let n = seed >>> 0;
  const random = () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
  const owned = [...new Set(stock.filter((x) => x.material !== 'tpu').map((x) => x.color))];
  const colors = owned.length ? owned : ['#F1EFE7', '#30343B'];
  const makeAccent = () => {
    const hue = random() * 360,
      s = 0.35 + random() * 0.35,
      l = 0.4 + random() * 0.25;
    const a = s * Math.min(l, 1 - l);
    return (
      '#' +
      [0, 8, 4]
        .map((k) => {
          const h = (k + hue / 30) % 12;
          return Math.round((l - a * Math.max(-1, Math.min(h - 3, 9 - h, 1))) * 255)
            .toString(16)
            .padStart(2, '0');
        })
        .join('')
        .toUpperCase()
    );
  };
  return Array.from({ length: 48 }, (_, i) => {
    const first = Math.floor(random() * colors.length);
    const chosen = Array.from(
      { length: count },
      (_, j) => colors[j === 0 ? first : Math.floor(random() * colors.length)],
    );
    if (colors.length > 1 && count > 1 && chosen[1] === chosen[0])
      chosen[1] = colors[(first + 1 + Math.floor(random() * (colors.length - 1))) % colors.length];
    if (mode !== 'stock' && count > 2) chosen[count - 1] = makeAccent();
    return { name: `灵感组合 ${i + 1}`, tag: '新组合', colors: chosen };
  });
}
export function recommend(
  model: Manifest,
  base: Palette,
  inventory: Inventory,
  presets: ColorPreset[],
  mode: RecommendationMode,
  options: RecommendationOptions = {},
): Recommendation[] {
  validatePalette(base, model);
  const stock = validateInventory(inventory).items;
  if (!['stock', 'add-one', 'paint'].includes(mode)) throw new Error('未知推荐模式');
  const roles = model.colorGroups.map((x) => x.id);
  if (
    options.seed !== undefined &&
    (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 4294967295)
  )
    throw new Error('随机种子必须为 0–4294967295 的整数');
  const candidatesForLook =
    options.seed === undefined ? presets : variedPresets(stock, roles.length, mode, options.seed);
  const results = candidatesForLook.map((preset, index) => {
    const palette = structuredClone(base);
    palette.name = `${preset.name} · ${mode === 'stock' ? '已有耗材' : mode === 'paint' ? '丙烯点缀' : '补充一色'}`;
    const used = new Map<string, Recommendation['used'][number]>(),
      missing = new Map<string, Recommendation['missing'][number]>();
    let total = 0;
    const groups = new Map<
      string,
      { ids: string[]; target: string; flex: boolean; role: string }
    >();
    for (const p of model.parts.filter((x) => x.printable)) {
      const ri = roles.indexOf(p.role);
      const target = preset.colors[ri] || p.defaultColor;
      const flex = p.defaultMaterial === 'tpu';
      const key = p.role + ':' + flex;
      const group = groups.get(key) || { ids: [], target, flex, role: p.role };
      group.ids.push(p.id);
      groups.set(key, group);
    }
    // At most one discretionary spool; missing flexible material is always explicitly listed.
    const candidates = [...groups.values()].map((g) => {
      const valid = stock.filter((s) => (g.flex ? s.material === 'tpu' : s.material !== 'tpu'));
      const nearest = valid
        .slice()
        .sort(
          (a, b) =>
            distance(a.color, g.target) - distance(b.color, g.target) || a.id.localeCompare(b.id),
        )[0];
      return { g, nearest, delta: nearest ? distance(nearest.color, g.target) : 100 };
    });
    const upgrade =
      mode === 'add-one'
        ? candidates.filter((x) => !x.g.flex).sort((a, b) => b.delta - a.delta)[0]
        : undefined;
    const painting: Recommendation['paint'] = [];
    for (const { g, nearest, delta } of candidates) {
      const buy = mode === 'add-one' && upgrade?.g === g && delta > 12;
      if (!nearest || buy) {
        const material: MaterialKind = g.flex ? 'tpu' : 'pla';
        const proposed = g.flex
          ? model.parts.find((p) => p.defaultMaterial === 'tpu')?.defaultColor || g.target
          : g.target;
        const reason = !nearest
          ? g.flex
            ? '缺少 TPU，柔性件不能用硬质料替代'
            : '缺少可用于硬质件的耗材'
          : '补一卷此色，使该色组更接近目标配色';
        const key = proposed + material;
        const item = missing.get(key) || { color: proposed, material, reason, count: 0 };
        item.count += g.ids.length;
        missing.set(key, item);
        for (const id of g.ids) {
          palette.parts[id] = { color: proposed, material };
        }
        total += buy ? 0 : 100;
        continue;
      }
      const item = used.get(nearest.id) || {
        stockId: nearest.id,
        name: nearest.name,
        color: nearest.color,
        material: nearest.material,
        count: 0,
      };
      item.count += g.ids.length;
      used.set(nearest.id, item);
      for (const id of g.ids)
        palette.parts[id] = { color: nearest.color, material: nearest.material };
      const paintable = model.parts
        .filter((p) => g.ids.includes(p.id) && p.paintable === true)
        .map((p) => p.id);
      if (mode === 'paint' && paintable.length && delta > 12) {
        for (const id of paintable)
          palette.parts[id].coating = { kind: 'acrylic', color: g.target };
        painting.push({
          color: g.target,
          partIds: paintable,
          reason: '用现有耗材打印，再用丙烯笔为允许涂色的外观件补色；先在试片上确认附着效果。',
        });
      }
      total += delta * (mode === 'paint' && paintable.length === g.ids.length ? 0.3 : 1);
    }
    return {
      id: `${mode}-${options.seed ?? 0}-${index}`,
      name: preset.name,
      mode,
      palette: validatePalette(palette, model),
      complete: missing.size === 0,
      used: [...used.values()],
      missing: [...missing.values()],
      paint: painting,
      distance: total / Math.max(1, groups.size),
    };
  });
  const seen = new Set<string>();
  return results
    .sort(
      (a, b) =>
        a.missing.length - b.missing.length || a.distance - b.distance || a.id.localeCompare(b.id),
    )
    .filter((p) => {
      const key = JSON.stringify(p.palette.parts);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}
