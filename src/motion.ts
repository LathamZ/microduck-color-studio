/**
 * Motions for the assembly: a joint rig driven by time, with no skeleton in the model.
 * Each joint is one servo, so every rotation happens about that servo's horn — the only
 * thing on the robot that can actually turn. `src/models/active.ts` says which servo drives
 * which parts; `src/viewer.ts` measures the horns and applies the angles.
 */
export const MOTIONS = [
  'walk',
  'skate',
  'sprint',
  'turn',
  'brake',
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
/**
 * How near the floor a point has to be to hold the body back, in millimetres. Generous on
 * purpose: the body sliding from one contact onto the next should be a move, not a step.
 */
const ANCHOR_SPAN = 14;
function restOnFloor(angle: number, points: Vec2[], pin?: { at: Vec2; x: number }) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (p: Vec2): Vec2 => [
    PIVOT[0] + (p[0] - PIVOT[0]) * cos - (p[1] - PIVOT[1]) * sin,
    PIVOT[1] + (p[0] - PIVOT[0]) * sin + (p[1] - PIVOT[1]) * cos,
  ];
  let lowest = Infinity;
  for (const p of points) lowest = Math.min(lowest, at(p)[1]);
  // The body is carried by whatever is nearest the floor, and every near contact holds it back
  // a little. Picking the one lowest point instead would make the body jump sideways the
  // instant the weight moved from one contact to the next. A contact holds the body at its own
  // place on the body — a part that is not moving does not slide — unless it is pinned, which
  // is for a contact that is itself moving over the ground and must stay put anyway.
  let weight = 0;
  let anchor = 0;
  for (const p of points) {
    const w = Math.exp(-(at(p)[1] - lowest) / ANCHOR_SPAN);
    weight += w;
    anchor += w * ((pin && p === pin.at ? pin.x : p[0]) - at(p)[0]);
  }
  return { dx: anchor / weight, dy: GROUND - lowest };
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
export const RECOVER_DOWN = 1;
export const RECOVER_PRESS = 1.4;
export const RECOVER_UP = 2.4;
export const RECOVER_SETTLE = 1.2;
export const RECOVER_SECONDS =
  RECOVER_FALL + RECOVER_DOWN + RECOVER_PRESS + RECOVER_UP + RECOVER_SETTLE;
/** The neck's own geometry in the trunk's frame: the two joints it turns about. */
const NECK_BASE: Vec2 = [26, 32.5];
const NECK_PITCH: Vec2 = [26, 82.3];
/** The back-top corner of the head: what lands on the floor when the neck folds over. */
const HEAD_BACK: Vec2 = [-30.4, 157.4];
/** How much further the neck leans on the head once it is down, and how far it straightens. */
const FOLD_PRESS = 0.22;
const FOLD_RISE = 0.8;
/** How the fold is shared between the neck's two joints: the base turns, the pitch curls. */
const CURL = 0.55;
/** Past this the head has swung under the body and is coming back up, so the search stays here. */
const FOLD_ON_FLOOR = 1.4;
/** How far the sole reaches behind and ahead of the ankle, measured off the foot. */
const HEEL = -19.9;
const TOE = 34;
/** Corners of the trunk, which take the weight whenever the duck is not on its feet. */
const TRUNK_POINTS: Vec2[] = [
  [-47, -39],
  [-46, 42],
  [35, 0],
];
/** The head's back corner for a neck folded over by `fold` and curled by `curl`. */
function headCorner(fold: number, curl: number): Vec2 {
  const over = rotate([HEAD_BACK[0] - NECK_PITCH[0], HEAD_BACK[1] - NECK_PITCH[1]], curl);
  const bent = rotate(
    [NECK_PITCH[0] + over[0] - NECK_BASE[0], NECK_PITCH[1] + over[1] - NECK_BASE[1]],
    fold,
  );
  return [NECK_BASE[0] + bent[0], NECK_BASE[1] + bent[1]];
}
/** Where the trunk sits while it lies on its back. */
const FALL_ANGLE = 1.52;
/**
 * The ankle as built, read off the linkage: `x` is where it sits along the trunk, `y` how far
 * below the hip. The ankle is well behind the hip, so a target that only says "level with the
 * hip" would put the foot 36 mm forward of where the duck actually stands.
 */
const ankleBuilt = (legs?: Legs): Vec2 => [
  legs ? legs.L.hipToKnee[0] + legs.L.kneeToAnkle[0] : 0,
  legs ? legs.L.hipToKnee[1] + legs.L.kneeToAnkle[1] : 0,
];
/**
 * The head lands where it lands. Both the fold that puts it on the floor and the spot it
 * touches are read off the lying pose once, so the press can hold the head exactly where it
 * arrived — the neck folding further is then what lifts the body, and the head never skates
 * across the floor while it does.
 */
const HEAD_LANDS = (() => {
  const rump = restOnFloor(FALL_ANGLE, TRUNK_POINTS);
  const reach = (fold: number) => {
    const corner = headCorner(fold, CURL * fold);
    const r = rotate([corner[0] - PIVOT[0], corner[1] - PIVOT[1]], FALL_ANGLE);
    return { y: PIVOT[1] + r[1] + rump.dy, x: PIVOT[0] + r[0] + rump.dx };
  };
  let lo = 0;
  let hi = FOLD_ON_FLOOR;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (reach(mid).y > GROUND) lo = mid;
    else hi = mid;
  }
  return { fold: (lo + hi) / 2, ...reach((lo + hi) / 2) };
})();
/**
 * Knocked onto its back, then up again the only way a duck with a neck this long can do it: it
 * rolls its head back, presses the back of its head onto the floor and rides its own neck up
 * until its feet are under it again. It cannot simply stand back up — its legs are in the air.
 *
 * Three things make this behave like a body rather than a lid on a hinge:
 *
 * - it turns about whatever is actually touching the floor — the soles, then the rump, then the
 *   back of its head, then the soles again — so nothing swings below the ground on the way over;
 * - the fall accelerates into the floor the way gravity makes it, instead of easing down;
 * - the press is what lifts it. Folding the neck further drives the head down, and the body
 *   rides up on it: the head stays on the floor, the trunk comes up over it, and the feet reach
 *   for the floor underneath. The head only leaves the ground once they are carrying it.
 */
