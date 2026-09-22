/** Deterministic, isolated presentation mode for documentation recording.
 * Open ?demo=1. Right arrow advances one 100 ms frame. No local data is read or saved.
 *
 * The beats follow the storyboard in docs/recording.md: meet the duck, recolour it while it
 * turns, work on one part up close, walk through the light rigs, fill the screen for a walk,
 * then save the look and export the plates.
 */
import { defaults, type Manifest, type Palette } from './domain';
import type { Viewer } from './viewer';
import type { Inventory } from './recommend';

/** Frame range of each beat, in 100 ms frames. */
const BEAT = {
  intro: [0, 8],
  spin: [9, 42],
  settle: [43, 48],
  push: [49, 60],
  recolour: [61, 82],
  materials: [83, 102],
  pullBack: [103, 112],
  lights: [113, 138],
  patterns: [139, 162],
  shape: [163, 198],
  fullscreen: [199, 210],
  walk: [211, 268],
  tilt: [269, 288],
  exit: [289, 295],
  looks: [296, 317],
  print: [318, 357],
  end: [358, 365],
};
/** 36.6 seconds at 10 frames a second. */
export const DEMO_FRAMES = 366;

export function setupDemo(
  model: Manifest,
  viewer: Viewer,
  apply: (p: Palette) => void,
  select: (id: string) => void,
  stock: { setInventory: (i: unknown) => Inventory; open: () => void },
  print: { load(bytes: Uint8Array, name: string): Promise<unknown> },
) {
  let frame = -1;
  /** The azimuth the turn starts from: the standard view, whatever the model calls it. */
  let spinFrom = 0;
  /** The torso: colours and materials are both shown on this part, up close. */
  const body =
    model.parts.find((p) => p.sourceName === 'right_shell')?.id ||
    model.parts.find((p) => p.printable)!.id;
  const base = defaults(model);
  viewer.controls.enableDamping = false;
  const inventory: Inventory = {
    schemaVersion: 1,
    items: [
      { id: 'demo-ivory', name: '象牙白', color: '#F1EFE7', material: 'matte-pla' },
      { id: 'demo-dark', name: '石墨灰', color: '#30343B', material: 'petg' },
      { id: 'demo-sage', name: '鼠尾草绿', color: '#8DAB8A', material: 'pla' },
      { id: 'demo-soft', name: '柔性黑', color: '#30343B', material: 'tpu' },
    ],
  };
  stock.setInventory(inventory);
  void select; // kept in the signature: callers pass the editor's own selection handler
  // A visible pointer: the demo scrolls each control into view, moves the cursor onto it
  // and lets the click pulse, so the recording shows what is being used and where.
  const cursor = document.createElement('div');
  cursor.id = 'demo-cursor';
  cursor.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5l13 7.6-5.9 1.4-2.6 5.9z"/></svg>';
  document.body.append(cursor);
  /** Keep the pointer on a slider that was already located by its element. */
  const aimRendered = (el: HTMLElement, id: string) => {
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = el.getBoundingClientRect();
    cursor.style.left = `${rect.left + rect.width * (Number((el as HTMLInputElement).value) / (Number((el as HTMLInputElement).max) || 100))}px`;
    cursor.style.top = `${rect.top + rect.height / 2}px`;
    cursor.classList.add('visible');
    void id;
  };
  const aim = (selector: string) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const rect = el.getBoundingClientRect();
    cursor.style.left = `${rect.left + rect.width / 2}px`;
    cursor.style.top = `${rect.top + rect.height / 2}px`;
    cursor.classList.add('visible');
    return el;
  };
  const click = (selector: string) => {
    const el = aim(selector);
    if (!el) return;
    el.classList.add('demo-press');
    setTimeout(() => el.classList.remove('demo-press'), 300);
    el.click();
  };
  const scrollTo = (top: number) =>
    document.querySelector('.inspector-scroll')?.scrollTo({ top, behavior: 'auto' });
  const setSlider = (id: string, value: number) => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) return;
    aimRendered(input, id);
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /**
   * Camera moves, eased between two framings: a push-in onto a part reads as a camera move
   * instead of a cut, and the same machinery carries the return to the standard view.
   */
  let from: number[] = [];
  let to: number[] = [];
  const cameraState = () => [
    viewer.camera.position.x,
    viewer.camera.position.y,
    viewer.camera.position.z,
    viewer.controls.target.x,
    viewer.controls.target.y,
    viewer.controls.target.z,
  ];
  const applyCamera = (a: number[], b: number[], t: number) => {
    const value = a.map((n, i) => n + (b[i] - n) * t);
    viewer.camera.position.set(value[0], value[1], value[2]);
    viewer.controls.target.set(value[3], value[4], value[5]);
    viewer.controls.update();
  };
  const glideTo = (move: () => void) => {
    from = cameraState();
    move();
    to = cameraState();
    applyCamera(from, to, 0);
  };
  /** Ease in and out, so every move starts and ends without a jolt. */
  const ease = (t: number) => {
    const v = Math.max(0, Math.min(1, t));
    return v * v * (3 - 2 * v);
  };
  const glideAt = (t: number) => applyCamera(from, to, ease(t));
  /** A four-object 3MF, so the print dialog has something real to match. */
  const samplePrint = () => {
    const mesh =
      '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="26" y="0" z="0"/><vertex x="0" y="26" z="0"/><vertex x="0" y="0" z="26"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
    const names = [
      model.parts.filter((p) => p.printable)[0].sourceName + '.stl',
      'shell.stl',
      'sole_left_v2.stl',
      'unknown_bracket.stl',
    ];
    const resources = names
      .map((name, i) => `<object id="${i + 1}" name="${name}">${mesh}</object>`)
      .join('');
    const items = names
      .map((_, i) => `<item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${i * 40} 0 0"/>`)
      .join('');
    return import('fflate').then(({ zipSync, strToU8 }) =>
      zipSync({
        '3D/3dmodel.model': strToU8(
          `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${resources}</resources><build>${items}</build></model>`,
        ),
      }),
    );
  };
  const hover = (selector: string, on: boolean) =>
    document
      .querySelector(selector)
      ?.dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave', { bubbles: true }));
  const mix = (from: string, to: string, t: number) => {
    const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [a, b] = [parse(from), parse(to)];
    return (
      '#' +
      a
        .map((v, i) =>
          Math.round(v + (b[i] - v) * t)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };
  /** Drive the part colour picker the way a hand does: an input per frame, then commit. */
  const dragColour = (stops: string[], t: number) => {
    const span = (stops.length - 1) * 12;
    const scaled = Math.min(0.999, t) * span;
    const index = Math.floor(scaled / 12);
    const colour = mix(stops[index], stops[index + 1], (scaled % 12) / 12);
    const input = document.getElementById('part-color') as HTMLInputElement | null;
    if (!input) return;
    input.value = colour;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** Where the camera stands now, as the angle `viewer.orbit` takes. */
  const azimuthOf = () => {
    const offset = viewer.camera.position.clone().sub(viewer.controls.target);
    return (Math.atan2(offset.x, offset.z) * 180) / Math.PI;
  };
  /** The model decides which way it faces, so ask it instead of assuming an axis. */
  const frontAzimuth = (() => {
    const position = viewer.camera.position.clone();
    const target = viewer.controls.target.clone();
    viewer.view('front');
    const found = azimuthOf();
    viewer.camera.position.copy(position);
    viewer.controls.target.copy(target);
    viewer.controls.update();
    return found;
  })();
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight') return;
    e.preventDefault();
    frame++;
    const within = (beat: number[]) => frame >= beat[0] && frame <= beat[1];
    const at = (beat: number[], offset = 0) => frame === beat[0] + offset;
    const span = (beat: number[]) => (frame - beat[0]) / (beat[1] - beat[0]);

    // 0-8: meet the duck, in the studio's own standard view. It stands still first.
    if (frame === 0) {
      apply(base);
      viewer.select(null);
      viewer.view('three-quarter');
      spinFrom = azimuthOf();
    }
    // 9-42: turn it and recolour it on the way round, easing up and easing to a stop.
    if (within(BEAT.spin)) viewer.orbit(spinFrom + ease(span(BEAT.spin)) * 170, 14);
    if (at(BEAT.spin, 5)) click('[data-preset="1"]');
    if (at(BEAT.spin, 21)) click('[data-preset="3"]');
    // 49-112: the torso, up close: recolour it by hand, then step through the materials.
    if (frame === BEAT.settle[1]) click(`[data-part="${body}"]`);
    // Close enough to read the surface, wide enough to keep the part in one piece, and swung
    // round to look at it from the front while the camera comes in.
    if (at(BEAT.push))
      glideTo(() => {
        viewer.focus([body], 1.9);
        viewer.orbit(frontAzimuth + 38, 12);
      });
    if (within(BEAT.push)) glideAt(span(BEAT.push));
    if (at(BEAT.recolour)) aim('#part-color');
    if (frame > BEAT.recolour[0] && frame < BEAT.recolour[1])
      dragColour(
        ['#F2C94C', '#F28C28', '#ECC6C5', '#3AC9BD', '#254D70'],
        (frame - BEAT.recolour[0]) / (BEAT.recolour[1] - BEAT.recolour[0]),
      );
    if (frame === BEAT.recolour[1])
      document.getElementById('part-color')?.dispatchEvent(new Event('change', { bubbles: true }));
    if (within(BEAT.recolour) || within(BEAT.materials))
      viewer.orbit(frontAzimuth + 38 + (frame - BEAT.recolour[0]) * 0.45, 12);
    ['matte-pla', 'silk-pla', 'metallic-petg', 'petg-cf'].forEach((material, index) => {
      if (at(BEAT.materials, index * 5)) {
        scrollTo(0);
        click(`[data-material="${material}"]`);
      }
    });
    if (at(BEAT.pullBack)) glideTo(() => viewer.view('three-quarter'));
    if (within(BEAT.pullBack)) glideAt(span(BEAT.pullBack));
    // 113-162: the light rigs, then the film setups inside the cinema rig.
    if (at(BEAT.lights, 1)) click('[data-light="daylight"]');
    if (at(BEAT.lights, 8)) click('[data-light="warm"]');
    if (at(BEAT.lights, 15)) click('[data-light="cinema"]');
    ['butterfly', 'rembrandt', 'split', 'rim'].forEach((pattern, index) => {
      if (at(BEAT.patterns, 1 + index * 6)) click(`[data-pattern="${pattern}"]`);
    });
    // 163-198: aim the lamp: direction, then angle, then strength.
    if (at(BEAT.shape)) aim('#direction');
    if (frame > BEAT.shape[0] + 1 && frame <= BEAT.shape[0] + 10)
      setSlider('direction', -150 + (frame - BEAT.shape[0] - 1) * 25);
    if (frame > BEAT.shape[0] + 12 && frame <= BEAT.shape[0] + 19)
      setSlider('elevation', 20 + (frame - BEAT.shape[0] - 12) * 8.5);
    if (frame > BEAT.shape[0] + 22 && frame <= BEAT.shape[0] + 27)
      setSlider('intensity', 40 + (frame - BEAT.shape[0] - 22) * 24);
    if (frame > BEAT.shape[0] + 28 && frame <= BEAT.shape[0] + 34)
      setSlider('intensity', 160 - (frame - BEAT.shape[0] - 28) * 10);
    // 199-268: fullscreen, then a walk all the way round and back to the front.
    if (at(BEAT.fullscreen)) click('#fullscreen');
    // Face the duck first, then walk it right the way round and stop where it started.
    if (at(BEAT.walk)) glideTo(() => viewer.orbit(frontAzimuth, 14));
    if (frame >= BEAT.walk[0] && frame <= BEAT.walk[0] + 6) glideAt((frame - BEAT.walk[0]) / 6);
    if (at(BEAT.walk, 8)) hover('.motion-tools', true);
    if (at(BEAT.walk, 11)) click('[data-motion="walk"]');
    if (frame > BEAT.walk[0] + 11 && frame <= BEAT.walk[1])
      viewer.orbit(
        frontAzimuth + ease((frame - BEAT.walk[0] - 11) / (BEAT.walk[1] - BEAT.walk[0] - 11)) * 360,
        14,
      );
    // 269-295: stop, tilt the head, and come back out of fullscreen.
    if (at(BEAT.tilt)) click('#motion-toggle');
    if (at(BEAT.tilt, 2)) hover('.motion-tools', true);
    if (at(BEAT.tilt, 5)) click('[data-motion="tilt"]');
    // Let the head come back level before leaving fullscreen, so the rest of the tour is still.
    if (at(BEAT.tilt, 13)) {
      hover('.motion-tools', false);
      click('#motion-toggle');
    }
    if (at(BEAT.exit)) click('#fullscreen');
    // 296-317: keep the look: save it, change it, then apply the saved one back.
    if (at(BEAT.looks)) click('#looks-toggle');
    if (at(BEAT.looks, 3)) {
      const name = document.getElementById('looks-name') as HTMLInputElement | null;
      if (name) {
        name.value = '我的第一版';
        name.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (at(BEAT.looks, 6)) click('#looks-save-button');
    if (at(BEAT.looks, 9)) click('#looks-menu [data-close]');
    if (at(BEAT.looks, 10)) click('[data-preset="5"]');
    if (at(BEAT.looks, 13)) click('#looks-toggle');
    if (at(BEAT.looks, 16)) click('[data-apply]');
    if (at(BEAT.looks, 20)) click('#looks-menu [data-close]');
    // 318-357: export, with the print model matched against the look.
    if (at(BEAT.print)) void samplePrint().then((bytes) => print.load(bytes, 'duck-plates.3mf'));
    if (at(BEAT.print, 10)) {
      click('#export-menu-toggle');
      click('#export-print-open');
    }
    if (at(BEAT.print, 16)) {
      const picker = document.getElementById('print-printer') as HTMLSelectElement | null;
      if (picker) {
        picker.value = 'p1s';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (at(BEAT.print, 22))
      document.getElementById('print-object-list')?.scrollTo({ top: 260, behavior: 'auto' });
    if (at(BEAT.print, 28))
      document.getElementById('print-object-list')?.scrollTo({ top: 0, behavior: 'auto' });
    if (at(BEAT.print, 32)) click('#print-plan');
  });
}
