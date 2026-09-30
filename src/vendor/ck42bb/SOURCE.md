# Procedural weather source

- Source: https://github.com/ck42bb/procedural-weather-threejs/tree/26ad580e3ab256f00af9e60e818bffdcfb32aa1e
- License: MIT, Copyright (c) 2026 Kingsley (see LICENSE).
- Reference: SKILL.md, weather-types.md and weather-shaders.md at this commit.

This repository distributes implementation templates, not an npm runtime. The local
adapter in weather-state.js, weather-controller.js, weather-particles.js and
weather-atmosphere.js adapts its 12 profiles, interpolated state machine,
GPU-wrapped rain/snow/dust, branching lightning and aurora curtain recipes for
Three.js 0.180, WebGL2, Spark and the existing volumetric sky.

Local fixes: duplicate rain seeds for both vertices, valid ascending smoothstep
edges, downward gravity, continuous interrupted transitions, integrated wind
offset, camera-relative precipitation including camera height, bounded particle
budgets, independent lightning branch segments and disposal, and per-splat fog.
The local ground-weather, surface-atlas, surface-shader and surface-state modules
add accelerated wetness/snow accumulation, procedural puddles and impact rings,
and precipitation clipping against a top-surface atlas of the hidden collider.
WebGPU compute, full 3D precipitation collision, physical water/snow thickness,
splash particles, rainbows, wet-lens refraction and frost overlays are not implemented.
