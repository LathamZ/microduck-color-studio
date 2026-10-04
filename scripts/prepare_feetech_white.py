#!/usr/bin/env python3
"""Make the bound Feetech manufacturing sample white PLA/TPU without editing meshes.

Code Apache-2.0; model CC BY-NC-SA 4.0. Writes a candidate, never the input.
Supports the measured eight-slot sample and this script's two-slot output.
"""
import argparse
import copy
import hashlib
import json
import pathlib
import re
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def meta(node, key):
    return next((m.get('value') for m in node.findall('metadata') if m.get('key') == key), None)


def setmeta(node, key, value):
    found = next((m for m in node.findall('metadata') if m.get('key') == key), None)
    if found is None:
        found = ET.SubElement(node, 'metadata', key=key)
    found.set('value', str(value))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--report', required=True, type=pathlib.Path)
    args = parser.parse_args()
    assert args.source.resolve() != args.output.resolve(), 'Candidate must differ from source'
    original = args.source.read_bytes()
    with zipfile.ZipFile(args.source) as archive:
        assert archive.testzip() is None
        infos = archive.infolist()
        data = {i.filename: archive.read(i) for i in infos}
    descriptor = json.loads((ROOT / 'src/models/feetech-sample.json').read_text())
    manifest = json.loads((ROOT / 'public/models/parts.json').read_text())
    soft_parts = {p['id'] for p in manifest['parts'] if p['defaultMaterial'] == 'tpu'}
    bindings = descriptor['bindings']
    soft = {key for key, binding in bindings.items() if binding['partId'] in soft_parts}
    assert len(soft) == 8
    settings = ET.fromstring(data['Metadata/model_settings.config'])
    root_text = data['3D/3dmodel.model'].decode()
    root = ET.fromstring(root_text)
    items = {i.get('objectid'): i for i in root.findall('./{*}build/{*}item')}
    resources = {o.get('id'): o for o in root.findall('./{*}resources/{*}object')}
    expected = set()
    for obj in settings.findall('object'):
        oid = obj.get('id')
        parts = obj.findall('part')
        assert oid in items and len(parts) in (1, 2)
        object_slots = []
        for part in parts:
            key = oid if len(parts) == 1 else oid + ':' + part.get('id')
            assert bindings[key]['name'] == meta(part if len(parts) > 1 else obj, 'name')
            slot = 2 if key in soft else 1
            setmeta(part, 'extruder', slot)
            object_slots.append(slot)
            expected.add(key)
        setmeta(obj, 'extruder', min(object_slots))
    assert expected == set(bindings) and len(items) == 45

    project = json.loads(data['Metadata/project_settings.config'])
    n = len(project['filament_type'])
    assert n in (8, 2) and project['filament_type'][0] == 'PLA' and project['filament_type'][-1] == 'TPU'
    if n == 8:
        # Filament variant arrays use three variants per material. Printer/process
        # arrays use seven and must stay untouched. Group arrays wrap process/printer.
        for key, values in list(project.items()):
            if not isinstance(values, list):
                continue
            if key in ('inherits_group', 'different_settings_to_system', 'compatible_printers_condition_group'):
                assert len(values) == n + 2
                project[key] = [values[0], values[1], values[n], values[-1]]
            elif key == 'flush_volumes_matrix':
                assert len(values) == 2 * n * n
                project[key] = [values[nozzle*n*n + row*n + col]
                                for nozzle in range(2) for row in (0, n-1) for col in (0, n-1)]
            elif key == 'flush_volumes_vector':
                assert len(values) == 2 * n
                project[key] = [values[nozzle*n + col] for nozzle in range(2) for col in (0, n-1)]
            elif key == 'filament_dev_ams_drying_ams_limitations':
                # The inherited PLA profile has two flags, the inherited TPU one
                # has one; the source concatenates seven PLA/PETG/ABS pairs + TPU.
                assert len(values) == 15
                project[key] = values[:2] + values[-1:]
            elif key.startswith('filament_mixed_') or key == 'filament_is_mixed':
                assert len(set(values)) == 1
                project[key] = values[:1] * 2
            elif len(values) == n:
                project[key] = [values[0], values[-1]]
            elif len(values) == 3*n:
                project[key] = values[:3] + values[-3:]
            elif key in ('filament_dev_ams_drying_temperature', 'filament_dev_ams_drying_time'):
                assert len(values) == 4*n
                project[key] = values[:4] + values[-4:]
        project['filament_self_index'] = ['1'] * 3 + ['2'] * 3
    for key in ('filament_colour', 'filament_multi_colour', 'default_filament_colour'):
        project[key] = ['#FFFFFF', '#FFFFFF']
    project['filament_colour_type'] = ['0', '0']
    project['extruder_colour'] = ['#FFFFFF'] * len(project['extruder_colour'])
    assert project['filament_type'] == ['PLA', 'TPU']
    assert len(project['filament_self_index']) == len(project['filament_extruder_variant']) == 6
    assert len(project['filament_settings_id']) == 2
    data['Metadata/project_settings.config'] = json.dumps(project, indent=2).encode()

    standalone_soft = {key for key in soft if ':' not in key}
    plates = settings.findall('plate')
    assert len(plates) in (4, 5)
    transforms = {oid: item.get('transform') for oid, item in items.items()}
    if len(plates) == 4:
        old = plates[-1]
        new = ET.Element('plate')
        for k, v in [('plater_id', '5'), ('plater_name', '白色 TPU：脚底与软嘴'),
                     ('locked', 'false'), ('filament_map_mode', 'Auto For Flush')]:
            setmeta(new, k, v)
        for instance in list(old.findall('model_instance')):
            oid = meta(instance, 'object_id')
            if oid in standalone_soft:
                old.remove(instance)
                new.append(copy.deepcopy(instance))
                values = transforms[oid].split()
                # Existing H2D grid: plate 4 at (420,-384); plate 5 at (0,-768).
                values[9] = f'{float(values[9]) - 420:.12g}'
                values[10] = f'{float(values[10]) - 384:.12g}'
                transforms[oid] = ' '.join(values)
        settings.insert(list(settings).index(old) + 1, new)
    titles = ['白色 PLA：腿部与结构支架', '白色 PLA：外壳、头部与脚踝',
              '白色 PLA：步行轮滑底座与配件', '白色 PLA／TPU：组合轮组', '白色 TPU：脚底与软嘴']
    plate_report = []
    members = []
    for index, plate in enumerate(settings.findall('plate')):
        setmeta(plate, 'plater_name', titles[index])
        for m in list(plate.findall('metadata')):
            if m.get('key') in ('thumbnail_file', 'thumbnail_no_light_file', 'top_file', 'pick_file'):
                plate.remove(m)
        ids = [meta(i, 'object_id') for i in plate.findall('model_instance')]
        plate_report.append({'id': index+1, 'name': titles[index], 'objects': ids})
        members += ids
    assert set(plate_report[4]['objects']) == standalone_soft
    assert set(plate_report[3]['objects']) == {'63', '68', '69', '71'}
    assert sorted(members) == sorted(items)
    def item_replace(match):
        oid = re.search(r'objectid="([^"]+)"', match[0])[1]
        return re.sub(r'transform="[^"]+"', 'transform="' + transforms[oid] + '"', match[0])
    root_text = re.sub(r'<item\b[^>]*>', item_replace, root_text)
    root_text = re.sub(r'\s*<metadata name="Thumbnail_(?:Middle|Small)">.*?</metadata>', '', root_text)
    description = root.find('./{*}metadata[@name="Description"]').text
    if 'White PLA/TPU sample' not in description:
        root_text = root_text.replace(description, description + ' White PLA/TPU sample; standalone TPU on plate 5; combined wheels on plate 4.')
    data['3D/3dmodel.model'] = root_text.encode()
    data['Metadata/model_settings.config'] = ET.tostring(settings, encoding='utf-8', xml_declaration=True)
    data['Metadata/filament_sequence.json'] = json.dumps({f'plate_{p["id"]}':
        {'nozzle_sequence': [], 'optimal_assignment': [], 'sequence': []} for p in plate_report}).encode()
    # The measured input already has no cached images or standard mesh colors.
    assert not any(name.endswith('.png') for name in data)
    for name, content in data.items():
        if name.startswith('3D/Objects/'):
            assert not re.search(rb'<(?:\w+:)?(?:basematerials|colorgroup)\b', content)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED) as out:
        for info in infos:
            out.writestr(info, data[info.filename])
    with zipfile.ZipFile(args.output) as out, zipfile.ZipFile(args.source) as before:
        assert out.testzip() is None
        mesh_names = [n for n in out.namelist() if n.startswith('3D/Objects/')]
        assert all(out.read(n) == before.read(n) for n in mesh_names)
        after = ET.fromstring(out.read('3D/3dmodel.model'))
        for item in after.findall('./{*}build/{*}item'):
            oid = item.get('objectid')
            assert item.get('transform').split()[:9] == items[oid].get('transform').split()[:9]
        assert ET.tostring(after.find('./{*}resources')) == ET.tostring(root.find('./{*}resources'))
    report = {'source_sha256': hashlib.sha256(original).hexdigest(),
              'output_sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
              'materials': ['PLA', 'TPU'], 'colors': ['#FFFFFF', '#FFFFFF'],
              'build_objects': len(items), 'material_volumes': len(expected),
              'pla_volumes': len(expected-soft), 'tpu_volumes': len(soft),
              'tpu_source_ids': sorted(soft), 'plates': plate_report,
              'mesh_entries_byte_identical': len(mesh_names),
              'component_transforms_unchanged': True, 'orientations_scales_unchanged': True}
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
