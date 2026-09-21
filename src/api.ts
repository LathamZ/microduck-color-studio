import type { PrintMatchState, PrintSetup } from './print-ui';
import type { PrintAssignment, PrintOptions, PrintPlan } from './print-project';
import type { Finish, Lighting, Manifest, Palette, Surface } from './domain';
import type { SavedLook } from './looks';
import type { JointName, MotionName } from './motion';
import type {
  Inventory,
  Recommendation,
  RecommendationMode,
  RecommendationOptions,
} from './recommend';
/** Explicit same-page API. All mutation methods use the editor's shared validator/history. */
export interface ColorStudioAPI {
  readonly version: 1;
  importPrintModel(bytes: Uint8Array, name: string): Promise<PrintSetup>;
  getPrintSetup(): Promise<PrintSetup>;
  /** Object-to-part match confidence. Unmatched objects keep their source colors. */
  getPrintMatches(): Promise<PrintMatchState[]>;
  configurePrint(assignments: PrintAssignment[], options: PrintOptions): Promise<PrintPlan>;
  planPrint(): Promise<PrintPlan>;
  exportPrint(): Promise<Uint8Array>;
  getModel(): Manifest;
  getPalette(): Palette;
  importPalette(value: unknown): Palette;
  updateParts(ids: string[], patch: Partial<Finish>): Palette;
  setLighting(patch: Partial<Lighting>): Palette;
  setSurface(surface: Surface): Palette;
  selectPart(id: string): void;
  /** Play the default loop, one named motion, or stop with null. Returns what is playing. */
  playMotion(name: MotionName | 'sequence' | null): MotionName | 'sequence' | null;
  /** Measured joints: servo axis, horn pivot and the parts each one drives. */
  getRig(): {
    id: JointName;
    parent: JointName | 'root';
    axis: [number, number, number];
    pivot: [number, number, number];
    parts: string[];
  }[];
  setView(name: string): void;
  undo(): void;
  redo(): void;
  getInventory(): Inventory;
  setInventory(value: unknown): Inventory;
  recommend(mode?: RecommendationMode, options?: RecommendationOptions): Recommendation[];
  getLooks(): SavedLook[];
  saveLook(name: string): SavedLook[];
  applyLook(id: string): Palette;
}
declare global {
  interface Window {
    readonly colorStudio?: ColorStudioAPI;
  }
}
