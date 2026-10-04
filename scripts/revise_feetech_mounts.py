#!/usr/bin/env python3
"""Feetech v8: inside bearing seats, no long rails, two screw-joined skate halves.
Code Apache-2.0; model derivatives CC BY-NC-SA 4.0.
Explicit --source / --output; only the supplied manufacturing archive is read.
Requires numpy, trimesh, manifold3d, matplotlib. No printer operations.
"""
import argparse,copy,hashlib,re,tempfile,uuid,posixpath
from pathlib import Path
import zipfile,xml.etree.ElementTree as E,json
import numpy as np,trimesh,manifold3d as mf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
ROOT=Path(__file__).resolve().parents[1]
SOURCE=None
PROD='http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
def load(oid,source=None,*,part_id=None):
 with zipfile.ZipFile(source or SOURCE) as z:
  r=E.fromstring(z.read('3D/3dmodel.model'))
  o=next(o for o in r.findall('./{*}resources/{*}object') if o.get('id')==str(oid))
  components=o.findall('./{*}components/{*}component')
  c=next(c for c in components if c.get('objectid')==str(part_id)) if part_id is not None else components[0]
  path=c.get('{'+PROD+'}path').lstrip('/')
  m=E.fromstring(z.read(path));obj=next(o for o in m.findall('./{*}resources/{*}object') if o.get('id')==c.get('objectid'))
  v=np.array([[float(p.get(a)) for a in ['x','y','z']] for p in obj.findall('.//{*}vertex')]);f=np.array([[int(p.get(a)) for a in ['v1','v2','v3']] for p in obj.findall('.//{*}triangle')])
  return trimesh.Trimesh(v,f,process=True)
def solid(m):
 s=mf.Manifold(mf.Mesh64(np.float64(m.vertices),np.uint64(m.faces)))
 assert s.status()==mf.Error.NoError,s.status()
 return s
def mesh(s):
 # Boolean seams can contain sub-micron edges. Remove them before the slicer's
 # world-space vertex merging, with surface displacement below 0.00001 mm.
 s=s.set_tolerance(1e-5).simplify(1e-5)
 m=s.to_mesh64();return trimesh.Trimesh(m.vert_properties[:,:3],m.tri_verts,process=True)
def box(lo,hi):
 return mf.Manifold.cube(np.array(hi)-lo).translate(lo)
def cylinder(axis,center,radius,start,end):
 s=mf.Manifold.cylinder(end-start,radius,radius,128)
 if axis==0:s=s.rotate([0,90,0])
 if axis==1:s=s.rotate([-90,0,0])
 p=list(center);p[axis]=start
 return s.translate(p)
def render(parts,path,angles=((25,-55),(25,125)),size=(15,8)):
 fig=plt.figure(figsize=size)
 for j,(el,az) in enumerate(angles):
  for i,(title,m) in enumerate(parts.items()):
   ax=fig.add_subplot(len(angles),len(parts),j*len(parts)+i+1,projection='3d')
   p=Poly3DCollection(m.triangles,edgecolors='none',linewidths=0)
   light=np.array([.3,-.4,1]);sh=.35+.65*np.maximum(0,(m.face_normals*light).sum(axis=1)/np.linalg.norm(light));p.set_facecolor(np.c_[.34*sh,.67*sh,.8*sh,np.ones(len(sh))]);ax.add_collection3d(p)
   c=m.bounds.mean(0);rad=max(m.extents)*.55
   ax.set(xlim=(c[0]-rad,c[0]+rad),ylim=(c[1]-rad,c[1]+rad),zlim=(c[2]-rad,c[2]+rad),title=title,xlabel='X',ylabel='Y',zlabel='Z');ax.set_box_aspect([1,1,1]);ax.view_init(el,az)
 fig.tight_layout();fig.savefig(path,dpi=155);plt.close(fig)
def sections(m,axis,values,path):
 fig,axs=plt.subplots(1,len(values),figsize=(4*len(values),5));axes=[a for a in range(3) if a!=axis]
 for ax,value in zip(np.ravel(axs),values):
  normal=np.eye(3)[axis];origin=normal*value;s=m.section(plane_origin=origin,plane_normal=normal)
  if s:
   for d in s.discrete:
    p=d[:,axes];ax.plot(*p.T,lw=.8)
    print('section',axis,value,'bounds',np.round([p.min(0),p.max(0)],4).tolist())
  ax.set(title=f'{"XYZ"[axis]} = {value}',aspect='equal');ax.grid(alpha=.3)
 fig.tight_layout();fig.savefig(path,dpi=145);plt.close(fig)

