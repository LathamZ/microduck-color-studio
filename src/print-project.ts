import { printerById } from './printers';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { isColor, MATERIALS, type Manifest, type Palette, type Finish } from './domain';

type Vec = [number, number, number];
type Mesh = { vertices: Vec[]; triangles: Vec[] };
export type PartMatch = {
  partId: string;
  /** 0–1 name similarity between the build object and this part. */
  confidence: number;
  /** Another candidate scored within 5 points, so the winner is not safe to apply silently. */
  ambiguous: boolean;
};
export type PrintObject = Mesh & {
  id: string;
  name: string;
  size: Vec;
  printable: boolean;
  /** Best candidates, strongest first. Empty when nothing looks like this part. */
  matches: PartMatch[];
  originalColor: string;
  originalMaterial: Finish['material'];
};
/** At or above this confidence a match is applied without asking. */
export const MATCH_ACCEPT = 0.8;
/** Below this confidence the object counts as unmatched and needs a human decision. */
export const MATCH_FLOOR = 0.5;
const MATCH_MARGIN = 0.05;
/**
 * What a build object still needs from the user:
 * `auto` applies silently, `confirm` shows the best guess and asks for one confirmation,
 * `choose` has no acceptable guess and needs the part to be picked deliberately.
 */
export type MatchAction = 'auto' | 'confirm' | 'choose';
export function matchAction(
  confidence: number | null,
  { linked, chosen, contested = false }: { linked: boolean; chosen: boolean; contested?: boolean },
): MatchAction {
  if (chosen) return 'auto'; // the user already decided this row
  if (!linked) return 'choose'; // nothing reached MATCH_FLOOR
  // Below MATCH_ACCEPT, or a second candidate is within a few points: a human looks at it.
  if (confidence === null || contested) return 'confirm';
  return confidence >= MATCH_ACCEPT ? 'auto' : 'confirm';
}
/** Same name but one exchanged word (left/right, v1/v2, A/B): never auto-matched. */
const VARIANT_CEILING = 0.45;
const normalizeCache = new Map<string, string>();
const NAME_EXT = /\.(stl|3mf|obj|step|stp|ply|glb|gltf|iges|igs)$/;
const normalizeName = (value: string) => {
  const hit = normalizeCache.get(value);
  if (hit !== undefined) return hit;
  const clean = value
    .toLowerCase()
    .replace(NAME_EXT, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .trim();
  if (normalizeCache.size > 4096) normalizeCache.clear();
  normalizeCache.set(value, clean);
  return clean;
};
/** Latin words stay whole; CJK characters become one token each so partial names still match. */
const tokenize = (value: string) => normalizeName(value).match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || [];
const bigrams = (value: string) => {
  const text = normalizeName(value).replace(/ /g, '');
  const set = new Set<string>();
  if (!text) return set;
  if (text.length === 1) set.add(text);
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
};
const dice = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return (2 * shared) / (a.size + b.size);
};
/**
 * Similarity of two part names. Tolerates case, separators, file names and index prefixes,
 * so "ankle_left_v2" still matches "ankle_left" while "left_shell" and "right_shell" do not.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = normalizeName(left),
    b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = new Set(tokenize(left)),
    B = new Set(tokenize(right));
  const shared = [...A].filter((token) => B.has(token)).length;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (A.size && B.size && shared === Math.min(A.size, B.size) && short.length >= 2)
    // Every token of the shorter name appears in the longer one: added letters still match.
    return Math.min(1, 0.72 + 0.28 * (short.length / long.length));
  // "upper_leg_left" vs "upper_leg_right" differs by one word while sharing a long prefix.
  // Character overlap would read that as a match, so variants stay below the floor.
  if (shared === Math.min(A.size, B.size) - 1) return Math.min(VARIANT_CEILING, 0.8 * dice(A, B));
  return 0.8 * Math.max(dice(A, B), dice(bigrams(a), bigrams(b)));
}
/** Rank printable parts for a build object. Never invents a candidate out of nothing. */
export function matchPrintObject(name: string, model: Manifest, limit = 3): PartMatch[] {
  const ranked = model.parts
    .filter((p) => p.printable)
    .map((p) => ({
      partId: p.id,
      confidence: Math.max(
        nameSimilarity(name, p.sourceName),
        nameSimilarity(name, p.id),
        nameSimilarity(name, p.name),
      ),
    }))
    .filter((m) => m.confidence > 0.15)
    .sort((a, b) => b.confidence - a.confidence || a.partId.localeCompare(b.partId))
    .slice(0, Math.max(1, limit));
  const best = ranked[0];
  const runnerUp = ranked[1]?.confidence ?? -1;
  // Contested: a second candidate sits within the margin of the winner. Only then does the
  // winner need a human, and only candidates that close to it are called alternatives.
  const contested = ranked.length > 1 && best.confidence - runnerUp < MATCH_MARGIN;
  return ranked.map((m) => ({
    ...m,
    ambiguous: contested && best.confidence - m.confidence < MATCH_MARGIN,
  }));
}
export type PrintProject = {
  name: string;
  objects: PrintObject[];
  printer?: Record<string, unknown>;
};
export type PrintAssignment = {
  objectId: string;
  enabled: boolean;
  partId?: string;
  finish?: Finish;
};
export type PrintOptions = {
  printerId?: string;
  width: number;
  depth: number;
  height: number;
  margin: number;
  gap: number;
  grouping: 'color' | 'part';
};
export type PrintPlacement = {
  objectId: string;
  name: string;
  partId?: string;
  finish: Finish;
  x: number;
  y: number;
  size: Vec;
};
export type PrintPlate = {
  id: number;
  color: string;
  material: Finish['material'];
  placements: PrintPlacement[];
};
export type PrintPlan = {
  schemaVersion: 1;
  source: string;
  modelId: string;
  options: PrintOptions;
  plates: PrintPlate[];
  excluded: string[];
};
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const xml = (s: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(s))
    throw new Error('XML declarations with external entities are not supported.');
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(message);
    },
  }).parseFromString(s, 'application/xml');
};
type El = NonNullable<ReturnType<typeof xml>['documentElement']>;
const children = (el: El | null | undefined, name: string): El[] => {
  const result: El[] = [];
  if (el)
    for (let i = 0; i < el.childNodes.length; i++) {
      const n = el.childNodes[i];
      if (n.nodeType === 1 && (n as El).localName === name) result.push(n as El);
    }
  return result;
};
const child = (el: El | null | undefined, name: string) => children(el, name)[0];
const metadata = (el: El, key: string) =>
  children(el, 'metadata')
    .find((n) => n.getAttribute('key') === key)
    ?.getAttribute('value');
