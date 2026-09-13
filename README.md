# Microduck Color Studio

A 3D color and material studio for humans **and** agents. Built with TypeScript, Three.js and Vite. 中文界面，开放的数据接口。

Rotate the real Microduck assembly, select individual parts, compare PLA / matte PLA / PETG / TPU finishes, and adjust lighting. Export a reproducible JSON look or a PNG image.

![Microduck Color Studio — 15-second feature preview](docs/media/studio-demo.gif)

The preview uses example inventory and records only the webpage viewport.

## Run

```sh
npm ci
npm run dev
```

Open the local URL Vite prints. Production: `npm run build`, then serve `dist/` with any static server. No backend, account, API key, analytics or print service is required. Palettes are saved in your browser's local storage. Export JSON for portable backups.

## Features

- 70 individually addressable assembly instances, including 36 visual printable instances and 34 hardware instances.
- Click-to-select, named part browser, orbit / zoom / standard views, isolate and exploded view.
- Independent part colors, same-source batch editing, color groups and six starting palettes.
- PBR presets for PLA, matte PLA, PETG and TPU; directional key light and environment reflections.
- Approximate 0.2 mm layer shading, adjustable light intensity / direction, three lighting presets.
- Shared color + finish + lighting state, undo/redo, validated import/export and local persistence.
- Stable IDs, versioned JSON Schema, CLI and explicit browser API for agents.

## Agents: start here

Read [AGENTS.md](AGENTS.md), [Agent API](docs/agent-api.md) and [architecture](docs/architecture.md).

```sh
npm run -s palette -- parts --role primary
npm run -s palette -- new --out my-look.json
npm run -s palette -- edit --in my-look.json --patch examples/warm-petg.patch.json --out warm-look.json
npm run -s palette -- validate --in warm-look.json
```

The CLI and browser share the **same validator and state contract**. CLI output is JSON; errors go to stderr with exit code 1. `--out` never overwrites existing files. Import the resulting JSON through the editor.

## Model scope and licenses

This is a **visual configurator**, not a slicer or a fit-check tool. The included GLB is derived from Pollen Robotics' original XL330 simulation assembly, via `microduck-replica`'s assembled STLs. It is not an exact HD1910 assembly, does not include the optional roller-skate configuration, and its visual instance count is **not a printing BOM**. Color changes do not modify any `.3mf`, STL, CAD repository or printer.

Material presets are visual approximations, not measurements of a filament brand. TPU does not deform; opaque PETG is shown without transmission. Layer shading uses assembly Y, not per-part print orientation. RGB screenshots cannot predict exact physical filament color.

- Original application code: **Apache-2.0**.
- Included model geometry and derived metadata: **CC BY-NC-SA 4.0**, non-commercial, with attribution and ShareAlike. These restrictions remain attached to the model when reused with the open-source application.
- See [NOTICE.md](NOTICE.md) for sources and geometry provenance.

## Develop

```sh
npm test
npm run build
```

See [model-pack.md](docs/model-pack.md) for adding a different model without changing the renderer or editor state. Model regeneration is optional; the ready-to-use GLB is included.

## Your filaments, your palette

Open **我的耗材** to record actual stock colors and material types. Compare:

- **只用已有** — feasible colors from your stock, with missing required material types called out.
- **补充一色** — at most one optional extra color spool, plus any missing essential material types.
- **丙烯点缀** — owned filament as the base, with a separate acrylic coating suggestion on eligible exterior parts.

Recommendations use color-distance matching to curated palettes; they are deterministic and available to agents through both CLI and browser API. Flexible parts retain TPU requirements. Inventory is independently importable/exportable as JSON; no sample stock is silently treated as yours.

CI template: `.github/ci.example.yml`. To enable it, move it into `.github/workflows/ci.yml` with a GitHub credential that has workflow-write permission. Local checks are available immediately with `npm test` and `npm run build`.
