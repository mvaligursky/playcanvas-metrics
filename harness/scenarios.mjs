// Scenarios and the implementation each engine version gets.
//
// scenarios/<name>/scenario.json:
//   {
//     "title": "Spinning cube",
//     "description": "One line for the report's overview.",
//     "headline": "webgpu-or-webgl2",
//     "revision": 1,
//     "implementations": [
//       { "framework": "playcanvas", "dir": "playcanvas", "engine": ">=2.23.0" },
//       { "framework": "playcanvas", "dir": "playcanvas-pre-2.23", "engine": ">=2.20.0 <2.23.0" }
//     ]
//   }
//
// - For each framework, the first implementation whose "engine" range contains the engine version
//   is used. An engine outside every range is recorded as not supported.
// - Each sub-folder of an implementation's dir that has an index.html is one variant to build.
// - "headline" is the variant that stands for the scenario in overviews; every framework should
//   have it.
// - "revision" is bumped whenever the scenario's spec changes, so that results measured before
//   and after are never joined into one line.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import semver from 'semver';

import { SCENARIOS_DIR, posix } from './paths.mjs';

const subDirs = dir => fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);

const listFiles = (dir) => {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(file) : [file];
    });
};

// identifies the exact source of an implementation, so a result can tell when it changed
const hashDir = (dir) => {
    const hash = createHash('sha256');
    for (const file of listFiles(dir).sort()) {
        hash.update(posix(path.relative(dir, file)));
        // line endings differ between checkouts of the same commit
        hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    }
    return hash.digest('hex').slice(0, 12);
};

/**
 * @param {string} [only] - Name of the single scenario to load.
 * @returns {object[]} The scenarios.
 */
export const loadScenarios = (only) => {
    const scenarios = [];
    for (const name of subDirs(SCENARIOS_DIR)) {
        const dir = path.join(SCENARIOS_DIR, name);
        const manifestFile = path.join(dir, 'scenario.json');
        if ((only && name !== only) || !fs.existsSync(manifestFile)) {
            continue;
        }
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        for (const impl of manifest.implementations) {
            if (!semver.validRange(impl.engine)) {
                throw new Error(`${name}/scenario.json: "${impl.engine}" is not a valid version range`);
            }
            if (!fs.existsSync(path.join(dir, impl.dir))) {
                throw new Error(`${name}/scenario.json: there is no folder "${impl.dir}"`);
            }
        }
        scenarios.push({ name, dir, reference: path.join(dir, 'reference.png'), ...manifest });
    }
    return scenarios;
};

/**
 * Picks, per framework, the implementation of a scenario for an engine version.
 *
 * @param {object} scenario - The scenario.
 * @param {string} library - The library being measured: playcanvas or three.
 * @param {string} engineVersion - The engine version. A prerelease such as 2.25.0-beta.3 is
 * matched as the release it leads to, so that main always falls in the newest range.
 * @returns {{ variants: object[], unsupported: object[] }} What to build, and what cannot be.
 */
export const select = (scenario, library, engineVersion) => {
    const version = semver.coerce(engineVersion).version;
    const variants = [];
    const unsupported = [];

    // a scenario with no implementation at all for this library is simply not about it
    for (const framework of new Set(scenario.implementations.map(impl => impl.framework))) {
        if (framework !== library) {
            continue;
        }
        const candidates = scenario.implementations.filter(impl => impl.framework === framework);
        const impl = candidates.find(c => semver.satisfies(version, c.engine));
        if (!impl) {
            unsupported.push({
                scenario: scenario.name,
                framework,
                reason: `needs engine ${candidates.map(c => c.engine).join(' or ')}`
            });
            continue;
        }

        const implDir = path.join(scenario.dir, impl.dir);
        const implementation = { dir: impl.dir, hash: hashDir(implDir) };
        for (const variant of subDirs(implDir)) {
            const dir = path.join(implDir, variant);
            if (fs.existsSync(path.join(dir, 'index.html'))) {
                variants.push({
                    scenario: scenario.name,
                    framework,
                    variant,
                    revision: scenario.revision,
                    implementation,
                    dir,
                    // the picture this implementation must reproduce exactly
                    reference: path.join(scenario.dir, impl.reference ?? 'reference.png'),
                    // the scenario's own picture, which every framework must broadly agree with
                    canonical: scenario.reference
                });
            }
        }
    }

    return { variants, unsupported };
};
