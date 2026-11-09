"use strict";
// Skywatch ADS-B: command palette (Ctrl/Cmd-K). Aircraft already loaded, airports, and actions in one box.
// Ranking lives in palette-rank.js (unit tested). All text is set with textContent; nothing is built with innerHTML.
const PALETTE = (function () {
    let root = null, input = null, list = null, live = null, items = [], sel = 0, prevFocus = null, open = false;
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const click = (id) => () => { const b = document.getElementById(id); if (b) b.click(); };

    function actions() {
        const a = [
            {title: 'Switch to 2D', keys: ['flat', 'view'], run: click('view2d')},
            {title: 'Switch to 3D', keys: ['tilt', 'pitch', 'view', 'buildings'], run: click('view3d')},
            {title: 'Switch to Globe', keys: ['world', 'view'], run: click('viewGlobe')},
            {title: 'North up', keys: ['reset', 'rotation', 'compass'], run: click('north_up')},
            {title: 'Open settings', keys: ['preferences', 'options', 'cog'], run: click('settingsCog')},
        ];
        const g = document.getElementById('view_graphs');
        if (g && g.offsetParent !== null) a.push({title: 'Open graphs', keys: ['statistics', 'coverage'], run: () => g.click()});
        const rp = document.getElementById('RP');
        if (rp && rp.offsetParent !== null) a.push({title: 'Toggle replay', keys: ['history', 'rewind'], run: () => rp.click()});
        a.push({title: 'Toggle follow selected aircraft', keys: ['track', 'lock'], run: () => typeof toggleFollow == 'function' && toggleFollow()});
        a.push({title: 'Toggle aircraft labels', keys: ['callsign', 'names'], run: () => typeof toggleLabels == 'function' && toggleLabels()});
        a.push({title: 'Toggle airport detail (applies after reload)', keys: ['airfield', 'runway', 'detail'], run: () => {
            const cb = document.getElementById('airportDetail_cb'); if (cb) { cb.click(); if (typeof SKYUI != 'undefined') SKYUI.toast('Airport detail changes after you reload the page.'); }
        }});
        if (typeof SelectedPlane !== 'undefined' && SelectedPlane) {
            a.push({title: 'Isolate selected aircraft', keys: ['only', 'hide others', 'filter'], run: () => typeof toggleIsolation == 'function' && toggleIsolation()});
            a.push({title: 'Clear selection', keys: ['deselect', 'close'], run: () => typeof deselectAllPlanes == 'function' && deselectAllPlanes()});
        }
        if (typeof layers != 'undefined' && layers.getArray) {
            for (const l of layers.getArray()) if (l.get('type') === 'base') {
                a.push({title: 'Map: ' + l.get('title'), keys: ['basemap', 'provider', 'style'], run: () => { l.setVisible(true); }});
            }
        }
        return a;
    }
    function planes() {
        const out = [];
        for (const p of (g.planesOrdered || [])) {
            if (!p || !p.icao || p.position == null) continue;
            out.push({hex: p.icao, flight: (p.flight || '').trim(), reg: p.registration || '', type: p.icaoType || ''});
        }
        return out;
    }
    function view() { return typeof CenterLat == 'number' ? {lat: CenterLat, lon: CenterLon} : null; }

    function build(q) {
        const out = [], cats = (typeof AIRPT != 'undefined' && AIRPT.weatherCats) ? AIRPT.weatherCats() : {};
        q = q.trim();
        const sections = [];
        if (q) {
            const ac = PALRANK.rankAircraft(q, planes(), 5);
            if (ac.length) sections.push(['Aircraft', ac.map(r => ({
                title: r.plane.flight || r.plane.hex.toUpperCase(), sub: [r.plane.reg, r.plane.type, r.plane.hex.toUpperCase()].filter(Boolean).join(' · '),
                run: () => typeof selectPlaneByHex == 'function' && selectPlaneByHex(r.plane.hex, {follow: true})}))]);
            const db = typeof AIRPT != 'undefined' && AIRPT.state && AIRPT.state.db;
            if (db) {
                const ap = PALRANK.rankAirports(q, db.a, view(), 5);
                if (ap.length) sections.push(['Airports', ap.map(r => ({
                    title: r.row[0] + (r.row[1] ? ' / ' + r.row[1] : ''), sub: r.row[3], chip: cats[r.row[0]] || '',
                    run: () => AIRPT.open(r.row)}))]);
            } else if (typeof AIRPT != 'undefined') AIRPT.load();      // first keystroke warms the airport list
        }
        const ac = PALRANK.rankActions(q, actions(), q ? 5 : 8);
        if (ac.length) sections.push(['Actions', ac.map(r => ({title: r.action.title, run: r.action.run}))]);
        for (const [name, rows] of sections) { out.push({head: name}); for (const r of rows) out.push(r); }
        return out;
    }

    function render() {
        items = build(input.value);
        list.replaceChildren();
        const rows = items.filter(i => !i.head);
        if (sel >= rows.length) sel = Math.max(0, rows.length - 1);
        let n = 0;
        for (const it of items) {
            if (it.head) { const h = el('div', 'palHead', it.head); h.setAttribute('role', 'presentation'); list.appendChild(h); continue; }
            const idx = n++, row = el('div', 'palRow' + (idx === sel ? ' sel' : ''));
            row.id = 'palopt' + idx; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', idx === sel ? 'true' : 'false');
            row.appendChild(el('span', 'palTitle', it.title));
            if (it.sub) row.appendChild(el('span', 'palSub', it.sub));
            if (it.chip) row.appendChild(el('span', 'palChip ' + it.chip, it.chip));
            row.addEventListener('mousemove', () => { if (sel !== idx) { sel = idx; mark(); } });
            row.addEventListener('click', () => choose(idx));
            list.appendChild(row);
        }
        if (!rows.length) list.appendChild(el('div', 'sk-empty', 'Nothing matches "' + input.value.trim() + '".'));
        input.setAttribute('aria-activedescendant', rows.length ? 'palopt' + sel : '');
        live.textContent = rows.length ? rows.length + ' results' : 'No results';
    }
    function mark() {
        list.querySelectorAll('.palRow').forEach((r, i) => { r.classList.toggle('sel', i === sel); r.setAttribute('aria-selected', i === sel ? 'true' : 'false'); if (i === sel) r.scrollIntoView({block: 'nearest'}); });
        input.setAttribute('aria-activedescendant', 'palopt' + sel);
    }
    function choose(idx) {
        const it = items.filter(i => !i.head)[idx];
        if (!it) return;
        close();
        try { it.run(); } catch (e) { console.error(e); }
    }
    function make() {
        root = el('div', 'palBack'); root.hidden = true;
        const box = el('div', 'palBox'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Command palette');
        input = el('input', 'palInput'); input.type = 'text'; input.placeholder = 'Search aircraft, airports, actions'; input.autocomplete = 'off'; input.spellcheck = false;
        input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'palList'); input.setAttribute('aria-label', 'Search');
        list = el('div', 'palList'); list.id = 'palList'; list.setAttribute('role', 'listbox');
        live = el('div', 'palLive'); live.setAttribute('aria-live', 'polite');
        const x = el('button', 'sk-x', '\u00d7'); x.type = 'button'; x.setAttribute('aria-label', 'Close search'); x.addEventListener('click', () => close());
        box.append(input, x, list, live); root.appendChild(box); document.body.appendChild(root);
        input.addEventListener('input', () => { sel = 0; render(); });
        root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
        root.addEventListener('keydown', (e) => {
            const n = list.querySelectorAll('.palRow').length;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { sel = (sel + 1) % n; mark(); } }
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { sel = (sel - 1 + n) % n; mark(); } }
            else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
            else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }       // focus stays in the single input
            e.stopPropagation();
        });
    }
    function show() {
        if (!root) make();
        if (open) return;
        open = true; prevFocus = document.activeElement; sel = 0; input.value = '';
        root.hidden = false; render(); input.focus();
        requestAnimationFrame(() => root.classList.add('in'));
    }
    function close() {
        if (!open) return;
        open = false; root.classList.remove('in'); root.hidden = true;
        try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) { /* ignore */ }
    }
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); open ? close() : show(); }
    }, true);
    return {show, close, isOpen: () => open};
})();
