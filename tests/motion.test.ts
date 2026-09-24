import { describe, it, expect } from 'vitest';
import {
  GRAB_SECONDS,
  RECOVER_SECONDS,
  KICK_SECONDS,
  SIT_SECONDS,
  TILT_SECONDS,
  WALK_PERIOD,
  legForward,
  poseAt,
  type JointName,
  type LegGeometry,
  type Pose,
} from '../src/motion';

/** The linkage measured off the real assembly, so these numbers mean something. */
const LEG: LegGeometry = {
  hipToKnee: [-35.7, -21.9],
  kneeToAnkle: [0, -42],
  ankleToSole: 25.1,
  hipOffset: 54.3,
};
const LEGS = { L: LEG, R: LEG };
/** The hip's height in the model, which is where a solved leg hangs from. */
const HIP_Y = -17.5;
const GROUND = -106.5;
/** The trunk's pivot, which a whole-body roll turns about. */
const PIVOT = [-6.2, -1];
const PIVOT_Y = PIVOT[1];
/** The neck's own joints, and the corner of the head that lands on the floor. */
const NECK_BASE: [number, number] = [26, 32.5];
const NECK_PITCH: [number, number] = [26, 82.3];
const HEAD_BACK: [number, number] = [-30.4, 157.4];
const about = (p: readonly [number, number], c: readonly [number, number], a: number) => {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    c[0] + (p[0] - c[0]) * cos - (p[1] - c[1]) * sin,
    c[1] + (p[0] - c[0]) * sin + (p[1] - c[1]) * cos,
  ] as [number, number];
};
/** A point of the trunk placed on the floor for the pose it is in. */
const worldAt = (p: readonly [number, number], pose: Pose) => about(p, PIVOT, pose.root!.z || 0);
const worldY = (pose: Pose, p: readonly [number, number]) => worldAt(p, pose)[1] + pose.root!.dy!;
/** Where the sole sits, and how far ahead of the hip, for one leg of a pose. */
const foot = (pose: Pose, side: 'L' | 'R') => {
  const angle = (joint: JointName) => pose[joint]?.angle || 0;
  // `solveLeg` and `legForward` speak the same language: a rotation of the built linkage.
  return legForward(LEG, {
    hip: angle(`hip${side}`),
    knee: angle(`knee${side}`),
    ankle: angle(`ankle${side}`),
  });
};
/** How far the sole is off the floor, in model units: 0 is planted. */
const soleGap = (pose: Pose, side: 'L' | 'R') =>
  HIP_Y + pose.root?.dy! + foot(pose, side).sole[1] - GROUND;

/**
 * How high the sole ends up once the trunk transform is applied. A roll about the fore-and-aft
 * axis moves each foot vertically by its distance from the centre line, which is exactly what
 * the walk has to cancel to keep a planted foot planted.
 */
const worldSole = (pose: Pose, side: 'L' | 'R') => {
  const y = HIP_Y + foot(pose, side).sole[1] - PIVOT_Y;
  const z = (side === 'L' ? -1 : 1) * LEG.hipOffset;
  const roll = pose.root?.x || 0;
  return PIVOT_Y + pose.root!.dy! + y * Math.cos(roll) - z * Math.sin(roll);
};

