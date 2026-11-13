import { DEVICETYPE_WEBGL2, DEVICETYPE_WEBGPU, createGraphicsDevice } from 'playcanvas';

import { run } from '../scene.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('app'));

// the documented way to get a device: WebGPU when the browser has it, WebGL2 otherwise. Both
// backends have to ship in the bundle
const device = await createGraphicsDevice(canvas, {
    deviceTypes: [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2],
    antialias: true
});

run(device, canvas);
