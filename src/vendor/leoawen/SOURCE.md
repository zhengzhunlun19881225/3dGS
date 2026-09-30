# Source

Repository: https://github.com/leoawen/volumetric_cloud_atmosphere_scattering

Pinned commit: `776e26865b4b01e789f5be28dffd4d39055e3acf`.

Retrieved from `index.html` on 2026-09-30.

Source HTML SHA-256: `c287375abb92c085cbb45b22aee60b6fa7e402d492afae2723bd8b8b01b96fa2`

`shaders.js` extracts the five named shader objects verbatim, adding ES module exports.
The integration lives in `../../volumetric-sky.js` and `../../volumetric-shader.js`.
It reuses the generators, cloud density/lighting functions and atmospheric integration.
The local adapter uses bounded ray steps and a reduced-resolution sky pass, adds the existing moon and local day controls, and composites the PLY scene afterward.
Upstream TAA, depth-based ground fog, god-ray postprocess, planet geometry and flight controls are not enabled in this adapter.

The shader adapter fixes zero-width density remaps and smoothstep edges, removes unused deferred uniforms, and supports Three.js r180. License is preserved alongside this file.
