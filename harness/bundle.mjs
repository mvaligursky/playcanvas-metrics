// Builds one scenario variant with Vite and measures the JavaScript it produces.

import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { decode } from '@jridgewell/sourcemap-codec';
import { build, createLogger } from 'vite';

import { ROOT, posix } from './paths.mjs';

/**
 * @param {Buffer} buf - File contents.
 * @returns {{ raw: number, gzip: number, brotli: number }} Sizes in bytes.
 */
export const measure = buf => ({
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
});

/**
 * @param {string[]} files - Files that are shipped together.
 * @returns {{ raw: number, gzip: number, brotli: number }} Their combined sizes in bytes.
 */
export const measureFiles = (files) => {
    const total = { raw: 0, gzip: 0, brotli: 0 };
    for (const file of files) {
        const sizes = measure(fs.readFileSync(file));
        total.raw += sizes.raw;
        total.gzip += sizes.gzip;
        total.brotli += sizes.brotli;
    }
    return total;
};

function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(file) : [file];
    });
}

// names a source file the way results should show it: engine modules as src/..., the rest relative
// to this repo
const moduleId = (file, engine) => {
    const fromEngine = path.relative(engine.moduleRoot, file);
    if (!fromEngine.startsWith('..') && !path.isAbsolute(fromEngine)) {
        return posix(fromEngine);
    }
    const fromRoot = path.relative(ROOT, file);
    if (!fromRoot.startsWith('..') && !path.isAbsolute(fromRoot)) {
        return posix(fromRoot);
    }
    return posix(file);
};

// the relative modules a source file imports, and the one template literal a file consists of, if
// that is all it is. Both are read from disk once, as every variant of an engine asks again
const importCache = new Map();
const importsOf = (file) => {
    if (!importCache.has(file)) {
        let found = [];
        if (fs.existsSync(file)) {
            const source = fs.readFileSync(file, 'utf8');
            found = [...source.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)].map(m => path.resolve(path.dirname(file), m[1]));
        }
        importCache.set(file, found);
    }
    return importCache.get(file);
};
const literalCache = new Map();
const soleLiteralOf = (file) => {
    if (!literalCache.has(file)) {
        let literal = null;
        if (fs.existsSync(file)) {
            const source = fs.readFileSync(file, 'utf8');
            const first = source.indexOf('`');
            const last = source.lastIndexOf('`');
            // exactly one template literal, with nothing computed inside it, and no imports
            if (first >= 0 && last > first && !/^\s*import\s/m.test(source)) {
                const candidate = source.slice(first, last + 1);
                if (!candidate.slice(1, -1).includes('`') && !candidate.includes('${')) {
                    literal = candidate;
                }
            }
        }
        literalCache.set(file, literal);
    }
    return literalCache.get(file);
};

