#!/usr/bin/env python3
"""Create a display-only mobile GLB. Requires trimesh, numpy, fast-simplification.
Reads only this project's full-resolution GLB; never touches manufacturing geometry.
"""
from pathlib import Path
import json
import trimesh
root = Path(__file__).resolve().parents[1] / 'public/models'
scene = trimesh.load(root / 'microduck.glb', force='scene', process=False)
original = 0
for name, mesh in list(scene.geometry.items()):
    original += len(mesh.faces)
    target = max(800, int(len(mesh.faces) * 0.3))
    if len(mesh.faces) > target:
        mesh = mesh.simplify_quadric_decimation(face_count=target)
    # Indexed vertex normals are computed offline, avoiding large crease maps on phones.
    _ = mesh.vertex_normals
    scene.geometry[name] = mesh
out = root / 'microduck-mobile.glb'
out.write_bytes(trimesh.exchange.gltf.export_glb(scene, include_normals=True))
manifest = json.loads((root / 'parts.json').read_text())
manifest['mobileGeometryUrl'] = out.name
manifest['mobileDisplayTriangles'] = sum(len(m.faces) for m in scene.geometry.values())
(root / 'parts.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print({'sourceTriangles':original,'mobileTriangles':manifest['mobileDisplayTriangles'],'bytes':out.stat().st_size})
