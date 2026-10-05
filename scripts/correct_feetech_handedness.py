#!/usr/bin/env python3
"""Mirror the left ankle and matching left skate halves in a measured 3MF.

Code Apache-2.0; model derivative CC BY-NC-SA 4.0. Source meshes, material
slots, plate membership, translations and all unrelated transforms are kept.
Use a candidate output, never overwrite the input. No printer operations.
"""
import argparse
import copy
import hashlib
import json
import re
import zipfile
import xml.etree.ElementTree as E
from pathlib import Path


def mirror_x(value):
    # 3MF stores the three basis vectors consecutively. Reflect local X before
    # the existing print rotation, preserving Y, Z, scale and translation.
    values = value.split()
    assert len(values) == 12
    values[:3] = [format(-float(v), '.17g') for v in values[:3]]
    return ' '.join(values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'output', 'report', 'expected-sha256'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--white-filaments', action='store_true',
                        help='Restore the requested white sample without changing material profiles.')
    args = parser.parse_args()
    source, output = Path(args.source), Path(args.output)
    assert source.resolve() != output.resolve(), 'Use a candidate output.'
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    assert source_sha == args.expected_sha256, 'The measured source changed.'
    with zipfile.ZipFile(source) as z:
        infos = z.infolist()
        data = {i.filename: z.read(i) for i in infos}
    root = E.fromstring(data['3D/3dmodel.model'])
    settings = E.fromstring(data['Metadata/model_settings.config'])
    objects = {o.get('id'): o for o in settings.findall('object')}
    mirror_ids = {'51', '63', '71'}
    expected_names = {
        '50': 'ankle_dual_locks_no_end_slots_v9.stl',
        '51': 'ankle_dual_locks_no_end_slots_v9.stl',
        '63': '左轮滑底座_左半_v9.stl',
        '71': '左轮滑底座_右半_v9.stl',
    }
    for oid, name in expected_names.items():
        assert next(m.get('value') for m in objects[oid].findall('metadata')
                    if m.get('key') == 'name') == name
    items = {i.get('objectid'): i for i in root.findall('./{*}build/{*}item')}
    assert items['50'].get('transform').split()[:9] == ['1', '0', '0', '0', '1', '0', '0', '0', '1']
    assert items['51'].get('transform').split()[:9] == ['1', '0', '0', '0', '1', '0', '0', '0', '1']
    text = data['3D/3dmodel.model'].decode()
    changes = {}
    for oid in sorted(mirror_ids):
        before = items[oid].get('transform')
        after = mirror_x(before)
        pattern = r'(<item\b[^>]*\bobjectid="' + oid + r'"[^>]*\btransform=")[^"]*(")'
        text, count = re.subn(pattern, lambda m: m[1] + after + m[2], text)
        assert count == 1
        changes[oid] = {'before': before, 'after': after}
    data['3D/3dmodel.model'] = text.encode()
    config = data['Metadata/model_settings.config'].decode()
    for oid in sorted(mirror_ids):
        pattern = (r'(<assemble_item\b[^>]*\bobject_id="' + oid
                   + r'"[^>]*\binstance_id="0"[^>]*\btransform=")([^"]*)(")')
        config, count = re.subn(pattern, lambda m: m[1] + mirror_x(m[2]) + m[3], config)
        assert count == 1
    names = {'50': 'ankle_right_dual_locks_v10.stl', '51': 'ankle_left_dual_locks_v10.stl'}
    for oid, name in names.items():
        pattern = r'(<object\b[^>]*\bid="' + oid + r'">)(.*?)(</object>)'
        def rename(match):
            body, count = re.subn(r'(<metadata key="name" value=")[^"]*("\s*/>)',
                                 lambda m: m[1] + name + m[2], match[2])
            assert count == 2  # object and material volume
            return match[1] + body + match[3]
        config, count = re.subn(pattern, rename, config, flags=re.S)
        assert count == 1
    # Invalidate only the two visibly changed source plates; stale thumbnails
    # and pick images must not show the previous handedness on import.
    removed = set()
    for plate in settings.findall('plate'):
        ids = {m.get('value') for inst in plate.findall('model_instance')
               for m in inst.findall('metadata') if m.get('key') == 'object_id'}
        if ids & mirror_ids:
            for meta in plate.findall('metadata'):
                if meta.get('key') in ('thumbnail_file', 'thumbnail_no_light_file', 'top_file', 'pick_file'):
                    removed.add(meta.get('value'))
                    config = config.replace(E.tostring(meta, encoding='unicode').strip(), '')
            number = next(m.get('value') for m in plate.findall('metadata') if m.get('key') == 'plater_id')
            removed.update(n for n in data if re.fullmatch(
                r'Metadata/(?:plate_' + number + r'(?:_small)?|plate_no_light_' + number
                + r'|top_' + number + r'|pick_' + number + r')\.(?:png|json)', n))
    data['Metadata/model_settings.config'] = config.encode()
    project_before = json.loads(data['Metadata/project_settings.config'])
    if args.white_filaments:
        project = copy.deepcopy(project_before)
        assert project['filament_type'] == ['PLA', 'TPU']
        project['filament_colour'] = ['#FFFFFF', '#FFFFFF']
        data['Metadata/project_settings.config'] = (json.dumps(project, ensure_ascii=False, indent=4) + '\n').encode()
    for path in ('_rels/.rels', '3D/_rels/3dmodel.model.rels'):
        rel = data[path].decode()
        for name in removed:
            rel = re.sub(r'<Relationship\b[^>]*\bTarget="/?' + re.escape(name) + r'"[^>]*/>', '', rel)
        data[path] = rel.encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w') as z:
        for info in infos:
            if info.filename not in removed:
                z.writestr(copy.copy(info), data[info.filename])
    with zipfile.ZipFile(output) as z, zipfile.ZipFile(source) as old:
        assert z.testzip() is None
        now = E.fromstring(z.read('3D/3dmodel.model'))
        new_items = {i.get('objectid'): i for i in now.findall('./{*}build/{*}item')}
        assert len(new_items) == len(items) == 45
        assert sum(len(o.findall('./{*}components/{*}component'))
                   for o in now.findall('./{*}resources/{*}object')) == 49
        for oid, item in new_items.items():
            if oid in mirror_ids:
                assert item.get('transform') == changes[oid]['after']
                assert item.get('transform').split()[3:] == items[oid].get('transform').split()[3:]
            else:
                assert E.tostring(item) == E.tostring(items[oid])
        mesh_entries = [n for n in z.namelist() if n.startswith('3D/Objects/')]
        assert all(z.read(n) == old.read(n) for n in mesh_entries)
        project_after = json.loads(z.read('Metadata/project_settings.config'))
        if args.white_filaments:
            assert project_after['filament_colour'] == ['#FFFFFF', '#FFFFFF']
            assert {k: v for k, v in project_after.items() if k != 'filament_colour'} == {
                k: v for k, v in project_before.items() if k != 'filament_colour'}
        else:
            assert z.read('Metadata/project_settings.config') == old.read('Metadata/project_settings.config')
        new_settings = E.fromstring(z.read('Metadata/model_settings.config'))
        assert len(new_settings.findall('plate')) == len(settings.findall('plate')) == 6
        for before, after in zip(settings.findall('plate'), new_settings.findall('plate')):
            assert [E.tostring(i) for i in before.findall('model_instance')] == [E.tostring(i) for i in after.findall('model_instance')]
    report = {
        'revision': 'handed-ankles-v10', 'source_sha256': source_sha,
        'output_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'build_objects': 45, 'material_volumes': 49, 'source_plates': 6,
        'mirrored_local_x_objects': changes, 'ankle_names': names,
        'all_mesh_resources_byte_identical': True,
        'unrelated_build_transforms_preserved': True,
        'all_build_translations_preserved': True,
        'material_and_process_values_preserved_except_requested_color': True,
        'filament_color_before': project_before['filament_colour'],
        'filament_color_after': project_after['filament_colour'],
        'plate_membership_preserved': True,
        'removed_stale_preview_entries': sorted(removed),
        'physical_fit': 'not tested',
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'candidate_sha256': report['output_sha256'], 'mirrored_objects': sorted(mirror_ids)}))


if __name__ == '__main__':
    main()