def build_geometry():
 a0=load(50);f0=load(32);b0=load(65)
 a=solid(a0);f=solid(f0);b=solid(b0)
 # Current archive meshes were centered after previous edits. Derive these offsets
 # from the preserved front screw axis and matching rear hook/pocket locations.
 ANKLE=np.array([.01197032,4.66320781,18.388364])
 FOOT=np.array([0.,0.,6.73478842])
 BC=.0144918
 # Swap the existing 15.2-mm bearing seat and 14.5-mm retention lip from outer
 # to inner face, without changing the bearing axis or the 15-mm bearing size.
 center=[0,2.33679219,3.55];entry=14.811591
 stop=entry+3.0
 fill=(cylinder(0,center,7.62,stop,21)-cylinder(0,center,7.25,stop-.01,21.01)) ^ solid(a0.convex_hull)
 a+=fill
 a-=cylinder(0,center,7.60,entry-.5,stop)
 # Fill the two longitudinal underside recesses with 1.5-mm continuous ledges.
 # Copy the existing footprint down instead of adding square corners past it.
 slotregion=box([-21,-19.5,-7.69901],[-16.8884,17,-6.15])+box([17.1116,-19.5,-7.69901],[21,17,-6.15])
 added=(solid(a0).translate([0,0,-1.5]) ^ slotregion)-a
 a+=added
 # Only the added ledges and their 0.15-mm seating clearance are relieved in both
 # bases. This removes the raised mating rails while retaining the short hooks.
 rail_envelope=(added+added.translate([0,0,-.15])).translate(ANKLE)
 b-=rail_envelope
 f-=rail_envelope.translate(-FOOT)
 # Remove the complete pair of raised rails, including their unused front ends.
 rails=box([-19.4,-17.6,10.55],[-17.15,-7.4,12.25])+box([17.4,-17.6,10.55],[19.65,-7.4,12.25])
 b-=rails
 f-=rails.translate(-FOOT)
 # Continuous bosses below the ankle seating surfaces, clear of the wheel sweep.
 for y in [-19,19]:
  b+=box([BC-6,y-3,1],[BC+6,y+3,7])
 # A recessed head and tool tunnel, as on the torso mounting bracket. Same M2
 # family as the existing ankle lock: 2.2-mm clearance and 1.6-mm pilot.
 for y in [-19,19]:
  b-=cylinder(0,[0,y,4],2.2,-25,BC-3.2)
  b-=cylinder(0,[0,y,4],1.1,BC-3.21,BC+.1)
  b-=cylinder(0,[0,y,4],.8,BC+.08,BC+5.3)
 left=b ^ box([-50,-50,-50],[BC-.1,50,50])
 right=b ^ box([BC+.1,-50,-50],[50,50,50])
 # Audit the cleaned, exportable surfaces, including any numerical seam cleanup.
 a,f,left,right=[solid(mesh(s)) for s in (a,f,left,right)]
 old_a=solid(a0);old_f=solid(f0);old_b=solid(b0);new_b=left+right;bc=BC
 results={}
 def zero(name,v,tol=1e-5):
  v=float(v);assert abs(v)<tol,(name,v);results[name]=v
 def positive(name,v):
  v=float(v);assert v>1e-3,(name,v);results[name]=v
 zero('walking_seated_intersection_mm3',(f^a.translate(ANKLE-FOOT)).volume())
 zero('roller_seated_intersection_mm3',(new_b^a.translate(ANKLE)).volume())
 zero('split_half_intersection_mm3',(left^right).volume())
 zero('walking_complete_raised_rails_remaining_mm3',(f^rails.translate(-FOOT)).volume())
 zero('roller_complete_raised_rails_remaining_mm3',(new_b^rails).volume())
 for x in [-13.2884,13.5116]:
  region=box([x-3,11.8,-12.8],[x+3,19.6,-9.3])
  zero(f'ankle_short_hook_{x}_changed_mm3',((a^region)-(old_a^region)).volume())
  zero(f'ankle_short_hook_{x}_removed_mm3',((old_a^region)-(a^region)).volume())
 for name,s,shift in [('walk',f,ANKLE-FOOT),('roller',new_b,ANKLE)]:
  positive(name+'_retains_rear_uplift_mm3',(s ^ a.translate(shift+[0,0,1])).volume())
 # 15 x 10 x 3 bearing from inside. A 0.1-mm radial gap is present.
 cx=[0,2.33679219,3.55];ent=entry
 for step,start in enumerate(np.linspace(ent-5,ent,21)):
  ring=cylinder(0,cx,7.5,start,start+3)-cylinder(0,cx,5,start-.01,start+3.01)
  zero(f'bearing_inside_insertion_{step}_mm3',(a^ring).volume())
 outer=cylinder(0,cx,7.5,ent+3.01,ent+6.01)-cylinder(0,cx,5,ent+3,ent+6.02)
 positive('bearing_outer_lip_blocks_reverse_entry_mm3',(a^outer).volume())
 for y in [-19,19]:
  zero(f'screw_tool_channel_{y}_blocked_mm3',(left^cylinder(0,[0,y,4],2.19,-25,bc-3.201)).volume())
  zero(f'screw_clearance_{y}_blocked_mm3',(left^cylinder(0,[0,y,4],1.09,bc-3.199,bc-.1)).volume())
  zero(f'screw_pilot_{y}_blocked_mm3',(right^cylinder(0,[0,y,4],.79,bc+.101,bc+5.299)).volume())
  seat=cylinder(0,[0,y,4],2.19,bc-3.19,bc-3.0)-cylinder(0,[0,y,4],1.11,bc-3.2,bc-2.99)
  positive(f'screw_head_stop_{y}_material_mm3',(left^seat).volume())
 for y in [-32.5,32.5]:
  tyre=solid(load(67)).translate([bc,y,-10.6915331]);rim=solid(load(63)).translate([bc,y,-10.6915331])
  zero(f'wheel_{y}_tyre_intersection_mm3',(new_b^tyre).volume())
  zero(f'wheel_{y}_rim_intersection_mm3',(new_b^rim).volume())
  for x0,x1 in [(-4,-1),(1,4)]:
   bearing=(cylinder(0,[0,0,0],6,bc+x0,bc+x1)-cylinder(0,[0,0,0],3,bc+x0-.01,bc+x1+.01)).translate([0,y,-10.6915331])
   zero(f'wheel_{y}_bearing_{x0}_base_intersection_mm3',(new_b^bearing).volume())
   # Legacy STL middle planes are +/-1.00000024 mm. Contact-only rounding
   # overlap against the nominal +/-1 mm bearing shoulder is below .001 mm3.
   zero(f'wheel_{y}_bearing_{x0}_rim_intersection_mm3',(rim^bearing).volume(),tol=.001)
  for delta in np.linspace(0,12,25):
   zero(f'wheel_{y}_left_half_installation_{delta}_mm3',(left.translate([-delta,0,0])^tyre).volume())
   zero(f'wheel_{y}_right_half_installation_{delta}_mm3',(right.translate([delta,0,0])^tyre).volume())
  for x in [-6.25,6.25]:
   region=box([bc+x-2,y-5,-15.5],[bc+x+2,y+5,-5.5])
   zero(f'wheel_axle_{x}_{y}_removed_mm3',((old_b^region)-(new_b^region)).volume())
   zero(f'wheel_axle_{x}_{y}_added_mm3',((new_b^region)-(old_b^region)).volume())
 return {"ankle":mesh(a),"foot":mesh(f),"left_half":mesh(left),"right_half":mesh(right)},results

