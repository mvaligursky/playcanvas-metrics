// The Dependencies section: an overview over releases, and an explorer for one release or two.
// DEPS is set by data/deps.js; the page says which one it is in data-page on its body.

const PAGE = document.body.dataset.page;
const PROJECTS = ['engine', 'examples'];
const PROJECT_NAME = { engine: 'Engine', examples: 'Examples' };
// the two projects use colours that no library uses
const PROJECT_SLOT = { engine: '--s3', examples: '--s7' };
const projectColor = project => css(PROJECT_SLOT[project]);
const projectLabel = project => `<span class="lib" style="color: ${projectColor(project)}">${esc(PROJECT_NAME[project])}</span>`;

const releases = DEPS.releases;
// the group for packages that several top-level dependencies need
const SHARED = DEPS.shared;
const SHARED_NOTE = `${SHARED} holds packages that several top-level dependencies need.`;
const releaseName = r => (r.sub ? `${r.name} ${r.sub}` : r.name);

// sizes here run to hundreds of megabytes
const size = (bytes) => {
    if (bytes === null || bytes === undefined) {
        return '—';
    }
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
};
const signedSize = bytes => `${bytes > 0 ? '+' : bytes < 0 ? '−' : '±'}${size(Math.abs(bytes))}`;
const signedCount = n => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

// one line per project on a release-date axis
function projectsChart(id, value, title, format) {
    const options = baseOptions(title);
    options.interaction = { mode: 'nearest', intersect: false };
    options.scales.x.type = 'linear';
    options.scales.x.ticks.maxTicksLimit = 6;
    options.scales.x.ticks.callback = v => new Date(v).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    options.scales.y.ticks.callback = format;
    options.scales.y.beginAtZero = true;
    options.plugins.legend.labels.generateLabels = chart => Chart.defaults.plugins.legend.labels.generateLabels(chart)
    .map(label => ({ ...label, fontColor: projectColor(PROJECTS[label.datasetIndex]) }));
    options.plugins.tooltip.callbacks = {
        title: items => `${items[0].dataset.label}, ${releaseName(items[0].raw.release)}`,
        label: item => ` ${format(item.parsed.y)}, dated ${item.raw.release.date}`
    };
    draw(id, {
        type: 'line',
        data: {
            datasets: PROJECTS.map((project) => {
                const color = projectColor(project);
                return {
                    label: PROJECT_NAME[project],
                    data: releases.filter(r => r.projects[project]).map(r => ({ x: Date.parse(r.date), y: value(r.projects[project]), release: r })),
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBorderColor: css('--surface'),
                    pointBorderWidth: 2
                };
            })
        },
        options
    });
}

