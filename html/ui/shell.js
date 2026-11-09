// Skywatch ADS-B: floating "glass" shell.
//
// Wires the new top bar (view pill, unified search, settings), the right-hand
// control stack, the filter popover and the left-panel state. All aircraft data
// and the existing toggles stay in script.js; this file only drives UI.
"use strict";

// Body classes that describe the left panel, used by ui/shell.css to place things:
//   listOpen   aircraft list panel visible
//   infoOpen   selected-aircraft panel visible (wins over the list)
//   infoWide   selected-aircraft panel in its wide "all details" state
//   panelsHidden  user hid the left panel with the eye button
function shellSync() {
    const body = document.body;
    const listState = !!(toggles['sidebar_visible'] && toggles['sidebar_visible'].state);
    const infoOpen = body.classList.contains('infoOpen');
    body.classList.toggle('listOpen', listState);
    const listShown = listState && !infoOpen && !body.classList.contains('airportOpen') && !body.classList.contains('panelsHidden');
    setPressed('#view_list', listShown);
    setPressed('#view_map', !listShown && !body.classList.contains('replayOpen'));
    setPressed('#RP', body.classList.contains('replayOpen'));
    setPressed('#phone_list_button', listShown);
    // History (per-aircraft trace) only exists with traces / globe history
    const hist = document.getElementById('history_action');
    if (hist) {
        hist.hidden = !(typeof haveTraces != 'undefined' && (haveTraces || globeIndex));
        setPressed('#history_action', typeof showTrace != 'undefined' && showTrace);
    }
}

function setPressed(sel, on) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.toggle('on', !!on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
}

// ---------- Unified search (replaces #search_form + #jump_form) ----------
// Aircraft first (hex, callsign, registration, type, squawk); if nothing
// matches, an airport code or "lat, lon" jumps the map there.
function onUnifiedSearch(e) {
    e && e.preventDefault();
    const input = document.getElementById('search_input');
    const term = input.value.trim();
    if (!term) return false;
    input.blur();

    if (/^[-+]?\d+(\.\d+)?\s*,\s*[-+]?\d+(\.\d+)?$/.test(term)) {
        onJumpInput = term;
        onJump();
        input.value = '';
        return false;
    }

    let results = [];
    if (/^\d{4}$/.test(term)) {
        results = g.planesOrdered.filter(p => p.squawk == term);
        if (results.length == 1) {
            selectPlaneByHex(results[0].icao, {noDeselect: true, follow: true});
        } else if (results.length > 1) {
            toggleMultiSelect("on");
            for (const p of results) { select(p, {}); p.updateTick(true); }
            sp = SelectedPlane = null;
        }
    }
    if (!results.length)
        results = findPlanes(term, "byIcao", "byCallsign", "byReg", "byType", false) || [];

    if (results.length > 0) {
        hideSearchWarning();
        if (haveTraces) {
            toggleIsolation("on");
            if (results.length < 100)
                getTrace(null, null, {list: results});
        }
    } else if (typeof AIRPT != 'undefined') {
        // airport (ICAO, IATA or name): open its panel; fall back to the old jump for codes the airport list does not know
        AIRPT.searchAndOpen(term).then(found => {
            if (found) hideSearchWarning();
            else if (/^[a-z0-9]{3,4}$/i.test(term)) { onJumpInput = term; onJump(); }
            else if (!(db.regCache && db.regCache[term.toUpperCase().replace('-', '')])) showSearchWarning('No aircraft, airport or coordinates match "' + term + '"');
        });
    } else if (/^[a-z0-9]{3,4}$/i.test(term)) {
        onJumpInput = term; // airport code: onJump() shows a warning if unknown
        onJump();
    } else if (!(db.regCache && db.regCache[term.toUpperCase().replace('-', '')])) {
        showSearchWarning('No aircraft, airport or coordinates match "' + term + '"');
    }
    input.value = '';
    return false;
}

// ---------- Popovers (filters, columns) ----------
function openPopover(id, anchor) {
    const pop = document.getElementById(id);
    if (!pop) return;
    closePopovers(id);
    pop.hidden = false;
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    pop._anchor = anchor || null;
    const first = pop.querySelector('input, button:not(.popoverClose), [tabindex="0"]');
    first && first.focus({preventScroll: true});
}
function closePopovers(except) {
    document.querySelectorAll('.popover').forEach(pop => {
        if (pop.id === except || pop.hidden) return;
        pop.hidden = true;
        pop._anchor && pop._anchor.setAttribute('aria-expanded', 'false');
    });
}
function togglePopover(id, anchor) {
    const pop = document.getElementById(id);
    if (pop && !pop.hidden) closePopovers();
    else openPopover(id, anchor);
}