const numeric = (value: string | null) => {
  if (value === null || value.trim() === '' || !Number.isFinite(Number(value)))
    throw new Error('Invalid mesh number.');
  return Number(value);
};
const matrix = (value: string | null) => {
  const m = value ? value.trim().split(/\s+/).map(Number) : IDENTITY;
  if (m.length !== 12 || m.some((v) => !Number.isFinite(v)))
    throw new Error('Invalid 3MF transform.');
  return m;
};
const transform = (v: Vec, m: number[]): Vec => [
  v[0] * m[0] + v[1] * m[3] + v[2] * m[6] + m[9],
  v[0] * m[1] + v[1] * m[4] + v[2] * m[7] + m[10],
  v[0] * m[2] + v[1] * m[5] + v[2] * m[8] + m[11],
];
const transformed = (mesh: Mesh, m: number[]): Mesh => {
  const determinant =
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (Math.abs(determinant) < 1e-12) throw new Error('Singular 3MF transform.');
  return {
    vertices: mesh.vertices.map((v) => transform(v, m)),
    triangles: determinant < 0 ? mesh.triangles.map(([a, b, c]) => [a, c, b]) : mesh.triangles,
  };
};
const safePath = (path: string, base = '') => {
  if (/^[a-z]+:/i.test(path) || path.includes('\\'))
    throw new Error('External model paths are not supported.');
  const result: string[] = [];
  for (const p of (path.startsWith('/') ? path : base + path).split('/')) {
    if (p === '..') {
      if (!result.length) throw new Error('Invalid model path.');
      result.pop();
    } else if (p && p !== '.') result.push(p);
  }
  return result.join('/');
};
/** Parse actual print meshes. Never use the render GLB as manufacturing geometry. */
export function readPrintProject(bytes: Uint8Array, name: string, model: Manifest): PrintProject {
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error('3MF exceeds the 100 MB import limit.');
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      total += f.originalSize;
      if (total > 300 * 1024 * 1024) throw new Error('3MF expands beyond 300 MB.');
      return (
        f.name.endsWith('.model') ||
        f.name.endsWith('.rels') ||
        f.name === 'Metadata/model_settings.config' ||
        f.name === 'Metadata/project_settings.config'
      );
    },
  });
  const docs = new Map<string, ReturnType<typeof xml>>();
  const doc = (path: string) => {
    if (!docs.has(path)) {
      if (!files[path]) throw new Error('Missing 3MF model: ' + path);
      const d = xml(strFromU8(files[path]));
      if ((d.documentElement!.getAttribute('unit') || 'millimeter') !== 'millimeter')
        throw new Error('Only millimeter 3MF models are supported.');
      docs.set(path, d);
    }
    return docs.get(path)!;
  };
  let main = '3D/3dmodel.model';
  if (files['_rels/.rels']) {
    const r = xml(strFromU8(files['_rels/.rels']));
    const rel = children(r.documentElement, 'Relationship').find((n) =>
      n.getAttribute('Type')?.endsWith('/3dmodel'),
    );
    if (rel) main = safePath(rel.getAttribute('Target') || '');
  }
  const root = doc(main).documentElement;
  const config = files['Metadata/model_settings.config']
    ? xml(strFromU8(files['Metadata/model_settings.config'])).documentElement
    : null;
  const cfg = new Map(children(config, 'object').map((o) => [o.getAttribute('id'), o]));

  let triangleBudget = 0;
  const getMesh = (path: string, id: string, stack: string[] = []): Mesh => {
    const key = path + '#' + id;
    if (stack.includes(key) || stack.length > 30)
      throw new Error('Cyclic or excessively nested 3MF components.');
    const object = children(child(doc(path).documentElement, 'resources'), 'object').find(
      (o) => o.getAttribute('id') === id,
    );
    if (!object) throw new Error('Missing 3MF object: ' + key);
    const mesh = child(object, 'mesh');
    if (mesh) {
      const vertices = children(child(mesh, 'vertices'), 'vertex').map(
        (v) => ['x', 'y', 'z'].map((k) => numeric(v.getAttribute(k))) as Vec,
      );
      const triangles = children(child(mesh, 'triangles'), 'triangle').map(
        (t) => ['v1', 'v2', 'v3'].map((k) => numeric(t.getAttribute(k))) as Vec,
      );
      triangleBudget += triangles.length;
      if (triangleBudget > 3000000) throw new Error('3MF exceeds 3 million triangles.');
      if (
        !triangles.length ||
        triangles.some((t) => t.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length))
      )
        throw new Error('Invalid mesh triangle indices.');
      return { vertices, triangles };
    }
    const output: Mesh = { vertices: [], triangles: [] };
    for (const c of children(child(object, 'components'), 'component')) {
      const ref = c.getAttributeNS(PROD, 'path');
      const next = ref ? safePath(ref, path.slice(0, path.lastIndexOf('/') + 1)) : path;
      const mesh = transformed(
        getMesh(next, c.getAttribute('objectid') || '', [...stack, key]),
        matrix(c.getAttribute('transform')),
      );
      const offset = output.vertices.length;
      for (const v of mesh.vertices) output.vertices.push(v);
      for (const [a, b, c] of mesh.triangles)
        output.triangles.push([a + offset, b + offset, c + offset]);
    }
    if (!output.triangles.length) throw new Error('Object has no printable mesh.');
    return output;
  };
  const objects = children(child(root, 'build'), 'item').map((item, index) => {
    const oid = item.getAttribute('objectid') || '';
    const settings = cfg.get(oid);
    if (
      settings &&
      children(settings, 'part').some((p) => {
        const subtype = p.getAttribute('subtype');
        return subtype && subtype !== 'normal_part';
      })
    )
      throw new Error('Modifier/negative volumes must be resolved in the slicer before import.');
    const resource = children(child(root, 'resources'), 'object').find(
      (o) => o.getAttribute('id') === oid,
    );
    const objectName =
      (settings && metadata(settings, 'name')) || resource?.getAttribute('name') || 'Object ' + oid;
    const mesh = transformed(getMesh(main, oid), matrix(item.getAttribute('transform')));
    const min: Vec = [Infinity, Infinity, Infinity],
      max: Vec = [-Infinity, -Infinity, -Infinity];
    for (const v of mesh.vertices)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[k]);
        max[k] = Math.max(max[k], v[k]);
      }
    const size = max.map((v, k) => v - min[k]) as Vec;
    if (size.some((v) => !Number.isFinite(v) || v <= 0 || v > 2000))
      throw new Error('Invalid print dimensions: ' + objectName);
    // Keep the source printing rotation and scale, only translate each item onto Z=0.
    mesh.vertices = mesh.vertices.map((v) => v.map((n, k) => n - min[k]) as Vec);
    const slot = Number((settings && metadata(settings, 'extruder')) || 1) - 1;
    const sourceSettings = files['Metadata/project_settings.config']
      ? JSON.parse(strFromU8(files['Metadata/project_settings.config']))
      : {};
    let originalColor = sourceSettings.filament_colour?.[slot];
    const baseResource = children(child(root, 'resources'), 'basematerials').find(
      (b) => b.getAttribute('id') === resource?.getAttribute('pid'),
    );
    const base = children(baseResource, 'base')[Number(resource?.getAttribute('pindex') || 0)];
    if (!isColor(originalColor)) originalColor = base?.getAttribute('displaycolor')?.slice(0, 7);
    const kind = String(
      sourceSettings.filament_type?.[slot] || base?.getAttribute('name') || 'pla',
    ).toLowerCase();
    const originalMaterial = MATERIALS.includes(kind as Finish['material'])
      ? (kind as Finish['material'])
      : kind === 'pla-cf'
        ? 'pla-cf'
        : 'pla';
    return {
      ...mesh,
      id: 'item-' + index,
      name: objectName,
      size,
      printable: item.getAttribute('printable') !== '0',
      matches: matchPrintObject(objectName, model),
      originalColor: isColor(originalColor) ? originalColor : '#F1EFE7',
      originalMaterial,
    };
  });
  if (!objects.length || objects.length > 500)
    throw new Error('Import requires 1–500 build objects.');
  const sourceSettings = files['Metadata/project_settings.config']
    ? JSON.parse(strFromU8(files['Metadata/project_settings.config']))
    : {};
  const printer: Record<string, unknown> = {};
  for (const key of ['printer_model', 'printer_settings_id', 'nozzle_diameter'])
    if (sourceSettings[key] !== undefined) printer[key] = sourceSettings[key];
  return { name, objects, printer };
}
export function planPrint(
  project: PrintProject,
  palette: Palette,
  assignments: PrintAssignment[],
  options: PrintOptions,
): PrintPlan {
  const { width, depth, height, margin, gap, grouping } = options;
  const printer = printerById(options.printerId);
  if (options.printerId && options.printerId !== 'custom' && !printer)
    throw new Error('Unknown printer preset.');
  if (printer && (width !== printer.width || depth !== printer.depth || height !== printer.height))
    throw new Error('Preset dimensions must match. Use custom for another bed size.');
  const minX = (printer?.left || 0) + margin,
    minY = (printer?.bottom || 0) + margin;
  const maxX = width - (printer?.right || 0) - margin,
    maxY = depth - (printer?.top || 0) - margin;
  if (
    ![width, depth, height, margin, gap].every(Number.isFinite) ||
    width < 20 ||
    depth < 20 ||
    height < 1 ||
    Math.max(width, depth, height) > 2000 ||
    margin < 0 ||
    gap < 0 ||
    margin * 2 >= Math.min(width, depth) ||
    !['color', 'part'].includes(grouping)
  )
    throw new Error('Invalid build area, margin or spacing.');
  const seen = new Set<string>();
  const groups = new Map<string, PrintPlacement[]>();
  const excluded: string[] = [];
  for (const a of assignments) {
    if (typeof a.enabled !== 'boolean' || (a.partId && a.finish))
      throw new Error('Invalid print assignment.');
    if (seen.has(a.objectId)) throw new Error('Duplicate print assignment.');
    seen.add(a.objectId);
    const obj = project.objects.find((o) => o.id === a.objectId);
    if (!obj) throw new Error('Unknown print object.');
    if (!a.enabled) {
      excluded.push(obj.id);
      continue;
    }
    const finish = a.partId ? palette.parts[a.partId] : a.finish;
    if (!finish || !isColor(finish.color) || !MATERIALS.includes(finish.material))
      throw new Error('Assign a part or material/color to: ' + obj.name);
    if (obj.size[0] > maxX - minX || obj.size[1] > maxY - minY || obj.size[2] > height)
      throw new Error('Part exceeds build area: ' + obj.name);
    const f = structuredClone(finish);
    f.color = f.color.toUpperCase();
    const key = f.material + f.color + (grouping === 'part' ? ':' + (a.partId || obj.name) : '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      objectId: obj.id,
      name: obj.name,
      partId: a.partId,
      finish: f,
      x: 0,
      y: 0,
      size: [...obj.size],
    });
  }
  if (seen.size !== project.objects.length)
    throw new Error('Every source object needs an explicit include/exclude decision.');
  const plates: PrintPlate[] = [];
  for (const entries of groups.values()) {
    entries.sort(
      (a, b) =>
        b.size[1] - a.size[1] || b.size[0] - a.size[0] || a.objectId.localeCompare(b.objectId),
    );
    let plate: PrintPlate | undefined,
      x = minX,
      y = minY,
      row = 0;
    for (const entry of entries) {
      if (x + entry.size[0] > maxX) {
        x = minX;
        y += row + gap;
        row = 0;
      }
      if (!plate || y + entry.size[1] > maxY) {
        plate = {
          id: plates.length + 1,
          color: entry.finish.color,
          material: entry.finish.material,
          placements: [],
        };
        plates.push(plate);
        x = minX;
        y = minY;
        row = 0;
      }
      entry.x = x;
      entry.y = y;
      plate.placements.push(entry);
      x += entry.size[0] + gap;
      row = Math.max(row, entry.size[1]);
    }
  }
  if (!plates.length) throw new Error('Select at least one print object.');
  return {
    schemaVersion: 1,
    source: project.name,
    modelId: palette.modelId,
    options: { ...options },
    plates,
    excluded,
  };
}
const FILAMENT_TYPES: Record<Finish['material'], string> = {
  pla: 'PLA',
  'matte-pla': 'PLA',
  'silk-pla': 'PLA',
  'pla-cf': 'PLA-CF',
  petg: 'PETG',
  'matte-petg': 'PETG',
  'metallic-petg': 'PETG',
  'petg-cf': 'PETG-CF',
  abs: 'ABS',
  asa: 'ASA',
  pc: 'PC',
  pa: 'PA',
  'pa-cf': 'PA-CF',
  tpu: 'TPU',
};
const escapeXML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
function stl(mesh: Mesh): Uint8Array {
  const out = new Uint8Array(84 + mesh.triangles.length * 50),
    view = new DataView(out.buffer);
  out.set(strToU8('Microduck Color Studio | millimeters'));
  view.setUint32(80, mesh.triangles.length, true);
  mesh.triangles.forEach((t, i) => {
    let at = 84 + i * 50;
    const [a, b, c] = t.map((n) => mesh.vertices[n]);
    const u = b.map((v, k) => v - a[k]),
      v = c.map((v, k) => v - a[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    for (const value of [...n.map((v) => v / len), ...a, ...b, ...c]) {
      view.setFloat32(at, value, true);
      at += 4;
    }
  });
  return out;
}
function project3mf(plan: PrintPlan, project: PrintProject): Uint8Array {
  const columns = Math.ceil(Math.sqrt(plan.plates.length));
  const materials: { color: string; material: Finish['material'] }[] = [];
  const objects: string[] = [],
    builds: string[] = [],
    settings: string[] = [],
    plates: string[] = [];
  let nextId = 2;
  for (const [index, plate] of plan.plates.entries()) {
    let slot = materials.findIndex((m) => m.color === plate.color && m.material === plate.material);
    if (slot < 0) {
      slot = materials.length;
      materials.push({ color: plate.color, material: plate.material });
    }
    const originX = (index % columns) * plan.options.width * 1.2,
      originY = -Math.floor(index / columns) * plan.options.depth * 1.2;
    const instances: string[] = [];
    for (const p of plate.placements) {
      const id = nextId++,
        obj = project.objects.find((o) => o.id === p.objectId)!;
      objects.push(
        `<object id="${id}" type="model" name="${escapeXML(p.name)}" pid="1" pindex="${slot}"><mesh><vertices>${obj.vertices.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices><triangles>${obj.triangles.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh></object>`,
      );
      builds.push(
        `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${originX + p.x} ${originY + p.y} 0" printable="1"/>`,
      );
      settings.push(
        `<object id="${id}"><metadata key="name" value="${escapeXML(p.name)}"/><metadata key="extruder" value="${slot + 1}"/><part id="${id}" subtype="normal_part"><metadata key="name" value="${escapeXML(p.name)}"/><metadata key="extruder" value="${slot + 1}"/></part></object>`,
      );
      instances.push(
        `<model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="${id}"/></model_instance>`,
      );
    }
    plates.push(
      `<plate><metadata key="plater_id" value="${index + 1}"/><metadata key="plater_name" value="${index + 1} ${plate.material} ${plate.color}"/><metadata key="locked" value="false"/><metadata key="filament_map_mode" value="Auto For Flush"/>${instances.join('')}</plate>`,
    );
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="${CORE}" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"><metadata name="Application">BambuStudio-02.06.00.51</metadata><metadata name="Description">Exported by Microduck Color Studio in Bambu-compatible multi-plate format.</metadata><metadata name="BambuStudio:3mfVersion">1</metadata><resources><basematerials id="1">${materials.map((m) => `<base name="${m.material}" displaycolor="${m.color}FF"/>`).join('')}</basematerials>${objects.join('')}</resources><build>${builds.join('')}</build></model>`;
  // Filament types Bambu Studio / OrcaSlicer understand; appearance slugs never leak into profiles.
  const baseType = (m: Finish['material']) => FILAMENT_TYPES[m];
  const printer = printerById(plan.options.printerId);
  const config = {
    printer_model: printer?.name || 'Custom',
    printer_settings_id: printer ? printer.name + ' 0.4 nozzle' : 'Microduck Custom',
    printer_technology: 'FFF',
    bed_exclude_area: [],
    printable_area: [
      '0x0',
      `${plan.options.width}x0`,
      `${plan.options.width}x${plan.options.depth}`,
      `0x${plan.options.depth}`,
    ],
    printable_height: String(plan.options.height),
    filament_colour: materials.map((m) => m.color),
    filament_type: materials.map((m) => baseType(m.material)),
    filament_settings_id: materials.map((m) => `Generic ${baseType(m.material)}`),
    filament_diameter: materials.map(() => '1.75'),
    nozzle_diameter: Array.from({ length: printer?.nozzles || 1 }, () => '0.4'),
  };
  return zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Override PartName="/Metadata/project_settings.config" ContentType="application/json"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(
        `<?xml version="1.0"?><config>${settings.join('')}${plates.join('')}</config>`,
      ),
      'Metadata/project_settings.config': strToU8(JSON.stringify(config)),
      'Metadata/microduck_print_plan.json': strToU8(JSON.stringify(plan)),
    },
    { level: 6 },
  );
}

/** Archive contains no G-code, credentials, or printer process profiles. */
export function exportPrintPackage(project: PrintProject, plan: PrintPlan): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'microduck-print-project.3mf': project3mf(plan, project),
  };
  for (const plate of plan.plates) {
    const prefix = `plate-${String(plate.id).padStart(2, '0')}-${plate.material}-${plate.color.slice(1)}`;
    for (const p of plate.placements) {
      const obj = project.objects.find((o) => o.id === p.objectId)!;
      const safe = obj.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 90);
      files[`${prefix}/stl/${obj.id}-${safe}.stl`] = stl(obj);
    }
  }
  files['print-plan.json'] = strToU8(JSON.stringify(plan, null, 2));
  files['README.txt'] = strToU8(
    '打印包 / Print package\n\n一个 3MF 包含全部打印盘（Bambu Studio / OrcaSlicer 格式），STL 按盘存放。STL 不携带颜色，颜色和材质以 print-plan.json 为准。\nOne multi-plate 3MF project (Bambu Studio / OrcaSlicer format); individual STL files are grouped by plate. STL has no color; see print-plan.json for material and color assignments.\n\n保留源文件的打印旋转和比例，重新平移贴床。不会自动修复模型或更改尺寸。\nSource rotation and scale are retained; objects are translated onto the bed. No automatic repair or rescaling.\n\n请在切片软件中设置打印机、真实耗材、支撑、裙边及工艺，并检查排盘。原工程的支撑涂色、工艺和 G-code 不包含在此包中。\nSet the printer, filament profiles, supports, brim and process in your slicer. Review arrangement before slicing. Source support painting, process profiles and G-code are not preserved.\n\n丙烯涂色属于后处理，按底材颜色分盘；涂色记录保存在清单的 coating 字段。\nAcrylic is post-processing: plates use base filament colors; coating fields record paint accents.\n\n模型版权和许可归原作者，本导出不改变其许可。\nModel rights and licenses remain with their original authors.\n',
  );
  return zipSync(files, { level: 0 });
}