function renderOverview() {
    const latest = releases.filter(r => r.track === 'release').at(-1);
    const before = releases.filter(r => r.track === 'release').at(-2);

    const tile = (name, value, note) => `<div class="tile"><div class="name">${name}</div><div class="value">${value}</div><div class="change">${note}</div></div>`;
    const change = (project, field, format) => {
        const now = latest.projects[project]?.counts[field];
        const was = before?.projects[project]?.counts[field];
        return was === undefined ? '' : `<span class="${cls(now - was)}">${format(now - was)}</span> since ${esc(before.name)}`;
    };
    $('tiles').innerHTML = [
        ...PROJECTS.map(project => tile(`${projectLabel(project)}: packages installed, ${esc(latest.name)}`,
            latest.projects[project].counts.installed, change(project, 'installed', signedCount))),
        ...PROJECTS.map(project => tile(`${projectLabel(project)}: unpacked size`,
            size(latest.projects[project].counts.size), change(project, 'size', signedSize))),
        tile(`An app installing <span class="lib lib-playcanvas">playcanvas</span> ${esc(latest.name)}`,
            `${latest.projects.engine.app.installed} packages`, `${size(latest.projects.engine.app.size)} with the engine's runtime dependencies`)
    ].join('');

    projectsChart('installedChart', p => p.counts.installed, 'packages installed', v => `${Math.round(v)}`);
    projectsChart('sizeChart', p => p.counts.size, 'unpacked size', v => `${Math.round(v / 1048576)} MB`);
    projectsChart('topChart', p => p.counts.topLevel, 'top-level dependencies', v => `${Math.round(v)}`);

    const cells = (r, project) => {
        const c = r.projects[project]?.counts;
        return c ? `<td>${c.topLevel}</td><td>${c.installed}</td><td>${size(c.size)}</td>` : '<td class="dim" colspan="3">no lockfile</td>';
    };
    $('releaseTable').innerHTML = `<thead><tr><th rowspan="2">Version</th><th rowspan="2">Released</th>${
        PROJECTS.map(p => `<th colspan="3">${projectLabel(p)}</th>`).join('')}<th rowspan="2">App installs</th><th rowspan="2"></th></tr>
        <tr>${PROJECTS.map(() => '<th>top-level</th><th>installed</th><th>size</th>').join('')}</tr></thead><tbody>${
    [...releases].reverse().map(r => `<tr><td>${esc(releaseName(r))}${r.track === 'release' ? '' : `<span class="tag">${r.track}</span>`}</td><td>${r.date.slice(0, 10)}</td>${
        PROJECTS.map(p => cells(r, p)).join('')}<td>${r.projects.engine ? `${r.projects.engine.app.installed} (${size(r.projects.engine.app.size)})` : '—'}</td>
            <td><a href="explore/?to=${encodeURIComponent(r.id)}">explore</a></td></tr>`).join('')}</tbody>`;
}

// ---- explorer ----

const state = {
    project: readParam('project', 'engine', PROJECTS),
    from: readParam('from', null),
    to: readParam('to', null),
    compare: readParam('compare', '1') === '1',
    zoom: readParam('zoom', '')
};

const releaseById = id => releases.find(r => r.id === id);

// a release's packages as treemap modules: each top-level dependency is a folder holding what
// only it installs; packages that several need go under (shared). Several installed versions of
// one package in one place are one box
const modulesOf = (project) => {
    const sums = new Map();
    for (const [name, , bytes, group] of project.packages) {
        const id = `${group}/${name}`;
        sums.set(id, (sums.get(id) ?? 0) + (bytes ?? 0));
    }
    return sums;
};

// per package name: its versions and total size, wherever it is installed
const byName = (project) => {
    const out = new Map();
    for (const [name, version, bytes] of project?.packages ?? []) {
        const item = out.get(name) ?? { versions: new Set(), size: 0, unknown: false };
        item.versions.add(version);
        item.size += bytes ?? 0;
        item.unknown ||= bytes === null;
        out.set(name, item);
    }
    return out;
};

