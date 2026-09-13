#!/usr/bin/env python3
"""Build the display GLB + stable part manifest from microduck-replica assembly STLs.
Requires Python 3.12, numpy, trimesh. Never changes source files.
Usage: python scripts/build_model.py /path/to/microduck-replica
"""
import argparse, json, pathlib, struct, hashlib
import numpy as np
import trimesh
p=argparse.ArgumentParser(); p.add_argument('source',type=pathlib.Path); args=p.parse_args()
root=args.source; out=pathlib.Path(__file__).resolve().parents[1]/'public/models'; out.mkdir(parents=True,exist_ok=True)
assembly=json.loads((root/'cad/零件对照表.json').read_text()); sources=list((root/'print').rglob('*.stl'))
main={'top_head_shell','bottom_head_shell','right_shell','left_shell','foot_left','foot_right'}
accent={'jaw','jaw_soft','soft_mouth_top'}
scene=trimesh.Scene(); parts=[]; all_bounds=[]; original_count=0
for group,info in assembly.items():
 raw=(root/'cad'/f'{group}.stl').read_bytes()
 count=struct.unpack('<I',raw[80:84])[0]
 dtype=np.dtype([('normal','<f4',(3,)),('vertices','<f4',(3,3)),('attr','<u2')])
 triangles=np.frombuffer(raw, dtype=dtype,offset=84,count=count)['vertices'].astype(float)
 offset=0
 for idx,source in enumerate(info['源STL']):
  candidates=[f for f in sources if f.name.startswith(source+'_')]
  file=min(candidates,key=lambda x:len(x.name))
  n=struct.unpack('<I',file.read_bytes()[80:84])[0]; t=triangles[offset:offset+n];offset+=n
  assert len(t)==n
  # MJCF: Z up, front -Y. Viewer: Y up, front +Z.
  t=t[:,:,[0,2,1]];t[:,:,2]*=-1
  mesh=trimesh.Trimesh(vertices=t.reshape(-1,3),faces=np.arange(n*3).reshape(-1,3),process=True)
  bounds=mesh.bounds.copy(); all_bounds.append(bounds); original_count+=n
  # Preserve all source faces: appearance takes precedence over download size.
  mesh.vertices=np.round(mesh.vertices,4)
  hardware='标准件' in str(file)
  role='hardware' if hardware else 'primary' if source in main else 'accent' if source in accent else 'structure'
  color={'hardware':'#535960','primary':'#F1EFE7','accent':'#F28C28','structure':'#30343B'}[role]
  if source=='xl330': color='#000000'
  if source=='lens': color='#162329'
  if 'bearing' in source and hardware: color='#9CA5AA'
  if hardware and 'pcb' in source: color='#266B57'
  part_id=f"{group[:2]}-{idx+1:02d}-{source}"
  label=file.stem[len(source)+1:]
  plate=1 if role=='primary' else 3 if source=='jaw' else 4 if source in {'jaw_soft','soft_mouth_top'} else 5 if source.startswith('sole_') else 2 if not hardware else None
  part={'id':part_id,'name':label,'sourceName':source,'assembly':group[3:],'assemblyId':group[:2], 'paintable':source=='jaw','defaultMaterial':'tpu' if source.startswith('sole_') or source in {'jaw_soft','soft_mouth_top'} else 'pla','metalness':.65 if hardware and 'bearing' in source else .05 if hardware else 0,'role':role,'printable':not hardware,'plate':plate,'defaultColor':color,'triangles':len(mesh.faces),'bounds':np.round(bounds,3).tolist()}
  parts.append(part);scene.add_geometry(mesh,node_name=part_id,geom_name=part_id)
 assert offset==count,(group,offset,count)
scene.export(out/'microduck.glb')
b=np.array(all_bounds);bounds=[b[:,0].min(0).tolist(),b[:,1].max(0).tolist()]
manifest={'schemaVersion':1,'modelId':'microduck-walk-v1','name':'Microduck · 步行装配','units':'mm','coordinateSystem':'Y-up, front +Z','license':'CC-BY-NC-SA-4.0','source':'https://github.com/pollen-robotics/microduck_rl','upstreamRevision':'2fa62b8','geometryNote':'Display geometry derived from the original XL330 simulation assembly; not an HD1910 manufacturing or fit reference. Original face count retained for visual fidelity. Optional roller skates are not included.','bounds':bounds,'geometryUrl':'microduck.glb','uiNote':'原版 XL330 步行模型。HD1910 改件尺寸与轮滑件不在此预览中。','colorGroups':[{'id':'primary','name':'主色'},{'id':'structure','name':'结构'},{'id':'accent','name':'点缀'}],'parts':parts,'sourceTriangles':original_count,'displayTriangles':sum(x['triangles'] for x in parts)}
(out/'parts.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'parts':len(parts),'printable':sum(x['printable'] for x in parts),'faces':manifest['displayTriangles'],'bounds':bounds,'glbBytes':(out/'microduck.glb').stat().st_size},ensure_ascii=False))