export function recover(t: number, legs?: Legs): Pose {
  const fall = Math.min(1, (t / RECOVER_FALL) ** 2);
  const down = smooth((t - RECOVER_FALL) / RECOVER_DOWN);
  const press = smooth((t - RECOVER_FALL - RECOVER_DOWN) / RECOVER_PRESS);
  const rise = smooth((t - RECOVER_FALL - RECOVER_DOWN - RECOVER_PRESS) / RECOVER_UP);
  const settle = smooth(
    (t - RECOVER_FALL - RECOVER_DOWN - RECOVER_PRESS - RECOVER_UP) / RECOVER_SETTLE,
  );
  // Over onto its back and held there while the neck gathers, then up on the head. The neck
  // unfolds over the second half of the rise, so the head is off the floor before the legs
  // take the weight and the duck is left standing as built.
  const angle = FALL_ANGLE * fall * (1 - 0.84 * rise - 0.16 * settle);
  // The neck folds the head down to the floor and leans on it, then straightens: with the head
  // pinned, unfolding is what drives the trunk up and forward, which is the whole way up this
  // duck has. Folding further would only drag the body back along the floor.
  const fold = Math.max(0, (HEAD_LANDS.fold + FOLD_PRESS) * press - FOLD_RISE * rise);
  const curl = CURL * fold;
  const head = headCorner(fold, curl);
  // Legs cycle against thin air while it is down: once the body is on its back its own
  // "forward" points at the sky, so reaching the feet out ahead is what lifts them up. As it
  // starts to rise they swing back under the hips and take the floor again.
  const struggle = down * (1 - press) * Math.sin(t * 5.6) ** 2;
  const reach = smooth((rise - 0.08) / 0.55);
  const rest = legs ? legs.L.hipToKnee[1] + legs.L.kneeToAnkle[1] : 0;
  const soleDrop = legs?.L.ankleToSole ?? 25;
  const built = ankleBuilt(legs);
  // Both the ankle target and the sole it carries are in the trunk's frame, so the floor has to
  // be told about them exactly where they are: a foot placed a millimetre out of true reads as
  // a sole through the floor once the body is leaning.
  const ankleAt = (i: number): Vec2 => {
    // Planted is the leg as built, which is how the duck ends the action standing: the body is
    // then placed on the soles rather than the soles on the body.
    const air: Vec2 = [built[0] + 55 * down + [16, 6][i] * struggle, [7, -5][i] * struggle];
    return [air[0] + (built[0] - air[0]) * reach, air[1] * (1 - reach)];
  };
  const ground = restOnFloor(
    angle,
    [
      head,
      ...TRUNK_POINTS,
      // A sole is a footprint, not a point: leaning the trunk tips it, and it is the heel or
      // the toe that reaches the floor first.
      ...[0, 1].flatMap((i) => {
        const ankle = ankleAt(i);
        const y = HIP_Y + rest + ankle[1] - soleDrop;
        return [[HIP_X + ankle[0] + HEEL, y] as Vec2, [HIP_X + ankle[0] + TOE, y] as Vec2];
      }),
    ],
    // While the head is on the floor it is the neck folding that moves the body, not the head.
    fold > 0 ? { at: head, x: HEAD_LANDS.x } : undefined,
  );
  return {
    root: { z: angle, dx: ground.dx, dy: ground.dy },
    // The head goes over on the neck, and the jaw works while it struggles.
    neckBase: { angle: fold + 0.06 * struggle * Math.sin(t * 7) },
    neckPitch: { angle: curl },
    headPitch: { angle: 0.12 * struggle - 0.1 * settle },
    jaw: { angle: -0.22 * struggle },
    ...legAt('L', ankleAt(0), legs?.L),
    ...legAt('R', ankleAt(1), legs?.R),
  };
}
/** One skate stride, in seconds. */
export const SKATE_PERIOD = 1.7;
export const SPRINT_PERIOD = 0.95;
export const TURN_PERIOD = 2.4;
/**
 * Skating: the duck rolls on its wheels and pushes off with one leg at a time, carrying its
 * weight over the leg that is gliding. Nothing steps — the wheels do the travelling — so a
 * foot only slides back under the body to push, then comes forward again just clear of the
 * floor the way a skater picks a foot up to bring it round. The wheels turn the whole time,
 * and the body rocks as it does when it waddles, without the lift of a step.
 */
