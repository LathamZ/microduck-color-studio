# Architecture: stable engine, replaceable model

## Dependencies

```text
Human UI ─────┐
Browser API ──┼── domain.ts (Palette / validation / history) ── viewer.ts (Three.js)
CLI ──────────┘                ↑                                  ↑
                      model manifest                       GLB geometry
                         ↑
                  model adapter / presets
```

The domain knows IDs, colors, material keys, lighting and surface settings. It does not know ducks, servos, print filenames or Three.js. The renderer consumes a manifest and palette; it never chooses parts based on Microduck names. Microduck-specific geometry, classifications and material defaults are produced by its import adapter.

## What stays stable

- Versioned complete-palette contract and atomic validation.
- Instance-addressed edits, grouped edits, history and persistence semantics.
- PBR material library, lighting presets, orbit camera, picking and appearance renderer.
- Agent CLI / browser API behavior and machine-readable errors.
- GLB-node-to-manifest-ID binding.

## What changes for a new model

- GLB geometry, units, bounds and up/front orientation.
- Instance IDs, labels, assemblies, source equivalence groups and printability.
- Default colors/materials, neutral hardware metalness, color-group definitions.
- Model adapter path, display labels and initial palettes; model-specific provenance.

See `model-pack.md`. The Microduck converter is intentionally separate from runtime code. It recovers the ordered constituent meshes from assembled STLs using the assembly manifest and verifies all face ranges. It never alters the source repository.

## Appearance state vs view state

`Palette` contains all durable appearance: every part's color/material, key-light preset/intensity/azimuth, and layer shading. Import/export, browser API, CLI and undo/redo all share this contract. A complete model is required; unknown/missing IDs or invalid values fail before mutation.

Camera pose, selection, search, isolation, hardware visibility and explode amount are temporary inspection state. They are not in a saved look. A screenshot captures the current inspection view. Orbit controls continuously render with damping; resize observation updates camera aspect and pixel ratio is capped at 2.

## Materials and geometry

WebGL PBR uses environment illumination, directional lighting, cast/received shadows, clearcoat and roughness. Smooth curves use angle-aware vertex normals; hard mechanical edges retain their creases. Original source face count is retained. Material definitions are approximations, not calibrated filament measurements. See README for limitations.

## Compatibility and boundaries

`schemaVersion: 1` and `modelId` form the compatibility boundary. Breaking ID changes require a new model ID or an explicit migration. Do not silently remap IDs from labels. Group names may be translated; IDs must not.

The website is static. Palettes stay local. JSON imports are parsed as data, never executable code. The browser API is same-page functionality, not an unauthenticated remote service. There is no HTTP mutation API, MCP server, slicer, printer control or automatic modification of manufacturing files.

## Inventory and recommendations

`recommend.ts` is another pure, model-independent module. It reads Inventory + Palette + Manifest + adapter palettes and returns plans without mutating any input. Material compatibility follows manifest defaults; paintability is explicit model metadata. CIE76 color proximity ranks curated palettes; a bounded optional purchase and separate paint coating preserve the distinction between owned filament, suggested filament and surface finish. Duplicate realized looks are removed.

`inventory-ui.ts` binds this module to the human interface. `scripts/palette.ts` and `window.colorStudio` expose the same inventory validator and recommender. Neither invents a user's stock or depends on browser coordinates. Inventory is shared across model packs; palettes remain model-specific.

## Bilingual presentation

`translations.ts` contains the phrase catalog and pure translation function. `i18n.ts` applies that catalog at the DOM presentation boundary, including dynamic labels and accessibility attributes, and remembers original text for reversible switching. Input values and explicitly marked user-content nodes are never translated. It does not mutate the editor state, geometry, identifiers or inventory. Canonical model metadata remains available to agents; part and assembly display names are translated in the UI.

Language selection is saved independently of model state. Query parameters `lang=en` and `lang=zh-CN` provide explicit links. The CLI uses the same pure translation catalog for error messages without importing browser code.

## Print pipeline

`print-project.ts` parses uploaded manufacturing 3MF meshes, preserves component/build transforms, normalizes bed translation, produces deterministic material/color-separated shelf layouts, and exports binary STL plus core 3MF base materials plus Bambu-compatible multi-plate metadata. It is independent of the renderer and does not use display geometry. The manifest supplies optional source-name hints; ambiguous matches remain explicit choices. `print-worker.ts` owns source meshes and runs bounded import/plan/export operations. `print-ui.ts` owns temporary assignments and the upload/plate-preview dialog. The browser API shares this exact path. Uploaded files and process data are not persisted or bundled into the public model pack.
