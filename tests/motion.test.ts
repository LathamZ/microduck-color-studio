import { describe, it, expect } from 'vitest';
import {
  GRAB_SECONDS,
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
  ankleToSole: 7.6,
  hipOffset: 54.3,
};
const LEGS = { L: LEG, R: LEG };
/** The hip's height in the model, which is where a solved leg hangs from. */
const HIP_Y = -17.5;
const GROUND = -89;
/** The trunk's pivot, which a whole-body roll turns about. */
const PIVOT_Y = -1;
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
      expect(Math.abs(worldSole(pose, stance) - GROUND)).toBeLessThan(2);
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
