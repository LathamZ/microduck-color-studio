import url from '../../models/mircroduck_feetech_revision.3mf?url';
import descriptor from './feetech-sample.json';
import type { PrintSample } from '../print-sample';

/** One manufacturing source, bundled lazily by Vite; never generated from the display GLB. */
export const feetechSample: PrintSample = { ...descriptor, url };