describe('actions', () => {
  it('rocks the trunk over the planted foot without lifting it off the ground', () => {
    let lean = 0;
    let lifted = 0;
    for (let t = 0; t < WALK_PERIOD * 2; t += 0.02) {
      const pose = poseAt(t, 'walk', LEGS);
      lean = Math.max(lean, Math.abs(pose.root!.x!));
      // Left is planted through the first half of the cycle, right through the second.
      const stance: 'L' | 'R' = t % WALK_PERIOD < WALK_PERIOD / 2 ? 'L' : 'R';
      // Within 3 mm: the last of it is the second-order term the hip compensation drops.
      expect(Math.abs(worldSole(pose, stance) - GROUND)).toBeLessThan(3);
      lifted = Math.max(lifted, worldSole(pose, stance === 'L' ? 'R' : 'L') - GROUND);
    }
    // The free leg still swings clear of the floor at the middle of its half.
    expect(lifted).toBeGreaterThan(8);
    // And a waddle needs a visible rock, not a token one: nine degrees or so either way.
    expect(lean).toBeGreaterThan(0.14);
    expect(lean).toBeLessThan(0.3);
  });

  it('keeps both feet planted through sit and stand', () => {
    // The whole point of sitting on legs that cannot step sideways: the hips come down to the
    // feet, and the leg servos fold by exactly that much.
    for (let t = 0; t <= SIT_SECONDS; t += 0.1) {
      const pose = poseAt(t, 'sit', LEGS);
      expect(pose.root!.dy!).toBeLessThanOrEqual(0);
      for (const side of ['L', 'R'] as const) expect(Math.abs(soleGap(pose, side))).toBeLessThan(2);
    }
    expect(poseAt(SIT_SECONDS / 2, 'sit', LEGS).root!.dy).toBeLessThan(-30);
    expect(poseAt(SIT_SECONDS / 2, 'sit', LEGS).root!.dy).toBeGreaterThan(-40);
  });

  it('sends the kicking foot forward and up while the other leg holds', () => {
    const rest = foot(poseAt(0, 'kick', LEGS), 'R');
    const boot = poseAt(0.5, 'kick', LEGS);
    expect(foot(boot, 'R').ankle[0] - rest.ankle[0]).toBeGreaterThan(60);
    expect(soleGap(boot, 'R')).toBeGreaterThan(35);
    // The stance foot stays where it was, even though the trunk dropped to lean into the kick.
    expect(Math.abs(soleGap(boot, 'L'))).toBeLessThan(2);
    for (let t = 0; t <= KICK_SECONDS; t += 0.1)
      expect(soleGap(poseAt(t, 'kick', LEGS), 'L')).toBeLessThan(2);
  });

  it('crouches and opens the beak on the way down, then closes it on the scoop', () => {
    const down = poseAt(2.6, 'grab', LEGS);
    expect(down.root!.dy!).toBeLessThan(-40);
    expect(down.neckBase!.angle!).toBeLessThan(-1);
    expect(poseAt(2.0, 'grab', LEGS).jaw!.angle!).toBeLessThan(-0.3);
    expect(poseAt(2.9, 'grab', LEGS).jaw!.angle!).toBeGreaterThan(-0.15);
    for (const side of ['L', 'R'] as const) expect(Math.abs(soleGap(down, side))).toBeLessThan(2);
  });

  it('goes over backwards onto the floor instead of hanging above it', () => {
    // Corners of the trunk: what actually lands when the duck goes over backwards.
    const BODY: [number, number][] = [
      [-47, -39],
      [-46, 42],
      [35, 0],
    ];
    let resting = Infinity;
    for (let t = 0; t <= RECOVER_SECONDS; t += 0.05) {
      const pose = poseAt(t, 'recover', LEGS);
      const lows = BODY.map((p) => worldY(pose, p));
      // Nothing ever goes through the floor...
      expect(Math.min(...lows)).toBeGreaterThan(GROUND - 0.5);
      // ...and while it is on its back, some part of the trunk is on it.
      if ((pose.root!.z || 0) > 1.4) resting = Math.min(resting, Math.min(...lows) - GROUND);
    }
    expect(resting).toBeLessThan(2);
  });

  it('levers itself up on the back of its own head', () => {
    // Its legs are in the air when it is on its back, so the neck is the only thing it can push
    // with: the head has to reach the floor, and the trunk has to come up off it while the head
    // stays put. A duck that simply stood back up would fail both halves of this.
    const head = (pose: Pose) => {
      const over = about(HEAD_BACK, NECK_PITCH, pose.neckPitch?.angle || 0);
      return about(over, NECK_BASE, pose.neckBase?.angle || 0);
    };
    let pressed = 0;
    let held = 0;
    let lift = 0;
    for (let t = 0; t <= RECOVER_SECONDS; t += 0.05) {
      const pose = poseAt(t, 'recover', LEGS);
      const headY = worldY(pose, head(pose));
      const trunk = Math.min(
        ...[[-47, -39] as const, [35, 0] as const].map((p) => worldY(pose, p)),
      );
      // The head never scrapes through the floor on the way over...
      expect(headY).toBeGreaterThan(GROUND - 1);
      // ...and once the body is up on it the head is the contact, holding the trunk clear of
      // the floor. That press is the whole of the lifting.
      if (headY < GROUND + 1) {
        pressed++;
        held++;
        lift = Math.max(lift, trunk - GROUND);
      } else held = 0;
      expect(held).toBeLessThan(30);
    }
    // About a second on its head, holding the trunk a good 20 mm clear of the floor.
    expect(pressed).toBeGreaterThan(15);
    expect(lift).toBeGreaterThan(18);
    // And it is standing as built when the action ends, so the loop does not jump.
    const end = poseAt(RECOVER_SECONDS + 0.0001, 'recover', LEGS);
    expect(end.root!.z).toBeCloseTo(0, 5);
    expect(end.root!.dx).toBeCloseTo(0, 5);
    expect(end.root!.dy).toBeCloseTo(0, 5);
    expect(Math.abs(end.hipL!.angle!)).toBeLessThan(1e-3);
  });

  it('ends every cycle back where it started, so a loop never jumps', () => {
    for (const [motion, seconds] of [
      ['sit', SIT_SECONDS],
      ['kick', KICK_SECONDS],
      ['grab', GRAB_SECONDS],
      ['tilt', TILT_SECONDS],
    ] as const) {
      const start = poseAt(0, motion, LEGS);
      const end = poseAt(seconds * 4 + 0.0001, motion, LEGS);
      expect(JSON.stringify(end)).toBe(JSON.stringify(start));
    }
  });
});
