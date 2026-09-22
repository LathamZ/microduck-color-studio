/**
 * Motions for the assembly: a joint rig driven by time, with no skeleton in the model.
 * Each joint is one servo, so every rotation happens about that servo's horn — the only
 * thing on the robot that can actually turn. `src/models/active.ts` says which servo drives
 * which parts; `src/viewer.ts` measures the horns and applies the angles.
 */
export const MOTIONS = [
  'walk',
  'skate',
  'sit',
  'kick',
  'grab',
  'recover',
  'shake',
  'tilt',
  'beak',
] as const;
export type MotionName = (typeof MOTIONS)[number];
export type JointName =
  | 'root'
  | 'neckBase'
  | 'neckPitch'
  | 'headYaw'
  | 'headPitch'
  | 'jaw'
  | 'turnL'
  | 'turnR'
  | 'splayL'
  | 'splayR'
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'ankleL'
  | 'ankleR'
  | 'wheelLF'
  | 'wheelLR'
  | 'wheelRF'
  | 'wheelRR';
/**
 * `angle` is radians about the joint's servo horn, positive following the right-hand rule
 * around the horn axis. The trunk has no servo of its own, so it also takes euler `x/y/z`
 * for the whole-body lean, and `d*` shifts it (the walk bob).
 */
export type JointPose = {
  angle?: number;
  x?: number;
  y?: number;
  z?: number;
  dx?: number;
  dy?: number;
  dz?: number;
};
export type Pose = Partial<Record<JointName, JointPose>>;
/** One stride pair, in seconds. The sequence cuts on a multiple of this to avoid a jump. */
export const WALK_PERIOD = 0.9;
const TAU = Math.PI * 2;
export type Vec2 = [number, number];
/**
 * The leg linkage, measured from the model: hip → knee and knee → ankle in the sagittal
 * plane (x forward, y up), plus how far the sole hangs below the ankle. With this the walk
 * is solved the way the robot's own controller would: pick a foot path, solve the joints.
 */
export type LegGeometry = {
  hipToKnee: Vec2;
  kneeToAnkle: Vec2;
  ankleToSole: number;
  /** How far the hip sits from the trunk's centre line: what a body roll tips the leg about. */
  hipOffset: number;
};
const length = (v: Vec2) => Math.hypot(v[0], v[1]);
const rotate = (v: Vec2, angle: number): Vec2 => [
  v[0] * Math.cos(angle) - v[1] * Math.sin(angle),
  v[0] * Math.sin(angle) + v[1] * Math.cos(angle),
];
const clamp01 = (v: number) => Math.min(1, Math.max(-1, v));
const interior = (hipToKnee: Vec2, kneeToAnkle: Vec2) =>
  Math.acos(
    clamp01(
      (-hipToKnee[0] * kneeToAnkle[0] - hipToKnee[1] * kneeToAnkle[1]) /
        (length(hipToKnee) * length(kneeToAnkle)),
    ),
  );
/** Where the ankle and the sole's lowest point land for a set of joint angles. */
export function legForward(
  geom: LegGeometry,
  angles: { hip: number; knee: number; ankle: number },
) {
  const knee = rotate(geom.hipToKnee, angles.hip);
  const ankle = [
    knee[0] + rotate(geom.kneeToAnkle, angles.hip + angles.knee)[0],
    knee[1] + rotate(geom.kneeToAnkle, angles.hip + angles.knee)[1],
  ] as Vec2;
  // The sole keeps its rest orientation when the three angles cancel out.
  const footAngle = angles.hip + angles.knee + angles.ankle;
  const sole: Vec2 = [
    ankle[0] + Math.sin(footAngle) * geom.ankleToSole,
    ankle[1] - Math.cos(footAngle) * geom.ankleToSole,
  ];
  return { knee, ankle, sole, footAngle };
}
/**
 * Two-link inverse kinematics for the ankle target, in the plane the servo really turns in.
 * Returns servo angles relative to the rest pose, so zero means "standing as built".
 */
