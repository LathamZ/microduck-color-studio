// Replace this adapter when mounting another model.
import type { JointName } from '../motion';
export const manifestPath = 'models/parts.json';
export const presets = [
  { name: '暖白与橙', tag: '经典', colors: ['#F1EFE7', '#30343B', '#F28C28'] },
  { name: '鸭鸭黄', tag: '活力', colors: ['#F2C94C', '#30343B', '#EF7836'] },
  { name: '森林漫步', tag: '自然', colors: ['#8DAB8A', '#E9E4D4', '#C97543'] },
  { name: '深海信号', tag: '冷调', colors: ['#254D70', '#C7D5DC', '#3AC9BD'] },
  { name: '莓果奶油', tag: '柔和', colors: ['#ECC6C5', '#756577', '#D58464'] },
  { name: '月面探索', tag: '克制', colors: ['#DFE4E7', '#454E59', '#95B5AC'] },
];

/**
 * Which parts each joint moves and which servo turns them, for this model. The pivot is that
 * servo's horn, measured from the geometry, so every rotation happens where the robot can
 * actually rotate. A part named by a later joint leaves the joint that claimed it first.
 */
export type MotionJointSpec = {
  id: JointName;
  parent: JointName | 'root';
  /** Manifest assemblies whose parts follow this joint. */
  assemblies: string[];
  /** Single parts picked by source name. */
  sourceNames?: string[];
  /** Manifest id of the servo that drives this joint; its horn is the axis. */
  servo: string;
};
export const motionJoints: MotionJointSpec[] = [
  { id: 'neckBase', parent: 'root', assemblies: ['颈根'], servo: '07-02-xl330' },
  { id: 'neckPitch', parent: 'neckBase', assemblies: ['颈俯仰'], servo: '07-03-xl330' },
  { id: 'headYaw', parent: 'neckPitch', assemblies: ['头yaw-roll'], servo: '09-02-xl330' },
  { id: 'headPitch', parent: 'headYaw', assemblies: ['头部总成'], servo: '10-07-xl330' },
  {
    id: 'jaw',
    parent: 'headPitch',
    assemblies: [],
    sourceNames: ['jaw', 'jaw_soft'],
    servo: '10-03-xl330',
  },
  // Hip chain, in the order the robot is built: the trunk's yaw servo turns the whole leg,
  // the bracket's roll servo splays it, then the thigh, shin and foot servos pitch it.
  { id: 'turnL', parent: 'root', assemblies: ['左髋yaw-roll'], servo: '01-05-xl330' },
  { id: 'splayL', parent: 'turnL', assemblies: ['左髋roll'], servo: '02-02-xl330' },
  { id: 'hipL', parent: 'splayL', assemblies: ['左大腿'], servo: '04-05-xl330' },
  { id: 'kneeL', parent: 'hipL', assemblies: ['左小腿'], servo: '04-02-xl330' },
  { id: 'ankleL', parent: 'kneeL', assemblies: ['左踝脚'], servo: '05-02-xl330' },
  { id: 'turnR', parent: 'root', assemblies: ['右髋yaw-roll'], servo: '01-08-xl330' },
  { id: 'splayR', parent: 'turnR', assemblies: ['右髋roll'], servo: '11-02-xl330' },
  { id: 'hipR', parent: 'splayR', assemblies: ['右大腿'], servo: '13-05-xl330' },
  { id: 'kneeR', parent: 'hipR', assemblies: ['右小腿'], servo: '13-01-xl330' },
  { id: 'ankleR', parent: 'kneeR', assemblies: ['右踝脚'], servo: '14-01-xl330' },
];