CORE='http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
BASELINE_SHA='022bb00af1379d43a390030bbde17b255aef860036093883ed80d3ce912e3892'
NAMES={'ankle':'ankle_inside_bearing_no_rails_v8.stl','foot':'walking_base_no_rails_v8.stl',
       '65':'左轮滑底座_左半_v8.stl','70':'右轮滑底座_左半_v8.stl',
       '78':'左轮滑底座_右半_v8.stl','79':'右轮滑底座_右半_v8.stl'}

def mesh_xml(m):
 vertices=''.join('<vertex x="%.17g" y="%.17g" z="%.17g"/>'%tuple(v) for v in m.vertices)
 faces=''.join('<triangle v1="%d" v2="%d" v3="%d"/>'%tuple(f) for f in m.faces)
 return '<mesh><vertices>'+vertices+'</vertices><triangles>'+faces+'</triangles></mesh>'

def update_object_config(obj,name,m,part_id=None):
 for el in obj.findall('metadata'):
  if el.get('key')=='name':el.set('value',name)
  if el.get('face_count') is not None:el.set('face_count',str(len(m.faces)))
 part=obj.find('part')
 if part_id is not None:part.set('id',str(part_id));part.set('uuid',str(uuid.uuid4()))
 for el in part.findall('metadata'):
  if el.get('key')=='name':el.set('value',name)
 stats=part.find('mesh_stat')
 if stats is not None:
  for key in stats.attrib:stats.set(key,str(len(m.faces)) if key=='face_count' else '0')

