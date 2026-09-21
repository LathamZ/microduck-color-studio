import { mobilePreview } from './device';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  LightPattern,
  LightPreset,
  Lighting,
  Manifest,
  MaterialKind,
  Palette,
} from './domain';
import {
  BLEND_SECONDS,
  blendPose,
  poseAt,
  type JointName,
  type LegGeometry,
  type MotionName,
  type Pose,
} from './motion';
import { motionJoints, type MotionJointSpec } from './models/active';
export type MaterialPreset = {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Fuzz used for fibres and rubber; keeps nylon and TPU from reading as gloss plastic. */
  sheen: number;
  sheenRoughness: number;
};
/** Approximate appearance only. Never measured filament data. */
export const materialPresets: Record<MaterialKind, MaterialPreset> = {
  pla: {
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.38,
    sheen: 0,
    sheenRoughness: 1,
  },
  'matte-pla': {
    roughness: 0.84,
    metalness: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.8,
    sheen: 0.12,
    sheenRoughness: 0.9,
  },
  'silk-pla': {
    roughness: 0.14,
    metalness: 0.28,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    sheen: 0.2,
    sheenRoughness: 0.35,
  },
  'pla-cf': {
    roughness: 0.94,
    metalness: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.95,
    sheen: 0.3,
    sheenRoughness: 0.85,
  },
  petg: {
    roughness: 0.18,
    metalness: 0,
    clearcoat: 0.46,
    clearcoatRoughness: 0.17,
    sheen: 0,
    sheenRoughness: 1,
  },
  'matte-petg': {
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0.04,
    clearcoatRoughness: 0.75,
    sheen: 0.1,
    sheenRoughness: 0.9,
  },
  'metallic-petg': {
    roughness: 0.3,
    metalness: 0.48,
    clearcoat: 0.25,
    clearcoatRoughness: 0.25,
    sheen: 0,
    sheenRoughness: 1,
  },
  'petg-cf': {
    roughness: 0.9,
    metalness: 0.06,
    clearcoat: 0,
    clearcoatRoughness: 0.9,
    sheen: 0.28,
    sheenRoughness: 0.8,
  },
  abs: {
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    sheen: 0.06,
    sheenRoughness: 0.9,
  },
  asa: {
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.03,
    clearcoatRoughness: 0.6,
    sheen: 0.14,
    sheenRoughness: 0.85,
  },
  pc: {
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.2,
    sheen: 0,
    sheenRoughness: 1,
  },
  pa: {
    roughness: 0.7,
    metalness: 0,
    clearcoat: 0.02,
    clearcoatRoughness: 0.7,
    sheen: 0.42,
    sheenRoughness: 0.6,
  },
  'pa-cf': {
    roughness: 0.88,
    metalness: 0.04,
    clearcoat: 0,
    clearcoatRoughness: 0.9,
    sheen: 0.36,
    sheenRoughness: 0.7,
  },
  tpu: {
    roughness: 0.64,
    metalness: 0,
    clearcoat: 0.05,
    clearcoatRoughness: 0.6,
    sheen: 0.3,
    sheenRoughness: 0.65,
  },
};
export type Lamp = {
  color: string;
  intensity: number;
  /** Height of the lamp above the model centre, in scene units. */
  height: number;
  /** Offset from the light-direction slider, in degrees. Lets a pattern be aimed. */
  azimuth: number;
};
export type LightRig = {
  /** Three named lamps, ambient mix, backdrop and exposure. Values are appearance-only. */
  key: Lamp;
  fill: Lamp;
  rim: Lamp;
  sky: string;
  bounce: string;
  ambient: number;
  environment: number;
  exposure: number;
  background: string;
  shadow: number;
  shadowRadius: number;
};
/**
 * The light presets: neutral studio, high sun, a low warm lamp and a black-stage film look.
 * Standard backdrops stay light and low-saturation so the stage never fights the studio UI;
 * the presets separate through lamp colour, height, exposure and shadow.
 */
