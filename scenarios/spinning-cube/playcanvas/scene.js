import {
    AppBase,
    AppOptions,
    BoxGeometry,
    CameraComponentSystem,
    Color,
    Entity,
    FILLMODE_NONE,
    LightComponentSystem,
    Mesh,
    MeshInstance,
    RenderComponentSystem,
    StandardMaterial
} from 'playcanvas';

/**
 * Builds and starts the scene on an already created graphics device. The device is created by the
 * variant's entry point, so that each bundle only contains the backend it uses.
 *
 * @param {import('playcanvas').GraphicsDevice} device - The graphics device.
 * @param {HTMLCanvasElement} canvas - The canvas.
 */
export function run(device, canvas) {
    const options = new AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_NONE);
    // one directional light needs no light clustering
    app.scene.clusteredLightingEnabled = false;

    const metrics = { deviceType: device.deviceType, firstFrameMs: null, frames: 0 };
    window.__metrics = metrics;
    app.on('frameend', () => {
        metrics.firstFrameMs ??= performance.now();
        metrics.frames++;
    });

    // the geometry is built directly, as render.type = 'box' brings in every built-in shape
    const material = new StandardMaterial();
    material.diffuse = new Color(0.8, 0.8, 0.8);
    material.update();

    const mesh = Mesh.fromGeometry(device, new BoxGeometry());
    const box = new Entity('box');
    box.addComponent('render', { meshInstances: [new MeshInstance(mesh, material)] });
    app.root.addChild(box);

    const light = new Entity('light');
    light.addComponent('light', { type: 'directional' });
    light.setEulerAngles(45, 30, 0);
    app.root.addChild(light);

    const camera = new Entity('camera');
    camera.addComponent('camera', { fov: 45, clearColor: new Color(0.1, 0.12, 0.16) });
    camera.setPosition(0, 0, 4);
    app.root.addChild(camera);

    // ?pose=<seconds> holds the cube at that time, so a screenshot can be compared to the reference
    const pose = new URLSearchParams(location.search).get('pose');
    let time = pose === null ? 0 : Number(pose);
    app.on('update', (dt) => {
        if (pose === null) {
            time += dt;
        }
        box.setEulerAngles(30 + 10 * time, 45 + 20 * time, 30 * time);
    });

    app.start();
}
