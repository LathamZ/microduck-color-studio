# Agent API v1

## Discover

- `models/parts.json`: model ID, stable part IDs, assemblies, roles, defaults and geometry provenance.
- `palette.schema.json`: portable JSON shape.
- `models/microduck.glb`: display geometry. Node names equal part IDs.
- Browser readiness: listen for `colorstudio:ready`, or check `window.colorStudio?.version === 1`.

## Browser interface

```js
const api = window.colorStudio;
const model = api.getModel(); // deep copy
const before = api.getPalette(); // complete, portable, deep copy
const ids = model.parts.filter((p) => p.role === 'primary').map((p) => p.id);
api.updateParts(ids, { color: '#F1EFE7', material: 'matte-pla' });
api.setLighting({ preset: 'warm', intensity: 1.2, azimuth: 45 });
api.setSurface({ layers: true });
api.selectPart(ids[0]);
api.setView('three-quarter'); // front | back | left | right | three-quarter
api.playMotion('sequence'); // walk | shake | beak | 'sequence' | null to stop
api.getRig(); // measured joints: parent, servo axis, horn pivot, driven parts
const result = api.getPalette();
api.undo();
api.redo();
api.importPalette(before); // validated atomically

// Saved looks live in this browser under `color-studio:looks:<modelId>`
api.getLooks(); // [{id, name, savedAt, palette}], newest first
api.saveLook('Evening warm'); // adds, or replaces the look with that name
api.applyLook(api.getLooks()[0].id); // commits through the shared validator and undo history
```

`updateParts`, `setLighting`, `setSurface` and `importPalette` return the resulting complete palette.
Passing `stockId` in an `updateParts` patch links a part to an item in the local filament inventory, so the part follows that spool's color and material. Any hand-picked `color` or `material` releases the link unless the same patch sets `stockId` again. They update the UI, render, local storage and undo history. Invalid mutations throw before changing state. Empty/no-op updates do not create history entries. `selectPart` throws for unknown IDs. `setView` uses the default view for an unknown view name.

Events: `colorstudio:change` carries a deep-copied palette in `event.detail`; `colorstudio:selection` carries `{id}`. These are local DOM events. Agents whose browser tools only allow read-only evaluation should use CLI plus the visible JSON import button.

## CLI

```sh
npm run -s palette -- parts [--role primary] [--model another/parts.json]
npm run -s palette -- new --out new-palette.json
npm run -s palette -- edit --in new-palette.json --patch changes.json --out revised-palette.json
npm run -s palette -- validate --in revised-palette.json
```

`--out` refuses to overwrite; omitting it prints JSON. No network or browser required. `--model` selects another compatible model pack. Each command has one result on stdout; errors are JSON on stderr, exit code 1. Use `npm run -s` to suppress npm's banner.

Patch example (replace the ID with an ID from the manifest):

```json
{
  "parts": { "10-06-top_head_shell": { "color": "#729D83", "material": "matte-pla" } },
  "lighting": { "preset": "daylight", "intensity": 1.1, "azimuth": -40 },
  "surface": { "layers": true },
  "name": "Forest daylight"
}
```

Materials: `pla`, `matte-pla`, `silk-pla`, `pla-cf`, `petg`, `matte-petg`, `metallic-petg`, `petg-cf`, `abs`, `asa`, `pc`, `pa`, `pa-cf`, `tpu`. Colors: exactly six hexadecimal digits after `#`. Intensity: 0.3–1.8; azimuth: −180–180 degrees; elevation: 5–85 degrees; light presets: `studio`, `daylight`, `warm`, `cinema`. `pattern` is stored for any preset but only re-aims the cinema stage: `butterfly`, `rembrandt`, `split`, `rim`; omit it for the preset's own placement. `cinema` puts the model on a black stage lit by its lamps alone.

The complete output is portable across browser and CLI. Camera angle/selection/isolation are inspection state and are not exported. Material keys on non-printable hardware are retained in the schema for uniformity, but hardware uses neutral hardware shading in the renderer; use material edits on printable parts.

## Inventory and recommendation API

```js
api.getInventory();
api.setInventory({
  schemaVersion: 1,
  items: [
    { id: 'my-white', name: 'White matte PLA', color: '#F1EFE7', material: 'matte-pla' },
    { id: 'my-black', name: 'Black TPU', color: '#30343B', material: 'tpu' },
  ],
});
const plans = api.recommend('paint'); // stock | add-one | paint
// Inspect plans[0].used, .missing, .paint and .complete first.
api.importPalette(plans[0].palette);
```

`setInventory` validates before mutation, saves locally, updates an open inventory panel, pushes changes onto every linked part, and returns a deep copy. `recommend` is read-only: it returns up to three distinct recommendation plans and does not apply a look. Its output includes the full palette, used stock IDs, explicit missing material requirements and proposed acrylic colors/part IDs. A missing material is never claimed to be owned. `complete` means no filament purchase is required; a paint plan can still require acrylic pens.

```sh
npm run -s palette -- inventory-validate --in examples/inventory.json
npm run -s palette -- recommend --inventory examples/inventory.json --mode add-one --out suggestions.json
```

Inventory schema: `inventory.schema.json`. Recommendation uses deterministic CIE76 Lab proximity to the adapter's curated palettes, enforces TPU/rigid separation and deduplicates identical results. It is a transparent heuristic, not a learned aesthetic evaluator. “Add one” limits discretionary color spools to one; missing essential material types are listed separately.

