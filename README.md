# playcanvas-metrics

Benchmarks that track the PlayCanvas engine over time, and against three.js. So far: tree-shaken
bundle size.

**Report: https://mvaligursky.github.io/playcanvas-metrics/**

## Running

```bash
npm install
```

Measure the engine checkout next to this repo (`../engine`), as it is on disk:

```bash
npm run bench
```

Measure several engines in one go. Quote the list: PowerShell otherwise reads `2.20` as the number 2.2.

```bash
npm run bench -- --engine "2.20,2.21,2.22,2.23,2.24,main"
```

Look at the report, at http://localhost:5199/report/:

```bash
npm run serve
```

The `index.html` files under `scenarios/` cannot be opened directly; they only work once built.

## Checks

```bash
npm run lint
```

```bash
npm test
```

`npm test` builds and measures one scenario for one PlayCanvas and one three.js release, without
the browser check and without saving anything, then generates the report from the stored results.
CI runs both on every push and pull request. Node 22.12 or later is needed; `.nvmrc` names the
version the harness is developed on.

## The report

A generated static site under `dist/report/`, in three levels:

| Page | Shows |
|---|---|
| `/report/` | One card per benchmark section. Only bundle size is measured so far. |
| `/report/bundle-size/` | One card per scenario: its picture, and one chart of each library's headline variant by release date. |
| `/report/bundle-size/<scenario>/` | Everything for one scenario: library comparison, sizes by version, what the bundle is made of, a treemap of its modules, and what changed between two versions. |

- A scenario's `headline` variant (in `scenario.json`) is the one the overview pages show.
- Filters are kept in the page address, so any view can be bookmarked or shared.
- The treemap shows the "To" version. Ticking the box marks, inside each module's box, what was
  added and what was removed since the "From" version.
- "From" can also be "Whole library (no tree-shaking)". The treemap then draws every module of
  the library at its full size, with the part the bundle kept in colour and the part tree-shaking
  removed faded, and the table below lists the largest modules removed, kept in part and kept
  whole.
- The treemap also has a page of its own, `/report/bundle-size/<scenario>/treemap/`, linked from
  the scenario page. It fills the window and can be magnified (buttons, or Ctrl + mouse wheel), so
  that more boxes have room for their names.
- `npm run report` regenerates the site; a bench run that saves results does so too.

### Runnable builds

Every build of a published release is kept at its own address, and linked from the scenario page's
table as "run" and "picture":

```
/builds/<library>-<version>/<scenario>/<variant>/
/builds/playcanvas-2.24.1/glb-shadows/webgl2/
```