def write_revision(original,parts,output):
 with zipfile.ZipFile(SOURCE) as z:data={n:z.read(n) for n in z.namelist()}
 r=E.fromstring(data['3D/3dmodel.model']);root_objects={o.get('id'):o for o in r.findall('./{*}resources/{*}object')}
 build=r.find('./{*}build');items={i.get('objectid'):i for i in build}
 assert len(items)==47 and '78' not in root_objects and '79' not in root_objects
 settings=E.fromstring(data['Metadata/model_settings.config']);objects={o.get('id'):o for o in settings.findall('object')}
 changed={};face_counts={}
 for key,oid in [('ankle','50'),('foot','32'),('left_half','65')]:
  comp=root_objects[oid].find('./{*}components/{*}component');path=comp.get('{'+PROD+'}path').lstrip('/')
  text=data[path].decode();assert len(re.findall(r'<mesh>',text))==1
  data[path]=re.sub(r'<mesh>.*?</mesh>',lambda _:mesh_xml(parts[key]),text,flags=re.S).encode()
  changed[path]=key;face_counts[path]=len(parts[key].faces)
 for key,ids in [('ankle',['50','51']),('foot',['32','35']),('left_half',['65','70'])]:
  for oid in ids:update_object_config(objects[oid],NAMES.get(oid,NAMES.get(key)),parts[key])
 # One shared right-half mesh, two independently selectable native instances.
 new_path='3D/Objects/object_190.model';local_id='77'
 data[new_path]=(f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="{CORE}"><resources>'
                 f'<object id="{local_id}" type="model">'+mesh_xml(parts['right_half'])+'</object></resources><build/></model>').encode()
 E.register_namespace('',CORE);E.register_namespace('p',PROD)
 root_text=data['3D/3dmodel.model'].decode();add_objects=[];add_items=[]
 max_identify=max(int(m.get('value')) for p in settings.findall('plate') for i in p.findall('model_instance') for m in i.findall('metadata') if m.get('key')=='identify_id')
 for index,(old,new) in enumerate([('65','78'),('70','79')],1):
  obj=copy.deepcopy(root_objects[old]);obj.set('id',new);obj.set('{'+PROD+'}UUID',str(uuid.uuid4()))
  comp=obj.find('./{*}components/{*}component');comp.set('{'+PROD+'}path','/'+new_path);comp.set('objectid',local_id);comp.set('{'+PROD+'}UUID',str(uuid.uuid4()))
  add_objects.append(E.tostring(obj,encoding='unicode'))
  item=copy.deepcopy(items[old]);item.set('objectid',new);item.set('{'+PROD+'}UUID',str(uuid.uuid4()));add_items.append(E.tostring(item,encoding='unicode'))
  config=copy.deepcopy(objects[old]);config.set('id',new);update_object_config(config,NAMES[new],parts['right_half'],local_id);settings.append(config)
  matches=[]
  for plate in settings.findall('plate'):
   for instance in list(plate.findall('model_instance')):
    if any(m.get('key')=='object_id' and m.get('value')==old for m in instance.findall('metadata')):matches.append((plate,instance))
  assert len(matches)==1
  plate,instance=matches[0];instance=copy.deepcopy(instance)
  for meta in instance.findall('metadata'):
   if meta.get('key')=='object_id':meta.set('value',new)
   if meta.get('key')=='identify_id':meta.set('value',str(max_identify+index))
  plate.append(instance)
  assembly=settings.find('assemble')
  if assembly is not None:
   for el in list(assembly):
    if el.get('object_id')==old:
     child=copy.deepcopy(el);child.set('object_id',new);assembly.append(child)
 root_text=root_text.replace('</resources>',''.join(add_objects)+'</resources>')
 root_text=root_text.replace('</build>',''.join(add_items)+'</build>')
 root_text=re.sub(r'(<metadata name="Description">).*?(</metadata>)',lambda m:m[1]+'Feetech v8: bearings insert from inside; long ankle rails removed; both skate bases split left/right with two M2 fasteners and tool tunnels. 49 printable instances. Physical fit untested.'+m[2],root_text,flags=re.S)
 data['3D/3dmodel.model']=root_text.encode();data['Metadata/model_settings.config']=E.tostring(settings,encoding='utf-8',xml_declaration=True)
 rel_path='3D/_rels/3dmodel.model.rels';rel=data[rel_path].decode()
 rel=rel.replace('</Relationships>',f'<Relationship Target="/{new_path}" Id="rel-v8-right-half" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
 data[rel_path]=rel.encode()
 output.parent.mkdir(parents=True,exist_ok=True);temp=output.with_name('.feetech-v8.tmp')
 with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for n,b in data.items():z.writestr(n,b)
 with zipfile.ZipFile(temp) as z:
  assert z.testzip() is None
  root=E.fromstring(z.read('3D/3dmodel.model'));assert len(root.findall('./{*}build/{*}item'))==49
  for n in data:
   if n.endswith('.model') and n!='3D/3dmodel.model' and n not in changed and n!=new_path:
    with zipfile.ZipFile(SOURCE) as old:assert old.read(n)==z.read(n)
  for n in z.namelist():
   if n.endswith('.rels'):
    for rel in E.fromstring(z.read(n)):
     target=rel.get('Target')
     if rel.get('TargetMode')=='External':continue
     resolved=target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join(posixpath.dirname(posixpath.dirname(n)),target))
     assert resolved in z.namelist(),(n,resolved)
 temp.replace(output)
 return list(changed),new_path

