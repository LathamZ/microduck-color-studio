/** Center the bound manufacturing sample using the same planner as web export.
 * Code Apache-2.0; model and previews CC BY-NC-SA 4.0. Never edits source meshes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { defaults, type Manifest } from '../src/domain';
import { readPrintProject, planPrint, initialPrintAssignments } from '../src/print-project';
import { applyPrintSample } from '../src/print-sample';
import descriptor from '../src/models/feetech-sample.json';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const value = args[args.indexOf('--' + name) + 1];
  if (!args.includes('--' + name) || !value) throw new Error('Missing --' + name);
  return value;
};
const source = arg('source'),
  output = arg('output'),
  reportPath = arg('report');
if (source === output) throw new Error('Write a candidate before replacing the source.');
const input = new Uint8Array(readFileSync(source));
const files = unzipSync(input);
const model = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
const project = applyPrintSample(
  readPrintProject(input, descriptor.name, model),
  model,
  descriptor,
);
const options = {
  printerId: 'h2d',
  width: 350,
  depth: 320,
  height: 325,
  margin: 20,
  gap: 10,
  grouping: 'color' as const,
};
const plan = planPrint(
  project,
  defaults(model),
  initialPrintAssignments(project.objects, true),
  options,
);
const parse = (text: Uint8Array) => new DOMParser().parseFromString(strFromU8(text), 'text/xml');
const root = parse(files['3D/3dmodel.model']),
  settings = parse(files['Metadata/model_settings.config']);
const children = (node: Element, tag: string) =>
  Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1 && n.localName === tag);
const meta = (node: Element, key: string) =>
  children(node, 'metadata')
    .find((m) => m.getAttribute('key') === key)
    ?.getAttribute('value');
const rootObjects = new Map(
  children(root.getElementsByTagName('resources')[0], 'object').map((o) => [
    o.getAttribute('id')!,
    o,
  ]),
);
const items = new Map(
  Array.from(root.getElementsByTagName('item')).map((i) => [i.getAttribute('objectid')!, i]),
);
const instances = new Map(
  Array.from(settings.getElementsByTagName('model_instance')).map((i) => [
    meta(i, 'object_id')!,
    i,
  ]),
);
const serializer = new XMLSerializer();
const resourcesBefore = serializer.serializeToString(root.getElementsByTagName('resources')[0]);
const point = (p: number[], t: number[]) =>
  [0, 1, 2].map((a) => p[0] * t[a] + p[1] * t[3 + a] + p[2] * t[6 + a] + t[9 + a]);
const beforeTransforms = new Map(
  [...items].map(([id, i]) => [id, i.getAttribute('transform')!.split(/\s+/)]),
);
const seen = new Set<string>();
const plateReports = [];
for (const plate of Array.from(settings.getElementsByTagName('plate')))
  plate.parentNode!.removeChild(plate);
const columns = Math.ceil(Math.sqrt(plan.plates.length));
for (const [index, plate] of plan.plates.entries()) {
  const units = new Map<string, (typeof plate.placements)[number]>();
  for (const placement of plate.placements) {
    const object = project.objects.find((o) => o.id === placement.objectId)!;
    units.set(object.sourceObjectId!.split(':')[0], placement);
  }
  const newPlate = settings.createElement('plate');
  const name = plate.finishes
    ? '白色 PLA／TPU：组合轮组'
    : plate.material === 'tpu'
      ? '白色 TPU：脚底与软嘴'
      : `白色 PLA：硬质零件 ${plate.id}`;
  for (const [key, value] of Object.entries({
    plater_id: String(plate.id),
    plater_name: name,
    locked: 'false',
    filament_map_mode: 'Auto For Flush',
  })) {
    const m = settings.createElement('metadata');
    m.setAttribute('key', key);
    m.setAttribute('value', value);
    newPlate.appendChild(m);
  }
  for (const [oid, placement] of units) {
    if (seen.has(oid)) throw new Error('Duplicate build object');
    seen.add(oid);
    const item = items.get(oid)!,
      buildTransform = beforeTransforms.get(oid)!.map(Number);
    const low = [Infinity, Infinity, Infinity];
    for (const c of Array.from(rootObjects.get(oid)!.getElementsByTagName('component'))) {
      const path = c.getAttribute('p:path')!.replace(/^\//, '');
      const componentDoc = parse(files[path]);
      const leaf = Array.from(componentDoc.getElementsByTagName('object')).find(
        (o) => o.getAttribute('id') === c.getAttribute('objectid'),
      )!;
      if (leaf.getElementsByTagName('components').length)
        throw new Error('Unexpected nested component');
      const t = (c.getAttribute('transform') || '1 0 0 0 1 0 0 0 1 0 0 0').split(/\s+/).map(Number);
      for (const v of Array.from(leaf.getElementsByTagName('vertex'))) {
        const world = point(
          point(
            ['x', 'y', 'z'].map((k) => Number(v.getAttribute(k))),
            t,
          ),
          buildTransform,
        );
        world.forEach((n, a) => (low[a] = Math.min(low[a], n)));
      }
    }
    const target = [
      (index % columns) * options.width * 1.2 + placement.x - (placement.assembly?.offset[0] || 0),
      -Math.floor(index / columns) * options.depth * 1.2 +
        placement.y -
        (placement.assembly?.offset[1] || 0),
      0,
    ];
    const original = beforeTransforms.get(oid)!;
    item.setAttribute(
      'transform',
      [
        ...original.slice(0, 9),
        ...target.map((n, a) => String(buildTransform[9 + a] + n - low[a])),
      ].join(' '),
    );
    newPlate.appendChild(instances.get(oid)!.cloneNode(true));
  }
  settings.documentElement.appendChild(newPlate);
  const low = [
    Math.min(...plate.placements.map((p) => p.x)),
    Math.min(...plate.placements.map((p) => p.y)),
  ];
  const high = [
    Math.max(...plate.placements.map((p) => p.x + p.size[0])),
    Math.max(...plate.placements.map((p) => p.y + p.size[1])),
  ];
  plateReports.push({
    id: plate.id,
    name,
    objects: [...units.keys()],
    footprint_mm: { low, high },
    center_mm: low.map((n, a) => (n + high[a]) / 2),
  });
}
if (seen.size !== items.size || seen.size !== 45) throw new Error('Source coverage changed');
if (serializer.serializeToString(root.getElementsByTagName('resources')[0]) !== resourcesBefore)
  throw new Error('Component geometry changed');
for (const [id, item] of items)
  if (
    item.getAttribute('transform')!.split(/\s+/).slice(0, 9).join(' ') !==
    beforeTransforms.get(id)!.slice(0, 9).join(' ')
  )
    throw new Error('Orientation/scale changed');
for (const m of Array.from(root.getElementsByTagName('metadata'))) {
  if (m.getAttribute('name')?.startsWith('Thumbnail_')) m.parentNode!.removeChild(m);
  else if (m.getAttribute('name') === 'Description')
    m.textContent +=
      ' Centered plates in shared H2D nozzle reach, 20 mm margin and 10 mm part gap; three PLA plates, standalone TPU and assembled wheels.';
}
files['3D/3dmodel.model'] = strToU8(serializer.serializeToString(root));
files['Metadata/model_settings.config'] = strToU8(serializer.serializeToString(settings));
files['Metadata/filament_sequence.json'] = strToU8(
  JSON.stringify(
    Object.fromEntries(
      plan.plates.map((p) => [
        'plate_' + p.id,
        { nozzle_sequence: [], optimal_assignment: [], sequence: [] },
      ]),
    ),
  ),
);
const removed = new Set(Object.keys(files).filter((n) => n.endsWith('.png')));
for (const name of removed) delete files[name];
for (const name of Object.keys(files).filter((n) => n.endsWith('.rels'))) {
  const doc = parse(files[name]);
  for (const r of Array.from(doc.getElementsByTagName('Relationship')))
    if (removed.has(r.getAttribute('Target')!.replace(/^\//, ''))) r.parentNode!.removeChild(r);
  files[name] = strToU8(serializer.serializeToString(doc));
}
const candidate = zipSync(files, { level: 6 });
const roundtrip = applyPrintSample(
  readPrintProject(candidate, descriptor.name, model),
  model,
  descriptor,
);
if (roundtrip.objects.length !== 49) throw new Error('Instance count changed');
const oldFiles = unzipSync(input),
  saved = unzipSync(candidate);
const meshes = Object.keys(files).filter((n) => n.startsWith('3D/Objects/'));
if (meshes.some((n) => !Buffer.from(oldFiles[n]).equals(Buffer.from(saved[n]))))
  throw new Error('Mesh bytes changed');
writeFileSync(output, candidate);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const report = {
  source_sha256: sha(input),
  output_sha256: sha(candidate),
  materials: ['PLA', 'TPU'],
  colors: ['#FFFFFF', '#FFFFFF'],
  build_objects: 45,
  material_volumes: 49,
  pla_volumes: 41,
  tpu_volumes: 8,
  options,
  columns,
  shared_reachable_area_mm: { low: [45, 20], high: [305, 300] },
  plates: plateReports,
  mesh_entries_byte_identical: meshes.length,
  component_transforms_unchanged: true,
  orientations_scales_unchanged: true,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    plates: plateReports.map((p) => ({
      id: p.id,
      objects: p.objects.length,
      center: p.center_mm,
      footprint: p.footprint_mm,
    })),
    sha256: report.output_sha256,
  }),
);
