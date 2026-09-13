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
const result = api.getPalette();
api.undo();
api.redo();
api.importPalette(before); // validated atomically
```

`updateParts`, `setLighting`, `setSurface` and `importPalette` return the resulting complete palette. They update the UI, render, local storage and undo history. Invalid mutations throw before changing state. Empty/no-op updates do not create history entries. `selectPart` throws for unknown IDs. `setView` uses the default view for an unknown view name.

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

Materials: `pla`, `matte-pla`, `petg`, `tpu`. Colors: exactly six hexadecimal digits after `#`. Intensity: 0.3–1.8; azimuth: −180–180 degrees; light presets: `studio`, `daylight`, `warm`.

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

`setInventory` validates before mutation, saves locally, updates an open inventory panel, and returns a deep copy. `recommend` is read-only: it returns up to three distinct recommendation plans and does not apply a look. Its output includes the full palette, used stock IDs, explicit missing material requirements and proposed acrylic colors/part IDs. A missing material is never claimed to be owned. `complete` means no filament purchase is required; a paint plan can still require acrylic pens.

```sh
npm run -s palette -- inventory-validate --in examples/inventory.json
npm run -s palette -- recommend --inventory examples/inventory.json --mode add-one --out suggestions.json
```

Inventory schema: `inventory.schema.json`. Recommendation uses deterministic CIE76 Lab proximity to the adapter's curated palettes, enforces TPU/rigid separation and deduplicates identical results. It is a transparent heuristic, not a learned aesthetic evaluator. “Add one” limits discretionary color spools to one; missing essential material types are listed separately.

Acrylic is a separate optional `coating: {kind:'acrylic',color:'#RRGGBB'}` on a part. `color` remains the actual filament color. Only model instances with `paintable:true` accept coatings. The Microduck adapter conservatively permits the hard jaw exterior only; soft TPU and bearing/contact parts are excluded. A base-color edit clears its coating. The renderer approximates coating across the whole permitted part, not brush strokes or printed masks. Validate adhesion on a sample before painting.