/** The lean, travel and hip fix-ups every skating action shares. */
function skateFrame(phase: number, lean: number, legs: Legs | undefined, amount: number) {
  const roll = amount * lean;
  const shift = 7 * lean;
  const half = legs ? (legs.L.hipOffset + legs.R.hipOffset) / 2 : 0;
  return {
    roll,
    shift,
    bob: -1.2 * Math.cos(2 * phase),
    rise: (side: 'L' | 'R') => Math.sin(roll) * half * (side === 'L' ? 1 : -1),
    kneeFix: (shift - (PIVOT[1] - GROUND) * Math.sin(roll)) / (HIP_Y - GROUND),
  };
}
/** How far a wheel rolls: one circumference per stride. */
const wheelRoll = (t: number, period: number) => (-t * TAU * 26) / period;
/** A quicker cadence: the same stride, crouched lower and leaning into it. */
export function sprint(t: number, legs?: Legs): Pose {
  const phase = (t / SPRINT_PERIOD) * TAU;
  const { roll, shift, bob, rise, kneeFix } = skateFrame(phase, Math.cos(phase), legs, 0.16);
  const crouch = 11;
  const foot = (side: 'L' | 'R') => {
    const wheel = side === 'L' ? legs?.L : legs?.R;
    const v = (side === 'L' ? (phase / TAU) % 1 : ((phase / TAU) % 1) + 0.5) % 1;
    const x = v < 0.5 ? 12 - 34 * (v / 0.5) : -22 + 34 * smooth((v - 0.5) / 0.5);
    const y = v < 0.5 ? 0 : 5 * Math.sin(Math.PI * ((v - 0.5) / 0.5));
    return legAt(side, [x, y + crouch], wheel, rise(side) + bob + crouch);
  };
  return {
    root: { x: 0.1 + roll, dz: shift, dy: bob - crouch },
    turnL: { angle: 0.12 * Math.cos(phase) },
    turnR: { angle: -0.12 * Math.cos(phase) },
    splayL: { angle: kneeFix },
    splayR: { angle: -kneeFix },
    neckBase: { angle: -0.16 },
    headPitch: { angle: -roll * 0.6 },
    ...foot('L'),
    ...foot('R'),
    wheelLF: { angle: wheelRoll(t, SPRINT_PERIOD) },
    wheelLR: { angle: wheelRoll(t, SPRINT_PERIOD) },
    wheelRF: { angle: wheelRoll(t, SPRINT_PERIOD) },
    wheelRR: { angle: wheelRoll(t, SPRINT_PERIOD) },
  };
}
/**
 * Carving: the duck slaloms on its edges, leaning into each corner while the skates swing out
 * to the side of the lean and back under it, the way a skater's feet do through a turn.
 */
