#!/usr/bin/env python3
"""Arrange the user-owned Feetech sample in place, without editing any mesh.

Code Apache-2.0; model and rendered derivatives CC BY-NC-SA 4.0.
Requires numpy, trimesh and matplotlib. Backup is written outside the repository.
"""
import argparse
import copy
import datetime
import hashlib
import json
import pathlib
import re
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET

import numpy as np
import trimesh

CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
GROUPS = [([1, 4], '腿部、颈部与结构支架', 'Legs, neck and structural brackets'),
          ([2], '外壳、头部、脚踝与轮辋', 'Shells, head, common ankles and rims'),
          ([3], '步行轮滑底座与头部配件', 'Walking/skating bases and head fittings'),
          ([5], '脚底、轮胎与软嘴组件', 'Soles, tires and soft-mouth parts')]


def matrix(text):
    values=np.array([float(v) for v in text.split()]).reshape(4, 3)
    out=np.eye(4);out[:3,:]=values.T
    return out


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=pathlib.Path)
    parser.add_argument('--report',required=True,type=pathlib.Path)
    parser.add_argument('--preview',required=True,type=pathlib.Path)
    args=parser.parse_args()
    original=args.source.read_bytes()
    with zipfile.ZipFile(args.source) as archive:
        infos=archive.infolist();data={i.filename:archive.read(i) for i in infos}
    root=ET.fromstring(data['3D/3dmodel.model']);settings=ET.fromstring(data['Metadata/model_settings.config'])
    project=json.loads(data['Metadata/project_settings.config'])
    assert root.get('unit')=='millimeter'
    area=[tuple(float(v) for v in p.split('x')) for p in project['printable_area']]
    width=max(p[0] for p in area);depth=max(p[1] for p in area)
    items={i.get('objectid'):i for i in root.findall('./{*}build/{*}item')}
    expected=json.loads((pathlib.Path(__file__).resolve().parents[1]/'src/models/feetech-sample.json').read_text())['bindings']
    assert set(items)==set(expected), 'Source instances differ from the explicit sample bindings'
    count=len(items)
    objects={o.get('id'):o for o in settings.findall('object')}
    resources={o.get('id'):o for o in root.findall('./{*}resources/{*}object')}
    getmeta=lambda el,k:next((m.get('value') for m in el.findall('metadata') if m.get('key')==k),None)
    originals={k:dict(i.attrib) for k,i in items.items()}
    instances={getmeta(i,'object_id'):copy.deepcopy(i) for p in settings.findall('plate') for i in p.findall('model_instance')}
    oldplates={int(getmeta(p,'plater_id')):p for p in settings.findall('plate')}
    assert set(oldplates) in ({1,2,3,4,5},{1,2,3,4})
    groups=GROUPS if 5 in oldplates else [([i],title,english) for i,(_,title,english) in enumerate(GROUPS,1)]
    meshes={};records={};source_geometry={}
    for oid,item in items.items():
        components=resources[oid].findall('./{*}components/{*}component')
        assert len(components)==1
        component=components[0];path=component.get('{'+PROD+'}path').lstrip('/')
        model=ET.fromstring(data[path]);obj=next(o for o in model.findall('./{*}resources/{*}object') if o.get('id')==component.get('objectid'))
        vertices=np.array([[float(v.get(k)) for k in ('x','y','z')] for v in obj.findall('.//{*}vertex')])
        faces=np.array([[int(f.get(k)) for k in ('v1','v2','v3')] for f in obj.findall('.//{*}triangle')])
        component_transform=matrix(component.get('transform','1 0 0 0 1 0 0 0 1 0 0 0'))
        source_geometry[oid]=(vertices,faces,component_transform)
        transform=matrix(item.get('transform')) @ component_transform
        mesh=trimesh.Trimesh(trimesh.transform_points(vertices,transform),faces,process=True)
        if np.linalg.det(transform[:3,:3])<0:mesh.invert()
        meshes[oid]=mesh
        records[oid]={'source_object_id':oid,'name':getmeta(objects[oid],'name'),'size_mm':mesh.extents.tolist(),'triangles':len(faces),'watertight':bool(mesh.is_watertight),'winding_consistent':bool(mesh.is_winding_consistent),'signed_volume_mm3':float(mesh.volume),'extruder':getmeta(objects[oid],'extruder'),'mesh_entry':path}
    # Keep all per-object process/support settings and filament slots; change only plate placement.
    plate_reports=[];all_members=[];new_transforms={}
    for index,(oldids,title,english) in enumerate(groups):
        members=[getmeta(i,'object_id') for n in oldids for i in oldplates[n].findall('model_instance')]
        members.sort(key=lambda oid:(-meshes[oid].extents[1],-meshes[oid].extents[0],int(oid)))
        x=y=10.;row=0.;placed=[]
        origin=np.array([(index%2)*width*1.2,-(index//2)*depth*1.2,0.])
        for oid in members:
            mesh=meshes[oid];size=mesh.extents
            if x+size[0]>width-10:x=10.;y+=row+8.;row=0.
            assert y+size[1]<=depth-10 and size[2]<=float(project['printable_height']), (title,oid,'Plate overflow')
            low=mesh.bounds[0];delta=origin+np.array([x,y,0])-low
            old=matrix(items[oid].get('transform'));old[:3,3]+=delta
            new_transforms[oid]=' '.join(f'{v:.12g}' for v in np.r_[old[:3,:3].T.ravel(),old[:3,3]])
            # Preserve the nine original orientation/scale values byte-for-byte.
            new_transforms[oid]=' '.join(items[oid].get('transform').split()[:9]+new_transforms[oid].split()[9:])
            mesh.apply_translation(delta-origin)
            records[oid].update({'plate':index+1,'local_bounds_mm':mesh.bounds.tolist(),'translation_delta_mm':delta.tolist()})
            for other in placed:
                a=meshes[other].bounds
                assert mesh.bounds[1,0]+7.9999<=a[0,0] or a[1,0]+7.9999<=mesh.bounds[0,0] or mesh.bounds[1,1]+7.9999<=a[0,1] or a[1,1]+7.9999<=mesh.bounds[0,1], 'Spacing violation'
            placed.append(oid);x+=size[0]+8.;row=max(row,size[1])
        plate_reports.append({'id':index+1,'name':title,'preview_title':english,'members':members})
        all_members+=members
    assert sorted(all_members,key=int)==sorted(items,key=int) and len(set(all_members))==count
    text=data['3D/3dmodel.model'].decode()
    def replace_item(match):
        tag=match[0];oid=re.search(r'objectid="([^"]+)"',tag)[1]
        return re.sub(r'transform="[^"]+"','transform="'+new_transforms[oid]+'"',tag)
    text=re.sub(r'<item\b[^>]*>',replace_item,text)
    # Keep the geometry revision description when organizing its plates.
    if 'Four organized plates' not in (root.find('./{*}metadata[@name="Description"]').text or ''):
        text=re.sub(r'(<metadata name="Description">)(.*?)(</metadata>)',
                    lambda m:m[1]+m[2]+' Four organized plates; mesh dimensions and print rotations retained.'+m[3],text,flags=re.S)
    text=re.sub(r'(<metadata name="ModificationDate">).*?(</metadata>)',lambda m:m[1]+datetime.date.today().isoformat()+m[2],text,flags=re.S)
    text=re.sub(r'\s*<metadata name="Thumbnail_(?:Middle|Small)">.*?</metadata>','',text)
    data['3D/3dmodel.model']=text.encode()
    settings_text=data['Metadata/model_settings.config'].decode()
    newplates=[]
    for plate in plate_reports:
        members=''.join(ET.tostring(instances[oid],encoding='unicode') for oid in plate['members'])
        newplates.append(f'<plate><metadata key="plater_id" value="{plate["id"]}"/><metadata key="plater_name" value="{plate["name"]}"/><metadata key="locked" value="false"/><metadata key="filament_map_mode" value="Auto For Flush"/>{members}</plate>')
    settings_text,plate_replacements=re.subn(r'<plate>.*?</plate>',lambda m:newplates.pop(0) if newplates else '',settings_text,flags=re.S)
    assert plate_replacements==len(oldplates) and not newplates
    data['Metadata/model_settings.config']=settings_text.encode()
    data['Metadata/filament_sequence.json']=json.dumps({f'plate_{p["id"]}':{'nozzle_sequence':[],'optimal_assignment':[],'sequence':[]} for p in plate_reports}).encode()
    # Cached images belong to the former five-plate arrangement. Bambu regenerates them.
    removed={n for n in data if re.fullmatch(r'Metadata/(?:plate(?:_no_light)?|top|pick)_\d+(?:_small)?\.png',n)}
    for n in removed:del data[n]
    removed_relationships=0
    for name in [n for n in data if n.endswith('.rels')]:
        relationships=ET.fromstring(data[name])
        def keep_relationship(match):
            nonlocal removed_relationships
            target=re.search(r'Target="([^"]+)"',match[0])[1].lstrip('/')
            if target in removed:
                removed_relationships+=1
                return ''
            return match[0]
        data[name]=re.sub(r'<Relationship\b[^>]*/>',keep_relationship,data[name].decode()).encode()
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    fig,axs=plt.subplots(2,2,figsize=(12,12),facecolor='#fafaf7')
    for ax,plate in zip(axs.flat,plate_reports):
        for oid in plate['members']:
            m=meshes[oid];faces=m.triangles;order=np.argsort(faces[:,:,2].mean(axis=1))
            slot=int(records[oid]['extruder'])-1
            color=np.array(matplotlib.colors.to_rgb(project['filament_colour'][slot]))
            shades=.50+.50*np.maximum(0,(m.face_normals*np.array([.15,-.3,.942])).sum(axis=1))
            ax.add_collection(PolyCollection(faces[order,:,:2],facecolors=np.c_[shades[order,None]*color,np.ones(len(order))],edgecolors='none',linewidths=0))
            center=m.bounds.mean(axis=0);ax.text(center[0],center[1],oid,ha='center',fontsize=8,color='#143c31',bbox={'facecolor':'white','alpha':.8,'edgecolor':'none','pad':1})
        ax.set(xlim=(0,width),ylim=(0,depth),aspect='equal',title=f'{plate["id"]}. {plate["preview_title"]} ({len(plate["members"])} parts)',xlabel='mm',ylabel='mm');ax.grid(alpha=.2)
    fig.suptitle(f'Microduck Feetech sample: {count} parts / 4 plates / current geometry and orientation',fontsize=14)
    fig.tight_layout();args.preview.parent.mkdir(parents=True,exist_ok=True);fig.savefig(args.preview,dpi=145);plt.close(fig)
    backup=pathlib.Path(tempfile.mkdtemp(prefix='microduck-feetech-before-arrange-'))/args.source.name
    backup.write_bytes(original)
    temp=args.source.with_name('.feetech-arranged.tmp')
    with zipfile.ZipFile(temp,'w') as archive:
        for info in infos:
            if info.filename in data:archive.writestr(info,data[info.filename])
    with zipfile.ZipFile(temp) as archive:
        assert archive.testzip() is None
        for name in data:
            assert archive.read(name)==data[name]
            if name.endswith('.model') and name!='3D/3dmodel.model':
                with zipfile.ZipFile(backup) as source:assert archive.read(name)==source.read(name)
        current=ET.fromstring(archive.read('3D/3dmodel.model')).findall('./{*}build/{*}item')
        assert len(current)==count
        for item in current:
            oid=item.get('objectid');a=dict(item.attrib);a['transform']=originals[oid]['transform'];assert a==originals[oid]
            assert item.get('transform').split()[:9]==originals[oid]['transform'].split()[:9]
            # Serialization must preserve the expected translated floor and dimensions.
            observed_delta=matrix(item.get('transform'))[:3,3]-matrix(originals[oid]['transform'])[:3,3]
            assert np.allclose(observed_delta,records[oid]['translation_delta_mm'],atol=1e-6,rtol=0)
            # Check actual serialized world coordinates, where vertex welding can
            # expose numerical seams that were absent in local-coordinate meshes.
            vertices,faces,component_transform=source_geometry[oid]
            transform=matrix(item.get('transform')) @ component_transform
            final_mesh=trimesh.Trimesh(trimesh.transform_points(vertices,transform),faces,process=True)
            if np.linalg.det(transform[:3,:3])<0:final_mesh.invert()
            assert final_mesh.is_watertight==records[oid]['watertight'], (oid,'Closure changed during placement')
            assert final_mesh.is_winding_consistent==records[oid]['winding_consistent'], (oid,'Winding changed during placement')
            assert np.allclose(final_mesh.extents,records[oid]['size_mm'],atol=1e-6,rtol=0)
    shutil.copymode(args.source,temp);temp.replace(args.source)
    report={'source':str(args.source),'before_sha256':hashlib.sha256(original).hexdigest(),'after_sha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),'instance_count':count,'plate_count':4,'bed_mm':[width,depth],'margin_mm':10,'gap_mm':8,'all_mesh_entries_byte_identical':True,'source_orientations_and_scale_preserved':True,'filament_and_process_settings_preserved':True,'removed_stale_previews':len(removed),'removed_preview_relationships':removed_relationships,'plates':plate_reports,'objects':list(records.values()),'sliced':False,'print_started':False}
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'source':str(args.source),'backup_outside_project':str(backup),'plates':[{'name':p['name'],'count':len(p['members'])} for p in plate_reports],'watertight_objects':sum(r['watertight'] for r in records.values()),'total_objects':count},ensure_ascii=False))


if __name__=='__main__':main()
