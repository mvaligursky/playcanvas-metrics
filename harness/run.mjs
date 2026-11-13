// Usage: npm run bench -- [options]
//
//   --engine <list>      comma separated engines to measure (default: the checkout's working tree).
//                        Each is a checkout path, a git ref (main, a branch, a tag, a SHA) or an
//                        npm version (2.24.1, or 2.24 for the latest patch of that minor), or a
//                        three.js release (three@0.187, three@r187, three@last5)
//   --checkout <path>    engine checkout used to resolve git refs (default: ../engine)
//   --scenario <name>    only run this scenario
//   --no-verify          skip the browser check that each bundle renders
//   --no-save            print the summary without writing result files
//   --update-reference   replace each scenario's reference.png with what the first engine renders

import path from 'node:path';
import { parseArgs } from 'node:util';

import { bundle, measureBaseline } from './bundle.mjs';
import { engineLabel, expandSpecs, resolveEngine } from './engine.mjs';
import { browserInfo, harnessInfo, machineInfo } from './environment.mjs';
import { DIST_DIR, ROOT } from './paths.mjs';
import { bundleKey, engineId, loadResults, printSummary, writeResult } from './report.mjs';
import { writeReportPage } from './report-page.mjs';
import { loadScenarios, select } from './scenarios.mjs';

const { values: args } = parseArgs({
    options: {
        'engine': { type: 'string' },
        'checkout': { type: 'string', default: path.join(ROOT, '..', 'engine') },
        'scenario': { type: 'string' },
        'no-verify': { type: 'boolean', default: false },
        'no-save': { type: 'boolean', default: false },
        'update-reference': { type: 'boolean', default: false }
    }
});

const scenarios = loadScenarios(args.scenario);
if (!scenarios.length) {
    console.error(args.scenario ? `No scenario named "${args.scenario}"` : 'No scenarios found');
    process.exit(1);
}

const specs = expandSpecs(args.engine ?? args.checkout);

const machine = machineInfo();
const harness = harnessInfo();

let browser = null;
let browserDetails = null;
let updateReference = args['update-reference'];
const outcomes = [];

const runEngine = async (spec) => {
    console.log(`\n=== ${spec} ===`);
    const engine = resolveEngine(spec, args.checkout);
    const where = engine.sha ? `${engineLabel(engine)}${engine.dirty ? ' (local changes)' : ''} on ${engine.ref}` : 'from npm';
    console.log(`${engine.library} ${engine.version}, ${where}${engine.cached ? ', cached build' : ''}`);

    const result = {
        schema: 3,
        timestamp: new Date().toISOString(),
        machine: machine.id,
        // what the result was measured with; browser stays null when the check is skipped
        environment: machine,
        harness,
        browser: null,
        engine: {
            library: engine.library,
            version: engine.version,
            source: engine.source,
            sha: engine.sha,
            ref: engine.ref,
            dirty: engine.dirty,
            date: engine.date
        },
        // the library's own full minified builds; baselineName is the one bundles are compared to
        baselineName: engine.baselineName,
        baseline: {},
        bundles: []
    };

    for (const [name, baseline] of Object.entries(engine.baselines)) {
        result.baseline[name] = await measureBaseline(engine, baseline);
    }

    const built = [];
    for (const scenario of scenarios) {
        const { variants, unsupported } = select(scenario, engine.library, engine.version);
        for (const item of unsupported) {
            result.bundles.push({ ...item, status: 'unsupported' });
        }
        for (const variant of variants) {
            // builds of published releases are kept, each at its own address; anything built from
            // source on this machine goes to a work folder that the next run overwrites
            // (a run that saves no results leaves the kept builds alone as well)
            const kept = engine.source === 'npm' && !args['no-save'];
            const build = kept ?
                `builds/${engine.library}-${engine.version}/${variant.scenario}/${variant.variant}` :
                `work/${variant.scenario}/${variant.framework}/${variant.variant}`;
            variant.outDir = path.join(DIST_DIR, build);

            const entry = {
                scenario: variant.scenario,
                framework: variant.framework,
                variant: variant.variant,
                status: 'measured',
                verified: false,
                revision: variant.revision,
                implementation: variant.implementation,
                // where the runnable build is, relative to dist/; null when it is not kept
                build: kept ? `${build}/` : null
            };
            result.bundles.push(entry);
            try {
                Object.assign(entry, await bundle(variant, engine));
                built.push({ variant, entry });
            } catch (err) {
                entry.status = 'failed';
                entry.problems = [`build: ${err.message.split('\n')[0]}`];
            }
        }
    }

    if (!args['no-verify'] && built.length) {
        const { LAUNCH, launchBrowser, verify } = await import('./verify.mjs');
        browser ??= await launchBrowser();
        browserDetails ??= await browserInfo(browser, LAUNCH);
        result.browser = browserDetails;
        const written = new Set();
        for (const { variant, entry } of built) {
            // a reference is only ever replaced once per run, by the first variant that renders
            const outcome = await verify(browser, variant, updateReference && !written.has(variant.reference));
            if (outcome.referenceWritten) {
                written.add(variant.reference);
                console.log(`Wrote ${path.relative(ROOT, variant.reference)} from ${bundleKey(entry)}`);
            }
            entry.verified = outcome.ok;
            // the graphics API the bundle actually ran on, which a fallback variant does not fix
            entry.deviceType = outcome.deviceType;
            entry.referenceDiff = outcome.referenceDiff;
            if (outcome.canonicalDiff) {
                entry.canonicalDiff = outcome.canonicalDiff;
            }
            if (!outcome.ok) {
                // a bundle that does not render must not count as a size
                entry.status = 'failed';
                entry.problems = outcome.problems;
                delete entry.size;
                delete entry.files;
                delete entry.modules;
            }
        }
        updateReference = false;
    }

    // a run limited to one scenario keeps what the engine's last result has for the others
    if (args.scenario) {
        const earlier = loadResults().find(r => engineId(r.engine) === engineId(result.engine));
        result.bundles.unshift(...(earlier?.bundles ?? []).filter(b => b.scenario !== args.scenario));
    }

    printSummary(result);
    if (!args['no-save']) {
        console.log(`  Wrote ${path.relative(ROOT, writeResult(result))}`);
    }

    const count = status => result.bundles.filter(b => b.status === status).length;
    outcomes.push({ spec, engine: `${engine.library} ${engine.version} (${engineLabel(engine)})`, measured: count('measured'), unsupported: count('unsupported'), failed: count('failed') });
};

try {
    for (const spec of specs) {
        try {
            await runEngine(spec);
        } catch (err) {
            console.error(`  ${err.message}`);
            outcomes.push({ spec, engine: 'could not be resolved', measured: 0, unsupported: 0, failed: 1 });
        }
    }
} finally {
    await browser?.close();
}

if (specs.length > 1) {
    console.log('\n=== Summary ===');
    for (const o of outcomes) {
        console.log(`${o.spec.padEnd(12)} ${o.engine.padEnd(46)} ${o.measured} measured, ${o.unsupported} not supported, ${o.failed} failed`);
    }
}

if (!args['no-save']) {
    console.log(`\nReport: ${path.relative(ROOT, writeReportPage())} (npm run serve to view)`);
}

process.exitCode = outcomes.some(o => o.failed) ? 1 : 0;