export const LIGHT_RIGS: Record<LightPreset, LightRig> = {
  studio: {
    key: { color: '#ffffff', intensity: 2.9, height: 520, azimuth: 0 },
    fill: { color: '#d3e2ff', intensity: 0.85, height: 190, azimuth: 137 },
    rim: { color: '#ffffff', intensity: 0, height: 400, azimuth: 180 },
    sky: '#eef4ff',
    bounce: '#a9a89e',
    ambient: 0.7,
    environment: 0.85,
    exposure: 0.95,
    background: '#eef0eb',
    shadow: 0.18,
    shadowRadius: 2.5,
  },
  daylight: {
    key: { color: '#fff3de', intensity: 3.5, height: 900, azimuth: 0 },
    fill: { color: '#c9e2ff', intensity: 1.05, height: 320, azimuth: 137 },
    rim: { color: '#ffffff', intensity: 0, height: 500, azimuth: 180 },
    sky: '#cfe4ff',
    bounce: '#cec2a1',
    ambient: 1.05,
    environment: 1.35,
    exposure: 1.06,
    background: '#e7eef6',
    shadow: 0.24,
    shadowRadius: 1,
  },
  warm: {
    key: { color: '#ffb469', intensity: 2.6, height: 185, azimuth: 0 },
    fill: { color: '#ffd9a8', intensity: 0.5, height: 120, azimuth: 137 },
    rim: { color: '#ffd9a8', intensity: 0, height: 300, azimuth: 180 },
    sky: '#ffd2a1',
    bounce: '#8a6a4c',
    ambient: 0.46,
    environment: 0.5,
    exposure: 1,
    background: '#f2e6d8',
    shadow: 0.3,
    shadowRadius: 3.5,
  },
  // Black stage, lamps only: ambient and environment are nearly switched off.
  cinema: {
    key: { color: '#ffffff', intensity: 3.2, height: 520, azimuth: 0 },
    fill: { color: '#b9cdff', intensity: 0.35, height: 180, azimuth: 120 },
    rim: { color: '#ffffff', intensity: 1.2, height: 460, azimuth: 170 },
    sky: '#1b2026',
    bounce: '#0a0c0e',
    ambient: 0.05,
    environment: 0.06,
    exposure: 1.02,
    background: '#000000',
    shadow: 0.5,
    shadowRadius: 3,
  },
};
/**
 * Classic lighting setups, applied on top of any preset. Each one re-aims the key lamp and
 * sets the fill and rim as a ratio of the key, so the looked-for mood survives every stage:
 * butterfly: key straight ahead and high. rembrandt: 45° up and to the side.
 * split: hard side light with almost no fill. rim: backlit outline with a faint front fill.
 */
export const LIGHT_PATTERNS: Record<
  LightPattern,
  {
    key: { height: number; azimuth: number };
    fill: { height: number; azimuth: number; ratio: number };
    rim: { height: number; azimuth: number; ratio: number };
  }
> = {
  butterfly: {
    key: { height: 700, azimuth: 0 },
    fill: { height: 220, azimuth: 0, ratio: 0.16 },
    rim: { height: 520, azimuth: 168, ratio: 0.34 },
  },
  rembrandt: {
    key: { height: 470, azimuth: 46 },
    fill: { height: 170, azimuth: -70, ratio: 0.08 },
    rim: { height: 500, azimuth: 165, ratio: 0.42 },
  },
  split: {
    key: { height: 340, azimuth: 88 },
    fill: { height: 150, azimuth: -88, ratio: 0.03 },
    rim: { height: 520, azimuth: 200, ratio: 0.36 },
  },
  rim: {
    key: { height: 430, azimuth: 168 },
    fill: { height: 140, azimuth: 0, ratio: 0.1 },
    rim: { height: 430, azimuth: -168, ratio: 0.72 },
  },
};
/** Resolve the stored lighting into the concrete rig the renderer applies. */
export function resolveRig(lighting: Lighting): LightRig {
  const base = LIGHT_RIGS[lighting.preset] || LIGHT_RIGS.studio;
  // A lamp setup re-aims the cinema stage only; the studio presets keep their own placement.
  const pattern =
    lighting.preset === 'cinema' && lighting.pattern ? LIGHT_PATTERNS[lighting.pattern] : null;
  if (!pattern) return base;
  return {
    ...base,
    key: { ...base.key, height: pattern.key.height, azimuth: pattern.key.azimuth },
    fill: {
      ...base.fill,
      height: pattern.fill.height,
      azimuth: pattern.fill.azimuth,
      intensity: base.key.intensity * pattern.fill.ratio,
    },
    rim: {
      ...base.rim,
      height: pattern.rim.height,
      azimuth: pattern.rim.azimuth,
      intensity: base.key.intensity * pattern.rim.ratio,
    },
  };
}
type Joint = {
  /** Horn of the driving servo: the axis the joint turns about, and a point on it. */
  axis: THREE.Vector3;
  pivot: THREE.Vector3;
  parent: JointName | 'root';
  ids: string[];
};
/**
 * Servo horn: the small round face at one end of the servo body. It shows up as the only
 * face carrying a dense ring of vertices, while the flat mounting faces carry a handful.
 * The joint can only turn about the axis through it.
 */
