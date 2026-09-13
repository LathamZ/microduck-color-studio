/** Bed coordinates from Bambu Studio's bundled BBL machine profiles (2026-09).
 * Insets conservatively avoid P1S's front-left exclusion and use the shared
 * nozzle reach on dual-nozzle printers. Full bed dimensions determine plate spacing.
 */
export const PRINTERS = [
  {
    id: 'p1s',
    name: 'Bambu Lab P1S',
    width: 256,
    depth: 256,
    height: 250,
    left: 18,
    right: 0,
    bottom: 0,
    top: 0,
    nozzles: 1,
  },
  {
    id: 'h2d',
    name: 'Bambu Lab H2D',
    width: 350,
    depth: 320,
    height: 325,
    left: 25,
    right: 25,
    bottom: 0,
    top: 0,
    nozzles: 2,
  },
  {
    id: 'a1-mini',
    name: 'Bambu Lab A1 mini',
    width: 180,
    depth: 180,
    height: 180,
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    nozzles: 1,
  },
  {
    id: 'x2d',
    name: 'Bambu Lab X2D',
    width: 256,
    depth: 256,
    height: 261,
    left: 20.5,
    right: 0,
    bottom: 0,
    top: 0,
    nozzles: 2,
  },
] as const;
export const printerById = (id?: string) => PRINTERS.find((p) => p.id === id);
