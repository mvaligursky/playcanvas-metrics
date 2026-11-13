// A treemap of the modules in a bundle: boxes sized by minified bytes, nested by folder. Click a
// folder's name to zoom into it.
//
// With a build to compare against, both builds are drawn at once. Every box takes the larger of
// the module's two sizes, and a part of it is marked: red for bytes that were added, striped green
// for bytes that were removed. A module in only one of the builds is marked whole.

const Treemap = (() => {
    const HEAD = 18;
    const PAD = 2;

    // builds the folder hierarchy; a folder with a single sub-folder is merged into it
    const buildTree = (modules, before) => {
        const root = { name: '', path: '', children: new Map(), value: 0, was: 0, size: 0 };
        const add = (id, now, was) => {
            // when comparing, a box has to hold the module as it is in either build
            const size = before ? Math.max(now, was) : now;
            const parts = id.split('/');
            let node = root;
            const grow = (n) => {
                n.value += now;
                n.was += was;
                n.size += size;
            };
            grow(node);
            parts.forEach((part, i) => {
                if (!node.children.has(part)) {
                    node.children.set(part, { name: part, path: parts.slice(0, i + 1).join('/'), children: new Map(), value: 0, was: 0, size: 0 });
                }
                node = node.children.get(part);
                grow(node);
                if (i === parts.length - 1) {
                    node.leaf = true;
                }
            });
        };
        const seen = new Set();
        for (const [id, bytes] of modules) {
            seen.add(id);
            add(id, bytes, before?.get(id) ?? 0);
        }
        // modules that are only in the build compared against
        for (const [id, bytes] of before ?? []) {
            if (!seen.has(id)) {
                add(id, 0, bytes);
            }
        }
        const tidy = (node) => {
            let kids = [...node.children.values()].map(tidy);
            if (node !== root) {
                while (kids.length === 1 && !kids[0].leaf) {
                    node.name = `${node.name}/${kids[0].name}`;
                    node.path = kids[0].path;
                    kids = kids[0].kids;
                }
            }
            node.kids = kids.sort((a, b) => b.size - a.size);
            return node;
        };
        return tidy(root);
    };

    // squarified layout: packs items, largest first, into rows that stay as square as possible
    const squarify = (items, x, y, w, h) => {
        const out = [];
        let rest = items.filter(item => item.size > 0);
        let remaining = rest.reduce((sum, item) => sum + item.size, 0);
        const worst = (row, sum, short, scale) => {
            const thick = sum * scale / short;
            let bad = 0;
            for (const item of row) {
                const len = item.size * scale / thick;
                bad = Math.max(bad, thick / len, len / thick);
            }
            return bad;
        };
        while (rest.length && w > 0 && h > 0) {
            const short = Math.min(w, h);
            const scale = w * h / remaining;
            const row = [rest[0]];
            let sum = rest[0].size;
            let best = worst(row, sum, short, scale);
            while (row.length < rest.length) {
                const next = rest[row.length];
                const bad = worst([...row, next], sum + next.size, short, scale);
                if (bad > best) {
                    break;
                }
                row.push(next);
                sum += next.size;
                best = bad;
            }
            const thick = sum * scale / short;
            let offset = 0;
            for (const item of row) {
                const len = item.size * scale / thick;
                out.push(w >= h ? { item, x, y: y + offset, w: thick, h: len } : { item, x: x + offset, y, w: len, h: thick });
                offset += len;
            }
            if (w >= h) {
                x += thick;
                w -= thick;
            } else {
                y += thick;
                h -= thick;
            }
            remaining -= sum;
            rest = rest.slice(row.length);
        }
        return out;
    };

    const find = (node, path) => {
        if (node.path === path) {
            return node;
        }
        for (const kid of node.kids) {
            if (!kid.leaf && (path === kid.path || path.startsWith(`${kid.path}/`))) {
                return find(kid, path);
            }
        }
        return null;
    };

    /**
     * @param {object} opts - Options.
     * @param {HTMLElement} opts.container - Where the boxes go.
     * @param {HTMLElement} opts.crumbs - Where the zoom trail goes.
     * @param {Array<[string, number]>} opts.modules - Module ids and their bytes.
     * @param {Map<string, number>|null} opts.before - Bytes per module in the build compared
     * against, or null for no comparison.
     * @param {function(string): {fill: string, dark: boolean}} opts.areaColor - Fill for a
     * module when there is no comparison.
     * @param {string} opts.zoom - Path of the folder to show; empty for everything.
     * @param {function(string): void} opts.onZoom - Called with the folder to zoom to.
     * @param {function(number): string} opts.format - Formats bytes.
     * @param {function(number): string} opts.formatChange - Formats a change in bytes.
     */
    const render = (opts) => {
        const { container, crumbs, modules, before, zoom, onZoom, format, formatChange } = opts;
        const root = buildTree(modules, before);
        const top = (zoom && find(root, zoom)) || root;

        // the zoom trail
        const trail = [{ label: 'everything', path: '' }];
        if (top !== root) {
            let node = root;
            while (node !== top) {
                node = node.kids.find(kid => !kid.leaf && (top.path === kid.path || top.path.startsWith(`${kid.path}/`)));
                trail.push({ label: node.name, path: node.path });
            }
        }
        const total = before ? `${format(top.was)} → ${format(top.value)}, ${formatChange(top.value - top.was)}` : format(top.value);
        crumbs.innerHTML = `${trail.map((step, i) => (i === trail.length - 1 ?
            `<strong>${esc(step.label)}</strong>` :
            `<button data-path="${esc(step.path)}">${esc(step.label)}</button>`)).join(' / ')
        } <span class="dim">· ${total}</span>`;
        crumbs.querySelectorAll('button').forEach(button => button.addEventListener('click', () => onZoom(button.dataset.path)));

        const tip = document.querySelector('.tm-tip') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'tm-tip', hidden: true }));
        container.innerHTML = '';

        const place = (node, parent, x, y, w, h) => {
            if (w < 3 || h < 3) {
                return;
            }
            const el = document.createElement('div');
            el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
            parent.appendChild(el);

            if (node.leaf) {
                const diff = node.value - node.was;
                const roomy = w > 54 && h > 16;
                if (before) {
                    // the changed share of the box, as a band across its longer side
                    el.className = 'tm-leaf cmp';
                    const share = Math.abs(diff) / node.size;
                    if (share > 0) {
                        const part = document.createElement('div');
                        part.className = `tm-part ${diff > 0 ? 'added' : 'removed'}`;
                        part.style.cssText = w >= h ?
                            `top:0;bottom:0;right:0;width:${Math.max(2, share * w)}px` :
                            `left:0;right:0;bottom:0;height:${Math.max(2, share * h)}px`;
                        el.appendChild(part);
                    }
                } else {
                    const paint = opts.areaColor(node.path);
                    el.className = `tm-leaf${paint.dark ? ' dark-text' : ''}`;
                    el.style.background = paint.fill;
                }
                if (roomy) {
                    el.insertAdjacentHTML('beforeend', `<span>${esc(node.name)}</span>${h > 30 ? `<span class="sz">${before ? (diff === 0 ? 'no change' : formatChange(diff)) : format(node.value)}</span>` : ''}`);
                }
                el.addEventListener('mousemove', (event) => {
                    tip.hidden = false;
                    let lines = `${format(node.value)} <span class="t2">· ${(100 * node.value / (top.value || 1)).toFixed(1)}% of what is shown</span>`;
                    if (before) {
                        lines = node.was === 0 ? `<span class="t2">added:</span> ${format(node.value)}` :
                            node.value === 0 ? `<span class="t2">removed, was</span> ${format(node.was)}` :
                                `${format(node.was)} → ${format(node.value)} <span class="t2">· ${diff === 0 ? 'no change' : formatChange(diff)}</span>`;
                    }
                    tip.innerHTML = `<strong>${esc(node.path)}</strong><br>${lines}`;
                    const tw = tip.offsetWidth;
                    tip.style.left = `${Math.min(event.clientX + 14, innerWidth - tw - 8)}px`;
                    tip.style.top = `${event.clientY + 16}px`;
                });
                el.addEventListener('mouseleave', () => {
                    tip.hidden = true;
                });
                return;
            }

            el.className = 'tm-group';
            // a folder shows its name when there is room for it
            const head = w > 60 && h > HEAD * 2 ? HEAD : 0;
            if (head) {
                const title = document.createElement('div');
                title.className = 'tm-head';
                title.textContent = `${node.name} · ${before ? formatChange(node.value - node.was) : format(node.value)}`;
                title.title = `Zoom into ${node.path}`;
                title.addEventListener('click', () => onZoom(node.path));
                el.appendChild(title);
            }
            for (const rect of squarify(node.kids, PAD, head + PAD, w - 2 - PAD * 2, h - 2 - head - PAD * 2)) {
                place(rect.item, el, rect.x, rect.y, rect.w, rect.h);
            }
        };

        // the top level has no frame of its own
        for (const rect of squarify(top.leaf ? [top] : top.kids, 0, 0, container.clientWidth, container.clientHeight)) {
            place(rect.item, container, rect.x, rect.y, rect.w, rect.h);
        }
    };

    return { render };
})();
