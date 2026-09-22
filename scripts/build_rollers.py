#!/usr/bin/env python3
"""Build the roller-skate module: the swap-in feet, as their own GLB plus manifest parts.

Requires Python 3.12+, numpy, trimesh. Never changes source files.
Usage: python scripts/build_rollers.py /path/to/microduck-replica

The placements below are the official Microduck simulator's, taken from the rollers variant of
pollen-robotics/microduck_rl (mirrored at github.com/boris721/microduck-3d). Every mesh sits
exactly where the simulator puts it, converted to this project's frame: millimetres, Y up, and
the same origin the rest of the model uses (the trunk body sits 120 mm up in the simulator).

The module replaces the foot and ankle assemblies. It lives in its own GLB so the walking model
stays the size it is, and is only fetched when someone switches to skates.

The runner rewrites the roller entries in public/models/parts.json; run Prettier afterwards.
"""
import argparse
import json
import pathlib

import numpy as np
import trimesh

# (label, source mesh, placement matrix rows in mm, manifest role, material, plate, paintable)
# Matrix is row-major 3x4: rotation then translation, in the viewer's frame.
MODULE = [
    ('轮滑脚踝左', 'ankle_l_v1_脚踝左V1.stl', 'ankle_l_v1', '16-01', 'accent', 'pla', 3, True),
    ('轮滑刀架左', 'roller_blade_滚轮叶片.stl', 'roller_blade', '16-02', 'primary', 'pla', 1, True),
    ('轮辋左前', 'rim_轮辋.stl', 'rim', '16-03', 'accent', 'pla', 3, True),
    ('轮胎左前', 'tire_轮胎.stl', 'tire', '16-04', 'structure', 'tpu', 5, False),
    ('轮辋左后', 'rim_轮辋.stl', 'rim', '16-05', 'accent', 'pla', 3, True),
    ('轮胎左后', 'tire_轮胎.stl', 'tire', '16-06', 'structure', 'tpu', 5, False),
    ('轮滑脚踝右', 'ankle_r_v1_脚踝右V1.stl', 'ankle_r_v1', '17-01', 'accent', 'pla', 3, True),
    ('轮滑刀架右', 'roller_blade_滚轮叶片.stl', 'roller_blade', '17-02', 'primary', 'pla', 1, True),
    ('轮辋右前', 'rim_轮辋.stl', 'rim', '17-03', 'accent', 'pla', 3, True),
    ('轮胎右前', 'tire_轮胎.stl', 'tire', '17-04', 'structure', 'tpu', 5, False),
    ('轮辋右后', 'rim_轮辋.stl', 'rim', '17-05', 'accent', 'pla', 3, True),
    ('轮胎右后', 'tire_轮胎.stl', 'tire', '17-06', 'structure', 'tpu', 5, False),
]

# Placement of every part, straight from the simulator: row-major 3x4, rotation then
# translation, in the viewer's frame. The meshes carry their own offsets, so parts that share
# a placement still land in different places.
MATRICES = [
    [-0.0006, -1000.0019, -0.0012, -9.7770, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, -0.0012, -9.7770, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, -0.0012, -9.7770, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, -0.0012, -9.7770, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, -0.0012, -74.7772, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, -0.0012, -74.7772, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0019, -0.0006, -0.0000, 0.2000],
    [-0.0006, -1000.0019, 0.0000, -9.7772, 0.0000, 0.0000, 1000.0025, -75.2772, -1000.0031, -0.0006, 0.0000, -0.2001],
    [-0.0006, -1000.0019, 0.0000, -9.7771, 0.0000, 0.0000, 1000.0025, -75.2772, -1000.0031, -0.0006, 0.0000, 100.0183],
    [-0.0006, -1000.0019, 0.0000, -9.7771, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0031, -0.0006, 0.0000, 100.0183],
    [-0.0006, -1000.0019, 0.0000, -9.7771, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0031, -0.0006, 0.0000, 100.0183],
    [-0.0006, -1000.0019, 0.0000, -74.7772, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0031, -0.0006, 0.0000, 100.0182],
    [-0.0006, -1000.0019, 0.0000, -74.7772, 0.0000, 0.0000, 1000.0025, -75.2773, -1000.0031, -0.0006, 0.0000, 100.0182],
]

COLORS = {'hardware': '#535960', 'primary': '#F1EFE7', 'accent': '#F28C28', 'structure': '#30343B'}


def matrix_for(index: int) -> np.ndarray:
    """The 4x4 placement for one entry of MODULE."""
    out = np.eye(4)
    out[:3, :4] = np.array(MATRICES[index], float).reshape(3, 4)
    return out
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=pathlib.Path, help='path to microduck-replica')
    args = parser.parse_args()
    stl_dir = args.source / 'print' / '变体-轮滑'
    out = pathlib.Path(__file__).resolve().parents[1] / 'public' / 'models'

    scene = trimesh.Scene()
    parts = []
    for index, (label, file, source, prefix, role, material, plate, paintable) in enumerate(MODULE):
        mesh = trimesh.load(stl_dir / file, force='mesh')
        mesh.apply_transform(matrix_for(index))
        mesh.vertices = np.round(mesh.vertices, 4)
        part_id = f'{prefix}-{source}'
        bounds = np.round(mesh.bounds, 3).tolist()
        parts.append({
            'id': part_id,
            'name': label,
            'sourceName': source,
            'assembly': '左踝脚（轮滑）' if index < 6 else '右踝脚（轮滑）',
            'assemblyId': '16' if index < 6 else '17',
            'defaultMaterial': material,
            'metalness': 0,
            'role': role,
            'printable': True,
            'plate': plate,
            'defaultColor': COLORS[role],
            'triangles': len(mesh.faces),
            'bounds': bounds,
            'paintable': paintable,
            'module': 'skate',
        })
        scene.add_geometry(mesh, node_name=part_id, geom_name=part_id)

    scene.export(out / 'microduck-rollers.glb')

    manifest_path = out / 'parts.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['parts'] = [p for p in manifest['parts'] if p.get('module') != 'skate'] + parts
    manifest['rollerGeometryUrl'] = 'microduck-rollers.glb'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

    print(json.dumps({
        'parts': len(parts),
        'faces': sum(p['triangles'] for p in parts),
        'glbBytes': (out / 'microduck-rollers.glb').stat().st_size,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
