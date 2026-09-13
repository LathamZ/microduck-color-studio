# Agent working contract

This repository has two supported agent workflows: editing looks and developing the editor.

## Edit a look

1. Read `public/models/parts.json` (stable instance IDs, source groups, defaults, printability).
2. Read `public/palette.schema.json` and `docs/agent-api.md`.
3. Use `npm run -s palette -- new|parts|edit|validate`. Supply colors as #RRGGBB, materials as `pla`, `matte-pla`, `petg`, `matte-petg`, `metallic-petg`, `pla-cf`, `tpu`.
4. Changes to colors, materials, lighting or layer shading belong in the palette JSON, not in the geometry.
5. Validate before import. Verify the look visually when appearance matters. Export a complete palette to make your result reproducible.

The browser exposes `window.colorStudio` after `colorstudio:ready`. Its mutation methods are explicit and affect local editor state only. `getModel()` and `getPalette()` return deep copies. Never assume an automation tool permits JavaScript writes; use the CLI/import workflow where its page evaluation is read-only.

## Develop

- `src/domain.ts`: pure model-independent state, validation and undo/redo. No DOM/Three.js/model-name checks.
- `src/viewer.ts`: model-independent rendering. Never match Microduck part names here.
- `src/models/`: application/model adapter configuration.
- `public/models/`: GLB plus declarative manifest. Stable IDs must match GLB mesh node names one-to-one.
- `src/main.ts`: human UI and explicit agent API, both mutate the shared domain state.
- `scripts/palette.ts`: CLI using the same domain validator.

Run `npm test` and `npm run build` after behavioral changes. Test model mismatch, invalid input, atomic multi-part changes and undo/redo. Keep model changes separately traceable from code changes. Preserve attribution and the model's non-commercial ShareAlike license. No backend, telemetry or printer connection is implied by this project. Print export only processes user-uploaded manufacturing meshes: never substitute the display GLB. Read the print API section before working with plate layouts, and preserve source dimensions, orientation and instance counts.

Do not read, modify or rely on the developer's sibling repositories for normal builds. Geometry regeneration takes an explicit source directory and is read-only toward that source. Do not commit credentials, local absolute paths, node_modules or user palette data.
