import modelUrl from '../assets/playcanvas-cube.glb?url';

const RAD = Math.PI / 180;

// three.js divides diffuse light by pi and PlayCanvas does not
const PI = Math.PI;

// PlayCanvas' inverse-square falloff is 16 / (d * d + 1) where three.js uses 1 / (d * d). The last
// factor is d * d / (d * d + 1) at each light's distance to the model, which makes them agree there
const OMNI_SCALE = 16 * 0.9;
const SPOT_SCALE = 16 * 0.96;

/**
 * Builds and starts the scene on an already created renderer. The three.js classes are passed in
 * one by one, because each variant imports them from a different entry point ('three' or
 * 'three/webgpu') and a whole namespace object would defeat tree-shaking.
 *
 * @param {object} three - The three.js classes the scene uses.
 * @param {object} renderer - The renderer, already initialized.
 * @param {string} deviceType - The graphics API the renderer runs on: webgl2 or webgpu.
 */
export function run(three, renderer, deviceType) {
    const {
        AmbientLight, Color, DirectionalLight, GLTFLoader, Mesh, MeshStandardMaterial, PerspectiveCamera,
        PlaneGeometry, PointLight, Scene, SpotLight
    } = three;

    const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');

    renderer.setPixelRatio(1);
    renderer.setSize(1280, 720, false);
    renderer.setClearColor(srgb(0.1, 0.12, 0.16));
    renderer.shadowMap.enabled = true;

    // frames only count once the model is on screen
    const metrics = { deviceType, firstFrameMs: null, frames: 0 };
    window.__metrics = metrics;

    const scene = new Scene();
    scene.add(new AmbientLight(srgb(0.2, 0.2, 0.2), PI));

    const withShadow = (light) => {
        light.castShadow = true;
        light.shadow.mapSize.set(1024, 1024);
        light.shadow.bias = -0.002;
        light.shadow.normalBias = 0.03;
        scene.add(light);
        return light;
    };

    const directional = withShadow(new DirectionalLight(srgb(0.7, 0.7, 0.7), PI));
    directional.position.set(3, 6, 4);
    directional.target.position.set(0, 0.5, 0);
    scene.add(directional.target);
    Object.assign(directional.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 20 });

    const omni = withShadow(new PointLight(srgb(0.5, 0.275, 0.1), PI * OMNI_SCALE, 10, 2));
    omni.position.set(-2.5, 2, 1.5);

    // a penumbra of 1/3 puts the inner cone at 20 degrees for an outer cone of 30
    const spot = withShadow(new SpotLight(srgb(0.3, 0.55, 1), PI * SPOT_SCALE, 14, 30 * RAD, 1 / 3, 2));
    spot.position.set(2.5, 4, -1.5);
    spot.target.position.set(0, 0.5, 0);
    scene.add(spot.target);

    const ground = new Mesh(new PlaneGeometry(12, 12), new MeshStandardMaterial({ color: srgb(0.6, 0.6, 0.6) }));
    ground.rotation.x = -90 * RAD;
    ground.receiveShadow = true;
    scene.add(ground);

    const camera = new PerspectiveCamera(45, 1280 / 720, 0.1, 1000);
    camera.position.set(0, 3, 6);
    camera.lookAt(0, 0.5, 0);

    // ?pose=<seconds> holds the model at that time, so a screenshot can be compared to the reference
    const pose = new URLSearchParams(location.search).get('pose');
    let time = pose === null ? 0 : Number(pose);
    let last = null;
    let model = null;

    new GLTFLoader().load(modelUrl, (gltf) => {
        model = gltf.scene;
        model.position.set(0, 0.5, 0);
        model.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });
        scene.add(model);
    });

    renderer.setAnimationLoop((now) => {
        if (pose === null && last !== null) {
            time += (now - last) / 1000;
        }
        last = now;
        if (model) {
            model.rotation.y = 20 * time * RAD;
        }

        renderer.render(scene, camera);

        if (model) {
            metrics.firstFrameMs ??= performance.now();
            metrics.frames++;
        }
    });
}
