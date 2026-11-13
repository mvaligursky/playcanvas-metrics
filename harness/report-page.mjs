// Generates the report site under dist/report/ from every stored result:
//
//   index.html                           the sections: bundle size, and those still to come
//   bundle-size/index.html               one card per scenario, with a library-against-library chart
//   bundle-size/<scenario>/index.html    the full report for one scenario
//   bundle-size/<scenario>/treemap/      that scenario's treemap alone, filling the window
//   assets/                              styles, scripts and the chart library, shared by all pages
//   data/                                the numbers, as scripts so pages also open from disk
//
// Usage: npm run report   (a bench run that saves results also regenerates it)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIST_DIR, ROOT } from './paths.mjs';
import { bundleKey, engineId, loadResults } from './report.mjs';
import { loadScenarios } from './scenarios.mjs';

const SITE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'site');
const OUT_DIR = path.join(DIST_DIR, 'report');

// how many named areas the composition chart shows before folding the rest into "Other"
const MAX_AREAS = 7;

const SECTIONS = [
    { id: 'bundle-size', title: 'Bundle size', description: 'What a small app ships after tree-shaking, bundling and minifying.', measured: true },
    { id: 'first-frame', title: 'Time to first frame', description: 'How long a scenario takes from page load to its first rendered frame.', measured: false },
    { id: 'performance', title: 'Runtime performance', description: 'Frame time, draw calls and memory while a scenario runs.', measured: false }
];

// a module's area: for PlayCanvas the first two folders under src/, e.g. scene/shader-lib; for a
// library published as pre-built files, the file. Must match areaOf in site/scenario.js
const areaOf = (id) => {
    if (id === '(unmapped)' || id.startsWith('\0')) {
        return 'bundler runtime';
    }
    if (id.startsWith('scenarios/')) {
        return 'scenario code';
    }
    if (id.startsWith('build/')) {
        return id.slice('build/'.length);
    }
    if (!id.startsWith('src/')) {
        return 'other packages';
    }
    const parts = id.split('/');
    return parts.length > 3 ? `${parts[1]}/${parts[2]}` : parts[1].replace(/\.js$/, '');
};

const track = (engine) => {
    if (engine.source === 'npm') {
        return 'release';
    }
    return engine.ref === 'main' && !engine.dirty ? 'main' : 'branch';
};

