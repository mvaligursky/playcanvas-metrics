// Collects the npm dependencies of PlayCanvas releases: for the engine and for its examples app,
// the top-level dependencies, every package they install, and each package's unpacked size.
//
// Everything comes from the package-lock.json files at each release tag of an engine checkout,
// and sizes from the npm registry, so nothing is installed or built. Writes one file per release
// to results/deps/, and main's to results/local/deps/ (not committed).
//
// Usage: npm run deps -- [options]
//
//   --checkout <path>   engine checkout to read release tags from (default: ../engine)
//   --force             collect again releases that already have a result

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import semver from 'semver';

import { CACHE_DIR, LOCAL_RESULTS_DIR, RESULTS_DIR, ROOT } from './paths.mjs';
import { writeReportPage } from './report-page.mjs';

export const DEPS_DIR = path.join(RESULTS_DIR, 'deps');
export const LOCAL_DEPS_DIR = path.join(LOCAL_RESULTS_DIR, 'deps');

// the lockfiles of each project, in the engine repository
const PROJECTS = {
    engine: 'package-lock.json',
    examples: 'examples/package-lock.json'
};

// the platform a real install is counted for: the lockfiles list the native binaries of every
// platform, but an install only fetches its own
const PLATFORM = { os: 'linux', cpu: 'x64', libc: 'glibc' };

// a package's own top-level box, and the group for packages that several top-level ones need
export const SHARED = '(shared)';

const SIZES_FILE = path.join(CACHE_DIR, 'npm-unpacked-sizes.json');

// an os or cpu field allows a platform when it lists it, or excludes others with "!"
const allows = (list, value) => {
    if (!list) {
        return true;
    }
    const values = Array.isArray(list) ? list : [list];
    const blocked = values.filter(v => v.startsWith('!')).map(v => v.slice(1));
    const wanted = values.filter(v => !v.startsWith('!'));
    return !blocked.includes(value) && (!wanted.length || wanted.includes(value));
};

// older npm versions did not record libc, so a musl build is then told by its name
const libcOf = (lockPath, entry) => entry.libc ?? (/-(?:linux)?musl(?:-|$)/.test(lockPath) ? ['musl'] : null);

const installs = (lockPath, entry) => allows(entry.os, PLATFORM.os) && allows(entry.cpu, PLATFORM.cpu) &&
    allows(libcOf(lockPath, entry), PLATFORM.libc);

// the name a lockfile path installs, e.g. node_modules/a/node_modules/@b/c is @b/c
const nameAt = (lockPath, entry) => entry.name ?? lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);

/**
 * Reads a lockfile into its top-level dependencies and the packages each of them installs.
 *
 * @param {object} lock - The parsed package-lock.json (lockfile version 2 or 3).
 * @returns {{ topLevel: object[], packages: object[] }} What the project installs.
 */