export function solveLeg(geom: LegGeometry, target: Vec2) {
  const upper = length(geom.hipToKnee);
  const lower = length(geom.kneeToAnkle);
  const reach = Math.min(
    Math.max(length(target), Math.abs(upper - lower) + 0.01),
    upper + lower - 0.01,
  );
  const direction = Math.atan2(target[1], target[0]);
  const restDirection = Math.atan2(geom.hipToKnee[1], geom.hipToKnee[0]);
  const cosine = clamp01((upper * upper + reach * reach - lower * lower) / (2 * upper * reach));
  const bend = Math.acos(cosine);
  const hip = direction - bend - restDirection;
  // The knee angle is the change of the interior angle from the built pose: folding closes
  // it, extending opens it, and zero means the leg stands exactly as assembled.
  const straight = Math.acos(
    clamp01((upper * upper + lower * lower - reach * reach) / (2 * upper * lower)),
  );
  const knee = interior(geom.hipToKnee, geom.kneeToAnkle) - straight;
  // The foot stays level (and so flat on the ground) when the angles cancel out.
  return { hip, knee, ankle: -(hip + knee) };
}
/** Foot path for one leg: planted and sliding back, then lifted and swung forward. */
export function footTarget(phase: number, stride = 18, lift = 11): Vec2 {
  const t = (((phase / TAU) % 1) + 1) % 1;
  const along = (u: number) => stride * (1 - 2 * u);
  if (t < 0.5) return [along(t / 0.5), 0];
  const u = (t - 0.5) / 0.5;
  const eased = u * u * (3 - 2 * u);
  return [-stride + 2 * stride * eased, lift * Math.sin(Math.PI * u)];
}
/**
 * One leg placed by hand: `x` is the ankle ahead of the hip and `y` its height above the ground,
 * both in the sagittal plane. Solving for the ankle is what keeps the flat sole flat, so a pose
 * only ever has to say where the foot should be.
 */
function legAt(side: 'L' | 'R', target: Vec2, geom?: LegGeometry, bob = 0): Pose {
  const [x, y] = target;
  if (!geom) {
    // No measured linkage (plain unit tests): drive the joints straight from the target.
    const swing = Math.atan2(x, Math.max(1, -y - 40));
    const flex = Math.max(0, y - 40) * 0.012;
    return {
      [`hip${side}`]: { angle: swing },
      [`knee${side}`]: { angle: -flex },
      [`ankle${side}`]: { angle: -swing + flex },
    };
  }
  const rest = geom.hipToKnee[1] + geom.kneeToAnkle[1];
  // `y` lifts the foot off the ground; `bob` raises the hip, so the stance foot would rise with
  // it and has to be pulled down by the same amount to stay planted.
  const solved = solveLeg(geom, [x, rest + y - bob]);
  return {
    [`hip${side}`]: { angle: solved.hip },
    [`knee${side}`]: { angle: solved.knee },
    [`ankle${side}`]: { angle: solved.ankle },
  };
}
/** Legs swing from the hip, fold at the knee and keep the sole flat without any tuning. */
const leg = (side: 'L' | 'R', phase: number, geom?: LegGeometry, bob = 0) =>
  legAt(side, footTarget(phase), geom, bob);
/** Ease in and out, so no joint starts or stops with a jolt. */
const smooth = (x: number) => {
  const v = Math.min(1, Math.max(0, x));
  return v * v * (3 - 2 * v);
};
/**
 * The shape every action below is built from: 0 → 1 over `rise`, held, then back to 0 over
 * `fall`. The rest of the cycle stays at rest, which is what makes each one loop cleanly.
 */
function arc(t: number, rise: number, hold: number, fall: number): number {
  if (t < rise) return smooth(t / rise);
  if (t < rise + hold) return 1;
  return 1 - smooth((t - rise - hold) / fall);
}
/** The trunk's pivot in the model frame: what a whole-body lean turns about. */
const PIVOT: Vec2 = [-6.2, -1];
/** The hip's own position, where every solved leg hangs from. */
const HIP_X = 3.9;
const HIP_Y = -17.5;
const GROUND = -106.5;
/**
 * Put the whole body on the floor: given the angle it has turned to, and the points that could
 * touch the ground, find the translation that rests the lowest of them on it and keeps that
 * contact from sliding. A body rolling onto its back pivots on its heels, then its rump, then
 * its shoulders — the contact moves, so no single fixed pivot can express it.
 */
