# Attribution and model license

Microduck is a design by **Pollen Robotics**. This third-party color studio is not affiliated with or endorsed by Pollen Robotics.

## Geometry

`public/models/microduck.glb`, `public/models/parts.json`, and renders in `docs/media/` derive from public simulation geometry in [pollen-robotics/microduck_rl](https://github.com/pollen-robotics/microduck_rl), upstream baseline `2fa62b8` as recorded by [fanhao375/microduck-replica](https://github.com/fanhao375/microduck-replica).

The replica project's assembled STL exports and `cad/零件对照表.json` provide world-space assembly coordinates and ordered source mesh identities. Our converter restores individual instances, converts coordinates from Z-up to Y-up, preserves source face counts, and packages display geometry as GLB with original appearance defaults and metadata. Original upstream geometry author: Pollen Robotics. Assembly export/organization: contributors to microduck-replica. Conversion and this application: Microduck Color Studio contributors.

These model assets and derived metadata are distributed under **Creative Commons Attribution–NonCommercial–ShareAlike 4.0**: https://creativecommons.org/licenses/by-nc-sa/4.0/ . Preserve attribution, non-commercial use and ShareAlike when redistributing derivatives. Upstream's README states “BY-SA-NC”; its repository-level code LICENSE is Apache-2.0. This project preserves the separate, more restrictive model terms as documented by the source repository.

The preview contains original XL330 visual geometry, not a newly engineered HD1910 assembly. It is not a printing bill of materials or a manufacturing validation. No MakerWorld profile, private information or user printing project is redistributed.

## Application

Original application code, tests, CLI and documentation in this repository are Apache-2.0. Three.js is MIT; Lucide is ISC; tooling retains its respective licenses. Model licenses are separate from the application's open-source license.

## Roller-skate module

`public/models/microduck-rollers.glb` holds the roller variant's swap-in parts: the roller
ankles (`ankle_l_v1`, `ankle_r_v1`), the blade (`roller_blade`), and four wheels (four `rim`,
four `tire`). The meshes come from the same original assembly as the rest of the model, and
each part's placement is the official simulator's own, taken from the rollers variant of
`pollen-robotics/microduck_rl` (mirrored at `boris721/microduck-3d`). Rebuild them with
`python scripts/build_rollers.py /path/to/microduck-replica`.

Geometry, derived metadata and renders remain **CC BY-NC-SA 4.0**, as above.
