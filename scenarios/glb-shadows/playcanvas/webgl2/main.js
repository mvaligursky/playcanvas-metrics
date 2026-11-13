import { WebglGraphicsDevice } from 'playcanvas';

import { run } from '../scene.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('app'));

// constructed directly: createGraphicsDevice references every backend, so none can be dropped
const device = new WebglGraphicsDevice(canvas, { antialias: true });

run(device, canvas);