function servoHorn(mesh: THREE.Mesh): { axis: THREE.Vector3; point: THREE.Vector3 } | null {
  const position = (mesh.geometry as THREE.BufferGeometry).getAttribute('position');
  if (!position) return null;
  const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute);
  const size = box.getSize(new THREE.Vector3());
  const tolerance = Math.max(0.2, Math.min(size.x, size.y, size.z) * 0.05);
  const centre = box.getCenter(new THREE.Vector3());
  let best: { axis: THREE.Vector3; point: THREE.Vector3; count: number } | null = null;
  for (let a = 0; a < 3; a++) {
    for (const side of ['min', 'max'] as const) {
      const limit = (side === 'min' ? box.min : box.max).getComponent(a);
      let count = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < position.count; i++) {
        if (Math.abs(position.getComponent(i, a) - limit) > tolerance) continue;
        count++;
        sum[0] += position.getX(i);
        sum[1] += position.getY(i);
        sum[2] += position.getZ(i);
      }
      if (count < 16 || (best && count <= best.count)) continue;
      const point = new THREE.Vector3(sum[0] / count, sum[1] / count, sum[2] / count);
      // Slide onto the servo's mid-plane so the pivot sits on the axis, not on a face.
      point.setComponent(a, centre.getComponent(a));
      const axis = new THREE.Vector3();
      axis.setComponent(a, 1);
      best = { axis, point, count };
    }
  }
  return best ? { axis: best.axis, point: best.point } : null;
}
export class Viewer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 4000);
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  meshes = new Map<string, THREE.Mesh>();
  group = new THREE.Group();
  private frame = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private box: THREE.BoxHelper;
  private key: THREE.DirectionalLight;
  private fill: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private ground: THREE.ShadowMaterial;
  private groundMesh: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLRenderTarget;
  private origins = new Map<string, THREE.Vector3>();
  private explodeVectors = new Map<string, THREE.Vector3>();
  /** Rest pose per mesh, captured at load: motions are applied on top of it, never compounded. */
  private restMatrices = new Map<string, THREE.Matrix4>();
  private joints = new Map<JointName, Joint>();
  private jointOf = new Map<string, JointName>();
  private jointOrder: JointName[] = [];
  /** Measured leg linkage per side, used to solve the walk instead of guessing angles. */
  private legs: { L: LegGeometry; R: LegGeometry } | null = null;
  private explodeValue = 0;
  private motion: MotionName | 'sequence' | null = null;
  private motionClock = 0;
  private lastFrame = 0;
  /** Cross-fade state: motions start, change and stop by blending out of the last pose. */
  private lastPose: Pose = {};
  private blendFrom: Pose | null = null;
  private blendClock = 0;
  private stopping = false;
  private selected: string | null = null;
  private down = { x: 0, y: 0 };
  private size = 300;
  private center = new THREE.Vector3();
  private mobile = mobilePreview();
  private layerTexture: THREE.CanvasTexture;
  constructor(
    private host: HTMLElement,
    private model: Manifest,
    private onPick: (id: string) => void,
    private onFailure: (error: Error) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.mobile,
      alpha: false,
      preserveDrawingBuffer: !this.mobile,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.25 : 2));
    this.renderer.setClearColor('#eef0eb');
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      'aria-label',
      '三维装配模型，拖动旋转，滚轮缩放；也可使用视角按钮',
    );
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 1100;
    this.controls.maxPolarAngle = Math.PI * 0.91;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = this.pmrem.fromScene(room, 0.04, 0.1, 100, {
      size: this.mobile ? 128 : 256,
    });
    room.dispose();
    this.scene.environment = this.environment.texture;
    this.ambient = new THREE.HemisphereLight('#eef4ff', '#a9a89e', 0.85);
    this.scene.add(this.ambient);
    this.key = new THREE.DirectionalLight('#ffffff', 3.2);
    this.key.position.set(-180, 400, 300);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(this.mobile ? 512 : 2048, this.mobile ? 512 : 2048);
    Object.assign(this.key.shadow.camera, {
      left: -250,
      right: 250,
      top: 300,
      bottom: -250,
      near: 1,
      far: 1300,
    });
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.4;
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight('#d7e6ff', 1.1);
    this.fill.position.set(220, 160, -240);
    this.scene.add(this.fill);
    this.rim = new THREE.DirectionalLight('#ffffff', 0);
    this.rim.position.set(0, 420, -460);
    this.scene.add(this.rim);
    this.scene.add(this.group);
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const cx = c.getContext('2d')!;
    let seed = 35;
    const image = cx.createImageData(64, 64);
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 16807) % 2147483647;
      const v = 125 + (seed % 12);
      image.data.set([v, v, v, 255], i);
    }
    cx.putImageData(image, 0, 0);
    this.layerTexture = new THREE.CanvasTexture(c);
    this.layerTexture.wrapS = this.layerTexture.wrapT = THREE.RepeatWrapping;
    this.box = new THREE.BoxHelper(new THREE.Mesh(), 0x26a890);
    this.box.visible = false;
    this.scene.add(this.box);
    this.ground = new THREE.ShadowMaterial({ opacity: 0.18 });
    this.groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.ground);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = model.bounds[0][1] - 0.3;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener(
      'pointerdown',
      (e) => (this.down = { x: e.clientX, y: e.clientY }),
    );
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      const r = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = ray.intersectObjects(
        [...this.meshes.values()].filter((m) => m.visible),
        false,
      )[0];
      // Clicking empty space clears the selection instead of leaving the last part active.
      this.onPick(hit ? hit.object.name : '');
    });
    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.disposed = true;
      cancelAnimationFrame(this.frame);
      this.onFailure(new Error('3D rendering context was lost.'));
    });
    let lastRender = 0;
    const animate = (now = 0) => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(animate);
      if (document.hidden || (this.mobile && now - lastRender < 32)) return;
      lastRender = now;
      this.controls.update();
      const delta = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
      this.lastFrame = now;
      const step = Math.min(delta, 0.1);
      if (this.motion) {
        this.motionClock += step;
        const target = poseAt(this.motionClock, this.motion, this.legs || undefined);
        this.blendClock += step;
        this.applyPose(
          this.blendFrom
            ? blendPose(this.blendFrom, target, this.blendClock / BLEND_SECONDS)
            : target,
        );
        this.lastPose = target;
        if (this.blendFrom && this.blendClock >= BLEND_SECONDS) this.blendFrom = null;
      } else if (this.stopping) {
        this.blendClock += step;
        this.blendFrom = this.blendFrom || {};
        this.applyPose(blendPose(this.blendFrom, {}, this.blendClock / BLEND_SECONDS));
        if (this.blendClock >= BLEND_SECONDS) {
          this.stopping = false;
          this.blendFrom = null;
          this.lastPose = {};
          this.resetPose();
        }
      }
      if (this.box.visible) this.box.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const known = new Set(this.model.parts.map((p) => p.id));
    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        if (!known.has(obj.name)) throw new Error(`模型节点未登记：${obj.name}`);
        const originalGeometry = obj.geometry;
        if (this.mobile) {
          if (!obj.geometry.getAttribute('normal')) obj.geometry.computeVertexNormals();
        } else {
          obj.geometry = toCreasedNormals(obj.geometry, 0.45);
          if (obj.geometry !== originalGeometry) originalGeometry.dispose();
        }
        obj.material = new THREE.MeshPhysicalMaterial({ color: '#ffffff' });
        obj.castShadow = true;
        obj.receiveShadow = true;
        this.meshes.set(obj.name, obj);
        this.origins.set(obj.name, obj.position.clone());
        const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
        this.explodeVectors.set(obj.name, center.clone());
        obj.updateMatrix();
        this.restMatrices.set(obj.name, obj.matrix.clone());
      }
    });
    if (this.meshes.size !== known.size) throw new Error('几何与零件清单不一致');
    this.group.add(gltf.scene);
    this.buildRig();
    const bounds = new THREE.Box3().setFromObject(this.group);
    bounds.getCenter(this.center);
    this.size = bounds.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(this.center);
    this.restage();
    this.view('three-quarter');
  }
  apply(palette: Palette, layers: boolean) {
    for (const [id, mesh] of this.meshes) {
      const part = this.model.parts.find((p) => p.id === id)!;
      const f = palette.parts[id];
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.color.set(f.coating?.color || f.color);
      Object.assign(mat, materialPresets[f.material]);
      if (f.coating) {
        mat.metalness = 0;
        mat.roughness = 0.7;
        mat.clearcoat = 0;
      }
      if (!part.printable) {
        mat.metalness = part.metalness;
        mat.roughness = 0.38;
        mat.sheen = 0;
      }
      // Triplanar world-space layer shading; display-only, never manufacturing geometry.
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.layerEnabled = { value: layers && part.printable ? 1 : 0 };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vLayerWorld;')
          .replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvLayerWorld = (modelMatrix * vec4(transformed,1.0)).xyz;',
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vLayerWorld; uniform float layerEnabled;',
          )
          .replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nfloat phase = vLayerWorld.y * 31.4159265; float attenuation = 1.0-smoothstep(0.7, 3.0, fwidth(phase)); float ridges = sin(phase)*attenuation; diffuseColor.rgb *= 1.0 - layerEnabled * 0.035 * (ridges*0.5+0.5); roughnessFactor = clamp(roughnessFactor + layerEnabled * 0.05 * ridges, 0.04, 1.0);',
          );
      };
      mat.customProgramCacheKey = () => `${layers && part.printable}`;
      mat.needsUpdate = true;
    }
  }
  /**
   * Group the meshes into joints and derive each hinge from the parts' rest bounds. Joints are
   * a flat list whose parents come first, so poses are applied top-down.
   */
  private buildRig() {
    const claimed = new Map<string, JointName>();
    for (const spec of motionJoints) {
      const ids = this.model.parts
        .filter(
          (part) =>
            spec.assemblies.includes(part.assemblyId) ||
            spec.assemblies.includes(part.assembly) ||
            spec.sourceNames?.includes(part.sourceName),
        )
        .map((part) => part.id)
        .filter((id) => this.meshes.has(id));
      if (!ids.length) continue;
      // The horn is where the robot can actually rotate; without it, leave the joint out.
      const servo = this.meshes.get(spec.servo);
      const horn = servo ? servoHorn(servo) : null;
      if (!horn) continue;
      this.joints.set(spec.id, {
        axis: horn.axis,
        pivot: horn.point,
        parent: spec.parent,
        ids: [],
      });
      // A part named by a later joint leaves the joint that claimed it first.
      for (const id of ids) claimed.set(id, spec.id);
    }
    // Whatever nobody claimed is the trunk plus the fixed hip brackets: the rig hangs off it.
    const trunk: string[] = [];
    const trunkBox = new THREE.Box3();
    for (const [id, mesh] of this.meshes) {
      if (claimed.has(id)) continue;
      trunk.push(id);
      trunkBox.expandByObject(mesh);
    }
    if (trunk.length) {
      this.joints.set('root', {
        axis: new THREE.Vector3(0, 1, 0),
        pivot: trunkBox.getCenter(new THREE.Vector3()),
        parent: 'root',
        ids: trunk,
      });
      for (const id of trunk) claimed.set(id, 'root');
    }
    for (const [partId, jointId] of claimed) {
      this.joints.get(jointId)!.ids.push(partId);
      this.jointOf.set(partId, jointId);
    }
    // Parents first, so each joint's world matrix can build on its parent's.
    const depth = (id: JointName): number => {
      let steps = 0,
        current = this.joints.get(id)?.parent;
      while (current && current !== 'root' && steps < this.joints.size) {
        steps++;
        current = this.joints.get(current)?.parent;
      }
      return steps;
    };
    this.jointOrder = [...this.joints.keys()].sort((a, b) => depth(a) - depth(b));
    this.legs = this.measureLegs();
  }
  /**
   * The linkage the IK needs, straight from the measured pivots: hip → knee → ankle in the
   * sagittal plane, and how far the sole hangs below the ankle.
   */
  private measureLegs(): { L: LegGeometry; R: LegGeometry } | null {
    const build = (side: 'L' | 'R'): LegGeometry | null => {
      const hip = this.joints.get(`hip${side}` as JointName);
      const knee = this.joints.get(`knee${side}` as JointName);
      const ankle = this.joints.get(`ankle${side}` as JointName);
      if (!hip || !knee || !ankle) return null;
      const soleParts = this.model.parts.filter(
        (p) => p.assemblyId === (side === 'L' ? '左踝脚' : '右踝脚'),
      );
      const box = new THREE.Box3();
      for (const part of soleParts) {
        const mesh = this.meshes.get(part.id);
        if (mesh) box.expandByObject(mesh);
      }
      const soleBottom = box.isEmpty() ? ankle.pivot.y - 25 : box.min.y;
      return {
        hipToKnee: [knee.pivot.x - hip.pivot.x, knee.pivot.y - hip.pivot.y],
        kneeToAnkle: [ankle.pivot.x - knee.pivot.x, ankle.pivot.y - knee.pivot.y],
        ankleToSole: ankle.pivot.y - soleBottom,
      };
    };
    const L = build('L');
    const R = build('R');
    return L && R ? { L, R } : null;
  }
  /** Play a motion, or the default walk-and-pause loop. */
  play(motion: MotionName | 'sequence' = 'sequence') {
    if (this.motion !== motion) this.blendFrom = this.lastPose;
    this.motion = motion;
    this.motionClock = 0;
    this.blendClock = 0;
    this.stopping = false;
  }
  stopMotion() {
    if (!this.motion && !this.stopping) return;
    if (this.playing) this.blendFrom = this.lastPose;
    this.motion = null;
    this.blendClock = 0;
    // Settle back onto the rest pose, then snap to it exactly.
    this.stopping = !!this.blendFrom;
    if (!this.stopping) this.resetPose();
  }
  get playing() {
    return this.motion;
  }
  /** Put every mesh back on its rest transform. */
  private resetPose() {
    for (const [id, mesh] of this.meshes) {
      const rest = this.restMatrices.get(id);
      if (!rest) continue;
      rest.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
    // Exploding and animating both move parts; the spread is reapplied on top of the rest pose.
    if (this.explodeValue) this.applyExplode();
  }
  private applyPose(pose: Pose) {
    const world = new Map<JointName, THREE.Matrix4>();
    const composed = new THREE.Matrix4();
    const turn = new THREE.Matrix4();
    for (const id of this.jointOrder) {
      const joint = this.joints.get(id)!;
      const angles = pose[id];
      const parent =
        id === 'root'
          ? new THREE.Matrix4()
          : world.get(joint.parent as JointName)?.clone() || new THREE.Matrix4();
      // Servo joints turn about their horn; the trunk leans freely and takes the offsets.
      turn.identity();
      if (angles) {
        if (angles.angle) turn.makeRotationAxis(joint.axis, angles.angle);
        else if (angles.x || angles.y || angles.z)
          turn.makeRotationFromEuler(new THREE.Euler(angles.x || 0, angles.y || 0, angles.z || 0));
      }
      const { pivot } = joint;
      composed
        .makeTranslation(
          pivot.x + (angles?.dx || 0),
          pivot.y + (angles?.dy || 0),
          pivot.z + (angles?.dz || 0),
        )
        .multiply(turn)
        .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
      world.set(id, parent.multiply(composed));
    }
    const matrix = new THREE.Matrix4();
    for (const [partId, jointId] of this.jointOf) {
      const mesh = this.meshes.get(partId);
      const rest = this.restMatrices.get(partId);
      const parent = world.get(jointId);
      if (!mesh || !rest) continue;
      if (parent) matrix.copy(parent).multiply(rest);
      else matrix.copy(rest);
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    }
  }
  /**
   * The measured joint rig: which servo drives which parts, and where its horn sits. Exposed
   * so agents and the docs can describe the mechanism instead of guessing at it.
   */
  rig() {
    return [...this.joints].map(([id, joint]) => ({
      id,
      parent: joint.parent,
      axis: joint.axis.toArray() as [number, number, number],
      pivot: joint.pivot.toArray() as [number, number, number],
      parts: [...joint.ids],
    }));
  }
  select(id: string | null) {
    this.selected = id;
    const m = id ? this.meshes.get(id) : null;
    this.box.visible = !!m && m.visible;
    if (m) this.box.setFromObject(m);
  }
  isolate(id: string | null) {
    for (const [key, m] of this.meshes) m.visible = !id || key === id;
    this.select(this.selected);
    this.restage();
  }
  hardware(visible: boolean) {
    for (const p of this.model.parts) if (!p.printable) this.meshes.get(p.id)!.visible = visible;
    this.select(this.selected);
    this.restage();
  }
  explode(value: number) {
    this.explodeValue = value;
    this.applyExplode();
    if (this.box.visible) this.box.update();
    this.restage();
  }
  /** Offsets from the rest position. Re-applied after any pose reset so both can coexist. */
  private applyExplode() {
    for (const [id, m] of this.meshes) {
      const v = this.explodeVectors.get(id)!.clone().sub(this.center);
      m.position.copy(this.origins.get(id)!).add(v.multiplyScalar(this.explodeValue * 0.8));
    }
  }
  /**
   * Drop the shadow floor under the parts as they currently stand and let the shadow camera
   * cover them. Without this, an exploded assembly keeps casting onto the assembled foot
   * height, so parts in the air look like they float above their own shadow.
   */
  private restage() {
    const box = new THREE.Box3();
    for (const [id, mesh] of this.meshes) if (mesh.visible) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.75 + 80;
    Object.assign(this.key.shadow.camera, {
      left: -radius,
      right: radius,
      top: radius,
      bottom: -radius,
      near: 1,
      // The key lamp sits at a fixed distance; pull `far` out past the widest layout.
      far: this.key.position.length() + radius * 2 + 400,
    });
    this.key.shadow.camera.updateProjectionMatrix();
    this.groundMesh.position.y = box.min.y - 0.3;
  }
  light(lighting: Lighting) {
    const rig = resolveRig(lighting);
    const intensity = lighting.intensity;
    const place = (lamp: THREE.DirectionalLight, spec: Lamp) => {
      lamp.color.set(spec.color);
      lamp.intensity = spec.intensity * intensity;
      // Height and angle are part of the rig: an overhead sun reads unlike a low side lamp.
      const a = ((lighting.azimuth + spec.azimuth) * Math.PI) / 180;
      lamp.position.set(Math.sin(a) * 420, spec.height, Math.cos(a) * 420);
    };
    place(this.key, rig.key);
    place(this.fill, rig.fill);
    place(this.rim, rig.rim);
    this.key.shadow.radius = rig.shadowRadius;
    this.ambient.color.set(rig.sky);
    this.ambient.groundColor.set(rig.bounce);
    this.ambient.intensity = rig.ambient * intensity;
    this.scene.environmentIntensity = rig.environment;
    this.renderer.toneMappingExposure = rig.exposure;
    this.renderer.setClearColor(rig.background);
    this.ground.opacity = rig.shadow;
  }
  orbit(azimuth: number, elevation: number) {
    const d = this.camera.position.distanceTo(this.controls.target);
    const a = (azimuth * Math.PI) / 180,
      e = (elevation * Math.PI) / 180;
    this.camera.position
      .copy(this.controls.target)
      .add(
        new THREE.Vector3(
          Math.sin(a) * Math.cos(e),
          Math.sin(e),
          Math.cos(a) * Math.cos(e),
        ).multiplyScalar(d),
      );
    this.controls.update();
  }
  view(name: string) {
    const d = (this.size * 1.75) / Math.min(1, this.camera.aspect);
    const dirs: Record<string, number[]> = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [1, 0, 0],
      right: [-1, 0, 0],
      'three-quarter': [0.9, 0.4, 1.4],
      ...this.model.viewDirections,
    };
    const v = new THREE.Vector3(...(dirs[name] || dirs['three-quarter']))
      .normalize()
      .multiplyScalar(d);
    this.camera.position.copy(this.center).add(v);
    this.controls.target.copy(this.center);
    this.controls.update();
  }
  png() {
    const shown = this.box.visible;
    this.box.visible = false;
    this.renderer.render(this.scene, this.camera);
    const data = this.renderer.domElement.toDataURL('image/png');
    this.box.visible = shown;
    return data;
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    const before = Math.min(1, this.camera.aspect);
    this.camera.aspect = width / Math.max(1, height);
    const ratio = before / Math.min(1, this.camera.aspect);
    this.camera.position.sub(this.controls.target).multiplyScalar(ratio).add(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.environment.dispose();
    this.pmrem.dispose();
    this.layerTexture.dispose();
    this.renderer.dispose();
  }
}
