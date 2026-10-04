#!/usr/bin/env python3
"""Feetech v9: two symmetric ankle locks and complete removal of end tabs.

Explicit manufacturing --source/--output, measured v8 or combined-wheel baseline only.
Code Apache-2.0; manufacturing model and previews CC BY-NC-SA 4.0.
Requires numpy, trimesh, manifold3d, matplotlib. No printer operations.
"""
import argparse
import copy
import hashlib
import json
import re
import tempfile
import zipfile
import xml.etree.ElementTree as E
from pathlib import Path

import numpy as np
import manifold3d as mf
import trimesh
import matplotlib.pyplot as plt
from revise_feetech_mounts import load, solid, mesh, box, cylinder, render, mesh_xml, update_object_config, PROD

BASELINE_SHA = '9bede9838e533d7f3ce08147dadce6ccfa85a794868a45b925da1f922e00b5c2'
WHEEL_BASELINE_SHA = '867a3d1f486c680511d3aa09ca8466978cb05b5c8ffbd5db79000b96fc80d560'
ANKLE = np.array([.01197032, 4.66320781, 18.388364])
FOOT = np.array([0., 0., 6.73478842])
BC = .0144918
LOCK_Y = -10.49799219
OLD_X = .12356132
LOCK_X = [BC - 8, BC + 8]
NAMES = {'ankle': 'ankle_dual_locks_no_end_slots_v9.stl',
         'foot': 'walking_base_dual_locks_no_end_tabs_v9.stl',
         '65': '左轮滑底座_左半_v9.stl', '70': '右轮滑底座_左半_v9.stl',
         '78': '左轮滑底座_右半_v9.stl', '79': '右轮滑底座_右半_v9.stl'}


def export_mesh(s):
    # The measured rim planes differ by a few nanometres. Remove boolean seam
    # remnants after vertex welding. The two stages displace surfaces by at
    # most 0.00003 mm in total, far below the assembly clearance.
    s=solid(mesh(s)).set_tolerance(2e-5).simplify(2e-5)
    m=s.to_mesh64()
    return trimesh.Trimesh(m.vert_properties[:,:3],m.tri_verts,process=True)


