# Add a model

1. Export a GLB with one mesh node per independently editable part instance. Names must be stable ASCII IDs, unique and equal to manifest IDs. Merge multiple primitives of a physical part before export. Bake transforms, use millimeters, Y up (front +Z by default). Negative/scaled parent transforms should be baked. For another model orientation, declare `viewDirections` in the manifest: front/back/left/right/three-quarter camera offsets. Microduck faces +X; its explicit directions preserve the source geometry and palette IDs.
2. Add a manifest matching `public/model.schema.json`. Use descriptive localized `name` and `assembly` labels; keep machine IDs independent of localization. `sourceName` identifies equivalent components for optional batch edits. `role` identifies a color group. Neither implies bilateral symmetry.
3. Put neutral hardware shading in `metalness`, and define `defaultMaterial`. Keep model-specific decisions in the manifest/import adapter, not `domain.ts` or `viewer.ts`.
4. Set `manifestPath` in `src/models/active.ts`. The geometry URL resolves relative to the manifest, so a model can live in its own directory. Adjust this adapter's palette definitions/group labels and optional application branding.
5. Load it; the renderer requires an exact one-to-one match between manifest IDs and GLB mesh names. Check all views, normals and picking. Run tests/build. A new model ID gives it its own local storage namespace and prevents accidental cross-model palette imports.
6. Include provenance, version and license. Do not imply the application license relicenses imported geometry.

## Regenerate Microduck

```sh
python -m venv .venv
.venv/bin/pip install numpy trimesh
.venv/bin/python scripts/build_model.py /path/to/microduck-replica
```

Regeneration reads `cad/零件对照表.json`, assembly STLs and original part STL face counts. All constituent counts must exactly consume the assembly mesh. It retains every original face, converts Z-up to Y-up, and writes only this project's GLB/manifest. Normal builds require no Python or sibling repository.
