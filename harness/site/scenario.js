// The full report for one scenario. DATA and ROOT are set by the page.

const STATUS = { unsupported: 'not supported', failed: 'failed', stale: 'needs a rerun' };

const state = {
    metric: readParam('metric', DEFAULT_METRIC, METRICS),
    library: readParam('library', DATA.libraries[0], DATA.libraries),
    bundle: null,
    variant: readParam('variant', DATA.scenario.headline),
    from: readParam('from', null),
    to: readParam('to', null),
    branches: readParam('branches', null) === '1',
    byChange: readParam('change', null) === '1',
    zoom: readParam('zoom', ''),
    // magnification of the treemap on its own page
    scale: Math.max(1, Math.min(6, Number(readParam('scale', '1')) || 1)),
    allModules: false
};

// the treemap also has a page of its own, which loads this script for the treemap alone
const TREEMAP_PAGE = document.body.dataset.page === 'treemap';

// what the comparison shows when nothing is chosen, for the current library
const defaults = { from: null, to: null };

// the "From" choice that stands for the whole library, not a version
const WHOLE_ID = 'whole';

const variantOf = key => key.split(' / ').at(-1);
// a variant (webgl2, webgpu, ...) has the same colour in every library
const bundleColor = key => css(VARIANT_SLOTS[DATA.variants.indexOf(variantOf(key)) % VARIANT_SLOTS.length]);
// a variant's name in the colour of its line
const variantTextColor = variant => css(`--variant-${DATA.variants.indexOf(variant) % VARIANT_SLOTS.length + 1}-text`);
const variantLabel = variant => `<span class="lib" style="color: var(--variant-${DATA.variants.indexOf(variant) % VARIANT_SLOTS.length + 1}-text)">${esc(variant)}</span>`;
const libBundles = () => DATA.bundles[state.library] ?? [];
const libAreas = () => DATA.areas[state.library] ?? [];
const areaColor = area => (area === 'Other' ? css('--muted') : css(SLOTS[libAreas().indexOf(area)]));
const engines = () => DATA.engines.filter(e => e.library === state.library && (state.branches || e.track !== 'branch'));
const axisLabel = e => (e.sub ? [e.name, e.sub] : e.name);

// the entry of a bundle for an engine; "not supported" is stored once per framework
const entryOf = (engine, key) => engine.bundles[key] ?? engine.bundles[`${key.split(' / ').slice(0, 2).join(' / ')} / *`] ?? null;
const measured = (engine, key) => {
    const entry = entryOf(engine, key);
    return entry?.status === 'measured' ? entry : null;
};
// the whole-library build that a bundle of an engine is tree-shaken from: its name, size and
// modules. WHOLE is set by data/whole.js
const wholeOf = (engine, key) => {
    const entry = engine && measured(engine, key);
    const modules = entry?.whole && window.WHOLE?.[engine.id]?.[entry.whole];
    return modules ? { ...engine.whole[entry.whole], modules } : null;
};

// must match areaOf in harness/report-page.mjs
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

const saveState = () => writeParams({
    metric: state.metric === DEFAULT_METRIC ? null : state.metric,
    library: state.library === DATA.libraries[0] ? null : state.library,
    variant: state.variant === DATA.scenario.headline ? null : state.variant,
    from: state.from === defaults.from ? null : state.from,
    to: state.to === defaults.to ? null : state.to,
    branches: state.branches,
    change: state.byChange,
    zoom: state.zoom,
    scale: TREEMAP_PAGE && state.scale !== 1 ? String(state.scale) : null
});