// Attributes every byte of a minified file to the source module it came from, using the source
// map: each mapping segment owns the output up to the next segment on its line.
const attribute = (jsFile, engine, totals) => {
    const map = JSON.parse(fs.readFileSync(`${jsFile}.map`, 'utf8'));
    const files = map.sources.map(source => (source.startsWith('\0') ? null : path.resolve(path.dirname(jsFile), source)));
    const ids = map.sources.map((source, i) => (files[i] ? moduleId(files[i], engine) : source));
    const code = fs.readFileSync(jsFile, 'utf8');
    const lines = code.split('\n');
    const decoded = decode(map.mappings);

    const add = (id, bytes) => totals.set(id, (totals.get(id) ?? 0) + bytes);

    // the owner carries over line ends: a multi-line template literal, as used for shader source,
    // has a mapping on its first line only
    let owner = null;
    // where in the file each owner's run starts, to look an owner up by position afterwards
    const runs = [];
    const mapped = new Set();
    let lineStart = 0;

    lines.forEach((line, i) => {
        const segments = decoded[i] ?? [];
        let col = 0;
        for (const segment of segments) {
            if (segment[0] > col) {
                add(owner, Buffer.byteLength(line.slice(col, segment[0])));
                col = segment[0];
            }
            owner = segment.length > 1 ? ids[segment[1]] : null;
            runs.push([lineStart + segment[0], owner]);
            if (segment.length > 1) {
                mapped.add(segment[1]);
            }
        }
        // the rest of the line, plus the newline that split() removed
        const newline = i < lines.length - 1 ? 1 : 0;
        add(owner, Buffer.byteLength(line.slice(col)) + newline);
        lineStart += line.length + 1;
    });

    const ownerAt = (offset) => {
        let lo = 0;
        let hi = runs.length - 1;
        let found = null;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (runs[mid][0] <= offset) {
                found = runs[mid][1];
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return found;
    };

    // A module that only exports one string, such as a shader chunk, is inlined where it is used.
    // The source map then has no mapping for it, and may not list it at all, so its text would
    // count as part of the module that imports it. Each mapped module's imports are therefore
    // read from disk, and an import that got no bytes is found by its text and given them back.
    const searchFrom = new Map();
    const mappedFiles = new Set([...mapped].map(index => files[index]).filter(Boolean));
    for (const file of mappedFiles) {
        for (const imported of importsOf(file)) {
            if (mappedFiles.has(imported)) {
                continue;
            }
            const literal = soleLiteralOf(imported);
            if (!literal) {
                continue;
            }
            // two modules can hold the same text; each takes the next place it appears
            const at = code.indexOf(literal, searchFrom.get(literal) ?? 0);
            if (at < 0) {
                continue;
            }
            searchFrom.set(literal, at + literal.length);
            const bytes = Buffer.byteLength(literal);
            add(ownerAt(at), -bytes);
            add(moduleId(imported, engine), bytes);
        }
    }
};

/**
 * @param {{ dir: string, outDir: string }} variant - The variant to build.
 * @param {{ root: string, entry: string }} engine - The resolved engine.
 * @returns {Promise<{ size: { raw: number, gzip: number, brotli: number }, files: object[],
 * modules: { id: string, bytes: number }[] }>} The measured bundle.
 */
export const bundle = async (variant, engine) => {
    await build({
        configFile: false,
        root: variant.dir,
        base: './',
        logLevel: 'warn',
        customLogger: quietLogger(),
        resolve: {
            alias: engine.alias ?? {}
        },
        plugins: engine.resolveFrom ? [{
            name: 'playcanvas-metrics-resolve-library',
            enforce: 'pre',
            resolveId(source, importer, options) {
                // only redirect imports written in the scenario, not the library's own
                if (engine.resolveFrom.pattern.test(source) && importer && !importer.includes('node_modules')) {
                    return this.resolve(source, engine.resolveFrom.importer, { ...options, skipSelf: true });
                }
                return null;
            }
        }] : [],
        build: {
            outDir: variant.outDir,
            emptyOutDir: true,
            target: 'esnext',
            minify: true,
            sourcemap: 'hidden',
            modulePreload: { polyfill: false },
            reportCompressedSize: false,
            chunkSizeWarningLimit: Infinity
        }
    });

    return measureOutput(variant.outDir, engine, variant.dir);
};

/**
 * Bundles every export of one of a library's entry points, minified like a scenario. This is the
 * library with nothing tree-shaken away, measured the same way as the scenarios, so that a
 * scenario's bundle can be set against it module by module.
 *
 * @param {object} engine - The resolved engine.
 * @param {string} specifier - The entry point, such as playcanvas or three/webgpu.
 * @returns {Promise<{ size: { raw: number, gzip: number, brotli: number },
 * modules: { id: string, bytes: number }[] }>} The measured build.
 */
export const bundleWholeLibrary = async (engine, specifier) => {
    const name = `everything-${specifier.replace(/\W+/g, '-')}`;
    const entry = path.join(engine.workDir, `${name}.js`);
    const outDir = path.join(engine.workDir, name);
    fs.writeFileSync(entry, `export * from '${specifier}';\n`);

    await build({
        configFile: false,
        root: engine.workDir,
        logLevel: 'warn',
        customLogger: quietLogger(),
        resolve: {
            alias: engine.alias ?? {}
        },
        build: {
            outDir,
            emptyOutDir: true,
            target: 'esnext',
            minify: true,
            sourcemap: 'hidden',
            modulePreload: { polyfill: false },
            reportCompressedSize: false,
            chunkSizeWarningLimit: Infinity,
            rolldownOptions: { input: entry, preserveEntrySignatures: 'strict' }
        }
    });

    const { size, modules } = measureOutput(outDir, engine, specifier);
    // what no module accounts for here is the list of exports the build ends with
    return { size, modules: modules.map(m => (m.id === '(unmapped)' ? { ...m, id: '(export list)' } : m)) };
};

// older engines import node:worker_threads in worker sources that only use it under Node; Vite
// stubs it out for the browser and says so once per importer
function quietLogger() {
    const logger = createLogger('warn');
    const warn = logger.warn;
    logger.warn = (msg, options) => {
        if (!msg.includes('has been externalized for browser compatibility')) {
            warn(msg, options);
        }
    };
    return logger;
}

// sizes the JavaScript a build produced, and attributes its bytes to source modules
function measureOutput(outDir, engine, label) {
    const jsFiles = listFiles(outDir).filter(file => file.endsWith('.js'));
    if (!jsFiles.length) {
        throw new Error(`Build of ${label} produced no JavaScript`);
    }

    const size = { raw: 0, gzip: 0, brotli: 0 };
    const files = [];
    const totals = new Map();
    for (const file of jsFiles) {
        const sizes = measure(fs.readFileSync(file));
        size.raw += sizes.raw;
        size.gzip += sizes.gzip;
        size.brotli += sizes.brotli;
        // file names carry a content hash, which would make every result differ
        files.push({ file: posix(path.relative(outDir, file)).replace(/-[\w-]{8}\.js$/, '.js'), ...sizes });
        attribute(file, engine, totals);
        // the map has done its job, and is several times the size of the bundle
        fs.rmSync(`${file}.map`);
    }

    const modules = [...totals]
    .map(([id, bytes]) => ({ id: id ?? '(unmapped)', bytes }))
    .filter(item => item.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));

    const attributed = modules.reduce((sum, item) => sum + item.bytes, 0);
    if (attributed !== size.raw) {
        throw new Error(`Module breakdown of ${label} adds up to ${attributed} bytes, build is ${size.raw}`);
    }

    return { size, files, modules };
}
