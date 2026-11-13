const RAD = Math.PI / 180;

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
    const { BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } = three;

    renderer.setPixelRatio(1);
    renderer.setSize(1280, 720, false);
    renderer.setClearColor(new Color().setRGB(0.1, 0.12, 0.16, 'srgb'));

    const metrics = { deviceType, firstFrameMs: null, frames: 0 };
    window.__metrics = metrics;

    const scene = new Scene();

    // roughness 1 and metalness 0 by default: a plain diffuse surface
    const material = new MeshStandardMaterial({ color: new Color().setRGB(0.8, 0.8, 0.8, 'srgb') });
    const box = new Mesh(new BoxGeometry(1, 1, 1), material);
    // the spec's rotation is Rz * Ry * Rx
    box.rotation.order = 'ZYX';
    scene.add(box);

    // three.js divides diffuse light by pi, so an intensity of pi lights a facing surface fully.
    // The light shines down the -Y axis of an object rotated by (45, 30, 0) degrees
    const light = new DirectionalLight(0xffffff, Math.PI);
    light.rotation.set(45 * RAD, 30 * RAD, 0, 'ZYX');
    light.position.set(0, 1, 0).applyEuler(light.rotation);
    scene.add(light);

    const camera = new PerspectiveCamera(45, 1280 / 720, 0.1, 1000);
    camera.position.set(0, 0, 4);

    // ?pose=<seconds> holds the cube at that time, so a screenshot can be compared to the reference
    const pose = new URLSearchParams(location.search).get('pose');
    let time = pose === null ? 0 : Number(pose);
    let last = null;

    renderer.setAnimationLoop((now) => {
        if (pose === null && last !== null) {
            time += (now - last) / 1000;
        }
        last = now;
        box.rotation.set((30 + 10 * time) * RAD, (45 + 20 * time) * RAD, 30 * time * RAD);

        renderer.render(scene, camera);

        metrics.firstFrameMs ??= performance.now();
        metrics.frames++;
    });
}