Recommended palettes carry a `stockId` for every part taken from stock, so applying a recommendation stays linked to the library.

Acrylic is a separate optional `coating: {kind:'acrylic',color:'#RRGGBB'}` on a part. `color` remains the actual filament color. Only model instances with `paintable:true` accept coatings. The Microduck adapter conservatively permits the hard jaw exterior only; soft TPU and bearing/contact parts are excluded. A base-color edit clears its coating. The renderer approximates coating across the whole permitted part, not brush strokes or printed masks. Validate adhesion on a sample before painting.

## Reproducible fresh combinations

`api.recommend(mode, {seed: 42})` generates new inventory-aware candidate combinations. The same inventory, base look, model and seed reproduce the same result. Seed is an integer in the range 0–4294967295. Omitting it uses the curated initial palettes. Distinct output looks are deduplicated; stock with few colors may not produce three alternatives.

The human **New ideas / 换一换** button chooses a fresh seed and uses this same API logic. Material compatibility, explicit missing-stock reporting and coating restrictions apply to generated combinations as well.

```sh
npm run -s palette -- recommend --inventory examples/inventory.json --mode stock --seed 42 --out ideas.json
```

CLI validation errors use stable `code: "VALIDATION_ERROR"` plus a human-readable English message by default. Use `--lang zh-CN` for Chinese error messages. Machine IDs, schema keys and saved user-entered names do not change with display language.

## Print model import and export

The print workflow is independent of the display mesh. No geometry is obtained from the GLB, and source files are never uploaded to a server. The lazy-loaded browser API uses a worker for XML/mesh processing and ZIP creation.

```ts
const setup = await api.importPrintModel(bytes, 'my-HD1910.3mf'); // Uint8Array
// Inspect source.objects: stable item IDs, original names, dimensions,
// matches (ranked part candidates with confidence), originalColor and originalMaterial.
const assignments = setup.assignments;
assignments[0] = {
  objectId: assignments[0].objectId,
  enabled: true,
  partId: '10-06-top_head_shell',
}; // Resolve the actual matching part ID first.
const plan = await api.configurePrint(assignments, {
  printerId: 'p1s',
  width: 256,
  depth: 256,
  height: 250,
  margin: 10,
  gap: 8,
  grouping: 'color',
});
const zipBytes = await api.exportPrint(); // Uint8Array; no automatic download
```

### Object-to-part matching

`source.objects[].matches` ranks printable parts by name similarity: case, separators, file extensions and numeric prefixes are ignored, and an object name that contains a part name still matches it (`ankle_left_v2` → `ankle_left`). Two parts that share a name are both returned with `ambiguous: true`.

- confidence ≥ `0.8` (`MATCH_ACCEPT`): applied as the object's part binding.
- `0.5`–`0.8`, or a tie between candidates: the closest candidate is applied and the row is marked with an amber `*` for the user to check.
- below `0.5` (`MATCH_FLOOR`), or no candidate above `0.15`: nothing is preselected, the row is marked with a red `*`, and the object keeps the color and material it came in with.

Nothing blocks the export. `exportPrint()` always runs; objects without a match are plated in their source colors, and `getPrintMatches()` lists what was applied so a caller can report or override it. `getPrintMatches()` returns the current state per object: `{objectId, name, partId, confidence, needsConfirm}`.

```js
api.getPrintMatches(); // audit: partId, confidence and whether a row is only a suggestion
```

`getPrintSetup()` returns a deep copy of the current source summary, assignments and options. `configurePrint()` validates the complete proposal and produces a plan before committing it. Every source object must have an explicit `enabled` decision. Each included object needs either `partId` (reads the current palette at planning/export time) or an independent `finish`. `grouping:'part'` additionally separates part IDs or independent source names. Materials and base colors are always separated; acrylic remains in `finish.coating` for post-processing.

`planPrint()` returns a deterministic plan without downloading. `exportPrint()` recalculates from current palette state and returns a ZIP containing one color-preserving multi-plate 3MF project, per-instance binary STL files and `print-plan.json`. No supports, source support painting, process profiles or G-code are carried forward. The source's orientation/scale is retained, with bed placement by translation. Oversize objects are rejected, never scaled. Dimensions and spacing are in millimeters; fit checks use axis-aligned footprints and do not predict supports/brims.

Supported inputs and resource limits are described in the README. Source meshes and assignments are session-only. Re-upload after a page reload. Agent browser tools may restrict mutations: respect their policy and use the human upload flow where required. No printer connection or print-start operation exists.

The `{assignments, options}` configuration is described by [`print-settings.schema.json`](https://lathamz.github.io/microduck-color-studio/print-settings.schema.json). Runtime checks additionally enforce source coverage, unique object IDs, exclusive part/finish assignment and build-area fit.

Printer presets are available as machine-readable [`printers.json`](https://lathamz.github.io/microduck-color-studio/printers.json). Set `printerId` to `p1s`, `h2d`, `a1-mini`, `x2d` or `custom`. Preset dimensions must match the catalog. Dimensions follow Bambu Studio machine profiles; usable heights can differ from advertised build volumes. Insets conservatively avoid excluded areas and use shared nozzle reach. The full bed dimensions determine plate origins, independently of packing insets. These presets do not configure slicing processes.
