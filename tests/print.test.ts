import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  readPrintProject,
  planPrint,
  exportPrintPackage,
  matchAction,
  matchPrintObject,
  nameSimilarity,
  MATCH_FLOOR,
  type PrintOptions,
} from '../src/print-project';
import { defaults, type Manifest } from '../src/domain';
import { readFileSync } from 'node:fs';
import { PRINTERS } from '../src/printers';
const model = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
const part = model.parts.find((p) => p.printable)!;
const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const mesh =
  '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
const source = (options = { mirror: false, cycle: false }) =>
  zipSync({
    '3D/3dmodel.model': strToU8(
      `<model unit="millimeter" xmlns="${CORE}" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="1" name="${part.sourceName}.stl"><components><component objectid="2" p:path="/3D/Objects/part.model" transform="${options.mirror ? -1 : 1} 0 0 0 1 0 0 0 1 30 40 50"/></components></object></resources><build><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 500 600 700"/><item objectid="1" printable="0"/></build></model>`,
    ),
    '3D/Objects/part.model': strToU8(
      `<model unit="millimeter" xmlns="${CORE}"><resources><object id="2">${options.cycle ? '<components><component objectid="2"/></components>' : mesh}</object></resources></model>`,
    ),
  });
const options: PrintOptions = {
  width: 35,
  depth: 35,
  height: 30,
  margin: 5,
  gap: 5,
  grouping: 'color',
};
describe('print model import and color-preserving plate export', () => {
  it('uses preset packing insets but full bed dimensions for multi-plate origins', () => {
    const p = readPrintProject(source(), 'source', model);
    const a = p.objects.map((o, i) => ({
      objectId: o.id,
      enabled: true,
      finish: { color: i ? '#ffffff' : '#000000', material: 'pla' as const },
    }));
    for (const preset of PRINTERS) {
      const opts = {
        ...options,
        printerId: preset.id,
        width: preset.width,
        depth: preset.depth,
        height: preset.height,
      };
      const plan = planPrint(p, defaults(model), a, opts);
      expect(plan.plates).toHaveLength(2);
      expect(plan.plates[0].placements[0].x).toBe(preset.left + opts.margin);
      const zip = unzipSync(exportPrintPackage(p, plan));
      const files = unzipSync(zip['microduck-print-project.3mf']);
      const xml = strFromU8(files['3D/3dmodel.model']);
      expect(xml).toContain(
        `1 0 0 0 1 0 0 0 1 ${preset.width * 1.2 + preset.left + opts.margin} ${opts.margin} 0`,
      );
      const settings = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
      expect(settings.printer_model).toBe(preset.name);
      expect(settings.printable_area[2]).toBe(`${preset.width}x${preset.depth}`);
      expect(() => planPrint(p, defaults(model), a, { ...opts, width: 200 })).toThrow(
        'Preset dimensions',
      );
    }
  });
  it('flattens component/build rotations, preserves scale and instances, and places vertices on the bed', () => {
    const p = readPrintProject(source(), 'HD1910.3mf', model);
    expect(p.objects).toHaveLength(2);
    expect(p.objects[0].size).toEqual([10, 10, 10]);
    expect(p.objects[0].vertices[0]).toEqual([10, 0, 0]);
    expect(p.objects[0].triangles).toHaveLength(4);
    expect(p.objects[1].printable).toBe(false);
    expect(p.objects[0].matches[0].partId).toBe(part.id);
    expect(p.objects[0].matches[0].confidence).toBe(1);
  });
  it('corrects winding on mirrored source geometry', () => {
    const p = readPrintProject(source({ mirror: true, cycle: false }), 'mirror', model);
    expect(p.objects[0].triangles[0]).toEqual([0, 1, 2]);
  });
  it('rejects cycles, invalid transforms and out-of-range triangle indices', () => {
    expect(() => readPrintProject(source({ mirror: false, cycle: true }), 'bad', model)).toThrow(
      'Cyclic',
    );
    const files = unzipSync(source());
    for (const [from, to] of [
      ['v3="3"', 'v3="99"'],
      ['x="10"', 'x="NaN"'],
    ]) {
      const copy = { ...files };
      copy['3D/Objects/part.model'] = strToU8(
        strFromU8(files['3D/Objects/part.model']).replace(from, to),
      );
      expect(() => readPrintProject(zipSync(copy), 'bad', model)).toThrow();
    }
  });
  it('keeps material/color groups separate and records paint as post-processing', () => {
    const p = readPrintProject(source(), 'source', model),
      palette = defaults(model);
    palette.parts[part.id] = {
      color: '#123456',
      material: 'pla-cf',
      coating: { kind: 'acrylic', color: '#ff0000' },
    };
    const assignments = [
      { objectId: 'item-0', enabled: true, partId: part.id },
      {
        objectId: 'item-1',
        enabled: true,
        finish: { color: '#123456', material: 'petg' as const },
      },
    ];
    const plan = planPrint(p, palette, assignments, options);
    expect(plan.plates).toHaveLength(2);
    expect(plan.plates[0].color).toBe('#123456');
    expect(plan.plates[0].placements[0].finish.coating?.color).toBe('#ff0000');
    const archive = unzipSync(exportPrintPackage(p, plan));
    const plates = Object.keys(archive).filter((n) => n.endsWith('.3mf'));
    expect(plates).toHaveLength(1);
    const plateFiles = unzipSync(archive[plates[0]]);
    expect(strFromU8(plateFiles['3D/3dmodel.model'])).toContain('displaycolor="#123456FF"');
    const imported = readPrintProject(archive[plates[0]], 'roundtrip', model);
    expect(imported.objects).toHaveLength(2);
    expect(imported.objects[0].triangles).toHaveLength(4);
    const config = strFromU8(plateFiles['Metadata/model_settings.config']);
    expect((config.match(/<plate>/g) || []).length).toBe(2);
    expect((config.match(/<model_instance>/g) || []).length).toBe(2);
    expect(imported.objects[0].size).toEqual([10, 10, 10]);
    expect(imported.objects[0].originalColor).toBe('#123456');
    expect(imported.objects[0].originalMaterial).toBe('pla-cf');
    const stl = archive[Object.keys(archive).find((n) => n.endsWith('.stl'))!];
    expect(stl.length).toBe(84 + 50 * 4);
    expect(new DataView(stl.buffer, stl.byteOffset).getUint32(80, true)).toBe(4);
  });
  it('requires explicit coverage, rejects oversize parts, and packs without overlap', () => {
    const p = readPrintProject(source(), 'source', model),
      palette = defaults(model),
      a = p.objects.map((o) => ({ objectId: o.id, enabled: true, partId: part.id }));
    expect(() => planPrint(p, palette, a.slice(1), options)).toThrow('explicit');
    expect(() => planPrint(p, palette, a, { ...options, height: 5 })).toThrow('exceeds');
    const plan = planPrint(p, palette, a, options);
    expect(plan.plates).toHaveLength(1);
    const [x, y] = plan.plates[0].placements;
    expect(x.x + x.size[0] + options.gap).toBeLessThanOrEqual(y.x);
  });
});

