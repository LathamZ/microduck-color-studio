#!/usr/bin/env python3
"""Check saved v10 handedness and mating geometry; optionally export a review mesh.

Code Apache-2.0; derivative geometry CC BY-NC-SA 4.0. Requires the same mesh
dependencies as revise_feetech_mounts.py. All dimensions are millimeters.
Functional assembly frames are measured v9 datums, independent of print poses.
"""
import argparse
import hashlib
import json
import zipfile
import xml.etree.ElementTree as E
from pathlib import Path

import numpy as np
import trimesh
from revise_feetech_mounts import load, solid, cylinder, box
from revise_feetech_locks import ANKLE, FOOT, BC, LOCK_X, LOCK_Y


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--review-mesh')
    args = parser.parse_args()
    source = Path(args.source)
    flip = np.diag([-1., 1., 1., 1.])
    with zipfile.ZipFile(source) as z:
        root = E.fromstring(z.read('3D/3dmodel.model'))
        items = {i.get('objectid'): i for i in root.findall('./{*}build/{*}item')}
    checks = {}

    def zero(name, value, tolerance=1e-4):
        value = float(value)
        assert abs(value) < tolerance, (name, value)
        checks[name] = value

    def positive(name, value):
        value = float(value)
        assert value > 1e-3, (name, value)
        checks[name] = value

    meshes = {oid: load(oid, source) for oid in (50, 51, 32, 35, 63, 67, 71, 72)}
    # The ankle build frames contain no print rotation. The left build X
    # reflection is its actual manufacturing handedness, not a display edit.
    for oid, expected in ((50, np.eye(3)), (51, flip[:3, :3])):
        basis = np.array(list(map(float, items[str(oid)].get('transform').split()[:9]))).reshape(3, 3)
        assert np.allclose(basis, expected, atol=1e-12, rtol=0)
        meshes[oid].apply_transform(np.block([[basis.T, np.zeros((3, 1))], [np.zeros((1, 3)), np.ones((1, 1))]]))
    for oid in (35, 63, 71):
        basis = np.array(list(map(float, items[str(oid)].get('transform').split()[:9]))).reshape(3, 3)
        assert np.linalg.det(basis) < 0, (oid, 'mating left part is not reflected')
        meshes[oid].apply_transform(flip)
    for oid in (32, 67, 72):
        basis = np.array(list(map(float, items[str(oid)].get('transform').split()[:9]))).reshape(3, 3)
        assert np.linalg.det(basis) > 0, (oid, 'right part unexpectedly reflected')
    for oid, m in meshes.items():
        assert m.is_watertight and m.is_winding_consistent and m.volume > 0, oid
        assert len(m.split(only_watertight=False)) == 1, oid
        checks[f'object_{oid}_closed_positive_single_component'] = True
    right, left = solid(meshes[50]), solid(meshes[51])
    zero('left_ankle_vs_reflected_right_mm3',
         (left - right.mirror([1, 0, 0])).volume() + (right.mirror([1, 0, 0]) - left).volume())
    zero('ankle_volume_difference_mm3', left.volume() - right.volume())
    zero('ankle_vertices_reflection_max_error_mm',
         np.max(np.abs(meshes[51].vertices - meshes[50].vertices * [-1, 1, 1])), 1e-9)
    blades = {}
    for side, ids in (('right', (67, 72)), ('left', (63, 71))):
        halves = []
        for index, oid in enumerate(ids):
            raw = load(oid, source)
            shift = np.array([BC - .1 - raw.bounds[1, 0] if index == 0
                              else BC + .1 - raw.bounds[0, 0], 0, 0])
            if side == 'left':
                shift *= [-1, 1, 1]
            halves.append(solid(meshes[oid]).translate(shift))
        zero(f'{side}_skate_half_intersection_mm3', (halves[0] ^ halves[1]).volume())
        blades[side] = halves[0] + halves[1]
    zero('left_skate_vs_reflected_right_mm3',
         (blades['left'] - blades['right'].mirror([1, 0, 0])).volume()
         + (blades['right'].mirror([1, 0, 0]) - blades['left']).volume())
    for side, ankle, foot in (('right', right, solid(meshes[32])), ('left', left, solid(meshes[35]))):
        sign = np.array([-1, 1, 1]) if side == 'left' else np.ones(3)
        walking_shift, roller_shift = (ANKLE - FOOT) * sign, ANKLE * sign
        for kind, base, shift in (('walking', foot, walking_shift), ('roller', blades[side], roller_shift)):
            zero(f'{side}_{kind}_seated_intersection_mm3', (base ^ ankle.translate(shift)).volume())
            positive(f'{side}_{kind}_rear_hook_retains_uplift_mm3', (base ^ ankle.translate(shift + [0, 0, 1])).volume())
        for x in LOCK_X:
            xy = (np.array([x, LOCK_Y, 0]) - ANKLE) * sign
            xy[2] = 0
            zero(f'{side}_ankle_clearance_{x}_blocked_mm3',
                 (ankle ^ cylinder(2, xy, 1.09, -7.79, -4.5692)).volume())
            for kind, base, offset in (('walking', foot, FOOT), ('roller', blades[side], np.zeros(3))):
                center = (np.array([x, LOCK_Y, 0]) - offset) * sign
                center[2] = 0
                zero(f'{side}_{kind}_pilot_{x}_blocked_mm3',
                     (base ^ cylinder(2, center, .79, 6.39 - offset[2], 11.68 - offset[2])).volume())
        bearing_center = [0, 2.33679219, 3.55]
        for step, start in enumerate(np.linspace(14.811591 - 5, 14.811591, 11)):
            ring = cylinder(0, bearing_center, 7.5, start, start + 3) - cylinder(0, bearing_center, 5, start - .01, start + 3.01)
            if side == 'left':
                ring = ring.mirror([1, 0, 0])
            zero(f'{side}_bearing_inside_insertion_{step}_mm3', (ankle ^ ring).volume())
        ring = cylinder(0, bearing_center, 7.5, 17.821591, 20.821591) - cylinder(0, bearing_center, 5, 17.811591, 20.831591)
        if side == 'left':
            ring = ring.mirror([1, 0, 0])
        positive(f'{side}_bearing_outside_shoulder_blocks_reverse_entry_mm3', (ankle ^ ring).volume())
    # X reflection keeps the filled end slots and the rear hooks at the same
    # front/back and up/down locations. It never rotates a heel toward the toe.
    for oid in (50, 51):
        assert meshes[oid].bounds[0, 2] == -12.75 and meshes[oid].bounds[1, 2] == 12.75
    report = {
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'functional_frame': 'v9 datums; left assemblies reflect X, retaining Y and Z',
        'intersection_tolerance_mm3': 1e-4, 'checks': checks,
        'physical_fit': 'not tested',
    }
    if args.review_mesh:
        # Focus artifact derived directly from saved manufacturing instances,
        # arranged in left/right assembly order. No new manufacturing geometry.
        pair = []
        for oid, x in ((51, -30), (50, 30)):
            m = meshes[oid].copy()
            m.apply_translation([x, 0, 12.75])
            pair.append(m)
        review = Path(args.review_mesh)
        trimesh.util.concatenate(pair).export(review)
        report['review_mesh_sha256'] = hashlib.sha256(review.read_bytes()).hexdigest()
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'checks_passed': len(checks), 'source_sha256': report['source_sha256']}))


if __name__ == '__main__':
    main()
