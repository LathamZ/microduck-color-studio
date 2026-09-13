import type { Finish, Lighting, Manifest, Palette, Surface } from './domain';
import type { Inventory, Recommendation, RecommendationMode } from './recommend';
/** Explicit same-page API. All mutation methods use the editor's shared validator/history. */
export interface ColorStudioAPI {
  readonly version: 1;
  getModel(): Manifest;
  getPalette(): Palette;
  importPalette(value: unknown): Palette;
  updateParts(ids: string[], patch: Partial<Finish>): Palette;
  setLighting(patch: Partial<Lighting>): Palette;
  setSurface(surface: Surface): Palette;
  selectPart(id: string): void;
  setView(name: string): void;
  undo(): void;
  redo(): void;
  getInventory(): Inventory;
  setInventory(value: unknown): Inventory;
  recommend(mode?: RecommendationMode): Recommendation[];
}
declare global {
  interface Window {
    readonly colorStudio?: ColorStudioAPI;
  }
}
