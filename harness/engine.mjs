// Resolves the engine to benchmark into a folder laid out like the published npm package:
//   <root>/package.json
//   <root>/build/playcanvas/src/index.js   unbundled release modules, what `import 'playcanvas'` resolves to
//   <root>/build/playcanvas.min.mjs        full minified bundle, the "no tree-shaking" baseline
//
// An engine can be given as:
//   a path         the working tree of a checkout, built as it is (local changes included)
//   a git ref      main, a branch, a tag or a SHA; fetched and exported from the checkout's remote
//   an npm version 2.24.1, or 2.24 for the latest patch of that minor
//   three@<version> a published three.js release: three@0.187.0, three@0.187, three@r187, or
//                   three@last5 for the five most recent releases
//
// Checkouts and refs are built into this repo's cache with the engine's own build code, so the
// checkout's working tree, branch and build/ folder are never touched.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import semver from 'semver';

import { CACHE_DIR } from './paths.mjs';

const BUILD_SCRIPT = `
import { buildTarget } from './utils/esbuild-build-target.mjs';
const dir = process.env.ENGINE_METRICS_OUT;
await buildTarget({ moduleFormat: 'esm', buildType: 'rel', dir });
await buildTarget({ moduleFormat: 'esm', buildType: 'min', dir });
`;

// what the engine build reads; exported for a git ref
const BUILD_INPUTS = ['src', 'utils', 'build.mjs', 'package.json'];

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const tryGit = (cwd, ...args) => {
    try {
        return git(cwd, ...args);
    } catch {
        return null;
    }
};

const describe = (root, info) => {
    const entry = path.join(root, 'build', 'playcanvas', 'src', 'index.js');
    const min = path.join(root, 'build', 'playcanvas.min.mjs');
    for (const file of [entry, min]) {
        if (!fs.existsSync(file)) {
            throw new Error(`Engine build is missing ${file}`);
        }
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return {
        library: 'playcanvas',
        root,
        version: pkg.version,
        // `import 'playcanvas'` is pointed at the unbundled modules
        alias: { playcanvas: entry },
        // module ids in results are relative to this folder
        moduleRoot: path.join(root, 'build', 'playcanvas'),
        baselines: { 'playcanvas.min.mjs': { files: [min] } },
        baselineName: 'playcanvas.min.mjs',
        ...info
    };
};

const checkCheckout = (checkout) => {
    if (!fs.existsSync(path.join(checkout, 'package.json'))) {
        throw new Error(`${checkout} is not an engine checkout`);
    }
    if (!fs.existsSync(path.join(checkout, 'node_modules', 'esbuild'))) {
        throw new Error(`${checkout} has no node_modules; run npm install there first`);
    }
};

// builds the engine sources in sourceDir into root, and gives root the engine's package.json
const buildInto = (root, sourceDir, sha) => {
    if (!fs.existsSync(path.join(sourceDir, 'utils', 'esbuild-build-target.mjs'))) {
        throw new Error(`${sha.slice(0, 7)} has no utils/esbuild-build-target.mjs; only commits that use the esbuild build can be built from source. Use an npm version for older engines.`);
    }

    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, 'build'), { recursive: true });

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', BUILD_SCRIPT], {
        cwd: sourceDir,
        env: {
            ...process.env,
            ENGINE_METRICS_OUT: path.join(root, 'build'),
            // the revision is embedded in the build; pinned so an export builds like the checkout
            ENGINE_BUILD_REVISION: sha.slice(0, 9)
        },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    if (result.status !== 0) {
        throw new Error(`Engine build failed for ${sha.slice(0, 7)}`);
    }

    // bundlers read "sideEffects" from the nearest package.json, so the engine's own goes with it
    fs.copyFileSync(path.join(sourceDir, 'package.json'), path.join(root, 'package.json'));
    fs.writeFileSync(path.join(root, '.complete'), '');
};

const cacheRoot = (sha, dirty) => path.join(CACHE_DIR, 'engine', `${sha.slice(0, 12)}${dirty ? '-dirty' : ''}`);