// ---------- Aircraft list (mockup 02) ----------
// Live filter for the table rows (not a map filter): callsign, hex,
// registration, type, squawk and, when routes are on, the route airports.
let listFilterTerm = '';
function listFilterMatch(plane) {
    if (!listFilterTerm) return true;
    const t = listFilterTerm;
    return [plane.flight, plane.icao, plane.registration, plane.icaoType, plane.squawk, plane.routeString]
        .some(v => v != null && String(v).toLowerCase().includes(t));
}
function onListFilterInput() {
    listFilterTerm = this.value.trim().toLowerCase();
    for (const p of g.planesOrdered) p.refreshTR = 0; // re-evaluate every row now
    TAR.planeMan.refresh();
}

// Chip captions follow the real filter state.
function updateListChips() {
    const alt = document.getElementById('chip_altitude');
    if (!alt) return;
    const min = jQuery('#altitude_filter_min').val().trim(), max = jQuery('#altitude_filter_max').val().trim();
    const unit = get_unit_label('altitude', DisplayUnits);
    alt.textContent = 'Altitude: ' + (min || max ? (min || '…') + '–' + (max || '…') + ' ' + unit : 'any');
    alt.classList.toggle('on', !!(min || max));

    const src = jQuery('#sourceFilter li.ui-selected').map(function () { return jQuery(this).text().trim(); }).get();
    const srcActive = PlaneFilter.sources && PlaneFilter.sources.length > 0;
    const srcChip = document.getElementById('chip_source');
    srcChip.textContent = 'Source: ' + (srcActive && src.length ? (src.length > 2 ? src.length + ' selected' : src.join(', ')) : 'all');
    srcChip.classList.toggle('on', !!srcActive);

    const flags = jQuery('#flagFilter li.ui-selected').map(function () { return jQuery(this).text().trim(); }).get();
    const flagActive = PlaneFilter.flagFilter && PlaneFilter.flagFilter.length > 0;
    const flagChip = document.getElementById('chip_flags');
    flagChip.textContent = 'Flags: ' + (flagActive && flags.length ? flags.join(', ') : 'none');
    flagChip.classList.toggle('on', !!flagActive);

    const cols = Object.values(TAR.planeMan.cols).filter(c => TAR.planeMan.columnUsable(c));
    jQuery('#dd_route').toggle(TAR.planeMan.columnUsable(TAR.planeMan.cols.route || {id: 'route'}));
    // the columns control is a small icon button at the end of the chip row; the count is in its tooltip
    const cc = document.getElementById('chip_columns');
    const label = 'Columns ' + cols.filter(c => c.visible).length + ' of ' + cols.length;
    cc.title = label; cc.setAttribute('aria-label', label); cc.textContent = '';
}

function initList() {
    jQuery('#list_filter').on('input', onListFilterInput);

    // filter chips open the shared filter popover next to the list, at that section
    jQuery('.listChips .chipPopover[data-section]').on('click', function () {
        const pop = document.getElementById('filterPopover');
        const open = !pop.hidden && pop.classList.contains('fromList') && pop._anchor === this;
        closePopovers();
        if (open) return;
        pop.classList.add('fromList');
        // show just the section this chip is about
        pop.querySelectorAll('.filterSection').forEach(sec => sec.classList.toggle('chipHidden', sec.id !== this.dataset.section));
        pop.querySelector('.popoverHead span').textContent = this.textContent.split(':')[0];
        openPopover('filterPopover', this);
    });
    jQuery('#filters_button').on('click', function () {
        const pop = document.getElementById('filterPopover');
        pop.classList.remove('fromList');
        pop.querySelectorAll('.filterSection').forEach(sec => sec.classList.remove('chipHidden'));
        pop.querySelector('.popoverHead span').textContent = 'Filters';
    });
    jQuery('#chip_columns').on('click', function () { togglePopover('columnsPopover', this); });

    // keep chip captions current
    jQuery('#altitude_filter_form, #source_filter_form, #flag_filter_form').on('submit', () => setTimeout(updateListChips, 0));
    jQuery('#altitude_filter_reset_button, #source_filter_reset_button, #flag_filter_reset_button').on('click', () => setTimeout(updateListChips, 0));
    jQuery('#sortableColumns').on('click', () => setTimeout(updateListChips, 0));
    jQuery('#units_selector').on('change', () => setTimeout(updateListChips, 0));

    // decoder version in the list header (e3: version only)
    const decoder = () => {
        if (typeof receiverJson == 'undefined' || !receiverJson) return false;
        const v = String(receiverJson.version || '').split(' ')[0];
        const el = document.getElementById('listDecoder');
        el.textContent = (receiverJson.readsb ? 'readsb ' : '') + v;
        el.title = receiverJson.version || '';
        return true;
    };
    if (!decoder()) {
        const t = setInterval(() => { if (decoder()) clearInterval(t); }, 500);
    }
    setTimeout(updateListChips, 0);
}