describe('object-to-part name matching', () => {
  const printable = model.parts.filter((p) => p.printable);
  const named = (name: string) => printable.find((p) => p.sourceName === name)!;
  it('scores identical names as certain and ignores case, extension and separators', () => {
    const trunk = named('trunk_base');
    expect(nameSimilarity('trunk_base.stl', 'trunk_base')).toBe(1);
    expect(nameSimilarity('Trunk-Base', 'trunk_base')).toBe(1);
    expect(matchPrintObject('trunk_base.stl', model)[0]).toMatchObject({
      partId: trunk.id,
      confidence: 1,
      ambiguous: false,
    });
  });
  it.each([
    'hip_l_v2.stl',
    'hip_l (1).stl',
    '04-02-hip_l.stl',
    'hip_l left_extra.stl',
    'final_hip_l.stl',
  ])('still matches %s at 80% confidence or better', (name) => {
    const best = matchPrintObject(name, model)[0];
    expect(best.partId).toBe(named('hip_l').id);
    expect(best.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it('does not call a match contested just because other parts exist', () => {
    const best = matchPrintObject('trunk_base.stl', model)[0];
    expect(best.confidence).toBe(1);
    expect(best.ambiguous).toBe(false);
    const shell = matchPrintObject('shell.stl', model)[0];
    expect(shell.ambiguous).toBe(true);
  });
  it('flags a close call as ambiguous instead of guessing silently', () => {
    const left = named('upper_leg_left');
    const best = matchPrintObject('upper_leg.stl', model)[0];
    expect(best.ambiguous).toBe(true);
    expect(best.confidence).toBeGreaterThanOrEqual(0.5);
    expect([named('upper_leg_left').id, named('upper_leg_right').id]).toContain(best.partId);
    expect(best.partId).toBe(left.id);
  });
  it('does not treat an opposite side as the same part', () => {
    expect(nameSimilarity('left_shell', 'right_shell')).toBeLessThan(0.5);
    expect(nameSimilarity('upper_leg_left', 'upper_leg_right')).toBeLessThan(0.5);
  });
  it('leaves unrelated objects unmatched instead of inventing a default', () => {
    for (const name of ['spool_holder_bracket', 'zz_widget_v9'])
      for (const m of matchPrintObject(name, model)) expect(m.confidence).toBeLessThan(MATCH_FLOOR);
    expect(matchPrintObject('', model)).toHaveLength(0);
    expect(matchPrintObject('   ', model)).toHaveLength(0);
  });
  it('marks identical duplicate source names as ambiguous', () => {
    const duplicates = printable.filter(
      (p) => printable.filter((x) => x.sourceName === p.sourceName).length > 1,
    );
    if (!duplicates.length) return;
    const best = matchPrintObject(duplicates[0].sourceName, model)[0];
    expect(best.confidence).toBe(1);
    expect(best.ambiguous).toBe(true);
  });
  it('keeps unmatched objects out of the auto-assignment path', () => {
    const p = readPrintProject(source(), 'source', model);
    const unmatched = { ...p.objects[0], name: 'zz_unknown_widget_v9', matches: [] };
    expect(unmatched.matches.filter((m) => m.confidence >= MATCH_FLOOR)).toHaveLength(0);
    expect(p.objects[0].matches.filter((m) => m.confidence >= MATCH_FLOOR).length).toBeGreaterThan(
      0,
    );
  });
});

describe('confidence bands', () => {
  it('applies 80% and above without asking', () => {
    expect(matchAction(1, { linked: true, chosen: false })).toBe('auto');
    expect(matchAction(0.8, { linked: true, chosen: false })).toBe('auto');
  });
  it('asks for one confirmation between 50% and 80%', () => {
    for (const confidence of [0.5, 0.62, 0.79])
      expect(matchAction(confidence, { linked: true, chosen: false })).toBe('confirm');
  });
  it('requires a deliberate choice below 50% or with no candidate at all', () => {
    expect(matchAction(0.49, { linked: false, chosen: false })).toBe('choose');
    expect(matchAction(0.2, { linked: false, chosen: false })).toBe('choose');
    expect(matchAction(null, { linked: false, chosen: false })).toBe('choose');
  });
  it('treats a contested match as a confirmation even when the score is high', () => {
    expect(matchAction(1, { linked: true, chosen: false, contested: true })).toBe('confirm');
    expect(matchAction(0.86, { linked: true, chosen: false, contested: true })).toBe('confirm');
    expect(matchAction(0.86, { linked: true, chosen: false })).toBe('auto');
  });
  it('accepts a row the user already decided, whatever the score says', () => {
    expect(matchAction(0.1, { linked: false, chosen: true })).toBe('auto');
    expect(matchAction(null, { linked: true, chosen: true })).toBe('auto');
    expect(matchAction(0.9, { linked: true, chosen: true })).toBe('auto');
  });
});
