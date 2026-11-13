import {
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    MeshStandardMaterial,
    PerspectiveCamera,
    Scene,
    WebGLRenderer
} from 'three';

import { run } from '../scene.js';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('app'));

const renderer = new WebGLRenderer({ canvas, antialias: true });

run({ BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene }, renderer, 'webgl2');