function restOnFloor(angle: number, points: Vec2[]) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (p: Vec2) => PIVOT[1] + (p[0] - PIVOT[0]) * sin + (p[1] - PIVOT[1]) * cos;
  let lowest = Infinity;
  let contact = points[0];
  for (const p of points)
    if (at(p) < lowest) {
      lowest = at(p);
      contact = p;
    }
  const rolledX = PIVOT[0] + (contact[0] - PIVOT[0]) * cos - (contact[1] - PIVOT[1]) * sin;
  return { dx: contact[0] - rolledX, dy: GROUND - lowest };
}
/** How much of the cycle a leg spends in the air: 0 while planted, 1 at mid-swing. */
function swingWeight(phase: number): number {
  return Math.max(0, Math.sin(phase)) ** 0.8;
}
/**
 * The waddle. A duck's legs are short and set wide, so its weight cannot pass between its
 * feet: the trunk swings out over whichever foot is carrying it and the hips tip with it. The
 * hips sit about 54 mm either side of the trunk's centre, so a nine degree lean lifts one hip
 * and drops the other by more than a centimetre — each leg is told how far its own hip moved,
 * which is what keeps the planted foot on the ground while the pelvis rocks above it. The head
 * counter-rolls to hold its eyes level, the way a bird's does, and the roll and the travel
 * always point at the foot that has the weight.
 */
export function walk(t: number, legs?: Legs): Pose {
  const phase = (t / WALK_PERIOD) * TAU;
  const step = Math.sin(phase);
  const swingL = swingWeight(phase);
  const swingR = swingWeight(phase + Math.PI);
  /** +1 while the left foot is carrying the weight, -1 while the right one is. */
  const weight = Math.sin(phase);
  const roll = -0.21 * weight;
  const shift = -9 * weight;
  const bob = -1.5 * Math.cos(2 * phase);
  const half = legs ? (legs.L.hipOffset + legs.R.hipOffset) / 2 : 0;
  const rise = (side: 'L' | 'R') => Math.sin(roll) * half * (side === 'L' ? 1 : -1);
  // Rolling about the trunk instead of about the floor drags both feet the same way. The hips
  // open and close against that — the knee rotation a waddling bird uses — so the foot the duck
  // is standing on stays where it put it. `DRAG_ARM` is the roll's lever to the floor, `LEG` the
  // hip's to the foot; the result is about eight degrees either side of the built stance.
  const DRAG_ARM = PIVOT[1] - GROUND;
  const LEG = HIP_Y - GROUND;
  const kneeFix = (shift - DRAG_ARM * Math.sin(roll)) / LEG;
  return {
    // Roll and sideways travel, both leaning onto the foot that is carrying.
    root: { x: roll, dz: shift, dy: bob },
    // Each leg turns and opens a little as it lifts and closes as it plants, on top of the
    // fold its own hip needs to keep the foot where it was put.
    turnL: { angle: 0.05 * swingL },
    turnR: { angle: -0.05 * swingR },
    splayL: { angle: 0.04 * swingL - 0.018 * swingR + kneeFix },
    splayR: { angle: -0.04 * swingR + 0.018 * swingL - kneeFix },
    // The neck goes with the trunk; the head above it stays level.
    neckBase: { angle: 0 },
    neckPitch: { angle: 0 },
    headYaw: { angle: -0.05 * step },
    headPitch: { angle: -roll * 0.6 },
    ...leg('L', phase, legs?.L, rise('L') + bob),
    ...leg('R', phase + Math.PI, legs?.R, rise('R') + bob),
  };
}
/** How long each action runs, in seconds: long enough to read, short enough to loop. */
export const SIT_SECONDS = 6.4;
export const KICK_SECONDS = 2.6;
export const GRAB_SECONDS = 5.2;
export const RECOVER_SECONDS = 9.2;
/**
 * Sit and stand: the trunk settles onto its haunches while the legs fold under it, holds, then
 * pushes back up. The feet never move — the hips come down to them, and the leg servos fold by
 * exactly that much, which is the whole trick of sitting down on legs that cannot step sideways.
 */
