#!/usr/bin/env python3
"""Group four original wheels into PLA/TPU assemblies without changing mesh bytes.
Code Apache-2.0; model and renders CC BY-NC-SA 4.0. No printer operations.
Requires an explicitly verified source hash and a Bambu filament profile directory.
"""
import argparse, copy, hashlib, json, re, uuid, zipfile
from pathlib import Path
import xml.etree.ElementTree as E
import numpy as np
from arrange_feetech_sample import matrix, CORE, PROD
from revise_feetech_mounts import load, solid

PAIRS = [('63','67','左前轮'),('68','72','左后轮'),('69','73','右前轮'),('71','74','右后轮')]

E.register_namespace('', CORE)
E.register_namespace('p', PROD)
E.register_namespace('BambuStudio', 'http://schemas.bambulab.com/package/2021')

def meta(el, key, value):
    node = next((m for m in el.findall('metadata') if m.get('key') == key), None)
    if node is None: node = E.SubElement(el,'metadata',{'key':key})
    node.set('value',str(value))

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for k in ('source','output','profiles','report','preview'):p.add_argument('--'+k,required=True,type=Path)
    p.add_argument('--expected-sha256',required=True)
    args=p.parse_args();original=args.source.read_bytes()
    source_hash=hashlib.sha256(original).hexdigest()
    assert source_hash == args.expected_sha256, 'Source changed; measure again before applying'
    assert args.source.resolve() != args.output.resolve(), 'Write a candidate before replacing the source'
    with zipfile.ZipFile(args.source) as z:
        infos=z.infolist();data={i.filename:z.read(i) for i in infos}
    root=E.fromstring(data['3D/3dmodel.model']);settings=E.fromstring(data['Metadata/model_settings.config'])
    root.set('xmlns:BambuStudio','http://schemas.bambulab.com/package/2021')
    project=json.loads(data['Metadata/project_settings.config'])
    resources={o.get('id'):o for o in root.findall('./{*}resources/{*}object')}
    objects={o.get('id'):o for o in settings.findall('object')}
    build=root.find('./{*}build');items={i.get('objectid'):i for i in build}
    n=len(project['filament_type']);assert n==8
    # Reuse an unused slot, keeping every material-array length unchanged.
    slot=8
    used={int(m.get('value')) for m in settings.iter('metadata') if m.get('key')=='extruder'}
    assert slot not in used
    def profile(name,seen=()):
        assert name not in seen
        d=json.loads((args.profiles/(name+'.json')).read_text())
        return {**(profile(d['inherits'],seen+(name,)) if d.get('inherits') else {}),**d}
    tpu=profile('Generic TPU @BBL H2D')
    original_lengths={k:len(v) for k,v in project.items() if isinstance(v,list)}
    variants=project['filament_extruder_variant'][(slot-1)*3:slot*3]
    for k,pv in tpu.items():
        v=project.get(k)
        if not isinstance(v,list) or not isinstance(pv,list) or not pv: continue
        if len(v)==n:
            v[slot-1]=copy.deepcopy(pv[0])
        elif len(v)==3*n:
            # The installed profile has four variants; match by name, not index.
            names=tpu['filament_extruder_variant']
            replacement=[pv[names.index(name)] for name in variants] if len(pv)==len(names) else [pv[0]]*3
            v[(slot-1)*3:slot*3]=replacement
        elif k in ('filament_dev_ams_drying_temperature','filament_dev_ams_drying_time') and len(v)==4*n:
            v[(slot-1)*4:slot*4]=(pv if len(pv)==4 else [pv[0]]*4)
    for k,val in {'filament_type':'TPU','filament_colour':'#30343B','default_filament_colour':'#30343B',
                  'filament_settings_id':'Generic TPU @BBL H2D','filament_ids':'GFU99','filament_nozzle_map':'1'}.items():
        project[k][slot-1]=val
    # Profile inheritance is indexed as process, N filaments, printer.
    project['inherits_group'][slot]='Generic TPU @BBL H2D'
    project['different_settings_to_system'][slot]=''
    assert all(len(project[k])==size for k,size in original_lengths.items())
    assert len(project['filament_extruder_variant'])==len(project['filament_self_index'])
    assert project['filament_self_index'][(slot-1)*3:slot*3]==[str(slot)]*3
    assert project['nozzle_temperature'][(slot-1)*3:slot*3]==['240']*3
    audits=[]
    rim=load(63,args.source);tire=load(67,args.source)
    assert rim.is_watertight and tire.is_watertight
    overlap=float((solid(rim)^solid(tire)).volume());assert overlap<.001
    # The two source meshes already share their original assembly axes and axial origin.
    assert np.allclose(rim.bounds.mean(0),tire.bounds.mean(0),atol=2e-6)
    assert np.allclose(rim.bounds[:,0],tire.bounds[:,0],atol=2e-6)
    for index,(rid,tid,title) in enumerate(PAIRS):
        rc=resources[rid].find('./{*}components');tc=copy.deepcopy(resources[tid].find('./{*}components/{*}component'))
        tc.set('{'+PROD+'}UUID',str(uuid.uuid5(uuid.NAMESPACE_URL, source_hash + ':' + rid + ':' + tid)));rc.append(tc)
        resources[rid].set('name',title+'_PLA_TPU')
        obj=objects[rid];meta(obj,'name',title+'_PLA_TPU');meta(obj,'extruder',1)
        part=copy.deepcopy(objects[tid].find('part'));meta(part,'extruder',slot);obj.append(part)
        meta(obj.find('part'),'extruder',1)
        obj.find('metadata[@face_count]').set('face_count',str(len(rim.faces)+len(tire.faces)))
        settings.remove(objects[tid]);root.find('./{*}resources').remove(resources[tid]);build.remove(items[tid])
        # Retain the rim's printing rotation, align TPU to that same frame, and place
        # the four complete wheels on plate 4, with 8 mm between 30 mm footprints.
        rot=matrix(items[rid].get('transform'));combined=np.vstack([rim.vertices,tire.vertices])
        world=np.column_stack([sum(combined[:,j]*rot[k,j] for j in range(3)) for k in range(3)]);low=world.min(0)
        assert np.isfinite(world).all()
        center=np.array([420+40+index*38,-384+145,0.])
        rot[:3,3]=center-np.array([15.,15.,0.])-low
        vals=np.r_[rot[:3,:3].T.ravel(),rot[:3,3]]
        items[rid].set('transform',' '.join(items[rid].get('transform').split()[:9]+[f'{v:.12g}' for v in vals[9:]]))
        assemble=settings.find('assemble')
        if assemble is not None:
            for old in list(assemble):
                if old.get('object_id') in (rid,tid):assemble.remove(old)
            E.SubElement(assemble,'assemble_item',{'object_id':rid,'instance_id':'0','transform':items[rid].get('transform'),'offset':'0 0 0'})
            for volume in ('0','1'):
                E.SubElement(assemble,'assemble_item',{'object_id':rid,'volume_id':volume,'transform':'1 0 0 0 1 0 0 0 1 0 0 0'})
        instance=None
        for plate in settings.findall('plate'):
            for inst in list(plate.findall('model_instance')):
                oid=next(m.get('value') for m in inst.findall('metadata') if m.get('key')=='object_id')
                if oid==rid:instance=inst;plate.remove(inst)
                if oid==tid:plate.remove(inst)
        assert instance is not None
        plate4=next(p for p in settings.findall('plate') if p.find('metadata[@key="plater_id"]').get('value')=='4')
        plate4.append(instance)
        audits.append({'assembly_id':rid,'original_mesh_instance_ids':[rid,tid],'name':title,
                       'rim_part_id':'62','tire_part_id':'66','filament_slots':[1,slot],
                       'original_rim_rotation_preserved':True,'coaxial':True,'interface_overlap_mm3':overlap})
    meta(next(p for p in settings.findall('plate') if p.find('metadata[@key="plater_id"]').get('value')=='2'),'plater_name','外壳、头部与脚踝')
    meta(plate4,'plater_name','双材料轮组、脚底与软嘴组件')
    root.find('./{*}metadata[@name="Description"]').text='Feetech: four coaxial PLA/TPU multipart wheels; all other source geometry preserved. 49 mesh instances, 45 build objects, four plates; physical printing untested.'
    data['3D/3dmodel.model']=E.tostring(root,encoding='utf-8',xml_declaration=True)
    data['Metadata/model_settings.config']=E.tostring(settings,encoding='utf-8',xml_declaration=True)
    data['Metadata/project_settings.config']=json.dumps(project,ensure_ascii=False,indent=2).encode()
    for k in list(data):
        if re.fullmatch(r'Metadata/(?:plate(?:_no_light)?|top|pick)_\d+(?:_small)?\.png',k):del data[k]
    with zipfile.ZipFile(args.output,'w') as out:
        for i in infos:
            if i.filename in data:out.writestr(copy.copy(i),data[i.filename])
    with zipfile.ZipFile(args.output) as z:
        assert z.testzip() is None
        with zipfile.ZipFile(args.source) as before:
            assert all(z.read(k)==before.read(k) for k in data if k.endswith('.model') and k!='3D/3dmodel.model')
    # Actual mesh preview and cross-section, not an illustrative drawing.
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    fig=plt.figure(figsize=(11,4));ax=fig.add_subplot(121,projection='3d')
    for m,color in [(tire,'#30343B'),(rim,'#b7dbed')]:
        ax.add_collection3d(Poly3DCollection(m.triangles,facecolor=color,edgecolor='none'))
    ax.set(xlim=(-16,16),ylim=(-16,16),zlim=(-16,16),title='Coaxial PLA hub + TPU tire');ax.set_box_aspect([1,1,1]);ax.view_init(25,25)
    ax2=fig.add_subplot(122)
    for m,color,label in [(rim,'#429cc0','PLA hub'),(tire,'#30343B','TPU tire')]:
        section=m.section(plane_origin=[0,0,0],plane_normal=[0,0,1])
        for i,line in enumerate(section.discrete):ax2.plot(line[:,0],line[:,1],color=color,label=label if i==0 else None)
    ax2.set(aspect='equal',xlabel='Axial position (mm)',ylabel='Radius (mm)',title='Original interlocking interface');ax2.legend();ax2.grid(alpha=.2)
    fig.tight_layout();fig.savefig(args.preview,dpi=160);plt.close(fig)
    report={'before_sha256':source_hash,'after_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),
            'build_object_count':len(build),'mesh_instance_count':sum(len(o.findall('./{*}components/{*}component')) for o in root.findall('./{*}resources/{*}object')),
            'wheel_mesh_entries_byte_identical':True,'all_mesh_entries_byte_identical':True,
            'assemblies':audits,'tpu_profile':'Generic TPU @BBL H2D',
            'sliced':False,'physically_tested':False,'print_started':False}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':main()
