import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCENARIOS_DIR = path.join(ROOT, 'scenarios');
// results of published releases, which are committed
export const RESULTS_DIR = path.join(ROOT, 'results');
// results of builds from source (main, branches, a working tree), which stay on this machine
export const LOCAL_RESULTS_DIR = path.join(RESULTS_DIR, 'local');
export const CACHE_DIR = path.join(ROOT, '.cache');
export const DIST_DIR = path.join(ROOT, 'dist');

export const posix = file => file.split(path.sep).join('/');
