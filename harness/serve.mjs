// Serves dist/: the report site at /report/ and the kept builds at /builds/.
// The source index.html files under scenarios/ cannot be opened directly: they import bare
// specifiers such as 'playcanvas', which only resolve once Vite has built them.
//
// Usage: npm run serve [-- --port 5199]

import fs from 'node:fs';
import { parseArgs } from 'node:util';

import { DIST_DIR } from './paths.mjs';
import { writeReportPage } from './report-page.mjs';
import { serve } from './verify.mjs';

const { values: args } = parseArgs({ options: { port: { type: 'string', default: '5199' } } });

fs.mkdirSync(DIST_DIR, { recursive: true });
// always serve a report that matches the stored results
writeReportPage();

const server = await serve(DIST_DIR, Number(args.port));
console.log(`Report: http://localhost:${server.address().port}/report/`);