def build(source):
    original = {key: load(oid, source) for key, oid in
                [('ankle', 50), ('foot', 32), ('left_half', 65), ('right_half', 78)]}
    # Studio re-centred the two skating half meshes on save. Work in the
    # measured common blade frame, then restore each source mesh's local frame.
    with zipfile.ZipFile(source) as z:
        root=E.fromstring(z.read('3D/3dmodel.model'))
        combined=any(o.get('id')=='63' and len(o.findall('./{*}components/{*}component'))==2 for o in root.findall('./{*}resources/{*}object'))
    local_shifts={k:np.zeros(3) for k in original}
    if combined:
        local_shifts['left_half'][0]=BC-.1-original['left_half'].bounds[1,0]
        local_shifts['right_half'][0]=BC+.1-original['right_half'].bounds[0,0]
        for k in ('left_half','right_half'):original[k].apply_translation(local_shifts[k])
    a0, f0, l0, r0 = [solid(original[k]) for k in original]
    a, f, b = a0, f0, l0 + r0
    # These are the transverse FRONT and REAR end notches marked by the user,
    # not the longitudinal underside steps that were removed in v8.
    slots = box([-5.888409, -19.5, -4.8690147], [6.111591, -18.1, -3.5690147])
    slots += box([-5.888409, 15.6, -4.8690147], [6.111591, 17, -3.5690147])
    a += slots
    # Reference the adjacent, un-tabbed rim at X=8 rather than cutting an
    # arbitrary flat through the rounded front/rear walls or the short hooks.
    section = original['foot'].section(plane_origin=[8, 0, 0], plane_normal=[1, 0, 0])
    profile = mf.CrossSection([p[:-1, 1:] for p in section.discrete], mf.FillRule.EvenOdd)
    natural_rim = profile.extrude(14).rotate([90, 0, 90]).translate([-7, 0, 0])
    tab_region = box([-6.37644, -27.01, 5.30489], [6.62356, -14.8, 8.5])
    tab_region += box([-6.37644, 21.6, 5.30489], [6.62356, 27.01, 8.5])
    tab_cutter = tab_region - natural_rim
    # Include the whole mating envelope under the now-solid notches, with the
    # existing 0.15-mm assembly clearance. The roller rim has an extra inward
    # ledge here that an outer-rim profile alone does not cover.
    tab_cutter += (slots + slots.translate([0,0,-.15])).translate(ANKLE-FOOT)
    f -= tab_cutter
    b -= tab_cutter.translate(FOOT)
    # Restore the old centre hole to solid material. The ankle's head seat is
    # one mm deep; its 2.2-mm passage and both bases' 1.6-mm pilot are retained
    # at the two new positions instead. All Z coordinates below use blade frame.
    old_head=cylinder(2, [OLD_X-ANKLE[0], LOCK_Y-ANKLE[1], 0], 2.201,
                      -6.3, -3.55)
    a += a0.translate([5,0,0]) ^ old_head
    old_fill = cylinder(2, [OLD_X, LOCK_Y, 0], .801, 6.18925, 11.69)
    old_head = cylinder(2, [OLD_X, LOCK_Y, 0], 1.501, 11.68, 12.2)
    f += old_fill.translate(-FOOT) + (f0.translate([5,0,0]) ^ old_head.translate(-FOOT))
    b += old_fill + ((l0+r0).translate([5,0,0]) ^ old_head)
    for x in LOCK_X:
        head = cylinder(2, [x-ANKLE[0], LOCK_Y-ANKLE[1], 0], 2.2, -4.5690147, 13)
        passage = cylinder(2, [x-ANKLE[0], LOCK_Y-ANKLE[1], 0], 1.1, -7.8, -4.5689)
        a -= head + passage
        # Each new pilot has a 5.2-mm outside boss, connected to the existing
        # top plate. It provides the old pilot depth even over walking ribs.
        boss = cylinder(2, [x, LOCK_Y, 0], 2.6, 6.1893511, 12.03968)
        bore = cylinder(2, [x, LOCK_Y, 0], .8, 6.3893511, 11.6893511)
        bore += cylinder(2, [x, LOCK_Y, 0], 1.5, 11.6893511, 12.2)
        f = (f + boss.translate(-FOOT)) - bore.translate(-FOOT)
        b = (b + boss) - bore
    # Reapply the existing 0.2-mm seam after centre-hole filling.
    l = b ^ box([-50, -50, -50], [BC-.1, 50, 50])
    r = b ^ box([BC+.1, -50, -50], [50, 50, 50])
    parts = {k: export_mesh(s) for k, s in zip(original, [a, f, l, r])}
    a, f, l, r = [solid(parts[k]) for k in parts]
    b = l + r
    checks = {}
    def zero(name, value, tol=1e-4):
        value = float(value); assert abs(value) < tol, (name, value); checks[name] = value
    def positive(name, value):
        value = float(value); assert value > 1e-3, (name, value); checks[name] = value
    zero('both_transverse_slots_missing_material_mm3', (slots-a).volume())
    zero('walking_end_tabs_remaining_mm3', (f ^ tab_cutter).volume())
    zero('roller_end_tabs_remaining_mm3', (b ^ tab_cutter.translate(FOOT)).volume())
    zero('walking_seated_intersection_mm3', (f ^ a.translate(ANKLE-FOOT)).volume())
    zero('roller_seated_intersection_mm3', (b ^ a.translate(ANKLE)).volume())
    zero('split_intersection_mm3', (l ^ r).volume())
    positive('walking_end_tabs_removed_mm3', (f0 ^ tab_cutter).volume())
    positive('roller_end_tabs_removed_mm3', ((l0+r0) ^ tab_cutter.translate(FOOT)).volume())
    old_shaft=cylinder(2, [OLD_X-ANKLE[0], LOCK_Y-ANKLE[1], 0], 1.09, -6.198, -4.57)
    zero('old_ankle_shaft_missing_material_mm3', (old_shaft-a).volume())
    old_pilot=cylinder(2, [OLD_X, LOCK_Y, 0], .79, 6.4, 11.68)
    zero('old_walking_pilot_missing_material_mm3', (old_pilot.translate(-FOOT)-f).volume())
    seam=box([BC-.1,-50,-50],[BC+.1,50,50])
    zero('old_roller_pilot_missing_material_outside_seam_mm3', (old_pilot-seam-b).volume())
    for x in [-13.2884, 13.5116]:
        region = box([x-3, 11.8, -12.8], [x+3, 19.6, -9.3])
        zero(f'ankle_short_hook_{x}_removed_mm3', ((a0 ^ region)-(a ^ region)).volume())
        zero(f'ankle_short_hook_{x}_added_mm3', ((a ^ region)-(a0 ^ region)).volume())
    for name, s, shift in [('walking', f, ANKLE-FOOT), ('roller', b, ANKLE)]:
        positive(name+'_rear_hook_retains_uplift_mm3', (s ^ a.translate(shift+[0,0,1])).volume())
    bearing_region = box([14, -6, -5], [22, 11, 13])
    zero('bearing_seat_removed_mm3', ((a0 ^ bearing_region)-(a ^ bearing_region)).volume())
    zero('bearing_seat_added_mm3', ((a ^ bearing_region)-(a0 ^ bearing_region)).volume())
    for x in LOCK_X:
        ankle_xy = [x-ANKLE[0], LOCK_Y-ANKLE[1], 0]
        zero(f'head_tool_path_{x}_blocked_mm3', (a ^ cylinder(2, ankle_xy, 2.19, -4.5689, 13)).volume())
        zero(f'ankle_passage_{x}_blocked_mm3', (a ^ cylinder(2, ankle_xy, 1.09, -7.79, -4.5692)).volume())
        seat = cylinder(2, ankle_xy, 2.19, -4.75, -4.58)-cylinder(2, ankle_xy, 1.11, -4.76, -4.57)
        positive(f'ankle_head_seat_{x}_material_mm3', (a ^ seat).volume())
        for name, s, shift in [('walking', f, FOOT), ('roller', b, np.zeros(3))]:
            pilot = cylinder(2, [x, LOCK_Y, 0], .79, 6.39, 11.68).translate(-shift)
            zero(f'{name}_pilot_{x}_blocked_mm3', (s ^ pilot).volume())
            wall = cylinder(2, [x, LOCK_Y, 0], 2.59, 6.4, 9)-cylinder(2, [x, LOCK_Y, 0], .81, 6.39, 9.01)
            zero(f'{name}_pilot_{x}_wall_missing_mm3', (wall.translate(-shift)-s).volume())
    # No screw, head or boss straddles the joint.
    for x in LOCK_X:
        assert abs(x-BC)-2.6 > .1
    for y in [-19, 19]:
        zero(f'horizontal_tool_tunnel_{y}_blocked_mm3', (l ^ cylinder(0, [0,y,4], 2.19, -25, BC-3.201)).volume())
        zero(f'horizontal_passage_{y}_blocked_mm3', (l ^ cylinder(0, [0,y,4], 1.09, BC-3.199, BC-.1)).volume())
        zero(f'horizontal_pilot_{y}_blocked_mm3', (r ^ cylinder(0, [0,y,4], .79, BC+.101, BC+5.299)).volume())
    tire_mesh=load(63,source,part_id=66) if combined else load(67,source)
    for y in [-32.5, 32.5]:
        tyre = solid(tire_mesh).translate([BC, y, -10.6915331])
        rim = solid(load(63, source)).translate([BC, y, -10.6915331])
        zero(f'wheel_{y}_rim_intersection_mm3', (b ^ rim).volume())
        for delta in np.linspace(0,12,25):
            zero(f'wheel_{y}_left_installation_{delta}_mm3', (l.translate([-delta,0,0]) ^ tyre).volume())
            zero(f'wheel_{y}_right_installation_{delta}_mm3', (r.translate([delta,0,0]) ^ tyre).volume())
        for x in [-6.25, 6.25]:
            region = box([BC+x-2,y-5,-15.5],[BC+x+2,y+5,-5.5])
            zero(f'axle_{x}_{y}_removed_mm3', (((l0+r0) ^ region)-(b ^ region)).volume())
            zero(f'axle_{x}_{y}_added_mm3', ((b ^ region)-((l0+r0) ^ region)).volume())
    for key, m in parts.items():
        assert m.is_watertight and m.is_winding_consistent and m.volume > 0, key
        assert len(m.split(only_watertight=False)) == 1, key
        assert np.allclose(m.bounds, original[key].bounds, atol=1e-5, rtol=0), key
    for k,m in parts.items():m.apply_translation(-local_shifts[k])
    return parts, checks