Add `?pose=1` to hold the scene at the reference pose. Builds from source (main, branches, a
checkout's working tree) are not kept; they go to `dist/work/` and are overwritten by the next run.
`dist/` is not committed. On a fresh clone, this brings the builds back, without touching results:

```bash
npm run builds
```

It rebuilds every release that has a stored result and reports any build whose size differs from
that result. It does not run the browser check, so those builds have no "picture" link.

### The published report

Every push to `main` rebuilds the whole site, runnable builds included, and publishes it to
GitHub Pages at https://mvaligursky.github.io/playcanvas-metrics/. It shows the committed results,
which are the published releases only.

Pull requests build the same site without publishing it, and keep it for 30 days as the
`report-site` artifact of the run, for checking a change before it is merged.

### Options for `npm run bench`

| Option | Meaning |
|---|---|
| `--engine <list>` | Comma separated engines to measure. Defaults to the working tree of the checkout. |
| `--checkout <path>` | Engine checkout used to resolve git refs. Defaults to `../engine`. |
| `--scenario <name>` | Only run one scenario. The saved result keeps the engine's last measurements of the other scenarios. |
| `--no-verify` | Skip the browser check that each bundle renders. |
| `--no-save` | Print the summary without writing result files. |
| `--update-reference` | Replace each scenario's `reference.png` with what the first engine renders. |

An engine is one of:

- **A path** to a checkout: its working tree is built as it is, local changes included.
- **A git ref**: `main`, a branch, a tag or a SHA. It is fetched from the checkout's `origin` and
  exported into `.cache/` to build. The checkout's working tree and branch are not touched. Only
  commits that use the esbuild build can be built this way; use npm versions for older engines.
- **An npm version**: `2.24.1`, or `2.24` for the latest patch of that minor.
- **A three.js release**: `three@0.187.0`, `three@0.187`, `three@r187`, or `three@last5` for the
  five most recent releases. three.js is always measured as published on npm.

Results are deterministic, so a release only needs measuring once, and again when a scenario
changes. To add the newest three.js releases:

```bash
npm run bench -- --engine "three@last5"
```

## Comparing libraries

A scenario can have implementations for several libraries. Each library has its own version line,
so the report compares them by release date and by latest release.

- Every implementation must draw the same scene. `reference.png` is drawn by the scenario's main
  framework. An implementation for another framework has its own reference (the `reference` field
  in `scenario.json`), which it must match exactly, and which must have the same outline as
  `reference.png` and nearly the same shading.
- Only documented ways of using a library are measured. A variant a library has no documented
  route for is left out, not approximated.
- The whole-library figure is every export of a library's entry point, bundled and minified by
  this harness the same way as the scenarios, and broken down per module (`whole` in a result).
  That makes a bundle comparable with it module by module. For PlayCanvas the published
  `playcanvas.min.mjs` is recorded next to it; it is a little larger, as it is made with a
  different minifier.
- The module breakdown for three.js is coarse, because `import 'three'` resolves to a few
  pre-built files, not to individual source modules.

The browser check uses the installed Google Chrome.

## What a run does

For each engine:

1. Resolves it to a release build: unbundled modules plus the full minified bundle. Builds are
   cached per commit in `.cache/`.
2. Picks, for every scenario, the implementation that matches the engine version (see below), and
   builds each of its variants with Vite, minified, with `playcanvas` resolved to that engine.
3. Measures the JavaScript: raw, gzip and brotli size, and the minified bytes each source module
   contributes (from the source map).
4. Loads each bundle in headless Chrome and checks that it runs on the expected graphics device
   with no errors, that the picture changes over time, and that a screenshot held at a fixed time
   matches the scenario's `reference.png`.
5. Writes `results/<run date>_<engine>_<machine id>.json` for a published release. Results of
   builds from source (main, branches, a working tree) go to `results/local/`, which is not
   committed: they are still charted on the machine that made them.

Afterwards it regenerates the report page, `dist/report/index.html`.

Every result file also records what it was measured with:

| Field | Contents |
|---|---|
| `environment` | An id for the machine, OS, CPU model and thread count, memory. The id is a hash, so machines can be told apart without being named; set `ENGINE_METRICS_MACHINE` to give a runner a chosen id. |
| `harness` | Harness version and git commit, Node, Vite, Rolldown and Playwright versions. |
| `browser` | Chrome version, headless or not, launch flags, user agent, and the GPU as reported by WebGL2 (vendor, renderer) and by WebGPU (vendor, architecture). `null` with `--no-verify`. |
| `bundles[].deviceType` | The graphics API the bundle actually ran on, which matters for fallback variants. |

Bundle sizes depend only on the engine, the scenario and the `harness` tools. The rest is there for
the timing benchmarks, where results are only comparable on the same machine, GPU and browser.

Each bundle in a result has one of three outcomes:

| Outcome | Meaning |
|---|---|
| `measured` | Built and passed the browser check. |
| `unsupported` | The scenario declares no implementation for this engine version. Expected. |
| `failed` | In range, but the build or the browser check broke. No size is recorded. |

A run exits with an error if anything failed.

## Scenarios and engine versions

| Scenario | What it covers |
|---|---|
| `spinning-cube` | The smallest lit scene: one procedural cube, one directional light. |
| `glb-shadows` | A loaded glTF model with textured PBR materials, a ground plane, and directional, omni and spot lights that all cast shadows. |

Each scenario has a `README.md` with its spec, a `reference.png`, and a `scenario.json`:

```json
{
  "revision": 1,
  "implementations": [
    { "framework": "playcanvas", "dir": "playcanvas", "engine": ">=2.23.0" },
    { "framework": "playcanvas", "dir": "playcanvas-pre-2.23", "engine": ">=2.20.0 <2.23.0" }
  ]
}
```

- The first implementation whose `engine` range contains the engine version is used. A prerelease
  such as `2.25.0-beta.4` is matched as `2.25.0`, so main always falls in the newest range.
- Each sub-folder of an implementation that has an `index.html` is one variant. A variant's name
  lists the device types it may run on, joined by `-or-`: `webgl2`, `webgpu`, `webgpu-or-webgl2`.
- **When an engine change breaks a scenario**: copy the implementation folder, cap the old copy's
  range at the last engine it works on, and fix the new one. Never edit the old copy again. Do not
  add runtime checks for old and new APIs to one implementation: both paths would ship in the
  bundle and distort its size.
- **A scenario that needs a newer engine** starts its range there; older engines are recorded as
  `unsupported`.
- **When a scenario's spec changes**, bump `revision` and rerun every engine. The report does not
  join results of different revisions.
- Every result records the implementation folder and a hash of its source, and the report marks
  where that changes.

## Layout

- `scenarios/` - one folder per scenario.
- `harness/` - the runner (`run.mjs`), engine resolution (`engine.mjs`), bundling and measuring
  (`bundle.mjs`), the browser check (`verify.mjs`), and the report generator (`report-page.mjs`)
  with its page sources in `harness/site/`.
- `results/` - one JSON file per published release per run, committed. `results/local/` holds the
  results of builds from source and is ignored. The report uses the latest run of each build.
- `dist/` - `report/` (the site), `builds/` (kept release builds, each with a `screenshot.png`)
  and `work/` (the last build from source). Not committed.
- `.cache/` - engine builds (not committed).
