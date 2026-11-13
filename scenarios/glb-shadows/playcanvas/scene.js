import {
    AppBase,
    AppOptions,
    Asset,
    CameraComponentSystem,
    Color,
    ContainerHandler,
    Entity,
    FILLMODE_NONE,
    LIGHTFALLOFF_INVERSESQUARED,
    LightComponentSystem,
    Mesh,
    MeshInstance,
    PlaneGeometry,
    RenderComponentSystem,
    StandardMaterial,
    TextureHandler,
    Vec3
} from 'playcanvas';

import modelUrl from '../assets/playcanvas-cube.glb?url';

const TARGET = new Vec3(0, 0.5, 0);

// shadow settings shared by the three lights
const SHADOWS = { castShadows: true, shadowResolution: 1024, shadowBias: 0.2, normalOffsetBias: 0.05 };

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
    options.resourceHandlers = [ContainerHandler, TextureHandler];

    const app = new AppBase(canvas);
    app.init(options);
    app.setCanvasFillMode(FILLMODE_NONE);
    app.scene.ambientLight = new Color(0.2, 0.2, 0.2);
    // the omni and spot lights are clustered, with shadows; nothing here is an area light or
    // projects a cookie
    app.scene.lighting.shadowsEnabled = true;
    app.scene.lighting.areaLightsEnabled = false;
    app.scene.lighting.cookiesEnabled = false;

    // frames only count once the model is on screen
    const metrics = { deviceType: device.deviceType, firstFrameMs: null, frames: 0 };
    window.__metrics = metrics;
    let model = null;
    app.on('frameend', () => {
        if (model) {
            metrics.firstFrameMs ??= performance.now();
            metrics.frames++;
        }
    });

    // a light shines down its -Y axis; this places it and points that axis at the target
    const addLight = (name, position, data) => {
        const light = new Entity(name);
        light.addComponent('light', { ...SHADOWS, ...data });
        light.setPosition(position);
        light.lookAt(TARGET);
        light.rotateLocal(90, 0, 0);
        app.root.addChild(light);
    };

    // every light has intensity 1 and is dimmed through its colour: the engine converts
    // colour * intensity to linear as one value when intensity is below 1, which no other
    // library does
    addLight('directional', new Vec3(3, 6, 4), {
        type: 'directional',
        color: new Color(0.7, 0.7, 0.7),
        shadowDistance: 20
    });
    addLight('omni', new Vec3(-2.5, 2, 1.5), {
        type: 'omni',
        color: new Color(0.5, 0.275, 0.1),
        range: 10,
        falloffMode: LIGHTFALLOFF_INVERSESQUARED
    });
    addLight('spot', new Vec3(2.5, 4, -1.5), {
        type: 'spot',
        color: new Color(0.3, 0.55, 1),
        range: 14,
        innerConeAngle: 20,
        outerConeAngle: 30,
        falloffMode: LIGHTFALLOFF_INVERSESQUARED
    });

    const groundMaterial = new StandardMaterial();
    groundMaterial.diffuse = new Color(0.6, 0.6, 0.6);
    groundMaterial.update();
    const ground = new Entity('ground');
    ground.addComponent('render', {
        meshInstances: [new MeshInstance(Mesh.fromGeometry(device, new PlaneGeometry()), groundMaterial)],
        castShadows: false
    });
    ground.setLocalScale(12, 1, 12);
    app.root.addChild(ground);

    const camera = new Entity('camera');
    camera.addComponent('camera', { fov: 45, clearColor: new Color(0.1, 0.12, 0.16) });
    camera.setPosition(0, 3, 6);
    camera.lookAt(TARGET);
    app.root.addChild(camera);

    // ?pose=<seconds> holds the model at that time, so a screenshot can be compared to the reference
    const pose = new URLSearchParams(location.search).get('pose');
    let time = pose === null ? 0 : Number(pose);
    app.on('update', (dt) => {
        if (pose === null) {
            time += dt;
        }
        model?.setEulerAngles(0, 20 * time, 0);
    });

    const asset = new Asset('playcanvas-cube', 'container', { url: modelUrl });
    asset.ready(() => {
        model = asset.resource.instantiateRenderEntity();
        model.setPosition(TARGET);
        app.root.addChild(model);
    });
    app.assets.add(asset);
    app.assets.load(asset);

    app.start();
}
