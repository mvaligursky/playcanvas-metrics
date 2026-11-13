// Loads a built variant in a real browser and confirms that it renders the scenario's reference
// picture. A bundle that lost code it needed is smaller, so sizes only count for bundles that pass.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.png': 'image/png',
    '.glb': 'model/gltf-binary'
};

// the time, in seconds, at which every scenario is held for its reference screenshot
const POSE = 1;

// a pixel differs when any channel is further than this from the reference, out of 255
const PIXEL_TOLERANCE = 24;

// share of differing pixels allowed, which absorbs antialiasing differences between backends
const MAX_DIFFERENT = 0.005;

export const serve = (dir, port = 0) => {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204).end();
            return;
        }
        let file = path.join(dir, path.normalize(decodeURIComponent(url.pathname)));
        if (file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
            if (!url.pathname.endsWith('/')) {
                res.writeHead(302, { Location: `${url.pathname}/` }).end();
                return;
            }
            file = path.join(file, 'index.html');
        }
        if (!file.startsWith(dir) || !fs.existsSync(file)) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
};

// share of pixels that differ between two screenshots of the same size
const difference = (a, b) => {
    let different = 0;
    for (let i = 0; i < a.data.length; i += 4) {
        if (Math.abs(a.data[i] - b.data[i]) > PIXEL_TOLERANCE ||
            Math.abs(a.data[i + 1] - b.data[i + 1]) > PIXEL_TOLERANCE ||
            Math.abs(a.data[i + 2] - b.data[i + 2]) > PIXEL_TOLERANCE) {
            different++;
        }
    }
    return different / (a.width * a.height);
};

// Compares a framework's picture with the scenario's own, which was drawn by another framework.
// The outline has to match, as it proves the same geometry, camera and pose; the shading only has
// to be close, as frameworks light and tone a surface a little differently.
const MAX_OUTLINE_DIFFERENT = 0.005;
const MAX_SHADING_DIFFERENT = 24;

const compareLoosely = (a, b) => {
    // anything unlike the top-left corner, which shows the clear colour, is part of the object
    const mask = (png) => {
        const out = new Uint8Array(png.width * png.height);
        for (let i = 0; i < out.length; i++) {
            const p = i * 4;
            const d = Math.abs(png.data[p] - png.data[0]) + Math.abs(png.data[p + 1] - png.data[1]) + Math.abs(png.data[p + 2] - png.data[2]);
            out[i] = d > 30 ? 1 : 0;
        }
        return out;
    };
    const luminance = (png, i) => 0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];

    const maskA = mask(a);
    const maskB = mask(b);
    let outline = 0;
    let shading = 0;
    let inside = 0;
    for (let i = 0; i < maskA.length; i++) {
        if (maskA[i] !== maskB[i]) {
            outline++;
        } else if (maskA[i]) {
            shading += Math.abs(luminance(a, i) - luminance(b, i));
            inside++;
        }
    }
    return {
        // share of the picture where one shows the object and the other the background
        outline: outline / maskA.length,
        // mean brightness difference over the object, out of 255
        shading: inside ? shading / inside : 0
    };
};

// how the browser is launched; recorded with every result
export const LAUNCH = {
    channel: 'chrome',
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist']
};

/**
 * @returns {Promise<import('playwright-core').Browser>} The browser used for checks.
 */
export const launchBrowser = () => chromium.launch(LAUNCH);

/**
 * @param {import('playwright-core').Browser} browser - The browser.
 * @param {{ outDir: string, variant: string, reference: string }} variant - The built variant. Its
 * name lists the device types it may run on, joined by "-or-", e.g. webgl2 or webgpu-or-webgl2.
 * @param {boolean} updateReference - Replace the reference with this variant's screenshot.
 * @returns {Promise<{ ok: boolean, problems: string[], deviceType: string|null,
 * referenceDiff: number|null, referenceWritten: boolean }>} The outcome.
 */
export const verify = async (browser, variant, updateReference) => {
    const server = await serve(variant.outDir);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    const problems = [];
    let deviceType = null;
    let referenceDiff = null;
    let referenceWritten = false;
    let canonicalDiff = null;

    page.on('pageerror', err => problems.push(`page error: ${err.message}`));
    page.on('response', (res) => {
        if (res.status() >= 400) {
            problems.push(`${res.status()} for ${new URL(res.url()).pathname}`);
        }
    });
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            problems.push(`console error: ${msg.text()}`);
        }
    });

    const rendered = () => page.waitForFunction(() => window.__metrics?.frames >= 3, null, { timeout: 15000 });
    const canvas = page.locator('#app');

    try {
        // running freely: the right backend, and a picture that changes
        await page.goto(url);
        await rendered();
        const first = await canvas.screenshot();
        const frames = await page.evaluate(() => window.__metrics.frames);
        await page.waitForFunction(n => window.__metrics.frames >= n + 20, frames, { timeout: 15000 });
        const second = await canvas.screenshot();

        deviceType = await page.evaluate(() => window.__metrics.deviceType);
        const allowed = variant.variant.split('-or-');
        if (!allowed.includes(deviceType)) {
            problems.push(`device type is ${deviceType}, expected ${allowed.join(' or ')}`);
        }
        if (first.equals(second)) {
            problems.push('the frame does not change over time');
        }

        // held at a fixed time: the same picture as the reference
        await page.goto(`${url}?pose=${POSE}`);
        await rendered();
        const posed = await canvas.screenshot({ path: path.join(variant.outDir, 'screenshot.png') });
        const png = PNG.sync.read(posed);
        if (png.width !== 1280 || png.height !== 720) {
            problems.push(`canvas is ${png.width}x${png.height}, expected 1280x720`);
        } else if (updateReference || !fs.existsSync(variant.reference)) {
            fs.writeFileSync(variant.reference, posed);
            referenceWritten = true;
            referenceDiff = 0;
        } else {
            referenceDiff = difference(png, PNG.sync.read(fs.readFileSync(variant.reference)));
            if (referenceDiff > MAX_DIFFERENT) {
                problems.push(`${(100 * referenceDiff).toFixed(1)}% of the picture differs from ${path.basename(variant.reference)}`);
            }
        }

        // an implementation with its own reference must still broadly agree with the scenario's
        if (variant.canonical !== variant.reference && png.width === 1280 && png.height === 720) {
            if (!fs.existsSync(variant.canonical)) {
                problems.push(`${path.basename(variant.canonical)} does not exist yet; run the scenario's main framework first`);
            } else {
                canonicalDiff = compareLoosely(png, PNG.sync.read(fs.readFileSync(variant.canonical)));
                if (canonicalDiff.outline > MAX_OUTLINE_DIFFERENT) {
                    problems.push(`the outline differs from ${path.basename(variant.canonical)} over ${(100 * canonicalDiff.outline).toFixed(1)}% of the picture`);
                }
                if (canonicalDiff.shading > MAX_SHADING_DIFFERENT) {
                    problems.push(`the shading differs from ${path.basename(variant.canonical)} by ${canonicalDiff.shading.toFixed(0)} of 255 on average`);
                }
            }
        }
    } catch (err) {
        problems.push(err.message.split('\n')[0]);
    } finally {
        await page.close();
        server.close();
    }

    return { ok: problems.length === 0, problems, deviceType, referenceDiff, referenceWritten, canonicalDiff };
};
