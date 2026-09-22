import { repairPalette, type Manifest, type Palette } from './domain';
export type SavedLook = { id: string; name: string; savedAt: number; palette: Palette };
export const LOOKS_KEY = (modelId: string) => `color-studio:looks:${modelId}`;
/** Oldest looks are dropped past this many; a browser-local shelf, not an archive. */
export const MAX_LOOKS = 40;
const isTimestamp = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 4e12;
const isLookId = (x: unknown): x is string =>
  typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
/** Read stored looks defensively: anything that no longer validates is skipped, never repaired. */
export function parseLooks(raw: unknown, model: Manifest, now = 0): SavedLook[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const looks: SavedLook[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const l = entry as Partial<SavedLook>;
    if (!isLookId(l.id) || seen.has(l.id) || !isTimestamp(l.savedAt)) continue;
    // Repair rather than drop: a scheme saved by an older version still belongs to the user.
    const palette = repairPalette(l.palette, model);
    if (!palette) continue;
    seen.add(l.id);
    looks.push({
      id: l.id,
      name:
        typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 120) : palette.name,
      savedAt: Math.min(l.savedAt, now || l.savedAt),
      palette,
    });
  }
  return looks.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_LOOKS);
}
export function readLooks(model: Manifest, storage: Storage | null, now = 0): SavedLook[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOOKS_KEY(model.modelId));
    return raw ? parseLooks(JSON.parse(raw), model, now) : [];
  } catch {
    return [];
  }
}
export function writeLooks(model: Manifest, storage: Storage | null, looks: SavedLook[]) {
  if (!storage) return false;
  try {
    storage.setItem(
      LOOKS_KEY(model.modelId),
      JSON.stringify(looks.slice(0, MAX_LOOKS).map((l) => ({ ...l, palette: { ...l.palette } }))),
    );
    return true;
  } catch {
    return false;
  }
}
/**
 * A scheme is the colors, materials, coatings and filament links of its parts. Lighting and
 * surface settings are how you happen to be looking at the duck rather than part of a scheme,
 * so two palettes are the same look even after the lamp has moved.
 */
export function samePalette(a: Palette, b: Palette) {
  return JSON.stringify(a.parts) === JSON.stringify(b.parts);
}
/**
 * What applying a look hands back: its own parts over the light and surface already in use, so
 * switching schemes leaves the room you are viewing in exactly as it was.
 */
export function lookPalette(look: SavedLook, current: Palette): Palette {
  return {
    ...structuredClone(look.palette),
    lighting: current.lighting,
    surface: current.surface,
  };
}
export function relativeTime(savedAt: number, now: number, locale = 'zh-CN') {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return locale === 'en' ? 'just now' : '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return locale === 'en' ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return locale === 'en' ? `${hours} h ago` : `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return locale === 'en' ? `${days} d ago` : `${days} 天前`;
  const date = new Date(savedAt);
  const stamp = `${date.getFullYear()}‑${String(date.getMonth() + 1).padStart(2, '0')}‑${String(date.getDate()).padStart(2, '0')}`;
  return locale === 'en' ? `saved ${stamp}` : `${stamp} 保存`;
}
/** Strip the auto-generated suffix so "暖白与橙 · 已有耗材" saves as "暖白与橙". */
export function suggestedName(paletteName: string, index: number) {
  const base = paletteName.split(' · ')[0].trim();
  return base && !/^默认配色$/.test(base) ? base : `配色 ${index}`;
}