export function turn(t: number, legs?: Legs): Pose {
  const phase = (t / TURN_PERIOD) * TAU;
  const lean = Math.sin(phase);
  const { roll, shift, bob, rise, kneeFix } = skateFrame(phase, lean, legs, 0.2);
  const carve = 16 * lean;
  const foot = (side: 'L' | 'R') =>
    legAt(
      side,
      [side === 'L' ? carve : -carve * 0.6, 0],
      side === 'L' ? legs?.L : legs?.R,
      rise(side) + bob,
    );
  return {
    root: { x: roll, y: 0.2 * lean, dz: shift, dy: bob },
    // The skates point where they are travelling, and the head looks into the corner.
    turnL: { angle: 0.35 + 0.2 * lean },
    turnR: { angle: -0.35 + 0.2 * lean },
    splayL: { angle: kneeFix },
    splayR: { angle: -kneeFix },
    headYaw: { angle: -0.2 * lean },
    headPitch: { angle: -roll * 0.5 },
    ...foot('L'),
    ...foot('R'),
    wheelLF: { angle: wheelRoll(t, TURN_PERIOD) },
    wheelLR: { angle: wheelRoll(t, TURN_PERIOD) },
    wheelRF: { angle: wheelRoll(t, TURN_PERIOD) },
    wheelRR: { angle: wheelRoll(t, TURN_PERIOD) },
  };
}
/**
 * Braking: the skates whip sideways across the direction of travel and the duck sits back
 * against them until it stops, then straightens up and rolls on. One arc, so it loops.
 */
export function brake(t: number, legs?: Legs): Pose {
  const scrub = arc(t, 0.5, 1.4, 0.9);
  const crouch = 9 * scrub;
  const foot = (side: 'L' | 'R') =>
    legAt(side, [-4 * scrub, crouch], side === 'L' ? legs?.L : legs?.R, crouch);
  const skid = -t * 3 * (1 - scrub);
  return {
    // Sitting back against the skids is what stops him.
    root: { x: -0.14 * scrub, dy: -crouch },
    turnL: { angle: 0.9 * scrub },
    turnR: { angle: -0.9 * scrub },
    splayL: { angle: 0.12 * scrub },
    splayR: { angle: -0.12 * scrub },
    neckBase: { angle: 0.14 * scrub },
    headPitch: { angle: 0.1 * scrub },
    ...foot('L'),
    ...foot('R'),
    wheelLF: { angle: skid },
    wheelLR: { angle: skid },
    wheelRF: { angle: skid },
    wheelRR: { angle: skid },
  };
}
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
  sprint,
  turn,
  brake,
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
  sprint: '加速',
  turn: '转弯',
  brake: '刹车',
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
