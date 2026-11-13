# glb-shadows

A loaded model under three shadow-casting lights: what an app pays for glTF loading, textured
physically based materials, and directional, omni and spot shadows.

- Canvas: 1280x720, device pixel ratio 1, antialiasing on.
- Model: `assets/playcanvas-cube.glb` (from the engine's examples), a unit cube with two textured
  PBR materials. Placed at (0, 0.5, 0) so it rests on the ground; casts and receives shadows.
- Ground: a 12x12 plane at y = 0, diffuse colour (0.6, 0.6, 0.6); receives shadows, casts none.
- Camera: perspective, 45 degree vertical field of view, at (0, 3, 6) looking at (0, 0.5, 0), clear
  colour (0.1, 0.12, 0.16).
- Ambient light: (0.2, 0.2, 0.2).
- Lights, each casting shadows with a 1024 shadow map and aimed at (0, 0.5, 0):

  | Light | Position | Colour | Other |
  |---|---|---|---|
  | Directional | from (3, 6, 4) | (0.7, 0.7, 0.7) | |
  | Omni | (-2.5, 2, 1.5) | (0.5, 0.275, 0.1) | range 10, inverse-square falloff |
  | Spot | (2.5, 4, -1.5) | (0.3, 0.55, 1) | range 14, inverse-square falloff, cone 20 to 30 degrees |

- All colours are sRGB. Every light has intensity 1 and is dimmed through its colour.
- At `t` seconds after the model has loaded, it is rotated by 20t degrees around Y.

Every implementation must:

- Set `window.__metrics` with `deviceType` (`'webgl2'` or `'webgpu'`), `firstFrameMs`
  (`performance.now()` at the end of the first frame that shows the model) and `frames` (frames
  rendered with the model so far).
- Honour `?pose=<seconds>` in the page URL by holding the model at that time.

`reference.png` is drawn by PlayCanvas, `reference.three.png` by three.js; see the repo README.

## PlayCanvas notes

- Lighting is configured for what the scene uses: clustered lighting with shadows on, area lights
  and cookies off (`scene.lighting`).
- Lights are dimmed through colour, not intensity, because the engine converts colour x intensity
  to linear as one value when intensity is below 1.
- Resource handlers: `ContainerHandler` and `TextureHandler` only.

## three.js notes

- Light intensities carry the unit conversions: pi (three.js divides diffuse light by pi), and for
  the omni and spot lights 16 x d^2 / (d^2 + 1), because PlayCanvas' inverse-square falloff is
  16 / (d^2 + 1) where three.js uses 1 / d^2. The two agree exactly only at the model's distance.
- The model is loaded with `GLTFLoader` from `three/addons`.