function renderLibraries() {
    const libs = DATA.libraries.filter(lib => DATA.engines.some(e => e.library === lib && e.track === 'release'));
    $('cmpCard').hidden = libs.length < 2;
    if (libs.length < 2) {
        return;
    }
    const latest = lib => DATA.engines.filter(e => e.library === lib && e.track === 'release').at(-1);
    const keyOf = (lib, variant) => DATA.bundles[lib].find(key => variantOf(key) === variant);
    const sizeOf = (lib, variant) => {
        const entry = keyOf(lib, variant) && measured(latest(lib), keyOf(lib, variant));
        return entry ? entry.size[state.metric] : null;
    };

    // the latest release of each library, as exact figures
    const [first, second] = libs;
    $('cmpTable').innerHTML = `<thead><tr><th>Latest release, ${METRIC_NAME[state.metric]}</th>${libs.map(lib => `<th>${libLabel(lib, latest(lib).version)}</th>`).join('')}<th>${libLabel(second)} relative to ${libLabel(first)}</th></tr></thead><tbody>${
        DATA.variants.map((variant) => {
            const a = sizeOf(first, variant);
            const b = sizeOf(second, variant);
            const headline = variant === DATA.scenario.headline ? '<span class="tag">headline</span>' : '';
            return `<tr><td>${esc(variant)}${headline}</td>${libs.map(lib => `<td>${sizeOf(lib, variant) === null ? '<span class="dim">no such variant</span>' : kb(sizeOf(lib, variant))}</td>`).join('')}<td>${a && b ? `${(100 * b / a).toFixed(0)}%` : '—'}</td></tr>`;
        }).join('')}</tbody>`;

    // one small chart per variant both libraries have: sizes over time, on release date
    for (const id of Object.keys(charts).filter(id => id.startsWith('timeline'))) {
        charts[id].destroy();
        delete charts[id];
    }
    const shared = DATA.variants.filter(variant => libs.every(lib => keyOf(lib, variant)));
    $('timelines').innerHTML = shared.map((variant, i) => `<div><h3>${esc(variant)} over time</h3><div class="plot small"><canvas id="timeline${i}"></canvas></div></div>`).join('');
    shared.forEach((variant, i) => {
        const series = {};
        for (const lib of libs) {
            series[lib] = DATA.engines.filter(e => e.library === lib && e.track !== 'branch' && measured(e, keyOf(lib, variant)))
            .map(e => ({ ...e, size: measured(e, keyOf(lib, variant)).size }));
        }
        timelineChart(`timeline${i}`, series, state.metric);
    });
}

function renderTiles(list) {
    const latest = list.at(-1);
    const before = list.at(-2);
    $('tiles').innerHTML = [...libBundles().map(key => ({ key: variantOf(key), variant: true, now: measured(latest, key)?.size[state.metric], was: before && measured(before, key)?.size[state.metric] })),
        { key: `full library: ${latest.fullName}`, now: latest.full[state.metric], was: before?.full[state.metric] }]
    .map(({ key, variant, now, was }) => {
        const change = now === undefined ? '' : was === undefined ? 'no earlier version to compare' :
            `<span class="${cls(now - was)}">${signed(now - was)} (${pct(now, was)})</span> since ${esc(engineName(before))}`;
        return `<div class="tile"><div class="name">${libLabel(state.library)} ${variant ? variantLabel(key) : esc(key)}</div>
            <div class="value">${now === undefined ? '—' : kb(now)}</div>
            <div class="change">${change}</div></div>`;
    }).join('');
}

