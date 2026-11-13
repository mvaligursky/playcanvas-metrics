import {
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    WebGPURenderer
} from 'three/webgpu';

import { run } from '../scene.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('app'));

// the documented way to use WebGPU in three.js: WebGPU when the browser has it, WebGL2 otherwise
const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();

run({ BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene }, renderer,
    renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2');
