import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { defaults, type Manifest } from '../src/domain';
import { applyPrintSample } from '../src/print-sample';
import {
  readPrintProject,
  planPrint,
  exportPrintPackage,
  initialPrintAssignments,
  type PrintProject,
} from '../src/print-project';
import descriptor from '../src/models/feetech-sample.json';

const model = JSON.parse(
  readFileSync(new URL('../public/models/parts.json', import.meta.url), 'utf8'),
) as Manifest;
let imported: PrintProject;
let sample: PrintProject;
beforeAll(() => {
  imported = readPrintProject(
    new Uint8Array(
      readFileSync(new URL('../models/mircroduck_feetech_revision.3mf', import.meta.url)),
    ),
    descriptor.name,
    model,
  );
  sample = applyPrintSample(imported, model, descriptor);
}, 60000);

describe('bundled Feetech manufacturing sample', () => {
  it('starts as white PLA/TPU, separates soft parts and exports two materials despite a colored palette', () => {
    const palette = defaults(model);
    palette.parts['15-04-foot_right'] = { color: '#123456', material: 'petg' };
    const assignments = initialPrintAssignments(sample.objects, descriptor.useSourceFinish);
    expect(assignments.every((a) => !a.partId && a.finish?.color === '#FFFFFF')).toBe(true);
    const softIds = ['34', '36', '58', '72', '64:63', '67:63', '68:63', '70:63'];
    expect(
      sample.objects
        .filter((o) => o.originalMaterial === 'tpu')
        .map((o) => o.sourceObjectId)
        .sort(),
    ).toEqual(softIds.sort());
    expect(sample.objects.filter((o) => o.originalMaterial === 'pla')).toHaveLength(41);
    const plan = planPrint(sample, palette, assignments, {
      printerId: 'h2d',
      width: 350,
      depth: 320,
      height: 325,
      margin: 10,
      gap: 8,
      grouping: 'color',
    });
    expect(plan.plates.flatMap((p) => p.placements)).toHaveLength(49);
    const softPlate = plan.plates.filter((p) =>
      p.placements.some((o) => o.finish.material === 'tpu' && !o.assembly),
    );
    expect(softPlate).toHaveLength(1);
    expect(softPlate[0].placements).toHaveLength(4);
    expect(softPlate[0].placements.every((o) => o.finish.material === 'tpu' && !o.assembly)).toBe(
      true,
    );
    const files = unzipSync(
      unzipSync(exportPrintPackage(sample, plan))['microduck-print-project.3mf'],
    );
    const config = JSON.parse(strFromU8(files['Metadata/project_settings.config']));
    expect(config.filament_colour).toEqual(['#FFFFFF', '#FFFFFF']);
    expect(new Set(config.filament_type)).toEqual(new Set(['PLA', 'TPU']));
    const roundtrip = readPrintProject(
      unzipSync(exportPrintPackage(sample, plan))['microduck-print-project.3mf'],
      'white',
      model,
    );
    expect(roundtrip.objects.every((o) => o.originalColor === '#FFFFFF')).toBe(true);
    expect(roundtrip.objects.filter((o) => o.originalMaterial === 'tpu')).toHaveLength(8);
    expect(
      new Set(roundtrip.objects.filter((o) => o.assembly).map((o) => o.assembly!.id)).size,
    ).toBe(4);
    // Normal uploads and an explicit palette link still follow the current palette.
    expect(
      initialPrintAssignments(sample.objects).find(
        (a) => a.objectId === sample.objects.find((o) => o.sourceObjectId === '32')!.id,
      )?.partId,
    ).toBe('15-04-foot_right');
  }, 60000);
  it('centers every populated plate in shared nozzle reach with a 20 mm inset and 10 mm gaps', () => {
    const plan = planPrint(sample, defaults(model), initialPrintAssignments(sample.objects, true), {
      printerId: 'h2d',
      width: 350,
      depth: 320,
      height: 325,
      margin: 20,
      gap: 10,
      grouping: 'color',
    });
    expect(plan.plates).toHaveLength(5);
    for (const plate of plan.plates) {
      const ps = plate.placements;
      const lowX = Math.min(...ps.map((p) => p.x)),
        highX = Math.max(...ps.map((p) => p.x + p.size[0]));
      const lowY = Math.min(...ps.map((p) => p.y)),
        highY = Math.max(...ps.map((p) => p.y + p.size[1]));
      expect((lowX + highX) / 2).toBeCloseTo(175, 9);
      expect((lowY + highY) / 2).toBeCloseTo(160, 9);
      expect(lowX).toBeGreaterThanOrEqual(45 - 1e-9);
      expect(highX).toBeLessThanOrEqual(305 + 1e-9);
      expect(lowY).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(highY).toBeLessThanOrEqual(300 + 1e-9);
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i],
            b = ps[j];
          if (a.assembly && a.assembly.id === b.assembly?.id) continue;
          expect(
            a.x + a.size[0] + 10 <= b.x + 1e-9 ||
              b.x + b.size[0] + 10 <= a.x + 1e-9 ||
              a.y + a.size[1] + 10 <= b.y + 1e-9 ||
              b.y + b.size[1] + 10 <= a.y + 1e-9,
          ).toBe(true);
        }
    }
  });
  it('binds both feet, both common ankles, both split rollers and both materials of all four wheels', () => {
    expect(sample.objects).toHaveLength(49);
    const bindings = Object.fromEntries(
      sample.objects.map((o) => [o.sourceObjectId, o.matches[0]?.partId]),
    );
    expect(bindings['32']).toBe('15-04-foot_right');
    expect(bindings['35']).toBe('06-02-foot_left');
    expect(bindings['50']).toBe('15-01-ankle_right');
    expect(bindings['51']).toBe('06-04-ankle_left');
    expect(bindings['66']).toBe('16-02-roller_blade');
    expect(bindings['69']).toBe('17-02-roller_blade');
    expect(bindings['74']).toBe('16-02-roller_blade');
    expect(bindings['75']).toBe('17-02-roller_blade');
    expect(new Set(['64', '67', '68', '70'].map((id) => bindings[id + ':62'])).size).toBe(4);
    const wheels = sample.objects.filter((o) => o.assembly);
    expect(wheels).toHaveLength(8);
    expect(new Set(wheels.map((o) => o.assembly!.id)).size).toBe(4);
    expect(
      wheels
        .filter((o) => o.sourceObjectId?.endsWith(':62'))
        .every((o) => o.originalMaterial === 'pla'),
    ).toBe(true);
    expect(
      wheels
        .filter((o) => o.sourceObjectId?.endsWith(':63'))
        .every((o) => o.originalMaterial === 'tpu'),
    ).toBe(true);
    expect(sample.objects.filter((o) => o.matches.length)).toHaveLength(47);
    expect(bindings['60']).toBeUndefined();
    expect(bindings['61']).toBeUndefined();
    expect(imported.sampleId).toBeUndefined();
    for (let i = 0; i < sample.objects.length; i++) {
      expect(sample.objects[i].vertices).toBe(imported.objects[i].vertices);
      expect(sample.objects[i].triangles).toBe(imported.objects[i].triangles);
    }
  });
  it('rejects model mismatch, incomplete coverage, renamed source objects and invalid parts atomically', () => {
    expect(() => applyPrintSample(imported, { ...model, modelId: 'other' }, descriptor)).toThrow(
      'model pack',
    );
    expect(() =>
      applyPrintSample({ ...imported, objects: imported.objects.slice(1) }, model, descriptor),
    ).toThrow('bindings');
    expect(() =>
      applyPrintSample(
        {
          ...imported,
          objects: imported.objects.map((o, i) => (i ? o : { ...o, name: 'replaced' })),
        },
        model,
        descriptor,
      ),
    ).toThrow('bindings');
    expect(() =>
      applyPrintSample(imported, model, {
        ...descriptor,
        bindings: {
          ...descriptor.bindings,
          '32': { ...descriptor.bindings['32'], partId: 'invalid' },
        },
      }),
    ).toThrow('Unknown');
    expect(imported.sampleId).toBeUndefined();
    expect(
      imported.objects.find((o) => o.sourceObjectId === '32')?.matches[0]?.confidence,
    ).not.toBe(1);
  });
  it('exports all 49 real meshes with palette colors, source dimensions and model attribution', () => {
    const palette = defaults(model);
    palette.parts['15-04-foot_right'] = { color: '#123456', material: 'petg' };
    const assignments = sample.objects.map((o) => ({
      objectId: o.id,
      enabled: o.printable,
      ...(o.matches[0]
        ? { partId: o.matches[0].partId }
        : { finish: { color: o.originalColor, material: o.originalMaterial } }),
    }));
    const plan = planPrint(sample, palette, assignments, {
      printerId: 'h2d',
      width: 350,
      depth: 320,
      height: 325,
      margin: 10,
      gap: 8,
      grouping: 'color',
    });
    expect(plan.plates.flatMap((p) => p.placements)).toHaveLength(49);
    expect(
      plan.plates.find((p) => p.placements.some((o) => o.partId === '15-04-foot_right'))?.color,
    ).toBe('#123456');
    const zip = unzipSync(exportPrintPackage(sample, plan));
    const projectFiles = unzipSync(zip['microduck-print-project.3mf']);
    const nativeConfig = JSON.parse(strFromU8(projectFiles['Metadata/project_settings.config']));
    // Missing process IDs crash native Bambu readers; support flags must cover
    // every filament, including both materials in a wheel assembly.
    expect(nativeConfig.print_settings_id).toBe('Microduck print setup');
    expect(nativeConfig.filament_is_support).toHaveLength(nativeConfig.filament_colour.length);
    expect(nativeConfig.filament_is_support.every((v: string) => v === '0')).toBe(true);
    expect(strFromU8(zip['MODEL-LICENSE.txt'])).toContain('CC BY-NC-SA 4.0');
    expect(strFromU8(zip['MODEL-LICENSE.txt'])).toContain('Pollen Robotics');
    const exported = readPrintProject(zip['microduck-print-project.3mf'], 'roundtrip', model);
    const order = plan.plates.flatMap((p) => p.placements);
    expect(exported.objects).toHaveLength(49);
    expect(Object.keys(zip).filter((n) => n.endsWith('.stl'))).toHaveLength(49);
    expect(exported.attribution).toEqual(sample.attribution);
    expect(
      new Set(exported.objects.filter((o) => o.assembly).map((o) => o.assembly!.id)).size,
    ).toBe(4);
    for (let i = 0; i < order.length; i++) {
      const original = sample.objects.find((o) => o.id === order[i].objectId)!;
      const result = exported.objects[i];
      expect(result.vertices.length).toBe(original.vertices.length);
      let maxError = 0;
      for (let v = 0; v < original.vertices.length; v++)
        for (let axis = 0; axis < 3; axis++)
          maxError = Math.max(
            maxError,
            Math.abs(result.vertices[v][axis] - original.vertices[v][axis]),
          );
      expect(maxError).toBeLessThan(1e-9);
      expect(
        Math.max(...result.size.map((n, axis) => Math.abs(n - original.size[axis]))),
      ).toBeLessThan(1e-9);
      expect(result.triangles).toEqual(original.triangles);
      expect(result.originalColor).toBe(order[i].finish.color);
      expect(result.originalMaterial).toBe(order[i].finish.material);
      if (original.assembly) {
        expect(result.assembly?.offset).toEqual(original.assembly.offset);
        expect(result.assembly?.size).toEqual(original.assembly.size);
      }
    }
  }, 60000);
  it('packs complete wheels together and rejects partial or invalid assemblies', () => {
    const palette = defaults(model);
    const assignments = sample.objects.map((o) => ({
      objectId: o.id,
      enabled: true,
      ...(o.matches[0]
        ? { partId: o.matches[0].partId }
        : { finish: { color: o.originalColor, material: o.originalMaterial } }),
    }));
    const options = {
      printerId: 'h2d',
      width: 350,
      depth: 320,
      height: 325,
      margin: 10,
      gap: 8,
      grouping: 'color' as const,
    };
    const plan = planPrint(sample, palette, assignments, options);
    const wheels = sample.objects.filter((o) => o.assembly);
    for (const id of new Set(wheels.map((o) => o.assembly!.id))) {
      const plates = plan.plates.filter((p) => p.placements.some((o) => o.assembly?.id === id));
      expect(plates).toHaveLength(1);
      const members = plates[0].placements.filter((o) => o.assembly?.id === id);
      expect(members).toHaveLength(2);
      expect(new Set(members.map((o) => o.finish.material))).toEqual(new Set(['pla', 'tpu']));
      expect(members[0].x - members[0].assembly!.offset[0]).toBe(
        members[1].x - members[1].assembly!.offset[0],
      );
      expect(members[0].y - members[0].assembly!.offset[1]).toBe(
        members[1].y - members[1].assembly!.offset[1],
      );
    }
    expect(() =>
      planPrint(
        sample,
        palette,
        assignments.map((a) => (a.objectId === wheels[0].id ? { ...a, enabled: false } : a)),
        options,
      ),
    ).toThrow('every part of assembly');
    const invalid = {
      ...sample,
      objects: sample.objects.map((o) =>
        o.id === wheels[0].id
          ? { ...o, assembly: { ...o.assembly!, offset: [-1, 0, 0] as [number, number, number] } }
          : o,
      ),
    };
    expect(() => planPrint(invalid, palette, assignments, options)).toThrow(
      'Invalid assembly bounds',
    );
  });
});
