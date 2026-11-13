// Result files and the console summary.

import fs from 'node:fs';
import path from 'node:path';

import { engineLabel } from './engine.mjs';
import { LOCAL_RESULTS_DIR, RESULTS_DIR } from './paths.mjs';

const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;

const delta = (now, before) => {
    if (before === undefined) {
        return '';
    }
    const diff = now - before;
    return diff === 0 ? '=' : `${diff > 0 ? '+' : ''}${diff} B`;
};

const table = (rows) => {
    const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)));
    return rows.map((row, r) => {
        const line = row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ');
        return r === 0 ? `${line}\n${widths.map(w => '-'.repeat(w)).join('  ')}` : line;
    }).join('\n');
};

export const bundleKey = b => [b.scenario, b.framework, b.variant].filter(Boolean).join(' / ');

// identifies an engine build across runs
export const engineId = engine => `${engine.library}@${engine.sha ?? engine.version}${engine.dirty ? '-dirty' : ''}`;

/**
 * @returns {object[]} Every stored result, keeping only the latest run of each engine build, in
 * engine order (oldest engine first).
 */
export const loadResults = () => {
    const files = [RESULTS_DIR, LOCAL_RESULTS_DIR].filter(dir => fs.existsSync(dir))
    .flatMap(dir => fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => path.join(dir, n)));
    const latest = new Map();
    for (const file of files) {
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (result.schema !== 3) {
            continue;
        }
        const id = engineId(result.engine);
        if (!latest.has(id) || latest.get(id).timestamp < result.timestamp) {
            latest.set(id, result);
        }
    }
    return [...latest.values()].sort((a, b) => a.engine.date.localeCompare(b.engine.date));
};

// the stored result of the newest build of the same library that is older than this one
const previousOf = (result) => {
    return loadResults().filter((r) => {
        return r.engine.library === result.engine.library && r.engine.date < result.engine.date &&
            engineId(r.engine) !== engineId(result.engine);
    }).at(-1) ?? null;
};

export const writeResult = (result) => {
    // only results of published releases are meant for the repository
    const dir = result.engine.source === 'npm' ? RESULTS_DIR : LOCAL_RESULTS_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const name = `${result.timestamp.slice(0, 10)}_${engineLabel(result.engine)}_${result.machine}.json`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    return file;
};

const STATUS = {
    measured: 'measured',
    unsupported: 'not supported',
    failed: 'FAILED'
};

export const printSummary = (result) => {
    const previous = previousOf(result);
    const before = new Map((previous?.bundles ?? []).filter(b => b.status === 'measured').map(b => [bundleKey(b), b]));

    const rows = [['bundle', 'raw', 'gzip', 'brotli', 'raw change', 'status']];
    for (const b of result.bundles) {
        const status = b.status === 'measured' && !b.verified ? 'measured, not checked' : STATUS[b.status];
        if (b.status !== 'measured') {
            rows.push([bundleKey(b), '', '', '', '', status]);
            continue;
        }
        rows.push([
            bundleKey(b),
            kb(b.size.raw),
            kb(b.size.gzip),
            kb(b.size.brotli),
            delta(b.size.raw, before.get(bundleKey(b))?.size.raw),
            status
        ]);
    }
    for (const [name, size] of Object.entries(result.baseline)) {
        rows.push([`full library: ${name}`, kb(size.raw), kb(size.gzip), kb(size.brotli),
            delta(size.raw, previous?.baseline[name]?.raw), '']);
    }

    console.log(`\n${table(rows)}`);
    for (const b of result.bundles) {
        for (const note of [b.reason, ...(b.problems ?? [])].filter(Boolean)) {
            console.log(`  ${bundleKey(b)}: ${note}`);
        }
    }
    if (previous) {
        console.log(`  Changes are against ${previous.engine.library} ${previous.engine.version} (${engineLabel(previous.engine)}).`);
    }
};
