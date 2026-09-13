/** Capability/viewport hint, not a promise that every phone supports WebGL2. */
export const mobilePreview = () => matchMedia('(max-width: 760px), (pointer: coarse)').matches;
