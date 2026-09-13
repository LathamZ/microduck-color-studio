import { mobilePreview } from './device';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { Manifest, Palette, MaterialKind } from './domain';
export const materialPresets: Record<
  MaterialKind,
  { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number }
> = {
  pla: { roughness: 0.36, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.38 },
  'matte-pla': { roughness: 0.84, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.8 },
  petg: { roughness: 0.18, metalness: 0, clearcoat: 0.46, clearcoatRoughness: 0.17 },
  'matte-petg': { roughness: 0.78, metalness: 0, clearcoat: 0.04, clearcoatRoughness: 0.75 },
  'metallic-petg': { roughness: 0.3, metalness: 0.48, clearcoat: 0.25, clearcoatRoughness: 0.25 },
  'pla-cf': { roughness: 0.94, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.95 },
  tpu: { roughness: 0.64, metalness: 0, clearcoat: 0.05, clearcoatRoughness: 0.6 },
};
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
  private pmrem: THREE.PMREMGenerator;
  private environment: THREE.WebGLRenderTarget;
  private origins = new Map<string, THREE.Vector3>();
  private explodeVectors = new Map<string, THREE.Vector3>();
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
    this.scene.add(new THREE.HemisphereLight('#e7f0ff', '#b3ab99', 0.85));
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
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.ShadowMaterial({ opacity: 0.15 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = model.bounds[0][1] - 0.3;
    ground.receiveShadow = true;
    this.scene.add(ground);
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
      if (hit) this.onPick(hit.object.name);
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
      }
    });
    if (this.meshes.size !== known.size) throw new Error('几何与零件清单不一致');
    this.group.add(gltf.scene);
    const bounds = new THREE.Box3().setFromObject(this.group);
    bounds.getCenter(this.center);
    this.size = bounds.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(this.center);
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
  select(id: string | null) {
    this.selected = id;
    const m = id ? this.meshes.get(id) : null;
    this.box.visible = !!m && m.visible;
    if (m) this.box.setFromObject(m);
  }
  isolate(id: string | null) {
    for (const [key, m] of this.meshes) m.visible = !id || key === id;
    this.select(this.selected);
  }
  hardware(visible: boolean) {
    for (const p of this.model.parts) if (!p.printable) this.meshes.get(p.id)!.visible = visible;
    this.select(this.selected);
  }
  explode(value: number) {
    for (const [id, m] of this.meshes) {
      const v = this.explodeVectors.get(id)!.clone().sub(this.center);
      m.position.copy(this.origins.get(id)!).add(v.multiplyScalar(value * 0.8));
    }
    if (this.box.visible) this.box.update();
  }
  light(preset: string, intensity: number, azimuth: number) {
    const colors: Record<string, [string, string]> = {
      studio: ['#ffffff', '#d7e6ff'],
      daylight: ['#e8f2ff', '#ffffff'],
      warm: ['#ffdab3', '#e0e7ff'],
    };
    const c = colors[preset] || colors.studio;
    this.key.color.set(c[0]);
    this.fill.color.set(c[1]);
    this.key.intensity = 2.4 * intensity;
    this.fill.intensity = 0.7 * intensity;
    const a = (azimuth * Math.PI) / 180;
    this.key.position.set(Math.sin(a) * 400, 360, Math.cos(a) * 400);
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
