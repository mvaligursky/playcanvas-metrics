// Rebuilds the runnable builds of published releases: one per variant, for every release that has
// a stored result. They are not committed, so this is what brings them back on a fresh clone, and
// what CI runs before it packages the report. Results are not changed.
//
// Usage: npm run builds [-- --force]
//
//   --force   rebuild even where a build is already there

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { bundle } from './bundle.mjs';
import { resolveEngine } from './engine.mjs';
import { DIST_DIR, ROOT } from './paths.mjs';
import { bundleKey, loadResults } from './report.mjs';
import { writeReportPage } from './report-page.mjs';
import { loadScenarios, select } from './scenarios.mjs';

const { values: args } = parseArgs({ options: { force: { type: 'boolean', default: false } } });

const scenarios = loadScenarios();
let built = 0;
let present = 0;
const different = [];

for (const result of loadResults().filter(r => r.engine.source === 'npm')) {
    const { library, version } = result.engine;
    // which of this release's bundles have a build to bring back
    const wanted = new Map(result.bundles.filter(b => b.status === 'measured' && b.build).map(b => [bundleKey(b), b]));
    const missing = [...wanted.values()].filter(b => args.force || !fs.existsSync(path.join(DIST_DIR, b.build, 'index.html')));
    present += wanted.size - missing.length;
    if (!missing.length) {
        continue;
    }

    console.log(`${library} ${version}: ${missing.length} build${missing.length > 1 ? 's' : ''}`);
    const engine = resolveEngine(library === 'playcanvas' ? version : `${library}@${version}`, ROOT);

    for (const scenario of scenarios) {
        for (const variant of select(scenario, library, version).variants) {
            const stored = wanted.get(bundleKey(variant));
            if (!stored || !missing.includes(stored)) {
                continue;
            }
            variant.outDir = path.join(DIST_DIR, stored.build);
            const { size } = await bundle(variant, engine);
            built++;
            // the same sources and tools should give the same bytes on any machine
            if (size.raw !== stored.size.raw) {
                different.push(`${library} ${version} ${bundleKey(variant)}: ${size.raw} bytes here, ${stored.size.raw} in the stored result`);
            }
        }
    }
}

console.log(`\n${built} built, ${present} already there.`);
if (different.length) {
    console.log(`${different.length} differ in size from their stored result:`);
    for (const line of different) {
        console.log(`  ${line}`);
    }
}
console.log(`Report: ${path.relative(ROOT, writeReportPage())}`);
