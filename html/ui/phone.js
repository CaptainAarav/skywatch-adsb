"use strict";
// Skywatch ADS-B: phone layout (coarse pointer or width <= 768 px). One bottom sheet owns the search pill, the tab bar and
// whichever panel is open (aircraft list, selected aircraft, airport). The map gets the rest. Round glass controls ride above
// the sheet through --sheet-h. The old top bar, control pile, chip bar and 2D/3D pill are hidden by ui/phone.css on phones.
// DOM is built with createElement/textContent only.
const PHONE = (function () {
    const MQ = '(max-width: 768px), (pointer: coarse)';
    const mq = window.matchMedia(MQ);
    const NS = 'http://www.w3.org/2000/svg';
    const ICON = {
        replay: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v5l3 2',
        locate: 'M12 3l7 17-7-4-7 4z',
        follow: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
        layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5',
        compass: 'M12 4.5l3 7.5h-6zM12 19.5l3-7.5h-6z',
        cycle: 'M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4',
        info: 'M12 11v6M12 7.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
        search: 'M20 20l-3.5-3.5M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
        map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
        list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
        bell: 'M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0',
        cog: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15l1.6 1-2 3.5-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.5 1.6-1a7 7 0 0 1 0-2l-1.6-1 2-3.5 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.5-1.6 1a7 7 0 0 1 0 2z',
    };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    function icon(name, size) {
        const s = document.createElementNS(NS, 'svg');
        s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size || 20); s.setAttribute('height', size || 20); s.setAttribute('aria-hidden', 'true');
        s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
        const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICON[name]); s.appendChild(p);
        return s;
    }
    function rbtn(cls, label, ic) { const b = el('button', 'pcBtn ' + cls); b.type = 'button'; b.setAttribute('aria-label', label); b.appendChild(icon(ic)); return b; }

    let sheet, body, foot, handle, tabs = {}, ctl = {}, built = false, snaps = [], idx = 0, h = 0, drag = null, peekExtra = 0;

    function vh() { return window.innerHeight; }
    function safe(side) { const d = el('div'); d.style.cssText = 'position:fixed;visibility:hidden;padding-' + side + ':env(safe-area-inset-' + side + ',0px)'; document.body.appendChild(d); const v = parseFloat(getComputedStyle(d)['padding' + side[0].toUpperCase() + side.slice(1)]) || 0; d.remove(); return v; }

    function setH(px, animate) {
        h = Math.round(px);
        sheet.classList.toggle('psAnim', !!animate);
        sheet.style.height = h + 'px';
        document.documentElement.style.setProperty('--sheet-h', h + 'px');
        const hi = h > vh() * 0.55;
        document.body.classList.toggle('sheetHigh', hi);
        handle.setAttribute('aria-valuenow', String(idx));
        if (snaps.length) document.body.dataset.snap = SHEETSNAP.snapName(h, snaps);
    }
    // peek height for a selected aircraft: measured with the peek layout applied, so it always fits header + summaries + actions
    function measureInfoPeek() {
        const b = document.body, prev = b.dataset.snap; b.dataset.snap = 'peek';
        const q = (s) => document.querySelector('#selected_infoblock ' + s);
        const hh = (e) => e ? e.getBoundingClientRect().height : 0;
        const scroll = q('.ibScroll'), cs = scroll ? getComputedStyle(scroll) : null;
        const v = SHEETSNAP.peekHeight({handle: 28, blocks: [hh(q('.ibHead')), hh(scroll), hh(q('#infoActions'))], pad: 0}, vh());
        if (prev) b.dataset.snap = prev; else delete b.dataset.snap;
        void cs;
        return v;
    }
    function recompute(keepSnap) {
        if (!built) return;
        const header = body.querySelector('#selected_infoblock .ibHead, #airport_panel .apHead');
        const showHead = (document.body.classList.contains('infoOpen') && document.querySelector('#selected_infoblock .ibHead')) || null;
        peekExtra = showHead ? Math.min(150, showHead.getBoundingClientRect().height + 20) : 0;
        const peek = document.body.classList.contains('infoOpen') ? measureInfoPeek() : 28 + foot.offsetHeight + peekExtra;
        snaps = SHEETSNAP.points(vh(), peek, safe('top'));
        snaps[0] = peek;
        if (!keepSnap) idx = Math.min(idx, 2);
        setH(snaps[idx], !keepSnap);
        document.body.classList.toggle('sheetFull', idx === 2 && document.body.classList.contains('infoOpen'));
    }
    function goto(i, animate) { idx = Math.max(0, Math.min(2, i)); recompute(true); sheet.classList.toggle('psAnim', animate !== false); setH(snaps[idx], animate !== false); syncFade(); }
    function syncFade() { document.body.classList.toggle('sheetHigh', h > vh() * 0.55); }

    // ---- drag (handle, footer and the pinned header) ----
    function dragStart(e) {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('button, a, input, select, textarea') && !e.target.closest('.psHandle')) return;
        drag = {y: e.clientY, h0: h, t: performance.now(), v: 0, last: e.clientY, lt: performance.now(), moved: false, id: e.pointerId};
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        sheet.classList.remove('psAnim');
    }
    function dragMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const dy = drag.y - e.clientY, now = performance.now();
        if (Math.abs(dy) > 4) drag.moved = true;
        const dt = Math.max(1, now - drag.lt); drag.v = 0.8 * drag.v + 0.2 * ((drag.last - e.clientY) / dt); drag.last = e.clientY; drag.lt = now;
        setH(SHEETSNAP.rubber(drag.h0 + dy, snaps[0], snaps[2]), false);
    }
    function dragEnd(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag; drag = null;
        if (!d.moved) { if (e.currentTarget === handle) goto((idx + 1) % 3); return; }
        const vel = performance.now() - d.lt > 80 ? 0 : d.v;
        if ((document.body.classList.contains('infoOpen') || document.body.classList.contains('airportOpen')) && SHEETSNAP.shouldDismiss(d.h0, h, vel, snaps[0])) { dismissSelection(); return; }
        const target = SHEETSNAP.snap(h, vel, snaps);
        goto(snaps.indexOf(target));
        void target;
    }
    function dismissSelection() {
        const b = document.body;
        if (b.classList.contains('infoOpen')) { const c = document.getElementById('infoblock_close'); c && c.click(); }
        else if (b.classList.contains('airportOpen') && typeof AIRPT != 'undefined' && AIRPT.close) AIRPT.close();
        idx = 0; recompute(true);
    }
    function wireDrag(node) {
        node.addEventListener('pointerdown', dragStart); node.addEventListener('pointermove', dragMove);
        node.addEventListener('pointerup', dragEnd); node.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { drag = null; goto(idx, true); } });
    }

    // ---- tabs ----
    function activeTab() {
        const b = document.body;
        if (b.classList.contains('settingsOpen')) return b.dataset.phoneSettings === 'alerts' ? 'alerts' : 'settings';
        if (b.classList.contains('listOpen') && !b.classList.contains('infoOpen') && !b.classList.contains('airportOpen')) return 'list';
        return 'map';
    }
    function markTabs() {
        const a = activeTab();
        for (const k in tabs) { const on = k === a; tabs[k].classList.toggle('on', on); tabs[k].setAttribute('aria-selected', on ? 'true' : 'false'); tabs[k].tabIndex = on ? 0 : -1; }
    }
    function closeAll() {
        if (typeof closeSettings == 'function') closeSettings();
        if (document.body.classList.contains('infoOpen')) { const c = document.getElementById('infoblock_close'); c && c.click(); }
        if (typeof AIRPT != 'undefined' && AIRPT.state && AIRPT.state.cur) AIRPT.close();
        if (document.body.classList.contains('listOpen') && typeof toggles != 'undefined' && toggles['sidebar_visible']) toggles['sidebar_visible'].toggle(false);
    }
    function tab(which) {
        document.body.dataset.phoneSettings = '';
        if (which === 'map') { closeAll(); goto(0); }
        else if (which === 'list') { closeAll(); if (typeof toggles != 'undefined' && toggles['sidebar_visible']) toggles['sidebar_visible'].toggle(true); if (typeof shellSync == 'function') shellSync(); goto(1); }
        else if (which === 'alerts') { document.body.dataset.phoneSettings = 'alerts'; openSettings('alerts', tabs.alerts); PHONE.settingsPage('page'); }
        else if (which === 'settings') { openSettings(null, tabs.settings); PHONE.settingsPage('root'); }
        markTabs();
    }

    // ---- floating controls ----
    function clickId(id) { const b = document.getElementById(id); if (b) b.click(); }
    function syncCtl() {
        if (!built) return;
        const rp = document.getElementById('RP');
        ctl.replay.hidden = !rp || rp.style.display === 'none' || rp.hidden;
        ctl.follow.hidden = !document.body.classList.contains('infoOpen');
        const fol = typeof FollowSelected != 'undefined' && FollowSelected;
        ctl.follow.classList.toggle('on', !!fol); ctl.follow.setAttribute('aria-pressed', fol ? 'true' : 'false');
        const m = typeof MLR != 'undefined' && MLR.map;
        const rotated = m && (Math.abs(m.getBearing()) > 1 || m.getPitch() > 1);
        ctl.compass.hidden = !rotated;
        const mode = typeof MLR != 'undefined' ? MLR.viewMode : '2d';
        ctl.cycleLabel.textContent = mode === '3d' ? '3D' : mode === 'globe' ? 'Globe' : '2D';
        ctl.compassNeedle && (ctl.compassNeedle.style.transform = 'rotate(' + (m ? -m.getBearing() : 0) + 'deg)');
    }
    function buildCtl() {
        const col = el('div', 'pcCol'); col.id = 'phoneCtl';
        ctl.compass = rbtn('pcCompass', 'Reset to north up and flat view', 'compass'); ctl.compassNeedle = ctl.compass.firstChild; ctl.compass.addEventListener('click', () => clickId('north_up'));
        ctl.replay = rbtn('', 'Replay history', 'replay'); ctl.replay.addEventListener('click', () => clickId('RP'));
        ctl.locate = rbtn('', 'Centre the map', 'locate'); ctl.locate.addEventListener('click', () => clickId('H'));
        ctl.follow = rbtn('', 'Follow selected aircraft', 'follow'); ctl.follow.addEventListener('click', () => typeof toggleFollow == 'function' && toggleFollow());
        ctl.layers = rbtn('', 'Base map and layers', 'layers'); ctl.layers.addEventListener('click', () => { openSettings('map', ctl.layers); PHONE.settingsPage('page'); markTabs(); });
        col.append(ctl.compass, ctl.replay, ctl.locate, ctl.follow, ctl.layers);
        // bottom-left: one cycle button (tap = next, long-press = menu with the three)
        const left = el('div', 'pcLeft'); left.id = 'phoneView';
        ctl.cycle = el('button', 'pcBtn pcCycle'); ctl.cycle.type = 'button'; ctl.cycle.setAttribute('aria-label', 'Map view: tap to change, press and hold for the list');
        ctl.cycle.appendChild(icon('cycle', 18)); ctl.cycleLabel = el('span', 'pcCycleLabel', '2D'); ctl.cycle.appendChild(ctl.cycleLabel);
        const menu = el('div', 'pcMenu'); menu.hidden = true; menu.setAttribute('role', 'menu');
        for (const [id, label] of [['view2d', '2D'], ['view3d', '3D'], ['viewGlobe', 'Globe']]) {
            const it = el('button', 'pcMenuItem', label); it.type = 'button'; it.setAttribute('role', 'menuitem');
            it.addEventListener('click', () => { clickId(id); menu.hidden = true; setTimeout(syncCtl, 50); });
            menu.appendChild(it);
        }
        let lp = null, long = false;
        ctl.cycle.addEventListener('pointerdown', () => { long = false; lp = setTimeout(() => { long = true; menu.hidden = false; }, 500); });
        const endLp = () => clearTimeout(lp);
        ctl.cycle.addEventListener('pointerup', endLp); ctl.cycle.addEventListener('pointerleave', endLp); ctl.cycle.addEventListener('pointercancel', endLp);
        ctl.cycle.addEventListener('click', () => {
            if (long) { long = false; return; }
            if (!menu.hidden) { menu.hidden = true; return; }
            const cur = typeof MLR != 'undefined' ? MLR.viewMode : '2d';
            clickId({'2d': 'view3d', '3d': 'viewGlobe', 'globe': 'view2d'}[cur] || 'view2d'); setTimeout(syncCtl, 50);
        });
        ctl.cycle.addEventListener('contextmenu', (e) => { e.preventDefault(); menu.hidden = false; });
        document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !left.contains(e.target)) menu.hidden = true; });
        left.append(ctl.cycle, menu);
        // attribution: compact "i" that reveals the active provider's credits (they must stay reachable)
        ctl.info = rbtn('pcInfo', 'Map credits', 'info'); ctl.info.setAttribute('aria-expanded', 'false'); ctl.info.id = 'phoneInfo';
        ctl.info.addEventListener('click', () => { const on = !document.body.classList.contains('attrOpen'); document.body.classList.toggle('attrOpen', on); ctl.info.setAttribute('aria-expanded', on ? 'true' : 'false'); });
        left.appendChild(ctl.info);
        document.body.append(col, left);
    }

    function build() {
        if (built) return;
        built = true;
        sheet = el('section', 'psSheet'); sheet.id = 'phoneSheet'; sheet.setAttribute('aria-label', 'Panels');
        handle = el('button', 'psHandle'); handle.type = 'button'; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', 'Resize panel'); handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '2'); handle.setAttribute('aria-valuenow', '0');
        handle.appendChild(el('span', 'psGrip'));
        handle.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') { e.preventDefault(); goto(idx + 1); } else if (e.key === 'ArrowDown') { e.preventDefault(); goto(idx - 1); } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goto((idx + 1) % 3); } });
        body = el('div', 'psBody'); body.id = 'phoneSheetBody';
        foot = el('div', 'psFoot');
        const search = el('button', 'psSearch'); search.type = 'button'; search.appendChild(icon('search', 18)); search.appendChild(el('span', null, 'Search aircraft and airports'));
        search.addEventListener('click', () => { if (typeof PALETTE != 'undefined') PALETTE.show(); });
        const bar = el('div', 'psTabs'); bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Sections');
        for (const [k, label, ic] of [['map', 'Map', 'map'], ['list', 'Aircraft', 'list'], ['alerts', 'Alerts', 'bell'], ['settings', 'Settings', 'cog']]) {
            const b = el('button', 'psTab'); b.type = 'button'; b.setAttribute('role', 'tab'); b.appendChild(icon(ic, 18)); b.appendChild(el('span', null, label));
            b.addEventListener('click', () => tab(k)); tabs[k] = b; bar.appendChild(b);
        }
        foot.append(search, bar);
        sheet.append(handle, body, foot);
        // existing panels live inside the sheet on phones
        for (const id of ['sidebar_container', 'selected_infoblock', 'airport_panel']) { const n = document.getElementById(id); if (n) body.appendChild(n); }
        document.body.appendChild(sheet);
        wireDrag(handle); wireDrag(foot);
        body.addEventListener('pointerdown', (e) => { const hd = e.target.closest('.ibHead, .apHead'); if (hd && !e.target.closest('button, a')) dragStart({button: e.button, target: e.target, currentTarget: body, pointerId: e.pointerId, clientY: e.clientY}); });
        body.addEventListener('pointermove', (e) => { if (drag) dragMove(e); }); body.addEventListener('pointerup', (e) => { if (drag) dragEnd({pointerId: e.pointerId, currentTarget: body}); });
        buildCtl();
        document.body.classList.add('phone');
        const sync = () => {
            const b = document.body;
            const wantIdx = b.classList.contains('airportOpen') ? Math.max(idx, 1) : null;
            markTabs(); syncCtl();
            if (b.dataset.lastMode !== modeKey()) { b.dataset.lastMode = modeKey(); body.scrollTop = 0; if (modeKey() === 'airport') idx = 1; else if (modeKey() === 'info') idx = 0; else if (modeKey() === 'list') idx = 1; else idx = 0; }
            void wantIdx;
            recompute(true);
        };
        new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['class']});
        window.addEventListener('resize', () => recompute(true));
        window.addEventListener('orientationchange', () => setTimeout(() => recompute(true), 200));
        const t = setInterval(() => { if (typeof MLR == 'undefined' || !MLR.map) return; clearInterval(t); MLR.map.on('rotate', syncCtl); MLR.map.on('pitch', syncCtl); }, 300);
        setInterval(syncCtl, 1500);
        const sh = document.getElementById('RP'); if (sh) new MutationObserver(syncCtl).observe(sh, {attributes: true});
        sync(); setTimeout(() => recompute(true), 300);
    }
    function modeKey() { const b = document.body; return b.classList.contains('airportOpen') ? 'airport' : b.classList.contains('infoOpen') ? 'info' : (b.classList.contains('listOpen') ? 'list' : 'none'); }

    function unbuild() {
        if (!built) return;
        for (const id of ['sidebar_container', 'selected_infoblock', 'airport_panel']) { const n = document.getElementById(id); if (n) document.getElementById('map_container') ? document.getElementById('map_container').appendChild(n) : document.body.appendChild(n); }
        sheet.remove(); document.getElementById('phoneCtl').remove(); document.getElementById('phoneView').remove();
        document.body.classList.remove('phone', 'sheetHigh', 'attrOpen'); document.documentElement.style.removeProperty('--sheet-h');
        built = false; tabs = {}; ctl = {};
    }
    function apply() { if (mq.matches) build(); else unbuild(); }

    // ---- settings as a grouped list that drills into pages ----
    function settingsPage(p) {
        const d = document.getElementById('settings_infoblock');
        if (!d || !mq.matches) return;
        d.dataset.phonePage = p;
    }
    function initSettingsPhone() {
        const d = document.getElementById('settings_infoblock');
        if (!d) return;
        const head = d.querySelector('.setHead');
        const back = el('button', 'btn setBack'); back.type = 'button'; back.setAttribute('aria-label', 'Back to settings list');         const bi = document.createElementNS(NS, 'svg'); bi.setAttribute('viewBox', '0 0 24 24'); bi.setAttribute('width', 18); bi.setAttribute('height', 18); bi.setAttribute('fill', 'none'); bi.setAttribute('stroke', 'currentColor'); bi.setAttribute('stroke-width', '2'); bi.setAttribute('stroke-linecap', 'round'); bi.setAttribute('aria-hidden', 'true');
        const bp = document.createElementNS(NS, 'path'); bp.setAttribute('d', 'm15 6-6 6 6 6'); bi.appendChild(bp); back.appendChild(bi);
        back.addEventListener('click', () => { settingsPage('root'); document.body.dataset.phoneSettings = ''; markTabs(); });
        head.insertBefore(back, head.firstChild);
        d.querySelectorAll('.setNavBtn').forEach(b => b.addEventListener('click', () => { settingsPage('page'); document.body.dataset.phoneSettings = b.dataset.sec === 'alerts' ? 'alerts' : ''; markTabs(); }));
        d.dataset.phonePage = 'root';
        new MutationObserver(markTabs).observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    // ---- history-backed layers: every full-screen or modal surface pushes one history entry, so system back closes it ----
    const layerStack = []; let ignorePops = 0;
    const $i = (id) => document.getElementById(id);
    const bodyHas = (c) => document.body.classList.contains(c);
    const surfaces = [
        {name: 'airport', open: () => bodyHas('airportOpen'), close: () => { if (typeof AIRPT != 'undefined' && AIRPT.close) AIRPT.close(); }},
        {name: 'info', open: () => bodyHas('infoOpen'), close: () => { const c = $i('infoblock_close'); c && c.click(); }},
        {name: 'settings', open: () => bodyHas('settingsOpen'), close: () => { if (typeof closeSettings == 'function') closeSettings(); }},
        {name: 'graphs', open: () => { const o = $i('graphsOverlay'); return !!o && !o.hidden; }, close: () => { const c = document.querySelector('#graphsOverlay .sk-x'); c && c.click(); }},
        {name: 'palette', open: () => typeof PALETTE != 'undefined' && PALETTE.isOpen(), close: () => PALETTE.close()},
        {name: 'dialog', open: () => !!document.querySelector('.sk-backdrop'), close: () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))},
        {name: 'replay', open: () => { const r = $i('replayBar'); return !!r && getComputedStyle(r).display !== 'none'; }, close: () => { const c = $i('replayStop'); c && c.click(); }},
    ];
    function syncLayers() {
        if (!built || !mq.matches) return;
        for (const s of surfaces) {
            let o = false; try { o = !!s.open(); } catch (e) { /* ignore */ }
            const i = layerStack.indexOf(s);
            if (o && i < 0) { layerStack.push(s); try { history.pushState({skyLayer: s.name}, ''); } catch (e) { /* ignore */ } }
            else if (!o && i >= 0) { layerStack.splice(i, 1); ignorePops++; try { history.back(); } catch (e) { ignorePops--; } }
        }
    }
    window.addEventListener('popstate', () => {
        if (ignorePops > 0) { ignorePops--; return; }
        const top = layerStack.pop();
        if (top) { try { top.close(); } catch (e) { /* ignore */ } setTimeout(syncLayers, 0); }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !built || e.defaultPrevented) return;
        const top = layerStack[layerStack.length - 1];
        if (top && (top.name === 'graphs' || top.name === 'replay' || top.name === 'airport' || top.name === 'info')) { e.preventDefault(); top.close(); }
    });
    function watchLayers() {
        const mo = new MutationObserver(() => setTimeout(syncLayers, 0));
        mo.observe(document.body, {attributes: true, attributeFilter: ['class'], childList: true});
        const g = $i('graphsOverlay'); if (g) mo.observe(g, {attributes: true, attributeFilter: ['hidden']});
        const r = $i('replayBar'); if (r) mo.observe(r, {attributes: true, attributeFilter: ['style', 'class']});
        setInterval(syncLayers, 700);
    }

    function init() { initSettingsPhone(); watchLayers(); apply(); mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
    return {settingsPage, recompute, layers: () => layerStack.map(l => l.name), syncLayers, dismiss: dismissSelection, goto: (i) => goto(i), isPhone: () => mq.matches, snaps: () => snaps.slice(), height: () => h};
})();