// what the results were measured with: the most common setup, and how many others there are
const environmentOf = (results) => {
    const setups = new Map();
    for (const r of results.filter(r => r.environment)) {
        const gpu = r.browser?.webgl2?.renderer.match(/ANGLE \([^,]+, ([^,(]+)/)?.[1].trim() ?? r.browser?.webgl2?.renderer;
        const text = [
            `${r.environment.os.version}, ${r.environment.cpu.model}${gpu ? `, ${gpu}` : ''}`,
            r.browser ? `Chrome ${r.browser.version}${r.browser.headless ? ' headless' : ''}` : 'no browser check',
            `Vite ${r.harness.vite}`
        ].join(', ');
        setups.set(text, (setups.get(text) ?? 0) + 1);
    }
    const ranked = [...setups].sort((a, b) => b[1] - a[1]);
    return ranked.length ? { text: ranked[0][0], others: ranked.length - 1 } : null;
};

// everything the scenario page shows, for one scenario
const collect = (results, scenario) => {
    // results of an older revision of the scenario are not comparable with the current one
    const revision = Math.max(0, ...results.flatMap(r => r.bundles).filter(b => b.scenario === scenario.name && b.revision !== undefined).map(b => b.revision));

    const libraries = [];
    const bundles = {};
    const variants = [];
    const areaMax = {};

    // PlayCanvas is listed first, whichever library has the oldest result
    const byLibrary = [...results].sort((a, b) => (b.engine.library === 'playcanvas') - (a.engine.library === 'playcanvas'));

    const engines = [];
    for (const result of byLibrary) {
        const { engine } = result;
        const library = engine.library;
        const own = result.bundles.filter(b => b.scenario === scenario.name);
        if (!own.length) {
            continue;
        }
        if (!libraries.includes(library)) {
            libraries.push(library);
            bundles[library] = [];
            areaMax[library] = new Map();
        }
        const kind = track(engine);
        const entries = {};
        for (const b of own) {
            const key = bundleKey(b);
            if (b.status === 'unsupported') {
                // recorded per framework; applies to every variant of it
                entries[`${key} / *`] = { status: 'unsupported', note: b.reason };
                continue;
            }
            if (!bundles[library].includes(key)) {
                bundles[library].push(key);
            }
            if (!variants.includes(b.variant)) {
                variants.push(b.variant);
            }
            if (b.status === 'failed') {
                entries[key] = { status: 'failed', note: b.problems.join('; ') };
                continue;
            }
            if (b.revision !== revision) {
                entries[key] = { status: 'stale', note: `measured with scenario revision ${b.revision}, now ${revision}` };
                continue;
            }
            const areas = {};
            for (const m of b.modules) {
                const area = areaOf(m.id);
                areas[area] = (areas[area] ?? 0) + m.bytes;
            }
            for (const [area, bytes] of Object.entries(areas)) {
                areaMax[library].set(area, Math.max(areaMax[library].get(area) ?? 0, bytes));
            }
            entries[key] = {
                status: 'measured',
                verified: b.verified,
                size: b.size,
                impl: `${b.implementation.dir} ${b.implementation.hash}`,
                // only offered when the build is still on disk
                build: b.build && fs.existsSync(path.join(DIST_DIR, b.build, 'index.html')) ? b.build : null,
                areas,
                modules: b.modules.map(m => [m.id, m.bytes])
            };
        }
        engines.push({
            id: engineId(engine),
            library,
            name: kind === 'release' ? engine.version : engine.ref,
            sub: engine.sha ? `${engine.sha.slice(0, 7)}${engine.dirty ? ' +changes' : ''}` : '',
            track: kind,
            version: engine.version,
            date: engine.date.slice(0, 10),
            fullName: result.baselineName,
            full: result.baseline[result.baselineName],
            bundles: entries
        });
    }

    // the largest areas of a library keep their own colour everywhere; the rest fold into "Other"
    const areas = {};
    for (const library of libraries) {
        areas[library] = [...areaMax[library]].sort((a, b) => b[1] - a[1]).slice(0, MAX_AREAS).map(([area]) => area);
    }

    return {
        generated: new Date().toISOString(),
        environment: environmentOf(results),
        scenario: { name: scenario.name, title: scenario.title, description: scenario.description, headline: scenario.headline },
        libraries,
        engines,
        bundles,
        variants,
        areas
    };
};

// a scenario's sizes over time, per variant and library, for the overview pages. A library that
// has no such variant is left out of that variant
const summarize = (data) => {
    const series = {};
    for (const variant of data.variants) {
        series[variant] = {};
        for (const library of data.libraries) {
            const key = data.bundles[library].find(k => k.endsWith(` / ${variant}`));
            if (key) {
                series[variant][library] = data.engines
                .filter(e => e.library === library && e.track !== 'branch' && e.bundles[key]?.status === 'measured')
                .map(e => ({ name: e.name, sub: e.sub, track: e.track, date: e.date, size: e.bundles[key].size }));
            }
        }
    }
    return { ...data.scenario, libraries: data.libraries, variants: data.variants, series };
};

const script = (name, value) => `window.${name} = ${JSON.stringify(value).replace(/</g, '\\u003c')};\n`;

const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};

/**
 * @returns {string} The site's home page.
 */
export const writeReportPage = () => {
    const results = loadResults();
    const scenarios = loadScenarios().filter(s => results.some(r => r.bundles.some(b => b.scenario === s.name)));

    fs.rmSync(OUT_DIR, { recursive: true, force: true });

    for (const name of ['site.css', 'common.js', 'treemap.js', 'scenario.js']) {
        write(path.join(OUT_DIR, 'assets', name), fs.readFileSync(path.join(SITE_DIR, name)));
    }
    // copied in, so the site works offline and from any server
    write(path.join(OUT_DIR, 'assets', 'chart.js'), fs.readFileSync(path.join(ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js')));

    const page = fs.readFileSync(path.join(SITE_DIR, 'scenario.html'), 'utf8');
    const treemapPage = fs.readFileSync(path.join(SITE_DIR, 'treemap.html'), 'utf8');
    const summaries = [];
    for (const scenario of scenarios) {
        const data = collect(results, scenario);
        summaries.push(summarize(data));
        write(path.join(OUT_DIR, 'data', `${scenario.name}.js`), script('DATA', data));
        write(path.join(OUT_DIR, 'bundle-size', scenario.name, 'index.html'),
            page.replaceAll('{{TITLE}}', scenario.title).replaceAll('{{SCENARIO}}', scenario.name));
        // the treemap alone, filling the window
        write(path.join(OUT_DIR, 'bundle-size', scenario.name, 'treemap', 'index.html'),
            treemapPage.replaceAll('{{TITLE}}', scenario.title).replaceAll('{{SCENARIO}}', scenario.name));
        fs.copyFileSync(scenario.reference, path.join(OUT_DIR, 'bundle-size', scenario.name, 'reference.png'));
    }

    write(path.join(OUT_DIR, 'data', 'summary.js'), script('SUMMARY', {
        generated: new Date().toISOString(),
        environment: environmentOf(results),
        sections: SECTIONS,
        scenarios: summaries
    }));
    write(path.join(OUT_DIR, 'bundle-size', 'index.html'), fs.readFileSync(path.join(SITE_DIR, 'section.html')));
    write(path.join(OUT_DIR, 'index.html'), fs.readFileSync(path.join(SITE_DIR, 'home.html')));

    // the server's root leads to the report
    write(path.join(DIST_DIR, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=report/"><a href="report/">Engine metrics report</a>\n');

    return path.join(OUT_DIR, 'index.html');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log(`Wrote ${path.relative(ROOT, writeReportPage())}`);
}