// ---------- Graphs: glass overlay over the live map (ui/graphs.js draws the charts; graphs1090 images are the fallback) ----------
let graphsTimer = null;
function graphsToggle(open) {
    const ov = document.getElementById('graphsOverlay');
    if (open === undefined) open = ov.hidden;
    ov.hidden = !open;
    document.body.classList.toggle('graphsOpen', open);
    setPressed('#view_graphs', open);
    if (open) { setPressed('#view_map', false); setPressed('#view_list', false); } else shellSync();
    clearInterval(graphsTimer);
    if (open) { GRAPHS.render(); graphsTimer = setInterval(() => GRAPHS.render(), 60000); }
}
function initGraphsLink() {
    const a = document.getElementById('view_graphs');
    if (!a) return;
    GRAPHS.available().then(ok => { if (ok) a.hidden = false; });
    a.addEventListener('click', () => graphsToggle());
    document.querySelector('#graphsOverlay .gClose').addEventListener('click', () => graphsToggle(false));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('graphsOverlay').hidden) graphsToggle(false); });
    for (const id of ['view_map', 'view_list']) document.getElementById(id)?.addEventListener('click', () => graphsToggle(false));
}

// phone (mockup 05): "Search 71 aircraft"
function updateSearchPlaceholder() {
    const inp = document.getElementById('search_input');
    if (!inp) return;
    let ph = 'Search';
    if (window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) {
        // search covers every tracked aircraft, not just the ones passing the filters
        let n = 0;
        if (globeIndex) n = parseInt(jQuery('#dump1090_total_ac').text(), 10);
        else for (const p of g.planesOrdered) if (p.seen != null && p.seen < 60) n++;
        if (n > 0) ph = `Search ${n} aircraft`;
    }
    if (inp.placeholder != ph) inp.placeholder = ph;
}