export const analyse = (lock) => {
    const all = lock.packages ?? {};
    const root = all[''] ?? {};
    const present = path => all[path] && installs(path, all[path]);

    // Node's resolution: the nearest node_modules folder up from the package that asks
    const resolve = (from, name) => {
        let base = from;
        for (;;) {
            const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
            if (present(candidate)) {
                return candidate;
            }
            if (!base) {
                return null;
            }
            const cut = base.lastIndexOf('/node_modules/');
            base = cut < 0 ? '' : base.slice(0, cut);
        }
    };

    const topLevel = [
        ...Object.entries(root.dependencies ?? {}).map(([name, range]) => ({ name, range, kind: 'runtime' })),
        ...Object.entries(root.devDependencies ?? {}).map(([name, range]) => ({ name, range, kind: 'dev' })),
        ...Object.entries(root.optionalDependencies ?? {}).map(([name, range]) => ({ name, range, kind: 'optional' }))
    ];

    // A link points at a local folder: the engine itself for the examples ("..", counted as a
    // project of its own) or a workspace package inside the project, whose dependencies count
    const follow = (at) => {
        const entry = at && all[at];
        if (!entry?.link) {
            return at;
        }
        return entry.resolved && !entry.resolved.startsWith('..') && all[entry.resolved] ? entry.resolved : null;
    };
    // a local folder is the project's own code, not a package it installs
    const isPackage = at => at.includes('node_modules/');

    // which top-level dependencies reach each installed package
    const reachedBy = new Map();
    for (const top of topLevel) {
        const found = resolve('', top.name);
        const start = follow(found);
        if (found && all[found].link) {
            top.local = all[found].resolved;
        }
        top.version = start ? all[start].version ?? null : null;
        if (!start) {
            continue;
        }
        const queue = [start];
        const seen = new Set(queue);
        while (queue.length) {
            const at = queue.shift();
            if (isPackage(at)) {
                if (!reachedBy.has(at)) {
                    reachedBy.set(at, new Set());
                }
                reachedBy.get(at).add(top.name);
            }
            const entry = all[at];
            const wants = { ...entry.peerDependencies, ...entry.optionalDependencies, ...entry.dependencies };
            for (const name of Object.keys(wants)) {
                const next = follow(resolve(at, name));
                if (next && !seen.has(next)) {
                    seen.add(next);
                    queue.push(next);
                }
            }
        }
    }

    const packages = [...reachedBy].map(([at, tops]) => {
        const entry = all[at];
        return {
            name: nameAt(at, entry),
            version: entry.version,
            group: tops.size === 1 ? [...tops][0] : SHARED,
            dev: Boolean(entry.dev),
            tops: [...tops]
        };
    });
    return { topLevel, packages };
};

// unpacked sizes from the npm registry, by name@version, cached on disk
const loadSizes = () => {
    try {
        return JSON.parse(fs.readFileSync(SIZES_FILE, 'utf8'));
    } catch {
        return {};
    }
};

const fetchSizes = async (wanted, sizes) => {
    const byName = new Map();
    for (const { name, version } of wanted) {
        if (!(`${name}@${version}` in sizes)) {
            if (!byName.has(name)) {
                byName.set(name, new Set());
            }
            byName.get(name).add(version);
        }
    }
    const names = [...byName.keys()];
    if (!names.length) {
        return;
    }
    console.log(`Looking up ${names.length} packages in the npm registry ...`);
    let next = 0;
    const worker = async () => {
        while (next < names.length) {
            const name = names[next++];
            // the abbreviated metadata is all an install needs, and it carries unpacked sizes
            const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
            let versions = {};
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const res = await fetch(url, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
                    if (res.ok) {
                        versions = (await res.json()).versions ?? {};
                        break;
                    }
                    if (res.status === 404) {
                        break;
                    }
                } catch {
                    // retried below
                }
                await new Promise((resolve) => {
                    setTimeout(resolve, 1000 * (attempt + 1));
                });
            }
            for (const version of byName.get(name)) {
                sizes[`${name}@${version}`] = versions[version]?.dist?.unpackedSize ?? null;
            }
        }
    };
    await Promise.all(Array.from({ length: 16 }, worker));
    fs.mkdirSync(path.dirname(SIZES_FILE), { recursive: true });
    fs.writeFileSync(SIZES_FILE, JSON.stringify(sizes));
};

// totals for a list of packages; a package with no recorded size adds to the count only
const totals = (packages) => {
    const known = packages.filter(p => p.size !== null);
    return {
        installed: packages.length,
        unknownSize: packages.length - known.length,
        size: known.reduce((sum, p) => sum + p.size, 0)
    };
};

const describe = (lock, sizes) => {
    const { topLevel, packages } = analyse(lock);
    for (const p of packages) {
        p.size = sizes[`${p.name}@${p.version}`] ?? null;
    }
    const runtime = new Set(topLevel.filter(t => t.kind !== 'dev').map(t => t.name));
    return {
        counts: {
            topLevel: topLevel.length,
            topLevelRuntime: topLevel.filter(t => t.kind !== 'dev').length,
            topLevelDev: topLevel.filter(t => t.kind === 'dev').length,
            ...totals(packages)
        },
        topLevel: topLevel.map(t => ({ ...t, ...totals(packages.filter(p => p.group === t.name)) })),
        // [name, version, unpacked size or null, group, 1 when only development needs it]
        packages: packages.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
        .map(p => [p.name, p.version, p.size, p.group, p.dev ? 1 : 0]),
        // what an app installs with the published package: the runtime dependencies' closure
        app: totals(packages.filter(p => p.tops.some(top => runtime.has(top))))
    };
};

