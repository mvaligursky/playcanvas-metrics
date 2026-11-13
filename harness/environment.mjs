// What a result was measured with: the machine, the tools and the browser. Bundle sizes depend on
// the tools only; the timing benchmarks to come depend on all of it.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';

import { ROOT } from './paths.mjs';

const require = createRequire(import.meta.url);

const packageVersion = (name) => {
    try {
        return JSON.parse(fs.readFileSync(`${ROOT}/node_modules/${name}/package.json`, 'utf8')).version;
    } catch {
        return null;
    }
};

const git = (...args) => {
    try {
        return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return null;
    }
};

/**
 * @returns {object} The machine this run is on.
 */
export const machineInfo = () => {
    const cpus = os.cpus();
    return {
        // Tells machines apart without naming them: results are only comparable on one machine,
        // but its name is nobody's business. ENGINE_METRICS_MACHINE gives a runner a chosen id.
        id: process.env.ENGINE_METRICS_MACHINE ?? `m-${createHash('sha256').update(os.hostname().toLowerCase()).digest('hex').slice(0, 8)}`,
        os: { platform: os.platform(), version: os.version(), release: os.release(), arch: os.arch() },
        cpu: { model: cpus[0]?.model.trim() ?? null, threads: cpus.length },
        memoryGb: Math.round(os.totalmem() / 2 ** 30)
    };
};

/**
 * @returns {object} The versions of everything that shapes a bundle, and of this harness.
 */
export const harnessInfo = () => {
    const status = git('status', '--porcelain');
    return {
        version: require('../package.json').version,
        // null until this repo has a commit
        commit: git('rev-parse', 'HEAD'),
        dirty: status === null ? null : status !== '',
        node: process.version,
        vite: packageVersion('vite'),
        rolldown: packageVersion('rolldown'),
        playwright: packageVersion('playwright-core')
    };
};

/**
 * @param {import('playwright-core').Browser} browser - The browser used for checks.
 * @param {{ channel: string, headless: boolean, args: string[] }} launch - How it was launched.
 * @returns {Promise<object>} The browser and the graphics hardware it reports.
 */
export const browserInfo = async (browser, launch) => {
    // WebGPU needs a secure context, which a page from localhost is
    const server = http.createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html>'));
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
    const page = await browser.newPage();
    try {
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const reported = await page.evaluate(async () => {
            const gl = document.createElement('canvas').getContext('webgl2');
            const ext = gl?.getExtension('WEBGL_debug_renderer_info');
            const adapter = await navigator.gpu?.requestAdapter();
            const info = adapter?.info;
            return {
                userAgent: navigator.userAgent,
                hardwareConcurrency: navigator.hardwareConcurrency,
                webgl2: gl ? {
                    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
                    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
                } : null,
                webgpu: info ? {
                    vendor: info.vendor,
                    architecture: info.architecture,
                    device: info.device,
                    description: info.description,
                    fallbackAdapter: adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? null
                } : null
            };
        });
        return {
            name: launch.channel,
            version: browser.version(),
            headless: launch.headless,
            args: launch.args,
            ...reported
        };
    } finally {
        await page.close();
        server.close();
    }
};