export function sit(t: number, legs?: { L: LegGeometry; R: LegGeometry }): Pose {
  const k = arc(t, 1.6, 3.2, 1.6);
  const drop = 34 * k;
  return {
    // The trunk tips back a little on the way down, the way a resting bird settles.
    root: { z: 0.09 * k, dy: -drop },
    // The legs turn and open outward so the shins fold under the body rather than through it.
    turnL: { angle: 0.13 * k },
    turnR: { angle: -0.13 * k },
    splayL: { angle: 0.17 * k },
    splayR: { angle: -0.17 * k },
    // The neck keeps the head where it was, so the duck keeps looking at you as it sits.
    neckBase: { angle: -0.1 * k },
    neckPitch: { angle: -0.07 * k },
    ...legAt('L', [7 * k, drop], legs?.L),
    ...legAt('R', [7 * k, drop], legs?.R),
  };
}
/**
 * A boot: the right leg winds up, snaps forward and up, then drops back to a stand. One shot,
 * so the rest of the cycle is simply standing — which is what "straight back to walking" means
 * when the loop comes round again.
 */
export function kick(t: number, legs?: { L: LegGeometry; R: LegGeometry }): Pose {
  const boot = arc(t, 0.3, 0.16, 0.6);
  const lean = arc(t, 0.3, 0.6, 0.9);
  // The trunk drops as it leans, so both feet are solved for a hip that much lower.
  const ground = 8 * lean;
  return {
    // The body drops and leans into the boot; the head follows the foot out and back.
    root: { z: 0.07 * lean, dy: -ground },
    neckBase: { angle: -0.22 * lean },
    neckPitch: { angle: -0.1 * lean },
    headPitch: { angle: 0.14 * boot - 0.06 * lean },
    // The stance leg tucks under as the body leans into the kick.
    ...legAt('L', [-7 * lean, ground], legs?.L),
    ...legAt('R', [-20 + 92 * boot, ground + 44 * boot], legs?.R),
  };
}
/**
 * Scoop: crouch, fold the neck until the beak is at the ground, close it, push back up. The beak
 * is this robot's only end effector, so the neck does the reaching and the body helps by
 * getting lower — the same trade the real duck makes when it picks something up.
 */
export function grab(t: number, legs?: { L: LegGeometry; R: LegGeometry }): Pose {
  const bend = arc(t, 1.5, 1.5, 1.6);
  // The beak closes once the head is down, holds the scoop, and lets go as the head comes up.
  const bite = arc(t - 2.1, 0.3, 0.8, 0.5);
  const drop = 44 * bend;
  return {
    // Everything the neck cannot reach, the body gets lower for. The fold stops near 100°:
    // past that the head tips so far that its own shell, not the beak, becomes the low point.
    root: { z: 0.17 * bend, dy: -drop },
    neckBase: { angle: -1.05 * bend },
    neckPitch: { angle: -0.66 * bend },
    // The jaw opens on the way down and closes on the scoop.
    jaw: { angle: -0.5 * bend + 0.46 * bite },
    ...legAt('L', [12 * bend, drop], legs?.L),
    ...legAt('R', [12 * bend, drop], legs?.R),
  };
}
export const RECOVER_FALL = 0.8;
export const RECOVER_ROCK = 4.6;
export const RECOVER_UP = 1.9;
/**
 * Knocked onto its back, then up again. Three things make this behave like a body rather than
 * like a lid on a hinge:
 *
 * - it turns about the heel it is standing on — the rearmost thing touching the floor — so that
 *   contact stays exactly where it is and nothing swings below the ground on the way over;
 * - the fall accelerates into the floor the way gravity makes it, instead of easing down;
 * - getting up is the legs reaching for the floor and the body rocking until it carries back
 *   over, not the fall played backwards.
 */
