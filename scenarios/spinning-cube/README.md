# spinning-cube

The smallest lit scene: what an app pays for just to put one shaded mesh on screen.

- Canvas: 1280x720, device pixel ratio 1, antialiasing on.
- One procedural unit cube with a default lit material, light grey (0.8, 0.8, 0.8).
- One directional light, no shadows, rotated by Euler angles (45, 30, 0) degrees.
- One perspective camera, 45 degree vertical field of view, 4 units back on Z, clear colour
  (0.1, 0.12, 0.16).
- At `t` seconds after start the cube's Euler angles are (30 + 10t, 45 + 20t, 30t) degrees, applied
  in X, then Y, then Z order (rotation matrix Rz * Ry * Rx).
- No assets are loaded.
- Nothing the scene does not use is switched on: no light clustering, area lights or cookies.

Every implementation must:

- Set `window.__metrics` with `deviceType` (`'webgl2'` or `'webgpu'`), `firstFrameMs`
  (`performance.now()` at the end of the first rendered frame) and `frames` (frames rendered so far).
- Honour `?pose=<seconds>` in the page URL by holding the cube at that time. The harness compares a
  screenshot at `?pose=1` with a reference picture, which keeps every implementation, for every
  engine version and framework, drawing the same scene.

`reference.png` is drawn by PlayCanvas and PlayCanvas bundles must match it exactly.
`reference.three.png` is drawn by three.js and three.js bundles must match it exactly; it must also
have the same outline as `reference.png` and nearly the same shading.

## PlayCanvas notes

- Clustered lighting is switched off (`scene.clusteredLightingEnabled = false`): a single
  directional light does not need it.

## three.js notes

- The material is `MeshStandardMaterial` with its default roughness 1 and metalness 0.
- The light's intensity is pi, because three.js divides diffuse light by pi and PlayCanvas does not.
- Variants: `webgl2` uses `WebGLRenderer` from `three`; `webgpu-or-webgl2` uses `WebGPURenderer`
  from `three/webgpu`, which falls back to WebGL2. There is no documented WebGPU-only route.