const resolvePath = (checkout) => {
    checkCheckout(checkout);

    const sha = git(checkout, 'rev-parse', 'HEAD');
    const branch = git(checkout, 'rev-parse', '--abbrev-ref', 'HEAD');
    // only changes that can alter the build output count as dirty
    const dirty = git(checkout, 'status', '--porcelain', '--', ...BUILD_INPUTS) !== '';
    const info = {
        source: 'checkout',
        sha,
        ref: branch,
        dirty,
        date: dirty ? new Date().toISOString() : git(checkout, 'show', '-s', '--format=%cI', sha)
    };

    // a clean commit always builds to the same output; a dirty tree has to be rebuilt every time
    const root = cacheRoot(sha, dirty);
    const cached = !dirty && fs.existsSync(path.join(root, '.complete'));
    if (!cached) {
        buildInto(root, checkout, sha);
    }
    return describe(root, { ...info, cached });
};

const resolveRef = (ref, checkout) => {
    checkCheckout(checkout);

    // fetching only updates the checkout's remote-tracking refs
    const remote = tryGit(checkout, 'remote') ? 'origin' : null;
    if (remote && tryGit(checkout, 'fetch', '--quiet', remote, ref) === null) {
        console.warn(`Could not fetch ${ref} from ${remote}; using what the checkout already has.`);
    }
    const sha = tryGit(checkout, 'rev-parse', '--verify', '--quiet', `${remote}/${ref}^{commit}`) ??
        tryGit(checkout, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
    if (!sha) {
        throw new Error(`"${ref}" is not a path, an npm version, or a git ref known to ${checkout}`);
    }

    // a commit given by SHA is recorded as main when it is part of main's history, so that
    // remeasuring an old main commit keeps it on the main line
    const isSha = /^[0-9a-f]{7,40}$/i.test(ref) && sha.startsWith(ref.toLowerCase());
    const onMain = isSha && remote && tryGit(checkout, 'merge-base', '--is-ancestor', sha, `${remote}/main`) !== null;

    const info = { source: 'ref', sha, ref: onMain ? 'main' : ref, dirty: false, date: git(checkout, 'show', '-s', '--format=%cI', sha) };
    const root = cacheRoot(sha, false);
    if (fs.existsSync(path.join(root, '.complete'))) {
        return describe(root, { ...info, cached: true });
    }

    // export just the build inputs of that commit
    const sourceDir = path.join(CACHE_DIR, 'engine-src', sha.slice(0, 12));
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.mkdirSync(sourceDir, { recursive: true });
    const tar = path.join(sourceDir, 'source.tar');
    git(checkout, 'archive', '--format=tar', '-o', tar, sha, ...BUILD_INPUTS);
    execFileSync('tar', ['-xf', tar, '-C', sourceDir]);
    fs.rmSync(tar);

    // the engine build finds its package.json through the enclosing git repository, which would
    // otherwise be this one
    git(sourceDir, 'init', '--quiet');

    // the export borrows the checkout's installed build tools
    fs.symlinkSync(path.join(checkout, 'node_modules'), path.join(sourceDir, 'node_modules'), 'junction');
    const wanted = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8')).devDependencies?.esbuild;
    const installed = JSON.parse(fs.readFileSync(path.join(checkout, 'node_modules', 'esbuild', 'package.json'), 'utf8')).version;
    if (wanted && wanted !== installed) {
        console.warn(`${ref} pins esbuild ${wanted} but the checkout has ${installed} installed; sizes may differ slightly from an official build.`);
    }

    try {
        buildInto(root, sourceDir, sha);
    } finally {
        // remove the junction itself first, so that deleting the export cannot reach through it
        fs.rmSync(path.join(sourceDir, 'node_modules'), { force: true });
        fs.rmSync(sourceDir, { recursive: true, force: true });
    }
    return describe(root, { ...info, cached: false });
};

const npmJson = (...args) => {
    // one command string: npm is a .cmd on Windows, which needs a shell
    const result = spawnSync(`npm view ${args.join(' ')} --json`, { shell: true, encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`npm view ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return JSON.parse(result.stdout);
};

const registries = new Map();
const npmRegistry = (pkg) => {
    if (!registries.has(pkg)) {
        registries.set(pkg, npmJson(pkg, 'time', 'versions'));
    }
    return registries.get(pkg);
};

// installs a published package into the cache; 2.24 means the latest stable patch of that minor
const installNpm = (pkg, spec, cacheName) => {
    const { versions, time } = npmRegistry(pkg);

    const version = /^\d+\.\d+$/.test(spec) ? semver.maxSatisfying(versions, `~${spec}.0`) : spec;
    // the version goes into a shell command below, so it has to be one the registry lists
    if (!version || !versions.includes(version)) {
        throw new Error(`There is no published ${pkg} version matching "${spec}"`);
    }

    const dir = path.join(CACHE_DIR, 'engine', `${cacheName}-${version}`);
    const root = path.join(dir, 'node_modules', pkg);
    const cached = fs.existsSync(path.join(root, 'package.json'));

    if (!cached) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
        const result = spawnSync(`npm install ${pkg}@${version} --no-audit --no-fund --ignore-scripts`, {
            cwd: dir,
            shell: true,
            stdio: ['ignore', 'ignore', 'inherit']
        });
        if (result.status !== 0) {
            fs.rmSync(dir, { recursive: true, force: true });
            throw new Error(`npm install ${pkg}@${version} failed`);
        }
    }

    return { dir, root, version, date: time[version], cached };
};

const resolveNpm = (spec) => {
    const { root, date, cached } = installNpm('playcanvas', spec, 'npm');
    return describe(root, { source: 'npm', sha: null, ref: null, dirty: false, date, cached });
};

// three.js is measured exactly as published: `import 'three'` resolves through its package.json
const resolveThree = (spec) => {
    // r187 is how three.js names 0.187
    const { dir, root, version, date, cached } = installNpm('three', spec.replace(/^r(\d+)$/, '0.$1'), 'npm-three');
    return {
        library: 'three',
        root,
        version,
        // bare imports of three are resolved as if written in a file next to its node_modules
        resolveFrom: { pattern: /^three(\/|$)/, importer: path.join(dir, 'index.js') },
        moduleRoot: root,
        // three.js no longer publishes minified builds, so the full library is every export of
        // an entry point, bundled and minified the same way as the scenarios
        baselines: {
            'three, all exports': { everything: 'three' },
            'three/webgpu, all exports': { everything: 'three/webgpu' }
        },
        baselineName: 'three, all exports',
        source: 'npm',
        sha: null,
        ref: null,
        dirty: false,
        date,
        cached
    };
};

/**
 * Expands the --engine list. "three@last5" becomes the five most recent three.js releases.
 *
 * @param {string} list - Comma separated engine specs.
 * @returns {string[]} One spec per engine build.
 */
export const expandSpecs = (list) => {
    return list.split(',').map(s => s.trim()).filter(Boolean).flatMap((spec) => {
        const last = /^three@last(\d+)$/.exec(spec);
        if (!last) {
            return [spec];
        }
        const stable = npmRegistry('three').versions.filter(v => !semver.prerelease(v));
        const minors = [...new Set(stable.map(v => `${semver.major(v)}.${semver.minor(v)}`))];
        return minors.slice(-Number(last[1])).map(minor => `three@${minor}`);
    });
};

/**
 * @param {string} spec - A checkout path, a git ref, or an npm version.
 * @param {string} checkout - The engine checkout used to resolve git refs.
 * @returns {{ root: string, entry: string, min: string, version: string, source: string,
 * sha: string|null, ref: string|null, dirty: boolean, date: string, cached: boolean }} The engine.
 */
export const resolveEngine = (spec, checkout) => {
    if (spec.startsWith('three@')) {
        return resolveThree(spec.slice('three@'.length));
    }
    if (fs.existsSync(path.join(spec, 'package.json'))) {
        return resolvePath(path.resolve(spec));
    }
    if (/^\d+\.\d+(?:\.\d.*)?$/.test(spec)) {
        return resolveNpm(spec);
    }
    return resolveRef(spec, path.resolve(checkout));
};

/**
 * @param {{ source: string, version: string, sha: string|null, dirty: boolean }} engine - The engine.
 * @returns {string} A short name that identifies the engine build, used in file names and charts.
 */
export const engineLabel = (engine) => {
    const prefix = engine.library === 'playcanvas' ? '' : `${engine.library}-`;
    return prefix + (engine.sha ? `${engine.sha.slice(0, 7)}${engine.dirty ? '-dirty' : ''}` : `v${engine.version}`);
};