export function recover(t: number, legs?: Legs): Pose {
  const fall = Math.min(1, (t / RECOVER_FALL) ** 2);
  const rising =
    t <= RECOVER_FALL + RECOVER_ROCK ? 0 : smooth((t - RECOVER_FALL - RECOVER_ROCK) / RECOVER_UP);
  // Rocking, growing and fading across the time it spends down.
  const window =
    t > RECOVER_FALL && t < RECOVER_FALL + RECOVER_ROCK
      ? Math.sin(((t - RECOVER_FALL) / RECOVER_ROCK) * Math.PI)
      : 0;
  const rock = 0.14 * window * (1 - rising) * Math.sin((t - RECOVER_FALL) * 3.4);
  const down = Math.min(1, Math.max(0, fall * (1 - rising) + rock));
  const angle = 1.52 * down;
  // Legs cycle against thin air while it is down. Once the body is on its back its own
  // "forward" points at the sky, so reaching the feet out ahead is what lifts them up.
  const struggle = down * Math.sin(t * 5.6) ** 2;
  const air = 30 * down + 12 * struggle;
  const { dx, dy } = restOnFloor(angle, [
    // Where the feet have been solved to, and the corners of the trunk.
    [HIP_X + air, GROUND + 7 * struggle],
    [HIP_X + air - 9 * struggle, GROUND - 5 * struggle],
    [-47, -39],
    [-46, 42],
    [35, -1],
  ]);
  return {
    root: { z: angle, dx, dy },
    // The neck goes limp on the way over so the head rides up rather than scraping.
    neckBase: { angle: -0.34 * down - 0.12 * struggle },
    neckPitch: { angle: -0.3 * down },
    headPitch: { angle: 0.24 * struggle },
    jaw: { angle: -0.22 * struggle },
    ...legAt('L', [air, 7 * struggle], legs?.L),
    ...legAt('R', [air - 9 * struggle, -5 * struggle], legs?.R),
  };
}
/** One skate stride, in seconds. */
export const SKATE_PERIOD = 1.7;
/**
 * Skating: the duck rolls on its wheels and pushes off with one leg at a time, carrying its
 * weight over the leg that is gliding. Nothing steps — the wheels do the travelling — so a
 * foot only slides back under the body to push, then comes forward again just clear of the
 * floor the way a skater picks a foot up to bring it round. The wheels turn the whole time,
 * and the body rocks as it does when it waddles, without the lift of a step.
 */
export function skate(t: number, legs?: Legs): Pose {
  const phase = (t / SKATE_PERIOD) * TAU;
  const lean = Math.cos(phase);
  const roll = 0.12 * lean;
  const shift = 7 * lean;
  const bob = -1.2 * Math.cos(2 * phase);
  const half = legs ? (legs.L.hipOffset + legs.R.hipOffset) / 2 : 0;
  const rise = (side: 'L' | 'R') => Math.sin(roll) * half * (side === 'L' ? 1 : -1);
  const DRAG_ARM = PIVOT[1] - GROUND;
  const LEG = HIP_Y - GROUND;
  const kneeFix = (shift - DRAG_ARM * Math.sin(roll)) / LEG;
  /** One skate: pushing slides it back under the body, the return carries it forward again. */
  const stride = (side: 'L' | 'R'): Vec2 => {
    const u = (((phase / TAU) % 1) + 1) % 1;
    const v = side === 'L' ? u : (u + 0.5) % 1;
    if (v < 0.55) return [14 - 46 * (v / 0.55), 0];
    const back = (v - 0.55) / 0.45;
    return [-32 + 46 * smooth(back), 6 * Math.sin(Math.PI * back)];
  };
  const skateFoot = (side: 'L' | 'R') => {
    const [x, y] = stride(side);
    return legAt(side, [x, y], side === 'L' ? legs?.L : legs?.R, rise(side) + bob);
  };
  // The wheels turn as the duck travels; an in-place loop just keeps turning them.
  const wheel = -t * 11;
  return {
    root: { x: roll, dz: shift, dy: bob },
    turnL: { angle: 0.09 * lean },
    turnR: { angle: -0.09 * lean },
    splayL: { angle: kneeFix },
    splayR: { angle: -kneeFix },
    neckBase: { angle: 0 },
    neckPitch: { angle: 0 },
    headYaw: { angle: 0.04 * Math.sin(phase) },
    headPitch: { angle: -roll * 0.6 },
    ...skateFoot('L'),
    ...skateFoot('R'),
    wheelLF: { angle: wheel },
    wheelLR: { angle: wheel },
    wheelRF: { angle: wheel },
    wheelRR: { angle: wheel },
  };
}
/** Two quick head turns, easing in and out. */
export function shake(t: number): Pose {
  const envelope = Math.sin((t / 2.4) * Math.PI) ** 0.5;
  const yaw = Math.sin((t / 0.32) * TAU) * 0.5 * envelope;
  return {
    headYaw: { angle: yaw },
    neckBase: { angle: yaw * 0.22 },
    headPitch: { angle: 0.07 * envelope },
  };
}
/** How long the head tilt is held, in seconds. */
export const TILT_SECONDS = 2.7;
/**
 * A curious head tilt: the head's own servo leans it over to one side, holds, and comes back.
 * That servo's measured horn axis runs fore-and-aft, so this is a roll — the head turning its
 * ear down, which is the one lean this neck actually has. The neck adds a little of its own.
 */
