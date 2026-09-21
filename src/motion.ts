/**
 * Motions for the assembly: a joint rig driven by time, with no skeleton in the model.
 * Each joint is one servo, so every rotation happens about that servo's horn — the only
 * thing on the robot that can actually turn. `src/models/active.ts` says which servo drives
 * which parts; `src/viewer.ts` measures the horns and applies the angles.
 */
export const MOTIONS = ['walk', 'shake', 'beak'] as const;
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
  | 'ankleR';
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
/** Legs swing from the hip, fold at the knee and keep the sole flat without any tuning. */
function leg(side: 'L' | 'R', phase: number, geom?: LegGeometry, bob = 0): Pose {
  if (!geom) {
    // No measured linkage (plain unit tests): a rough approximation of the same gait.
    const swing = 0.34 * Math.sin(phase);
    const flex = Math.max(0, Math.cos(phase)) ** 1.4 * 0.45;
    return {
      [`hip${side}`]: { angle: swing },
      [`knee${side}`]: { angle: -flex },
      [`ankle${side}`]: { angle: -swing + flex * 0.85 },
    };
  }
  const rest = geom.hipToKnee[1] + geom.kneeToAnkle[1];
  const [x, y] = footTarget(phase);
  // `y` lifts the swinging foot; `bob` raises the hip, so the stance foot would rise with it
  // and has to be pulled down by the same amount to stay planted on the ground.
  const solved = solveLeg(geom, [x, rest + y - bob]);
  return {
    [`hip${side}`]: { angle: solved.hip },
    [`knee${side}`]: { angle: solved.knee },
    [`ankle${side}`]: { angle: solved.ankle },
  };
}
/** How much of the cycle a leg spends in the air: 0 while planted, 1 at mid-swing. */
function swingWeight(phase: number): number {
  return Math.max(0, Math.sin(phase)) ** 0.8;
}
/**
 * Walking in place with the trunk held steady. Nothing moves the body itself: balance is
 * carried by the hips and legs, and whatever is left shows up as a neck-and-head sway, the
 * way a walking bird settles its head over its feet. Feet point straight ahead between steps.
 */
export function walk(t: number, legs?: { L: LegGeometry; R: LegGeometry }): Pose {
  const phase = (t / WALK_PERIOD) * TAU;
  const step = Math.sin(phase);
  const lift = Math.sin(2 * phase);
  const swingL = swingWeight(phase);
  const swingR = swingWeight(phase + Math.PI);
  return {
    // The trunk middle stays put; there is deliberately no body bob or lean here.
    root: { x: 0, y: 0, z: 0, dy: 0 },
    // Hips do the adjusting: each leg turns and opens slightly as it lifts, and closes as
    // it plants, which is what keeps the stance foot under a motionless trunk.
    turnL: { angle: 0.05 * swingL },
    turnR: { angle: -0.05 * swingR },
    splayL: { angle: 0.04 * swingL - 0.018 * swingR },
    splayR: { angle: -0.04 * swingR + 0.018 * swingL },
    // The neck is locked to the trunk and does not move on its own; the head above it is
    // what shifts, which is how the weight reads without the body ever wobbling.
    neckBase: { angle: 0 },
    neckPitch: { angle: 0 },
    headYaw: { angle: -0.06 * step },
    headPitch: { angle: 0.05 * lift },
    ...leg('L', phase, legs?.L, 0),
    ...leg('R', phase + Math.PI, legs?.R, 0),
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
export const motionPoses: Record<MotionName, (t: number) => Pose> = {
  walk,
  shake,
  beak,
};
export const MOTION_LABELS: Record<MotionName, string> = {
  walk: '走路',
  shake: '摇头',
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
export function poseAt(
  t: number,
  motion: MotionName | 'sequence',
  legs?: { L: LegGeometry; R: LegGeometry },
): Pose {
  if (motion === 'sequence') {
    const step = sequenceAt(t);
    return step.motion === 'walk' ? walk(step.local, legs) : motionPoses[step.motion](step.local);
  }
  return motion === 'walk' ? walk(t, legs) : motionPoses[motion](t);
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