def main():
 global SOURCE
 parser=argparse.ArgumentParser(description=__doc__)
 for name in ['source','output','report','preview']:parser.add_argument('--'+name,type=Path,required=True)
 args=parser.parse_args();SOURCE=args.source
 original=SOURCE.read_bytes();digest=hashlib.sha256(original).hexdigest()
 assert digest==BASELINE_SHA,'Input differs from measured v7 baseline; measure it before applying this revision'
 parts,checks=build_geometry()
 records={}
 for name,m in parts.items():
  assert m.is_watertight and m.is_winding_consistent and m.volume>0
  assert len(m.split(only_watertight=False))==1,(name,'disconnected')
  records[name]={'bounds_mm':m.bounds.tolist(),'triangles':len(m.faces),'watertight':True,'winding_consistent':True,'components':1,'volume_mm3':float(m.volume)}
 # Keep the prior archive outside the project even if --output points to --source.
 backup=Path(tempfile.mkdtemp(prefix='microduck-before-v8-'))/SOURCE.name;backup.write_bytes(original)
 changed,added=write_revision(original,parts,args.output)
 args.preview.parent.mkdir(parents=True,exist_ok=True)
 render({'Inside-entry ankle':parts['ankle'],'Walking base, no rails':parts['foot'],
         'Roller left half':parts['left_half'],'Roller right half':parts['right_half']},args.preview,size=(20,9))
 report={'revision':'inside-bearing-no-long-rails-split-roller-v8','source_sha256':digest,'output_sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),
         'instance_count':49,'modified_mesh_entries':changed,'added_mesh_entry':added,'other_mesh_entries_byte_identical':True,
         'bearing':{'size_id_od_width_mm':[10,15,3],'seat_diameter_mm':15.2,'entry':'inside-to-outside','depth_mm':3.0,'retention_opening_mm':14.5},
         'roller_fasteners':{'count_per_base':2,'size':'M2','suggested_length_mm':8,'clearance_diameter_mm':2.2,'pilot_diameter_mm':1.6,'tool_channel_diameter_mm':4.4,'split_gap_mm':.2,'channel_axis':'X','centers_yz_mm':[[-19,4],[19,4]]},
         'meshes':records,'geometry_checks':checks,'physical_fit_tested':False,'sliced':False,'print_started':False}
 args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
 print(json.dumps({'output':str(args.output),'backup_outside_project':str(backup),'passed_geometry_checks':len(checks),'instance_count':49},ensure_ascii=False))

if __name__=='__main__':main()