def write(source, output, parts):
    with zipfile.ZipFile(source) as z:
        infos=z.infolist(); data={i.filename:z.read(i) for i in infos}
    root=E.fromstring(data['3D/3dmodel.model'])
    objects={o.get('id'):o for o in root.findall('./{*}resources/{*}object')}
    build_count=len(root.findall('./{*}build/{*}item'))
    assert build_count in (45,49)
    assert sum(len(o.findall('./{*}components/{*}component')) for o in objects.values())==49
    settings=E.fromstring(data['Metadata/model_settings.config'])
    config={o.get('id'):o for o in settings.findall('object')}
    changed=[]
    for key, ids in [('ankle',[50,51]),('foot',[32,35]),('left_half',[65,70]),('right_half',[78,79])]:
        comp=objects[str(ids[0])].find('./{*}components/{*}component')
        path=comp.get('{'+PROD+'}path').lstrip('/'); changed.append(path)
        data[path]=re.sub(r'<mesh>.*?</mesh>',lambda _:mesh_xml(parts[key]),data[path].decode(),flags=re.S).encode()
        for oid in ids:update_object_config(config[str(oid)],NAMES.get(str(oid),NAMES.get(key)),parts[key])
    data['Metadata/model_settings.config']=E.tostring(settings,encoding='utf-8',xml_declaration=True)
    data['3D/3dmodel.model']=re.sub(r'(<metadata name="Description">).*?(</metadata>)',lambda m:m[1]+'Feetech v9: two symmetric vertical ankle locks, both transverse end slots and mating tabs removed. Inside-entry bearings, short hooks and split skate bases retained. 49 material instances; PLA/TPU wheel assemblies retained when present; physical fit untested.'+m[2],data['3D/3dmodel.model'].decode(),flags=re.S).encode()
    output.parent.mkdir(parents=True,exist_ok=True); temp=output.with_name('.feetech-v9.tmp')
    with zipfile.ZipFile(temp,'w') as z:
        for info in infos:z.writestr(copy.copy(info),data[info.filename])
    with zipfile.ZipFile(temp) as z, zipfile.ZipFile(source) as old:
        assert z.testzip() is None
        for info in infos:
            if info.filename not in changed+['3D/3dmodel.model','Metadata/model_settings.config']:
                assert z.read(info.filename)==old.read(info.filename)
        for key, oid in [('ankle',50),('foot',32),('left_half',65),('right_half',78)]:
            m=load(oid,temp); assert m.is_watertight and m.is_winding_consistent
            assert np.allclose(m.vertices,parts[key].vertices,atol=1e-12,rtol=0)
    temp.replace(output)
    return changed