function renderSize(list) {
    const datasets = libBundles().map((key) => {
        const color = bundleColor(key);
        let lastImpl = null;
        const changed = list.map((e) => {
            const entry = measured(e, key);
            if (!entry) {
                return false;
            }
            const isChange = lastImpl !== null && entry.impl !== lastImpl;
            lastImpl = entry.impl;
            return isChange;
        });
        return {
            label: variantOf(key),
            data: list.map(e => (measured(e, key) ? measured(e, key).size[state.metric] / 1024 : null)),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            tension: 0,
            pointRadius: changed.map(c => (c ? 7 : 4)),
            pointHoverRadius: 7,
            pointStyle: changed.map(c => (c ? 'rectRot' : 'circle')),
            pointBorderColor: css('--surface'),
            pointBorderWidth: 2,
            changed
        };
    });

    const options = baseOptions(METRIC_NAME[state.metric]);
    options.plugins.tooltip.callbacks = {
        title: items => engineName(list[items[0].dataIndex]),
        label: (item) => {
            const prev = item.dataset.data.slice(0, item.dataIndex).filter(v => v !== null).at(-1);
            const change = prev === undefined ? '' : ` (${signed((item.parsed.y - prev) * 1024)})`;
            return ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)} KB${change}`;
        },
        footer: (items) => {
            const e = list[items[0].dataIndex];
            const lines = [`Dated ${e.date}`];
            if (items.some(item => item.dataset.changed[item.dataIndex])) {
                lines.push('Scenario implementation changed here');
            }
            return lines;
        }
    };
    // each variant's name in the legend takes its colour
    options.plugins.legend.labels.generateLabels = chart => Chart.defaults.plugins.legend.labels.generateLabels(chart)
    .map(label => ({ ...label, fontColor: variantTextColor(label.text) }));
    draw('sizeChart', { type: 'line', data: { labels: list.map(axisLabel), datasets }, options });

    const rows = list.map((e) => {
        const cells = libBundles().map((key) => {
            const entry = entryOf(e, key);
            if (!entry) {
                return '<td class="dim">not run</td>';
            }
            if (entry.status !== 'measured') {
                return `<td class="dim" title="${esc(entry.note ?? '')}">${STATUS[entry.status]}</td>`;
            }
            // builds of published releases are kept and can be opened
            const links = entry.build ? `<a href="${ROOT}${entry.build}">run</a>${entry.picture ? `<a href="${ROOT}${entry.build}screenshot.png">picture</a>` : ''}` : '';
            return `<td>${kb(entry.size[state.metric])}${entry.verified ? '' : '<span class="tag">not checked</span>'}${links}</td>`;
        }).join('');
        const tag = e.track === 'release' ? '' : `<span class="tag">${e.track}</span>`;
        return `<tr><td>${esc(engineName(e))}${tag}</td><td>${e.date}</td>${cells}<td>${kb(e.full[state.metric])}</td></tr>`;
    }).join('');
    $('sizeTable').innerHTML = `<thead><tr><th>Version</th><th>Released</th>${libBundles().map(k => `<th>${variantLabel(variantOf(k))}</th>`).join('')}<th>full library</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderFull(list) {
    const color = css('--text-2');
    const options = baseOptions(METRIC_NAME[state.metric]);
    options.plugins.legend.display = false;
    options.plugins.tooltip.callbacks = {
        title: items => engineName(list[items[0].dataIndex]),
        label: item => ` ${list[item.dataIndex].fullName}: ${item.parsed.y.toFixed(1)} KB`
    };
    $('fullNote').textContent = 'Every export of the library\'s main entry point, bundled and minified by this harness the same way as the scenarios, with nothing tree-shaken: the upper bound for any app.';
    draw('fullChart', {
        type: 'line',
        data: {
            labels: list.map(axisLabel),
            datasets: [{
                label: 'full library',
                data: list.map(e => e.full[state.metric] / 1024),
                borderColor: color,
                backgroundColor: color,
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7,
                pointBorderColor: css('--surface'),
                pointBorderWidth: 2
            }]
        },
        options
    });
}

// each bundle as a share of the whole library it was tree-shaken from, per version
function renderShare(list) {
    const shareOf = (e, key) => {
        const entry = measured(e, key);
        const whole = entry?.whole && e.whole[entry.whole];
        return whole ? 100 * entry.size[state.metric] / whole.size[state.metric] : null;
    };
    const any = list.some(e => libBundles().some(key => shareOf(e, key) !== null));
    $('shareCard').hidden = !any;
    if (!any) {
        return;
    }
    $('shareTitle').innerHTML = `${libLabel(state.library)}: share of the whole library kept`;

    const options = baseOptions(`share of whole library, ${METRIC_NAME[state.metric]}`);
    options.scales.y.ticks.callback = v => `${v}%`;
    options.plugins.legend.labels.generateLabels = chart => Chart.defaults.plugins.legend.labels.generateLabels(chart)
    .map(label => ({ ...label, fontColor: variantTextColor(label.text) }));
    options.plugins.tooltip.callbacks = {
        title: items => engineName(list[items[0].dataIndex]),
        label: (item) => {
            const e = list[item.dataIndex];
            const entry = measured(e, libBundles()[item.datasetIndex]);
            return ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)}% (${kb(entry.size[state.metric])} of ${kb(e.whole[entry.whole].size[state.metric])})`;
        }
    };
    draw('shareChart', {
        type: 'line',
        data: {
            labels: list.map(axisLabel),
            datasets: libBundles().map((key) => {
                const color = bundleColor(key);
                return {
                    label: variantOf(key),
                    data: list.map(e => shareOf(e, key)),
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointBorderColor: css('--surface'),
                    pointBorderWidth: 2
                };
            })
        },
        options
    });
}

const areaBytes = (entry, area) => {
    if (area !== 'Other') {
        return entry.areas[area] ?? 0;
    }
    return Object.entries(entry.areas).filter(([name]) => !libAreas().includes(name)).reduce((sum, [, bytes]) => sum + bytes, 0);
};

function renderComposition(list) {
    const key = state.bundle;
    const withData = list.filter(e => measured(e, key));
    const areas = [...libAreas(), 'Other'];
    $('compTitle').innerHTML = `What the ${libLabel(state.library)} ${esc(variantOf(key))} bundle is made of, by version`;

    const options = baseOptions('raw size');
    options.scales.x.stacked = true;
    options.scales.y.stacked = true;
    options.plugins.legend.reverse = true;
    options.plugins.tooltip.itemSort = (a, b) => b.datasetIndex - a.datasetIndex;
    options.plugins.tooltip.callbacks = {
        title: items => engineName(withData[items[0].dataIndex]),
        label: item => ` ${item.dataset.label}: ${item.parsed.y.toFixed(1)} KB`,
        footer: items => `Total ${kb(measured(withData[items[0].dataIndex], key).size.raw)}`
    };
    draw('compChart', {
        type: 'bar',
        data: {
            labels: withData.map(axisLabel),
            datasets: areas.map(area => ({
                label: area,
                data: withData.map(e => areaBytes(measured(e, key), area) / 1024),
                backgroundColor: areaColor(area),
                // a surface-coloured edge separates the stacked segments
                borderColor: css('--surface'),
                borderWidth: { top: 2 },
                borderSkipped: false,
                maxBarThickness: 56
            }))
        },
        options
    });

    $('compTable').innerHTML = `<thead><tr><th>Version</th>${areas.map(a => `<th>${esc(a)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${
        withData.map((e) => {
            const entry = measured(e, key);
            return `<tr><td>${esc(engineName(e))}</td>${areas.map(a => `<td>${kb(areaBytes(entry, a))}</td>`).join('')}<td>${kb(entry.size.raw)}</td></tr>`;
        }).join('')}</tbody>`;
}

// the headline of the comparison: each version's size and the change, in the chosen size measure
function renderCompareTiles(list) {
    const key = state.bundle;
    const from = list.find(e => e.id === state.from);
    const to = list.find(e => e.id === state.to);
    const a = from && measured(from, key);
    const b = to && measured(to, key);
    const tile = (name, value, note) => `<div class="tile"><div class="name">${name}</div><div class="value">${value}</div><div class="change">${note}</div></div>`;

    // against the whole library: how much of it the bundle kept
    if (state.from === WHOLE_ID) {
        const whole = wholeOf(to, key);
        if (!b || !whole) {
            $('compareTiles').innerHTML = tile('No comparison', '—', 'This version has no whole-library build measured for this variant.');
            return;
        }
        const full = whole.size[state.metric];
        const kept = b.size[state.metric];
        $('compareTiles').innerHTML = [
            tile(`${libLabel(state.library, engineName(to))} ${esc(variantOf(key))}: kept by the bundle`,
                `${(100 * kept / full).toFixed(0)}%`,
                `${kb(full - kept)} removed by tree-shaking, ${METRIC_NAME[state.metric]}`),
            tile(`Whole library: ${esc(whole.name)}`, kb(full), 'nothing tree-shaken, built the same way'),
            tile('This bundle', kb(kept), `dated ${to.date}`)
        ].join('');
        return;
    }

    if (!a || !b) {
        $('compareTiles').innerHTML = tile('No comparison', '—', 'One of the two versions has no measurement for this variant.');
        return;
    }
    const was = a.size[state.metric];
    const now = b.size[state.metric];
    const same = from === to;
    $('compareTiles').innerHTML = [
        tile(`${libLabel(state.library)} ${esc(engineName(from))} → ${esc(engineName(to))}, ${METRIC_NAME[state.metric]}`,
            same ? '—' : `<span class="${cls(now - was)}">${signed(now - was)}</span>`,
            same ? 'Pick two different versions.' : `${pct(now, was)}, and ${signed(b.size.raw - a.size.raw)} before compression`),
        tile(`From: ${libLabel(state.library, engineName(from))}`, kb(was), `dated ${from.date}`),
        tile(`To: ${libLabel(state.library, engineName(to))}`, kb(now), `dated ${to.date}`)
    ].join('');
}

function renderTreemap(list) {
    const key = state.bundle;
    const from = list.find(e => e.id === state.from);
    const to = list.find(e => e.id === state.to);
    const shown = to && measured(to, key);
    const base = from && measured(from, key);
    const compare = state.byChange && base && from !== to;
    // against the whole library, the treemap shows what the bundle kept of every module
    const whole = state.from === WHOLE_ID ? wholeOf(to, key) : null;

    $('tmTitle').innerHTML = !to ? 'Inside the bundle' : whole ?
        `What the ${esc(variantOf(key))} bundle of ${libLabel(state.library, engineName(to))} keeps of the whole library` : compare ?
            `Inside the ${esc(variantOf(key))} bundle: ${libLabel(state.library, engineName(from))} against ${libLabel(state.library, engineName(to))}` :
            `Inside the ${esc(variantOf(key))} bundle of ${libLabel(state.library, engineName(to))}`;
    $('byChange').checked = state.byChange;
    $('byChangeLabel').textContent = state.from === WHOLE_ID ? 'Added and removed marking applies between two versions' :
        from && from !== to ? `Show what was added and removed since ${engineName(from)}` : 'Show what was added and removed (pick two different versions)';
    $('byChange').disabled = state.from === WHOLE_ID || !base || from === to;

    if (!shown) {
        $('treemap').innerHTML = '';
        $('tmCrumbs').textContent = 'This version has no measurement for this bundle.';
        $('tmLegend').innerHTML = '';
        return;
    }

    const before = compare ? new Map(base.modules) : null;
    const light = !matchMedia('(prefers-color-scheme: dark)').matches;

    Treemap.render({
        container: $('treemap'),
        crumbs: $('tmCrumbs'),
        modules: shown.modules,
        before,
        whole: whole ? new Map(whole.modules) : null,
        zoom: state.zoom,
        onZoom: (path) => {
            state.zoom = path;
            saveState();
            renderTreemap(engines());
        },
        format: kb,
        formatChange: signed,
        areaColor: (id) => {
            const index = libAreas().indexOf(areaOf(id));
            // yellow is the one fill that needs dark text
            return { fill: index < 0 ? css('--muted') : css(SLOTS[index]), dark: SLOTS[index] === '--s4' && light };
        }
    });

    const areaLegend = [...libAreas(), 'Other'].map(area => `<span><i style="background:${areaColor(area)}"></i>${esc(area)}</span>`).join('');
    if (whole) {
        $('tmLegend').innerHTML = `${areaLegend}<span><i class="shaken"></i>removed by tree-shaking</span><span>Each box is a module at its full size; the coloured part is what the bundle kept.</span>`;
        return;
    }
    $('tmLegend').innerHTML = compare ?
        `<span><i class="added"></i>added since ${esc(engineName(from))}</span><span><i class="removed"></i>removed since ${esc(engineName(from))}</span><span><i class="same"></i>in both</span><span>Each box is the larger of the module's two sizes, so removed code still has its place.</span>` :
        areaLegend;
}

// against the whole library: the largest modules removed, kept in part and kept whole
function renderKept(to, key, whole) {
    const entry = measured(to, key);
    const inBundle = new Map(entry.modules);
    // the list of exports that ends the whole-library build is not a module of the library
    const rows = whole.modules.filter(([id]) => id !== '(export list)').map(([id, full]) => {
        const kept = Math.min(inBundle.get(id) ?? 0, full);
        return { id, full, kept, removed: full - kept };
    });
    const removed = rows.filter(r => r.kept === 0).sort((a, b) => b.full - a.full);
    const partly = rows.filter(r => r.kept > 0 && r.removed > 0).sort((a, b) => b.removed - a.removed);
    const kept = rows.filter(r => r.removed === 0).sort((a, b) => b.full - a.full);
    const sum = (list, field) => list.reduce((total, r) => total + r[field], 0);

    $('diffTitle').innerHTML = `What tree-shaking removed from the ${libLabel(state.library, engineName(to))} ${esc(variantOf(key))} bundle`;
    $('diffNote').textContent = `Of ${rows.length} modules in the whole library, ${removed.length} ${removed.length === 1 ? 'was' : 'were'} removed entirely (${kb(sum(removed, 'full'))}), ${partly.length} were kept in part (${kb(sum(partly, 'removed'))} removed) and ${kept.length} were kept whole (${kb(sum(kept, 'full'))}). Sizes are minified bytes before compression.`;

    const LIMIT = 12;
    const group = (title, list) => {
        const shown = state.allModules ? list : list.slice(0, LIMIT);
        return `<tr><th colspan="4">${title}${!state.allModules && list.length > LIMIT ? `, largest ${LIMIT} of ${list.length}` : ''}</th></tr>${
            shown.map(r => `<tr><td class="wrap">${esc(r.id)}</td><td>${kb(r.full)}</td><td>${r.kept ? kb(r.kept) : '—'}</td><td>${(100 * r.kept / r.full).toFixed(0)}%</td></tr>`).join('')}`;
    };
    $('diffTable').innerHTML = `<thead><tr><th>Module</th><th>Whole library</th><th>In the bundle</th><th>Kept</th></tr></thead><tbody>${
        group('Removed entirely', removed)}${group('Kept in part', partly)}${group('Kept whole', kept)
    }</tbody><tfoot><tr><td>Whole library</td><td>${kb(whole.size.raw)}</td><td>${kb(entry.size.raw)}</td><td>${(100 * entry.size.raw / whole.size.raw).toFixed(0)}%</td></tr></tfoot>`;

    $('diffMore').hidden = state.allModules || rows.length <= LIMIT;
    $('diffMore').textContent = `Show all ${rows.length} modules`;
}

function renderDiff(list) {
    const key = state.bundle;
    const from = list.find(e => e.id === state.from);
    const to = list.find(e => e.id === state.to);
    const a = from && measured(from, key);
    const b = to && measured(to, key);
    $('diffMore').hidden = true;

    if (state.from === WHOLE_ID) {
        const whole = wholeOf(to, key);
        if (whole) {
            renderKept(to, key, whole);
        } else {
            $('diffTitle').textContent = 'What tree-shaking removed';
            $('diffNote').textContent = 'This version has no whole-library build measured for this variant.';
            $('diffTable').innerHTML = '';
        }
        return;
    }
    $('diffTitle').innerHTML = `Modules that changed in the ${libLabel(state.library)} ${esc(variantOf(key))} bundle`;

    if (!a || !b) {
        $('diffNote').textContent = 'Pick two versions that both have a measurement for this bundle.';
        $('diffTable').innerHTML = '';
        return;
    }

    const before = new Map(a.modules);
    const after = new Map(b.modules);
    const rows = [...new Set([...before.keys(), ...after.keys()])]
    .map(id => ({ id, was: before.get(id), now: after.get(id), diff: (after.get(id) ?? 0) - (before.get(id) ?? 0) }))
    .filter(row => row.diff !== 0)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

    const total = b.size.raw - a.size.raw;
    const added = rows.filter(r => r.was === undefined).length;
    const removed = rows.filter(r => r.now === undefined).length;
    $('diffNote').textContent = `${engineName(from)} to ${engineName(to)}: ${signed(total)} raw. ${rows.length} modules changed size, ${added} are new in the bundle and ${removed} left it. Sizes are minified bytes before compression.`;

    const LIMIT = 30;
    const shown = state.allModules ? rows : rows.slice(0, LIMIT);
    $('diffTable').innerHTML = `<thead><tr><th>Module</th><th>${esc(engineName(from))}</th><th>${esc(engineName(to))}</th><th>Change</th></tr></thead><tbody>${
        shown.map(r => `<tr><td class="wrap">${esc(r.id)}${r.was === undefined ? '<span class="tag">new</span>' : r.now === undefined ? '<span class="tag">gone</span>' : ''}</td>
            <td>${r.was === undefined ? '—' : kb(r.was)}</td><td>${r.now === undefined ? '—' : kb(r.now)}</td>
            <td class="${cls(r.diff)}">${signed(r.diff)}</td></tr>`).join('')
    }</tbody><tfoot><tr><td>Whole bundle</td><td>${kb(a.size.raw)}</td><td>${kb(b.size.raw)}</td><td class="${cls(total)}">${signed(total)}</td></tr></tfoot>`;

    if (!state.allModules && rows.length > LIMIT) {
        $('diffMore').hidden = false;
        $('diffMore').textContent = `Show all ${rows.length} modules`;
    }
}

function fillSelect(select, items, value) {
    select.innerHTML = items.map(([id, text]) => `<option value="${esc(id)}">${esc(text)}</option>`).join('');
    select.value = value;
}

function render() {
    const list = engines();

    // the chosen variant, or the library's first when it has no such variant
    state.bundle = libBundles().find(key => variantOf(key) === state.variant) ?? libBundles()[0];
    state.variant = variantOf(state.bundle);
    fillSelect($('bundle'), libBundles().map(k => [variantOf(k), variantOf(k)]), state.variant);

    // by default the comparison is the latest release against the one before it; a choice that
    // is no longer listed falls back to that
    const releases = list.filter(e => e.track === 'release');
    const usual = releases.length > 1 ? releases : list;
    defaults.to = usual.at(-1)?.id ?? null;
    defaults.from = (usual.at(-2) ?? usual.at(-1))?.id ?? null;
    if (!list.some(e => e.id === state.to)) {
        state.to = defaults.to;
    }
    if (state.from !== WHOLE_ID && !list.some(e => e.id === state.from)) {
        state.from = defaults.from;
    }
    const options = list.map(e => [e.id, engineName(e)]);
    // besides another version, a bundle can be set against the library it was tree-shaken from
    fillSelect($('from'), [[WHOLE_ID, 'Whole library (no tree-shaking)'], ...options], state.from);
    fillSelect($('to'), options, state.to);

    $('library2').value = state.library;
    $('branches').checked = state.branches;
    saveState();

    // the treemap's own page has only the treemap
    if (TREEMAP_PAGE) {
        $('back').href = `../${location.search}`;
        sizeTreemap();
        renderTreemap(list);
        return;
    }

    $('metric').value = state.metric;
    // the library can be picked in either section that depends on it
    $('library').value = state.library;
    $('sizeTitle').innerHTML = `${libLabel(state.library)}: tree-shaken bundle size by version`;
    $('fullTitle').innerHTML = `${libLabel(state.library)}: full library size by version`;
    $('up').href = withMetric('../', state.metric);
    // the full-screen treemap opens on the same selection
    $('tmOpen').href = `treemap/${location.search}`;

    renderLibraries();
    renderTiles(list);
    renderSize(list);
    renderFull(list);
    renderShare(list);
    renderComposition(list);
    renderCompareTiles(list);
    renderTreemap(list);
    renderDiff(list);
}

if (!TREEMAP_PAGE) {
    const hidden = DATA.engines.filter(e => e.track === 'branch').length;
    const counts = DATA.libraries.map(lib => `${DATA.engines.filter(e => e.library === lib).length} of ${libLabel(lib)}`).join(' and ');
    $('lede').innerHTML = `${esc(DATA.scenario.description)} Builds measured: ${counts}.${hidden ? ` ${hidden} branch build${hidden > 1 ? 's are' : ' is'} hidden until included.` : ''}`;
    if (DATA.environment) {
        const others = DATA.environment.others;
        $('setup').textContent = `Measured on ${DATA.environment.text}.${others ? ` ${others} other setup${others > 1 ? 's were' : ' was'} also used; each result file records its own.` : ''} Generated ${DATA.generated.slice(0, 10)}.`;
    }
    fillSelect($('library'), DATA.libraries.map(lib => [lib, libName(lib)]), state.library);
}

fillSelect($('library2'), DATA.libraries.map(lib => [lib, libName(lib)]), state.library);
// a picker that this page does not have is skipped
const on = (id, apply) => $(id)?.addEventListener('change', (event) => {
    apply(event.target);
    state.allModules = false;
    render();
});
on('metric', (el) => {
    state.metric = el.value;
});
on('library', (el) => {
    state.library = el.value; state.zoom = '';
});
on('library2', (el) => {
    state.library = el.value; state.zoom = '';
});
on('bundle', (el) => {
    state.variant = el.value;
});
on('from', (el) => {
    state.from = el.value;
});
on('to', (el) => {
    state.to = el.value;
});
on('branches', (el) => {
    state.branches = el.checked;
});
on('byChange', (el) => {
    state.byChange = el.checked;
});
$('diffMore')?.addEventListener('click', () => {
    state.allModules = true;
    render();
});

// On its own page the treemap fills the window, and can be magnified: the layout is drawn larger
// than the window and scrolled, which gives more boxes room for their names
const SCALES = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6];

// Sizes the treemap for the current magnification, keeping one point of the view where it is: the
// pointer when zooming with the wheel, otherwise the middle
function sizeTreemap(anchorX, anchorY) {
    const view = $('tmView');
    const box = $('treemap');
    const ax = anchorX ?? view.clientWidth / 2;
    const ay = anchorY ?? view.clientHeight / 2;
    // (on the first layout there is nothing to keep, and the view starts at the top left)
    const laidOut = box.offsetWidth > 0 && box.offsetHeight > 0;
    const fx = laidOut ? (view.scrollLeft + ax) / box.offsetWidth : 0;
    const fy = laidOut ? (view.scrollTop + ay) / box.offsetHeight : 0;
    box.style.width = `${Math.floor(view.clientWidth * state.scale)}px`;
    box.style.height = `${Math.floor(view.clientHeight * state.scale)}px`;
    view.scrollLeft = laidOut ? fx * box.offsetWidth - ax : 0;
    view.scrollTop = laidOut ? fy * box.offsetHeight - ay : 0;
    view.classList.toggle('can-pan', state.scale > 1);
    $('scaleText').textContent = `${Math.round(state.scale * 100)}%`;
    $('scaleDown').disabled = state.scale === SCALES[0];
    $('scaleUp').disabled = state.scale === SCALES.at(-1);
}
function magnify(step, anchorX, anchorY) {
    // the nearest step, in case the address carried a magnification that is not one
    const now = SCALES.reduce((best, s, i) => (Math.abs(s - state.scale) < Math.abs(SCALES[best] - state.scale) ? i : best), 0);
    const index = Math.max(0, Math.min(SCALES.length - 1, now + step));
    if (SCALES[index] !== state.scale) {
        state.scale = SCALES[index];
        saveState();
        sizeTreemap(anchorX, anchorY);
        renderTreemap(engines());
    }
}
if (TREEMAP_PAGE) {
    const view = $('tmView');
    $('scaleDown').addEventListener('click', () => magnify(-1));
    $('scaleUp').addEventListener('click', () => magnify(1));
    $('scaleFit').addEventListener('click', () => magnify(-SCALES.length));

    // Ctrl + wheel magnifies towards the pointer, as in maps and design tools; a trackpad pinch
    // arrives the same way. A plain wheel scrolls, and Shift + wheel scrolls sideways, as usual
    let wheel = 0;
    view.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey) {
            return;
        }
        event.preventDefault();
        // a pinch sends many small movements; a wheel notch sends one large one
        wheel += event.deltaY;
        if (Math.abs(wheel) >= 40) {
            const rect = view.getBoundingClientRect();
            magnify(wheel < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
            wheel = 0;
        }
    }, { passive: false });

    // dragging moves around a magnified treemap
    let drag = null;
    view.addEventListener('pointerdown', (event) => {
        if (event.button === 0 && state.scale > 1) {
            drag = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, moved: false };
        }
    });
    addEventListener('pointermove', (event) => {
        if (!drag) {
            return;
        }
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
            drag.moved = true;
            view.classList.add('panning');
        }
        if (drag.moved) {
            view.scrollLeft = drag.left - dx;
            view.scrollTop = drag.top - dy;
        }
    });
    addEventListener('pointerup', () => {
        if (drag?.moved) {
            // the click that ends a drag must not zoom into the folder under the pointer
            view.addEventListener('click', event => event.stopPropagation(), { capture: true, once: true });
            setTimeout(() => view.classList.remove('panning'));
        }
        drag = null;
    });

    // + and - magnify, 0 fits, unless a picker has the keyboard
    addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey || /^(?:SELECT|INPUT|BUTTON)$/.test(event.target.tagName)) {
            return;
        }
        if (event.key === '+' || event.key === '=') {
            magnify(1);
        } else if (event.key === '-') {
            magnify(-1);
        } else if (event.key === '0') {
            magnify(-SCALES.length);
        }
    });
}
// chart colours are read from CSS and the treemap is laid out in pixels
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
// the comparison's own bar sticks just below the page's bar, whatever height that wraps to
const measureBar = () => document.documentElement.style.setProperty('--bar-height', `${document.querySelector('.filters')?.offsetHeight ?? 0}px`);
let resizeTimer = null;
addEventListener('resize', () => {
    measureBar();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (TREEMAP_PAGE) {
            sizeTreemap();
        }
        renderTreemap(engines());
    }, 150);
});
measureBar();
render();