export function tilt(t: number): Pose {
  const ramp = Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (TILT_SECONDS - t) / 0.5));
  const hold = ramp * ramp * (3 - 2 * ramp);
  return {
    headPitch: { angle: -0.38 * hold },
    headYaw: { angle: 0.13 * hold },
    neckPitch: { angle: 0.06 * hold },
  };
}
/** Beak opening and closing, with a small head tilt. */
export function beak(t: number): Pose {
  const phase = (t / 2.2) * TAU;
  const open = Math.max(0, Math.sin(phase)) ** 0.7;
  return {
    jaw: { angle: -0.42 * open },
    headPitch: { angle: -0.05 * open },
    neckPitch: { angle: 0.04 * open },
  };
}
/** Both legs' measured linkages, as `viewer.legs` reports them. */
export type Legs = { L: LegGeometry; R: LegGeometry };
export const motionPoses: Record<MotionName, (t: number, legs?: Legs) => Pose> = {
  walk,
  skate,
  sit,
  kick,
  grab,
  recover,
  shake,
  tilt,
  beak,
};
export const MOTION_LABELS: Record<MotionName, string> = {
  walk: '走路',
  skate: '滑行',
  sit: '坐下站起',
  kick: '踢一下',
  grab: '叼一口',
  recover: '翻身站起',
  shake: '摇头',
  tilt: '歪头',
  beak: '张嘴',
};
/**
 * Default loop: walk a while, stop to look around, walk on, shift its weight, walk, then
 * open and close its beak. Walk legs are whole stride pairs so the loop never jumps.
 */
export type SequenceStep = { motion: MotionName; duration: number };
export const MOTION_SEQUENCE: SequenceStep[] = [
  { motion: 'walk', duration: WALK_PERIOD * 7 },
  { motion: 'shake', duration: 2.4 },
  { motion: 'walk', duration: WALK_PERIOD * 8 },
  { motion: 'beak', duration: 2.2 },
];
export const SEQUENCE_DURATION = MOTION_SEQUENCE.reduce((total, s) => total + s.duration, 0);
/** Which motion plays at `t` seconds into the default loop, and how far into it. */
export function sequenceAt(t: number): { motion: MotionName; local: number } {
  let rest = ((t % SEQUENCE_DURATION) + SEQUENCE_DURATION) % SEQUENCE_DURATION;
  for (const entry of MOTION_SEQUENCE) {
    if (rest < entry.duration) return { motion: entry.motion, local: rest };
    rest -= entry.duration;
  }
  const last = MOTION_SEQUENCE[MOTION_SEQUENCE.length - 1];
  return { motion: last.motion, local: last.duration };
}
/** Pose of the default loop at `t`, or of a single motion when one is chosen. */
export function poseAt(t: number, motion: MotionName | 'sequence', legs?: Legs): Pose {
  if (motion === 'sequence') {
    const step = sequenceAt(t);
    return motionPoses[step.motion](step.local, legs);
  }
  return motionPoses[motion](t, legs);
}
/** Blend two poses. Used to cross-fade when a motion starts, changes or stops. */
export function blendPose(from: Pose, to: Pose, ratio: number): Pose {
  const t = Math.max(0, Math.min(1, ratio));
  const out: Pose = {};
  for (const joint of new Set([...Object.keys(from), ...Object.keys(to)]) as Set<JointName>) {
    const a = from[joint] || {};
    const b = to[joint] || {};
    out[joint] = {
      angle: (a.angle || 0) + ((b.angle || 0) - (a.angle || 0)) * t,
      x: (a.x || 0) + ((b.x || 0) - (a.x || 0)) * t,
      y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t,
      z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t,
      dx: (a.dx || 0) + ((b.dx || 0) - (a.dx || 0)) * t,
      dy: (a.dy || 0) + ((b.dy || 0) - (a.dy || 0)) * t,
      dz: (a.dz || 0) + ((b.dz || 0) - (a.dz || 0)) * t,
    };
  }
  return out;
}
/** Seconds a motion change takes to cross-fade. */
export const BLEND_SECONDS = 0.35;