def render_comparison(source, output, path):
    fig, axes=plt.subplots(2,2,figsize=(14,8),facecolor='#fafaf7')
    cases=[('Front ankle slot filled',50,1,-18.8,[-8,8],[-5.2,-3.3]),
           ('Rear ankle slot filled',50,1,16.3,[-8,8],[-5.2,-3.3]),
           ('Walking rear tab removed',32,0,.2,[21.5,25],[6.3,8.15]),
           ('Skating rear tab removed',78,0,1,[21.5,25],[13,14.9])]
    for ax,(title,oid,axis,value,xlim,ylim) in zip(axes.flat,cases):
        if oid==78 and hashlib.sha256(source.read_bytes()).hexdigest()==WHEEL_BASELINE_SHA:
            value-=BC+.1-load(78,source).bounds[0,0]
        origin=np.eye(3)[axis]*value
        for label,p,color,style in [('V8 / before',source,'#bd6654','--'),('V9 / after',output,'#267f8c','-')]:
            sec=load(oid,p).section(plane_origin=origin,plane_normal=np.eye(3)[axis])
            for index,line in enumerate(sec.discrete):
                ax.plot(line[:,1-axis],line[:,2],color=color,ls=style,lw=2,
                        label=label if index==0 else None)
        ax.set(title=title,xlim=xlim,ylim=ylim,xlabel='X (mm)' if axis==1 else 'Y (mm)',ylabel='Z (mm)')
        ax.grid(alpha=.2);ax.legend(loc='lower right')
    fig.suptitle('Actual mesh sections at the marked end slots and mating rim tabs',fontsize=15)
    fig.tight_layout();fig.savefig(path,dpi=170);plt.close(fig)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['source','output','report','preview']:p.add_argument('--'+name,type=Path,required=True)
    args=p.parse_args(); original=args.source.read_bytes(); digest=hashlib.sha256(original).hexdigest()
    assert args.source.resolve()!=args.output.resolve(), 'Write a candidate before replacing the source'
    assert digest in (BASELINE_SHA,WHEEL_BASELINE_SHA), 'Source differs from the measured baseline; do not apply twice'
    parts, checks=build(args.source)
    backup=Path(tempfile.mkdtemp(prefix='microduck-before-v9-'))/args.source.name; backup.write_bytes(original)
    changed=write(args.source,args.output,parts)
    args.preview.parent.mkdir(parents=True,exist_ok=True)
    render({'Ankle: two locks, solid end slots':parts['ankle'],'Walking base: two pilots, no tabs':parts['foot'],
            'Roller left half: one ankle pilot':parts['left_half'],'Roller right half: one ankle pilot':parts['right_half']},args.preview,size=(20,9))
    render_comparison(args.source,args.output,args.preview.with_name(args.preview.stem+'-comparison.png'))
    report={'revision':'dual-ankle-locks-no-transverse-end-tabs-v9','source_sha256':digest,
            'output_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'instance_count':49,
            'build_object_count':45 if digest==WHEEL_BASELINE_SHA else 49,
            'modified_mesh_entries':changed,'other_mesh_entries_byte_identical':True,
            'meshes':{k:{'watertight':bool(m.is_watertight),'winding_consistent':bool(m.is_winding_consistent),
                         'components':len(m.split()),'triangles':len(m.faces),'bounds_mm':m.bounds.tolist(),
                         'volume_mm3':float(m.volume)} for k,m in parts.items()},
            'vertical_locks':{'count_per_ankle':2,'size':'M2','centers_blade_frame_mm':[[x,LOCK_Y] for x in LOCK_X],
                              'center_distance_mm':16,'ankle_head_diameter_mm':4.4,'ankle_passage_diameter_mm':2.2,
                              'base_pilot_diameter_mm':1.6,'base_boss_diameter_mm':5.2,'old_center_hole_filled':True},
            'removed_features':'front/rear 12 x 1.4 x 1.3 mm transverse ankle notches and mating rim tabs',
            'geometry_checks':checks,'physical_fit_tested':False,'sliced':False,'print_started':False}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'output':str(args.output),'backup_outside_project':str(backup),'passed_geometry_checks':len(checks)},ensure_ascii=False))


if __name__=='__main__':main()
