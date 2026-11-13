import {
    AmbientLight,
    Color,
    DirectionalLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    PointLight,
    Scene,
    SpotLight,
    WebGPURenderer
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { run } from '../scene.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('app'));

// the documented way to use WebGPU in three.js: WebGPU when the browser has it, WebGL2 otherwise
const renderer = new WebGPURenderer({ canvas, antialias: true });
await renderer.init();

run({
    AmbientLight,
    Color,
    DirectionalLight,
    GLTFLoader,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    PointLight,
    Scene,
    SpotLight
}, renderer, renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2');