function initShell() {
    setInterval(updateSearchPlaceholder, 2000);
    // the altitude legend sits above the toolbar; keep it there when the toolbar wraps
    const tb = document.getElementById('toolbar');
    if (tb && window.ResizeObserver) {
        new ResizeObserver(() => {
            document.documentElement.style.setProperty('--tb-h', (tb.offsetHeight || 50) + 'px');
        }).observe(tb);
    }
    document.getElementById('search_form').addEventListener('submit', onUnifiedSearch);

    // '/' focuses search (no clash: script.js has no '/' hotkey). Escape leaves the field.
    window.addEventListener('keydown', function (e) {
        if (document.body.classList.contains('settingsOpen')) return;   // ui/settings.js handles keys
        const t = e.target;
        const typing = t && (t.nodeName == 'INPUT' || t.nodeName == 'TEXTAREA' || t.nodeName == 'SELECT' || t.isContentEditable);
        if (e.key === '/' && !typing && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            document.getElementById('search_input').focus();
        } else if (e.key === 'Escape') {
            if (typing) t.blur();
            closePopovers();
        }
    }, true);

    // View pill
    jQuery('#view_map').on('click', function () {
        if (document.body.classList.contains('replayOpen')) showReplayBar();
        toggles['sidebar_visible'].toggle(false);
        document.body.classList.remove('panelsHidden');
        setPressed('#hide_panels_button', false);
        shellSync();
    });
    jQuery('#view_list').on('click', function () {
        if (SelectedPlane || SelPlanes.length) deselectAllPlanes();
        document.body.classList.remove('panelsHidden');
        setPressed('#hide_panels_button', false);
        toggles['sidebar_visible'].toggle(true);
        shellSync();
    });

    // Control stack
    jQuery('#north_up').on('click', function () {
        mapa.resetNorth();
    });
    jQuery('#filters_button').on('click', function () { togglePopover('filterPopover', this); });
    jQuery('#layers_button').on('click', function () { openSettings('map', this); });
    jQuery('#hide_panels_button').on('click', function () {
        const hidden = document.body.classList.toggle('panelsHidden');
        setPressed('#hide_panels_button', hidden);
        this.setAttribute('aria-label', hidden ? 'Show sidebar' : 'Hide sidebar');
        this.title = hidden ? 'Show sidebar' : 'Hide sidebar';
        shellSync();
    });
    jQuery('#history_action').on('click', () => { jQuery('#show_trace').click(); shellSync(); });
    jQuery('.popoverClose').on('click', () => closePopovers());
    document.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.popover, #filters_button, .chipPopover, .ui-datepicker')) return;
        closePopovers();
    });

    // Replay pill state follows the replay bar
    const bar = document.getElementById('replayBar');
    if (bar) {
        new MutationObserver(() => {
            document.body.classList.toggle('replayOpen', getComputedStyle(bar).display != 'none');
            shellSync();
        }).observe(bar, {attributes: true, attributeFilter: ['style', 'class']});
    }

    jQuery('#phone_list_button').on('click', function () {
        const open = !(toggles['sidebar_visible'].state && !document.body.classList.contains('infoOpen'));
        if (open && (SelectedPlane || SelPlanes.length)) deselectAllPlanes();
        toggles['sidebar_visible'].toggle(open);
        shellSync();
    });

    initList();
    // initPhoneLayout(): replaced by ui/phone.js (bottom sheet)
    initGraphsLink();
    shellSync();
}

// Phone (mockup 05): the layers button sits beside the search field and the
// settings button joins the small control stack. Moved in the DOM so the
// tab order follows the visual order; moved back on wider screens.
function initPhoneLayout() {
    const mq = window.matchMedia('(max-width: 768px), (pointer: coarse)');
    const layers = document.getElementById('layers_button');
    const cog = document.getElementById('settingsCog');
    const stack = document.getElementById('controlStack');
    const search = document.getElementById('searchWrap');
    const topbar = document.getElementById('topbar');
    const hide = document.getElementById('hide_panels_button');
    const apply = () => {
        if (mq.matches) {
            search.after(layers);
            layers.classList.add('glass');
            stack.insertBefore(cog, hide);
            cog.classList.remove('glass');
        } else {
            stack.insertBefore(layers, document.getElementById('phone_list_button'));
            layers.classList.remove('glass');
            topbar.appendChild(cog);
            cog.classList.add('glass');
        }
    };
    mq.addEventListener('change', apply);
    apply();
}

jQuery(initShell);


// Aircraft list: when many columns are on, tighten the spacing and, if that is not enough, widen the panel,
// so nothing is clipped and there is no horizontal scrolling.
function fitListTable() {
    const t = document.getElementById('planesTable');
    const canvas = document.getElementById('sidebar_canvas');
    if (!t || !canvas || !t.offsetParent) return;
    const body = document.body;
    const base = 420, maxW = Math.max(base, Math.floor(window.innerWidth * 0.62));
    const room = () => canvas.clientWidth - 32;
    body.style.setProperty('--list-w', base + 'px');
    t.classList.remove('dense', 'denser');
    for (const cls of [null, 'dense', 'denser']) {
        if (cls) t.classList.add(cls);
        if (t.offsetWidth <= room() + 1) break;
    }
    if (t.offsetWidth > room() + 1) {
        const need = Math.min(maxW, base + (t.offsetWidth - room()) + 2);
        body.style.setProperty('--list-w', need + 'px');
        if (t.offsetWidth > room() + 1) { /* still wider than 62% of the window: the panel scrolls */ }
    }
}
let fitListTimer = null;
function fitListTableSoon() { clearTimeout(fitListTimer); fitListTimer = setTimeout(fitListTable, 150); }
setInterval(fitListTable, 1500);
window.addEventListener('resize', fitListTableSoon);
