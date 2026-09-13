# Microduck Color Studio

[简体中文](README.md) · **English**

Microduck 3D color studio. Customize the colors, materials and lighting of a real Microduck assembly, and turn the look you imagine into a model you can explore from every angle.

**[Open the studio](https://lathamz.github.io/microduck-color-studio/?lang=en)**

![Microduck Color Studio: a 15-second feature preview](docs/media/studio-demo.gif)

The preview shows orbiting, whole-model palettes, individual finishes, lighting and inventory recommendations. It captures only the webpage viewport and uses example inventory.

## What you can do

- **Customize each part.** Select any of 70 independent assembly instances in 3D or find it by name or stable ID. Optionally edit equivalent source parts together.
- **Explore the assembly.** Orbit, zoom, jump between standard views, isolate a part, explode the assembly or hide standard hardware.
- **Compare materials and lighting.** Preview PLA, matte PLA, PETG, matte PETG, metallic PETG, PLA-CF and TPU with studio, daylight or warm lighting. Adjust light intensity and direction, and toggle approximate layer lines.
- **Keep a reproducible look.** Colors, materials, acrylic coatings and lighting share one validated state. Undo and redo changes, import or export JSON, save locally, or download a PNG preview.
- **Work with your actual stock.** Keep your filament inventory separate from reference colors. The part inspector shows compatible stock and whether the selected color/material combination is available.
- **Discover another combination.** Compare inventory-only, one-extra-color and acrylic-accent recommendations. Choose **New ideas** to explore different combinations without dropping material constraints.
- **Use an agent.** Stable instance IDs, versioned JSON schemas, a CLI and an explicit browser API support color, material, lighting, inventory and recommendation operations.
- **Replace the model.** The renderer and editing state are independent of Microduck. Another model can be mounted through a declarative model pack and adapter.

The interface supports English and Simplified Chinese. Use **EN / 中文** in the header; switching language preserves your look and stock. User-entered names are preserved rather than translated. `?lang=en` and `?lang=zh-CN` provide direct links to either language.

## Run locally

Requires Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For production, run `npm run build` and host `dist/` on any static web server.

There is no backend, login, API key, analytics or printer connection. Palettes and inventory stay in the current browser. Export JSON for portable backups.

## Your filaments, your palette

Open **My filaments** and enter the names, colors and materials you actually own. Nothing is silently assumed to be in stock.

| Recommendation mode | How it works                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| In stock            | Uses available colors and compatible materials; missing essential material types are listed explicitly |
| Add one color       | Suggests at most one optional extra color spool, with missing essential materials listed separately    |
| Paint accents       | Keeps your filament as the base and suggests acrylic only for rigid exterior parts marked as paintable |

The recommender uses transparent color-distance matching and curated or seeded combinations; it does not present subjective aesthetics as a precise quality score. Flexible parts retain their TPU requirement. Changing the seed can explore another combination, but limited stock may have only a few distinct feasible looks.

Acrylic paint is stored as a separate coating, not as a replacement for the filament color. A recommendation that uses owned filament may still require a suggested acrylic pen. Test adhesion on a sample before painting.

## For agents

Start with [AGENTS.md](AGENTS.md), the [API reference](docs/agent-api.md) and the [architecture](docs/architecture.md).

```sh
npm run -s palette -- parts --role primary
npm run -s palette -- new --out my-look.json
npm run -s palette -- edit --in my-look.json --patch examples/warm-petg.patch.json --out warm-look.json
npm run -s palette -- validate --in warm-look.json
npm run -s palette -- recommend --inventory examples/inventory.json --mode paint --seed 42 --out suggestions.json
```

The CLI and browser use the same validator and state contract. Results are JSON; failures go to stderr with exit code 1. `--out` refuses to overwrite an existing file. The browser exposes `window.colorStudio` when ready.

```js
const api = window.colorStudio;
const model = api.getModel();
const shellIds = model.parts.filter((part) => part.role === 'primary').map((part) => part.id);
api.updateParts(shellIds, { color: '#8DAB8A', material: 'matte-pla' });
api.setLighting({ preset: 'daylight', intensity: 1.1, azimuth: -40 });
const suggestions = api.recommend('add-one', { seed: 42 });
// Inspect suggestions[0].used, .missing and .paint before applying.
api.importPalette(suggestions[0].palette);
```

## Architecture and development

- `src/domain.ts`: model-independent state, validation and history.
- `src/viewer.ts`: generic Three.js rendering, picking, materials, lights and camera.
- `src/recommend.ts`: inventory validation and reproducible color recommendations.
- `src/models/`: active model configuration and initial palette templates.
- `public/models/`: GLB geometry and the named part manifest.
- `src/api.ts` and `scripts/palette.ts`: explicit interfaces shared by human and agent workflows.
- `src/i18n.ts` and `src/translations.ts`: presentation localization, separate from saved user data and machine IDs.

Read the [model-pack guide](docs/model-pack.md) to add another model. Normal builds need neither Python nor another local repository.

```sh
npm test
npm run build
npm run format:check
```

A CI template is included at `.github/ci.example.yml`. Move it to `.github/workflows/ci.yml` using a GitHub credential with workflow-write permission to enable it. Local checks work immediately.

`main` is the default source branch. `gh-pages` contains the generated static website; it is a deployment artifact, not the development branch.

## Geometry and simulation limits

This is an appearance configurator, not a slicer or an assembly-fit validator. The bundled geometry comes from the original **XL330 simulation assembly**, retaining about 796,800 source triangles. It is not an exact HD1910 assembly and does not include the roller-skate variant.

Of the 70 visual instances, 36 are marked printable and 34 are standard hardware. These counts are **not a printing BOM**. The editor does not modify `.3mf`, STL, CAD repositories or printers.

Material presets are visual approximations, not measurements of a specific filament brand. PETG is opaque in this preview; TPU does not deform. Layer shading follows the assembled model's vertical axis, not each part's real print orientation. RGB previews cannot predict exact physical filament color. Acrylic coatings approximate an eligible part's overall finish, not brush strokes or masking.

## Licenses and attribution

- Original application code and documentation: **Apache-2.0**.
- Geometry, derived model metadata and renders: **CC BY-NC-SA 4.0**, preserving attribution, non-commercial use and ShareAlike.
- Original model: **Pollen Robotics**. World-space assembly exports and organization: [fanhao375/microduck-replica](https://github.com/fanhao375/microduck-replica).

The application's open-source license does not change the model's license. See [NOTICE.md](NOTICE.md) for complete provenance and attribution.
