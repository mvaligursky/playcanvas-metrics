// Helpers shared by every report page. Loaded as a plain script, after chart.js.

const $ = id => document.getElementById(id);
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`;
const signed = bytes => `${bytes > 0 ? '+' : bytes < 0 ? '−' : ''}${(Math.abs(bytes) / 1024).toFixed(1)} KB`;
const pct = (now, before) => `${now >= before ? '+' : '−'}${(100 * Math.abs(now - before) / before).toFixed(1)}%`;
const cls = diff => (diff > 0 ? 'up' : diff < 0 ? 'down' : 'dim');
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7'];
const METRIC_NAME = { raw: 'raw size', gzip: 'gzip size', brotli: 'brotli size' };
const METRICS = ['brotli', 'gzip', 'raw'];
// brotli is what a release build is usually served with
const DEFAULT_METRIC = 'brotli';

// PlayCanvas is drawn in its brand orange, and three.js in blue, which stays distinct from orange
// for colour-blind readers (green does not). Variants use other colours: see VARIANT_SLOTS
const LIB_NAME = { playcanvas: 'PlayCanvas', three: 'three.js' };
const LIB_SLOT = { playcanvas: '--playcanvas', three: '--s1' };
// aqua, violet, yellow: none is used for a library
const VARIANT_SLOTS = ['--s3', '--s7', '--s4'];
const libName = lib => LIB_NAME[lib] ?? lib;
const libColor = lib => css(LIB_SLOT[lib] ?? '--muted');
// a library's name in its own colour, optionally followed by a version
const libTextColor = lib => css(`--${lib}-text`) || css('--text-2');
const libLabel = (lib, extra = '') => `<span class="lib lib-${esc(lib)}">${esc(libName(lib))}${extra ? ` ${esc(extra)}` : ''}</span>`;

const engineName = e => (e.sub ? `${e.name} ${e.sub}` : e.name);

// the page's filters live in its address, so any view can be bookmarked or shared
const params = new URLSearchParams(location.search);
const readParam = (name, fallback, allowed) => {
    const value = params.get(name);
    return value !== null && (!allowed || allowed.includes(value)) ? value : fallback;
};
const writeParams = (values) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries(values)) {
        if (value !== null && value !== undefined && value !== false && value !== '') {
            next.set(name, value === true ? '1' : value);
        }
    }
    const query = next.toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
};
// carries the size measure along to another page
const withMetric = (href, metric) => (metric === DEFAULT_METRIC ? href : `${href}?metric=${metric}`);

const charts = {};
const draw = (id, config) => {
    charts[id]?.destroy();
    charts[id] = new Chart($(id), config);
};

const baseOptions = yTitle => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: { position: 'bottom', labels: { color: css('--text-2'), usePointStyle: true, boxHeight: 7 } },
        tooltip: {
            backgroundColor: css('--surface'),
            titleColor: css('--text'),
            bodyColor: css('--text-2'),
            footerColor: css('--muted'),
            borderColor: css('--axis'),
            borderWidth: 1,
            padding: 10,
            footerFont: { weight: 'normal' }
        }
    },
    scales: {
        x: { grid: { display: false }, border: { color: css('--axis') }, ticks: { color: css('--muted') } },
        y: {
            grid: { color: css('--grid') },
            border: { display: false },
            ticks: { color: css('--muted'), callback: v => `${v} KB` },
            title: { display: true, text: yTitle, color: css('--muted') }
        }
    }
});

/**
 * One line per library on a shared release-date axis.
 *
 * @param {string} id - The canvas id.
 * @param {Object<string, object[]>} series - Per library, points with date, name, sub and size.
 * @param {string} metric - raw, gzip or brotli.
 * @param {boolean} [spark] - Draw a bare trend line, with no axes or legend.
 */
const timelineChart = (id, series, metric, spark = false) => {
    const options = baseOptions(METRIC_NAME[metric]);
    options.interaction = { mode: 'nearest', intersect: false };
    options.scales.x.type = 'linear';
    options.scales.x.ticks.maxTicksLimit = 5;
    options.scales.x.ticks.callback = value => new Date(value).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    options.plugins.tooltip.callbacks = {
        title: items => `${items[0].dataset.label} ${engineName(items[0].raw.point)}`,
        label: item => ` ${item.parsed.y.toFixed(1)} KB, dated ${item.raw.point.date}`
    };
    // each library's name in the legend takes its colour
    options.plugins.legend.labels.generateLabels = chart => Chart.defaults.plugins.legend.labels.generateLabels(chart)
    .map(label => ({ ...label, fontColor: libTextColor(chart.data.datasets[label.datasetIndex].lib) }));
    if (spark) {
        options.scales.x.display = false;
        options.scales.y.display = false;
        options.plugins.legend.display = false;
        options.layout = { padding: 6 };
    }
    draw(id, {
        type: 'line',
        data: {
            datasets: Object.entries(series).map(([lib, points]) => {
                const color = libColor(lib);
                return {
                    label: libName(lib),
                    lib,
                    data: points.map(point => ({ x: Date.parse(point.date), y: point.size[metric] / 1024, point })),
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    pointRadius: spark ? 0 : 4,
                    pointHoverRadius: spark ? 4 : 7,
                    pointBorderColor: css('--surface'),
                    pointBorderWidth: 2
                };
            })
        },
        options
    });
};

// the latest release in a series, and the release before it
const latestRelease = points => points.filter(p => p.track === 'release').at(-1);
const previousRelease = points => points.filter(p => p.track === 'release').at(-2);