const git = (checkout, ...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

const readLock = (checkout, ref, file) => {
    try {
        return JSON.parse(git(checkout, 'show', `${ref}:${file}`));
    } catch {
        return null;
    }
};

const run = async () => {
    const { values: args } = parseArgs({
        options: {
            checkout: { type: 'string', default: path.join(ROOT, '..', 'engine') },
            force: { type: 'boolean', default: false }
        }
    });
    const checkout = path.resolve(args.checkout);

    git(checkout, 'fetch', '--quiet', '--tags', 'origin');
    git(checkout, 'fetch', '--quiet', 'origin', 'main');

    // the latest patch of every 2.x minor, and main
    const latest = new Map();
    for (const tag of git(checkout, 'tag', '-l', 'v2.*').split('\n')) {
        const version = semver.valid(tag.slice(1));
        if (version && !semver.prerelease(version)) {
            const minor = `${semver.major(version)}.${semver.minor(version)}`;
            if (!latest.has(minor) || semver.gt(version, latest.get(minor))) {
                latest.set(minor, version);
            }
        }
    }
    const published = JSON.parse(spawnSync('npm view playcanvas time --json', { shell: true, encoding: 'utf8' }).stdout || '{}');

    const targets = [...latest.values()].sort(semver.compare).map(version => ({
        file: path.join(DEPS_DIR, `v${version}.json`),
        ref: `v${version}`,
        version,
        source: 'npm',
        date: published[version] ?? git(checkout, 'log', '-1', '--format=%cI', `v${version}`)
    }));
    const mainSha = git(checkout, 'rev-parse', 'origin/main');
    targets.push({
        file: path.join(LOCAL_DEPS_DIR, `main-${mainSha.slice(0, 7)}.json`),
        ref: mainSha,
        version: JSON.parse(git(checkout, 'show', `${mainSha}:package.json`)).version,
        source: 'ref',
        sha: mainSha,
        date: git(checkout, 'log', '-1', '--format=%cI', mainSha)
    });

    const todo = targets.filter(t => args.force || !fs.existsSync(t.file));
    console.log(`${targets.length} builds, ${todo.length} to collect.`);

    const locks = todo.map(t => ({ ...t, locks: Object.fromEntries(Object.entries(PROJECTS).map(([project, file]) => [project, readLock(checkout, t.ref, file)])) }));

    // every package version any of them installs, looked up once
    const sizes = loadSizes();
    const wanted = locks.flatMap(t => Object.values(t.locks).filter(Boolean).flatMap(lock => analyse(lock).packages));
    await fetchSizes(wanted, sizes);

    for (const t of locks) {
        const projects = {};
        for (const [project, lock] of Object.entries(t.locks)) {
            if (lock) {
                projects[project] = describe(lock, sizes);
            }
        }
        const result = {
            schema: 1,
            library: 'playcanvas',
            version: t.version,
            source: t.source,
            sha: t.sha ?? null,
            ref: t.source === 'ref' ? 'main' : null,
            date: t.date,
            platform: PLATFORM,
            projects
        };
        fs.mkdirSync(path.dirname(t.file), { recursive: true });
        fs.writeFileSync(t.file, `${JSON.stringify(result)}\n`);
        const e = projects.engine?.counts;
        const x = projects.examples?.counts;
        console.log(`${t.source === 'ref' ? `main ${t.sha.slice(0, 7)}` : t.version}: engine ${e?.installed ?? '-'} packages, examples ${x?.installed ?? '-'}`);
    }

    console.log(`Report: ${path.relative(ROOT, writeReportPage())}`);
};

/**
 * @returns {object[]} Every stored dependency result, oldest first.
 */
export const loadDeps = () => {
    return [DEPS_DIR, LOCAL_DEPS_DIR].filter(dir => fs.existsSync(dir))
    .flatMap(dir => fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))))
    .sort((a, b) => a.date.localeCompare(b.date));
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'harness', 'deps.mjs')) {
    await run();
}