function renderExplorer() {
    const available = releases.filter(r => r.projects[state.project]);
    const usual = available.filter(r => r.track === 'release');
    const fallbackTo = usual.at(-1)?.id;
    const fallbackFrom = usual.at(-2)?.id;
    if (!releaseById(state.to)?.projects[state.project]) {
        state.to = fallbackTo;
    }
    if (!releaseById(state.from)?.projects[state.project]) {
        state.from = fallbackFrom;
    }
    const to = releaseById(state.to);
    const from = releaseById(state.from);
    const a = from.projects[state.project];
    const b = to.projects[state.project];
    const comparing = state.compare && from !== to;

    const options = [...available].reverse().map(r => `<option value="${esc(r.id)}">${esc(releaseName(r))}</option>`).join('');
    $('from').innerHTML = options;
    $('to').innerHTML = options;
    $('from').value = state.from;
    $('to').value = state.to;
    $('project').value = state.project;
    $('compare').checked = state.compare;
    $('compareLabel').textContent = from === to ? 'Show what was added and removed (pick two different versions)' : `Show what was added and removed since ${releaseName(from)}`;
    $('compare').disabled = from === to;
    writeParams({
        project: state.project === 'engine' ? null : state.project,
        from: state.from === fallbackFrom ? null : state.from,
        to: state.to === fallbackTo ? null : state.to,
        compare: state.compare ? null : '0',
        zoom: state.zoom
    });

    // the headline figures
    const tile = (name, value, note) => `<div class="tile"><div class="name">${name}</div><div class="value">${value}</div><div class="change">${note}</div></div>`;
    const delta = (field, format) => (from === to ? '' : `<span class="${cls(b.counts[field] - a.counts[field])}">${format(b.counts[field] - a.counts[field])}</span> since ${esc(releaseName(from))}`);
    $('tiles').innerHTML = [
        tile(`${projectLabel(state.project)} ${esc(releaseName(to))}: packages installed`, b.counts.installed, delta('installed', signedCount)),
        tile('Unpacked size', size(b.counts.size), `${delta('size', signedSize)}${b.counts.unknownSize ? ` · ${b.counts.unknownSize} with no size recorded` : ''}`),
        tile('Top-level dependencies', `${b.counts.topLevel}`, `${b.counts.topLevelRuntime} runtime, ${b.counts.topLevelDev} development${from === to ? '' : ` · ${delta('topLevel', signedCount)}`}`)
    ].join('');

    // the treemap, coloured by top-level dependency
    const groups = [...new Set(b.packages.map(p => p[3]))];
    const groupSize = new Map(groups.map(g => [g, b.packages.filter(p => p[3] === g).reduce((s, p) => s + (p[2] ?? 0), 0)]));
    const coloured = [...groups].sort((x, y) => groupSize.get(y) - groupSize.get(x)).slice(0, SLOTS.length);
    const groupOf = id => groups.find(g => id === g || id.startsWith(`${g}/`)) ?? '';
    const fillOf = (group) => {
        const index = coloured.indexOf(group);
        return index < 0 ? css('--muted') : css(SLOTS[index]);
    };
    const light = !matchMedia('(prefers-color-scheme: dark)').matches;

    $('tmTitle').innerHTML = comparing ?
        `${projectLabel(state.project)} dependencies: ${esc(releaseName(from))} against ${esc(releaseName(to))}` :
        `${projectLabel(state.project)} dependencies of ${esc(releaseName(to))}`;
    Treemap.render({
        container: $('treemap'),
        crumbs: $('tmCrumbs'),
        modules: [...modulesOf(b)],
        before: comparing ? modulesOf(a) : null,
        whole: null,
        zoom: state.zoom,
        onZoom: (zoom) => {
            state.zoom = zoom;
            renderExplorer();
        },
        format: size,
        formatChange: signedSize,
        areaColor: (id) => {
            const group = groupOf(id);
            return { fill: fillOf(group), dark: SLOTS[coloured.indexOf(group)] === '--s4' && light };
        }
    });
    $('tmLegend').innerHTML = comparing ?
        `<span><i class="added"></i>added since ${esc(releaseName(from))}</span><span><i class="removed"></i>removed since ${esc(releaseName(from))}</span><span><i class="same"></i>in both</span><span>Each box is the larger of the package's two sizes. A package that moved to another group shows as removed in one and added in the other.</span>` :
        `${coloured.map(g => `<span><i style="background:${fillOf(g)}"></i>${esc(g)}</span>`).join('')}<span><i style="background:${css('--muted')}"></i>others</span><span>${SHARED_NOTE}</span>`;

    // the top-level dependencies
    const before = new Map(a.topLevel.map(t => [t.name, t]));
    const names = [...new Set([...b.topLevel.map(t => t.name), ...a.topLevel.map(t => t.name)])];
    const after = new Map(b.topLevel.map(t => [t.name, t]));
    const rows = names.map(name => ({ name, now: after.get(name), was: before.get(name) }))
    .sort((x, y) => (y.now?.size ?? -1) - (x.now?.size ?? -1));
    $('topTable').innerHTML = `<thead><tr><th>Dependency</th><th>Kind</th><th>Version</th>${from === to ? '' : `<th>In ${esc(releaseName(from))}</th>`}<th>Packages it alone installs</th><th>Their size</th>${from === to ? '' : '<th>Change</th>'}</tr></thead><tbody>${
        rows.map(({ name, now, was }) => {
            const t = now ?? was;
            const versionOf = x => (x ? x.local ? `local: ${x.local}` : x.version ?? '—' : '—');
            const diff = (now?.size ?? 0) - (was?.size ?? 0);
            const tag = !now ? '<span class="tag">removed</span>' : !was && from !== to ? '<span class="tag">new</span>' : '';
            return `<tr><td class="wrap">${esc(name)}${tag}</td><td>${t.kind}</td><td>${esc(versionOf(now))}</td>${from === to ? '' : `<td>${esc(versionOf(was))}</td>`}
                <td>${now ? now.installed : '—'}</td><td>${now ? size(now.size) : '—'}</td>${from === to ? '' : `<td class="${cls(diff)}">${signedSize(diff)}</td>`}</tr>`;
        }).join('')}</tbody><tfoot><tr><td>Installed by several (${esc(SHARED)})</td><td></td><td></td>${from === to ? '' : '<td></td>'}<td>${b.packages.filter(p => p[3] === SHARED).length}</td><td>${size(groupSize.get(SHARED) ?? 0)}</td>${from === to ? '' : '<td></td>'}</tr></tfoot>`;

    // every package that changed, by name
    if (from === to) {
        $('changesCard').hidden = true;
        return;
    }
    $('changesCard').hidden = false;
    const was = byName(a);
    const now = byName(b);
    const list = v => [...v].sort().join(', ');
    const changes = [...new Set([...was.keys(), ...now.keys()])].map((name) => {
        const x = was.get(name);
        const y = now.get(name);
        const status = !x ? 'added' : !y ? 'removed' : list(x.versions) === list(y.versions) ? 'same' : 'changed';
        return { name, x, y, status, diff: (y?.size ?? 0) - (x?.size ?? 0) };
    }).filter(c => c.status !== 'same').sort((p, q) => Math.abs(q.diff) - Math.abs(p.diff) || p.name.localeCompare(q.name));
    const count = s => changes.filter(c => c.status === s).length;
    $('changesNote').textContent = `${releaseName(from)} to ${releaseName(to)}: ${count('added')} packages added, ${count('removed')} removed and ${count('changed')} changed version. Sizes are unpacked, as installed on Linux x64.`;
    const LIMIT = 40;
    const shown = state.allChanges ? changes : changes.slice(0, LIMIT);
    $('changesTable').innerHTML = `<thead><tr><th>Package</th><th>${esc(releaseName(from))}</th><th>${esc(releaseName(to))}</th><th>Size change</th></tr></thead><tbody>${
        shown.map(c => `<tr><td class="wrap">${esc(c.name)}${c.status === 'changed' ? '' : `<span class="tag">${c.status}</span>`}</td>
            <td>${c.x ? esc(list(c.x.versions)) : '—'}</td><td>${c.y ? esc(list(c.y.versions)) : '—'}</td>
            <td class="${cls(c.diff)}">${signedSize(c.diff)}</td></tr>`).join('')}</tbody>`;
    $('changesMore').hidden = state.allChanges || changes.length <= LIMIT;
    $('changesMore').textContent = `Show all ${changes.length} changes`;
}

if (PAGE === 'overview') {
    renderOverview();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderOverview);
} else {
    const on = (id, apply) => $(id).addEventListener('change', (event) => {
        apply(event.target);
        state.allChanges = false;
        renderExplorer();
    });
    on('project', (el) => {
        state.project = el.value;
        state.zoom = '';
    });
    on('from', (el) => {
        state.from = el.value;
    });
    on('to', (el) => {
        state.to = el.value;
    });
    on('compare', (el) => {
        state.compare = el.checked;
    });
    $('changesMore').addEventListener('click', () => {
        state.allChanges = true;
        renderExplorer();
    });
    let timer = null;
    addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(renderExplorer, 150);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderExplorer);
    renderExplorer();
}
