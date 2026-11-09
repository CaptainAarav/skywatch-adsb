"use strict";
// Skywatch ADS-B: settings dialog (design/mockups/04-settings-basemaps.html).
// The settings themselves are still tar1090's Toggle objects (early.js); this file only
// moves their rows into sections, gives them clearer labels, and builds the base map
// picker and overlay switches that replace ol-layerswitcher.

const SET_TITLES = {
    map: 'Map & layers', aircraft: 'Aircraft & labels', table: 'Table & sidebar',
    units: 'Units & altitude', photos: 'Photos & routes', alerts: 'Alerts', advanced: 'Advanced', about: 'About',
};

// Toggle key -> [section list id, label]
const SET_ROWS = {
    ColoredPlanes:   ['set_appearance', 'Altitude-coloured aircraft'],
    ColoredTrails:   ['set_appearance', 'Altitude-coloured trails'],
    darkerColors:    ['set_appearance', 'Darker altitude colours'],

    showLabelUnits:  ['set_labels', 'Units in labels'],
    labelsGeom:      ['set_labels', 'Labels use geometric altitude'],
    windLabelsSlim:  ['set_labels', 'Smaller wind labels'],
    utcTimesLive:    ['set_labels', 'Live track labels in UTC'],
    utcTimesHistoric:['set_labels', 'History track labels in UTC'],
    autoselect:      ['set_aircraft', 'Auto-select an aircraft'],
    enableMouseover: ['set_aircraft', 'Hover card on mouse-over'],
    lastLeg:         ['set_aircraft', 'History: last leg only'],
    smoothMove:      ['set_aircraft', 'Smooth movement'],
    terrain3d:       ['set_appearance', 'Terrain in 3D view'],
    liftMapOnSelect: ['set_appearance', 'Lift map when an aircraft is selected'],
    airportDetail:   ['set_appearance', 'Airport detail (OpenFreeMap tiles)'],
    airportFx:       ['set_appearance', 'Airport detail effects (decorative)'],
    airlineLogos:    ['set_photos', 'Airline logos'],
    airportWeather:  ['set_photos', 'Airport weather (METAR and TAF)'],
    airportLinks:    ['set_photos', 'Airport links'],
    airportPinWx:    ['set_photos', 'Weather on airport pins'],

    moreTableLines1: ['set_table', 'More table rows'],
    moreTableLines2: ['set_table', 'Even more table rows'],
    allTableLines:   ['set_table', 'All table rows'],
    enableInfoblock: ['set_panels', 'Selected aircraft panel'],
    wideInfoblock:   ['set_panels', 'Open the panel with all details'],
    altitudeChart:   ['set_panels', 'Altitude legend'],

    geomUseEGM:      ['set_altitude', 'Geometric altitude: convert WGS84 to EGM96 (slow first load)'],
    baroUseQNH:      ['set_altitude', 'Correct baro. altitude for QNH'],

    planespottersAPI:['set_photos', 'Photos from planespotters.net'],
    planespottingAPI:['set_photos', 'Photos from planespotting.be'],
    useRouteAPI:     ['set_photos', 'Look up routes'],

    shareFilters:    ['set_advanced', 'Include filters in shared links'],
    updateLocation:  ['set_advanced', 'Update receiver location from GPS'],
    debugTracks:     ['set_advanced', 'Debug tracks'],
    debugAll:        ['set_advanced', 'Debug: show all'],
};

// curated base maps for the thumbnail grid (mockup 04); everything else is under "More..."
const BASE_PICKS = [
    {names: ['SkywatchDark', 'OpenFreeMapOfflineDark'], title: 'Skywatch Dark', sub: 'Default · OpenFreeMap', bg: 'linear-gradient(135deg,#000,#0d0d0d)'},
    {names: ['VersaTilesDark'], title: 'VersaTiles Dark', sub: 'Fallback', bg: 'linear-gradient(135deg,#1c1b19,#2d2b27)'},
    {names: ['CartoDarkMatterVector'], title: 'CARTO Dark Matter', sub: 'Opt-in · CARTO terms apply', bg: 'linear-gradient(135deg,#050505,#171717)'},
    {names: ['OpenFreeMapPositron', 'OpenFreeMapOfflinePositron'], title: 'Positron', sub: 'Light', bg: 'linear-gradient(135deg,#ececec,#d6d6d6)'},
    {names: ['OpenFreeMapLiberty', 'OpenFreeMapOfflineLiberty'], title: 'Liberty', sub: 'Colour', bg: 'linear-gradient(135deg,#d9e8c8,#bcd4e8)'},
    {names: ['esri'], title: 'Satellite', sub: 'ESRI imagery', bg: 'linear-gradient(135deg,#2d4a2e,#5a4a32)'},
    {names: ['OpenFreeMapBright', 'OpenFreeMapOfflineBright'], title: 'Bright', sub: 'OpenFreeMap', bg: 'linear-gradient(135deg,#f5efe0,#d6e6f2)'},
];

// layers that are not user overlays (drawn by tar1090 itself or shown elsewhere)
const SET_NOT_OVERLAYS = new Set(['ac_trail', 'iconLayer', 'webglLayer', 'dummy']);
// Toggle rows shown elsewhere in the dialog (as overlay switches)
const SET_HIDDEN_ROWS = ['MapDim'];

function setEsc(s) {
    return String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

function setForEachLayer(fn) {
    if (typeof layers_group == 'undefined' || !layers_group) return;
    mapa.forEachLayer(fn);
}

// region groups ('us', 'europe') only matter near the receiver (decision e13)
function setRegionUsable(region) {
    if (region != 'us' && region != 'europe') return true;
    const c = (typeof SitePosition != 'undefined' && SitePosition) ? SitePosition : (mapa.ready() ? mapa.getCenter() : null);
    if (!c) return true;
    const [lon, lat] = c;
    if (region == 'us') return lon > -170 && lon < -50 && lat > 15 && lat < 72;
    return lon > -32 && lon < 45 && lat > 34 && lat < 72;
}

function setLayerRegion(lyr) {
    return lyr.get('region') || '';
}

function setBaseLayers() {
    const out = [];
    setForEachLayer(lyr => {
        if (lyr.get('type') == 'base' && lyr.get('name'))
            out.push(lyr);
    });
    return out;
}

function setSelectBase(name) {
    for (const lyr of setBaseLayers())
        lyr.setVisible(lyr.get('name') == name);   // the change:visible handler in script.js saves the choice
    setRenderBaseState();
}

function setRenderBaseState() {
    for (const b of document.querySelectorAll('#settings_infoblock [data-base]')) {
        const on = b.dataset.base.split(',').includes(MapType_tar1090);
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
}

function setBuildBaseMaps() {
    const grid = document.getElementById('baseMapGrid');
    const more = document.getElementById('baseMapMore');
    if (!grid || grid.dataset.built) return;
    grid.dataset.built = '1';
    const all = setBaseLayers();
    const byName = {};
    for (const l of all) byName[l.get('name')] = l;
    const used = new Set();
    let html = '';
    for (const p of BASE_PICKS) {
        const name = p.names.find(n => byName[n] && setRegionUsable(setLayerRegion(byName[n])));
        if (!name) continue;
        used.add(name);
        html += `<button type="button" class="baseTile" role="radio" data-base="${setEsc(name)}"><span class="baseThumb" style="background:${p.bg}"></span><span class="baseName">${setEsc(p.title)}</span><span class="lbl baseSub">${setEsc(p.sub)}</span></button>`;
    }
    const rest = all.filter(l => !used.has(l.get('name')) && setRegionUsable(setLayerRegion(l)));
    if (rest.length) {
        html += `<button type="button" class="baseTile" id="baseMoreBtn" aria-expanded="false" aria-controls="baseMapMore"><span class="baseThumb baseThumbMore">${rest.length}</span><span class="baseName">More…</span><span class="lbl baseSub">All other maps</span></button>`;
        let m = '';
        for (const l of rest)
            m += `<button type="button" class="chip baseChip" role="radio" data-base="${setEsc(l.get('name'))}">${setEsc(l.get('title') || l.get('name'))}</button>`;
        more.innerHTML = m;
    }
    grid.innerHTML = html;
    jQuery('#settings_infoblock').on('click', '[data-base]', function () { setSelectBase(this.dataset.base); });
    jQuery('#baseMoreBtn').on('click', function () {
        more.hidden = !more.hidden;
        this.setAttribute('aria-expanded', more.hidden ? 'false' : 'true');
    });
    setRenderBaseState();
}

function setSwitchRow(id, label, checked, onChange, sub) {
    const row = document.createElement('label');
    row.className = 'setRow';
    row.innerHTML = `<span class="setRowText">${setEsc(label)}${sub ? `<span class="lbl setRowSub">${setEsc(sub)}</span>` : ''}</span><input type="checkbox" role="switch" class="setSwitch" id="${id}"><span class="switch" aria-hidden="true"></span>`;
    const cb = row.querySelector('input');
    cb.checked = !!checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return row;
}

// the map-chip toggles (Labels, Extended, Track labels, All tracks, Persist) live here; on phones the chip bar is gone
const SET_QUICK = [['L', 'Aircraft labels'], ['O', 'Extended labels'], ['K', 'Track labels'], ['T', 'All tracks'], ['P', 'Persistence mode']];
function setBuildQuick() {
    const list = document.getElementById('set_aircraft');
    if (!list) return;
    let box = document.getElementById('setQuick');
    if (!box) { box = document.createElement('div'); box.id = 'setQuick'; box.className = 'setList'; list.parentNode.insertBefore(box, list); }
    box.replaceChildren();
    for (const [id, label] of SET_QUICK) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        const row = setSwitchRow('quick_' + id, label, !btn.classList.contains('inActiveButton'), () => { btn.click(); setTimeout(setBuildQuickState, 80); });
        box.appendChild(row);
    }
}
function setBuildQuickState() {
    for (const [id] of SET_QUICK) {
        const btn = document.getElementById(id), cb = document.getElementById('quick_' + id);
        if (btn && cb) cb.checked = !btn.classList.contains('inActiveButton');
    }
}

function setBuildOverlays() {
    const list = document.getElementById('set_overlays');
    if (!list || list.dataset.built) return;
    list.dataset.built = '1';

    const layersSeen = [];
    setForEachLayer(lyr => {
        if (lyr.get('type') != 'overlay' || !lyr.get('name') || SET_NOT_OVERLAYS.has(lyr.get('name'))) return;
        if (!setRegionUsable(setLayerRegion(lyr))) return;
        layersSeen.push(lyr);
    });
    const nice = {
        siteCircles: 'Site distance circles', locationDot: 'Receiver position',
        actualRangeOutline: 'Actual range outline', calcOutline: 'Terrain range outline (heywhatsthat)',
        openaip: 'OpenAIP airspace', rainviewer_radar: 'RainViewer radar', rainviewer_clouds: 'RainViewer clouds',
    };
    const order = ['siteCircles', 'locationDot', 'actualRangeOutline', 'calcOutline', 'openaip', 'rainviewer_radar'];
    layersSeen.sort((a, b) => {
        const ia = order.indexOf(a.get('name')), ib = order.indexOf(b.get('name'));
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    for (const lyr of layersSeen) {
        const name = lyr.get('name');
        const title = nice[name] || (lyr.get('title') || name);
        const r = setSwitchRow('ov_' + name, title.charAt(0).toUpperCase() + title.slice(1), lyr.getVisible(), v => lyr.setVisible(v));
        lyr.on('change:visible', () => { r.querySelector('input').checked = lyr.getVisible(); });
        list.appendChild(r);
    }
    // dim map (B)
    if (toggles['MapDim']) {
        const r = setSwitchRow('ov_dim', 'Dim map', toggles['MapDim'].state, v => toggles['MapDim'].toggle(v));
        list.appendChild(r);
    }
}

function setBuildTable() {
    const list = document.getElementById('set_table');
    if (!list || list.dataset.built) return;
    list.dataset.built = '1';
    if (toggles['sidebar_visible']) {
        const r = setSwitchRow('set_sidebarVisible', 'Show the aircraft list', toggles['sidebar_visible'].state, v => {
            toggles['sidebar_visible'].toggle(v);
            if (typeof shellSync == 'function') shellSync();
        });
        list.appendChild(r);
    }
    const note = document.createElement('p');
    note.className = 'setNote';
    note.style.marginTop = '10px';
    note.textContent = 'Choose and reorder table columns with the "Columns" chip in the aircraft list.';
    list.after(note);
}

// keep the switches that mirror Toggles in sync
function setSyncSwitches() {
    const sv = document.getElementById('set_sidebarVisible');
    if (sv && toggles['sidebar_visible']) sv.checked = toggles['sidebar_visible'].state;
    const dim = document.getElementById('ov_dim');
    if (dim && toggles['MapDim']) dim.checked = toggles['MapDim'].state;
}

// move each Toggle row into its section and relabel it
function setArrange() {
    for (const key in SET_ROWS) {
        const cb = document.getElementById(key + '_cb');
        if (!cb) continue;
        const row = cb.closest('.settingsOptionContainer');
        const [target, label] = SET_ROWS[key];
        const dest = document.getElementById(target);
        if (!row || !dest) continue;
        if (row.parentNode !== dest) dest.appendChild(row);
        const t = row.querySelector('.settingsText');
        if (t && label && t.textContent != label) t.textContent = label;
    }
    for (const key of SET_HIDDEN_ROWS) {
        const cb = document.getElementById(key + '_cb');
        const row = cb && cb.closest('.settingsOptionContainer');
        if (row) row.hidden = true;
    }
    // anything not mapped stays visible under Advanced
    for (const id of ['settingsLeft', 'settingsRight']) {
        const e = document.getElementById(id);
        if (e) e.hidden = !e.querySelector('.settingsOptionContainer:not([hidden])');
    }
    for (const row of document.querySelectorAll('#settings_infoblock .settingsOptionContainer')) {
        row.setAttribute('role', 'switch');
        row.tabIndex = 0;
        const cb = row.querySelector('.settingsCheckbox');
        row.setAttribute('aria-checked', cb && cb.classList.contains('settingsCheckboxChecked') ? 'true' : 'false');
    }
}

function setUpdateRangeLabels() {
    const fmt = v => Number(v).toFixed(2).replace(/0$/, '') + '×';
    for (const [inp, out] of [['iconScaleRange', 'iconScaleValue'], ['userScaleRange', 'userScaleValue']]) {
        const e = document.getElementById(inp);
        if (!e) continue;
        const pct = (e.value - e.min) / (e.max - e.min) * 100;
        e.style.setProperty('--fill', pct + '%');
        document.getElementById(out).textContent = fmt(e.value);
    }
}

function setUnitsSync() {
    const sel = document.getElementById('units_selector');
    for (const b of document.querySelectorAll('#unitsSegmented [data-units]')) {
        const on = b.dataset.units == sel.value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.setAttribute('role', 'radio');
    }
}

function setAbout() {
    jQuery('#about_decoder').text((typeof receiverJson != 'undefined' && receiverJson && receiverJson.version) ? receiverJson.version : '');
    // web interface and database versions come from tar1090's version.json (installed alongside index.html)
    if (!setAbout.versions) {
        setAbout.versions = true;
        jQuery.getJSON('version.json').done((v) => {
            jQuery('#about_web').text('tar1090 ' + (v.tar1090Version || '').replace(/_dirty$/, ''));
            jQuery('#about_db').text(v.databaseVersion || '');
        }).fail(() => {
            jQuery('#about_web').text('tar1090');
            jQuery('#about_db').closest('.kvRow').hide();
        });
    }
    let host = '';
    try { host = new URL(routeApiUrl, location.href).host; } catch (e) { host = routeApiUrl; }
    jQuery('#routeApiHost').text(host);
}

let setLastFocus = null;
function showSettingsSection(sec) {
    if (!SET_TITLES[sec]) sec = 'map';
    for (const s of document.querySelectorAll('#settings_infoblock .setSec'))
        s.hidden = s.dataset.sec != sec;
    for (const b of document.querySelectorAll('#settings_infoblock .setNavBtn')) {
        const on = b.dataset.sec == sec;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    jQuery('#setSecTitle').text(SET_TITLES[sec]);
    try { loStore['settingsSection'] = sec; } catch (e) {}
}

function openSettings(sec, opener) {
    const d = document.getElementById('settings_infoblock');
    setLastFocus = opener || document.activeElement;
    setBuildBaseMaps();
    setBuildOverlays();
    setBuildTable();
    setBuildQuick();
    setArrange();
    setSyncSwitches();
    setRenderBaseState();
    setUpdateRangeLabels();
    setUnitsSync();
    setAbout();
    showSettingsSection(sec || loStore['settingsSection'] || 'map');
    if (typeof PHONE != 'undefined') PHONE.settingsPage(sec ? 'page' : 'root');      // phones: grouped list first, a page when a section was asked for
    d.hidden = false;
    document.getElementById('settingsBackdrop').hidden = false;
    document.body.classList.add('settingsOpen');
    const first = d.querySelector('.setNavBtn.on') || d.querySelector('.setNavBtn');
    if (!(typeof PHONE != 'undefined' && PHONE.isPhone())) first && first.focus();
}

function closeSettings() {
    const d = document.getElementById('settings_infoblock');
    if (d.hidden) return;
    d.hidden = true;
    document.getElementById('settingsBackdrop').hidden = true;
    document.body.classList.remove('settingsOpen');
    resetConfirm(false);
    if (setLastFocus && setLastFocus.focus) setLastFocus.focus();
}

let resetTimer = null;
function resetConfirm(on) {
    const b = document.getElementById('settingsReset');
    if (!b) return;
    clearTimeout(resetTimer);
    b.classList.toggle('confirm', on);
    b.textContent = on ? 'Click again to reset everything' : 'Reset all settings';
    if (on) resetTimer = setTimeout(() => resetConfirm(false), 4000);
}

function initSettings() {
    const d = document.getElementById('settings_infoblock');
    // sort the Toggle rows into their sections once the app has created them
    if (typeof runAfterLoad == 'function') runAfterLoad(setArrange);
    jQuery('#settingsCog').on('click', function () {
        if (d.hidden) openSettings(null, this); else closeSettings();
    });
    jQuery('#settings_close').on('click', closeSettings);
    jQuery(d).on('click', '.setNavBtn', function () { showSettingsSection(this.dataset.sec); });
    // dimmed backdrop behind the dialog; clicking it closes
    const bd = document.createElement('div');
    bd.id = 'settingsBackdrop';
    bd.hidden = true;
    // above every floating panel: move the dialog out of the map container's stacking context
    document.body.appendChild(bd);
    document.body.appendChild(d);
    bd.addEventListener('mousedown', closeSettings);
    jQuery('#settingsReset').on('click', function () {
        if (this.classList.contains('confirm')) resetSettings();
        else resetConfirm(true);
    });
    jQuery('#unitsSegmented').on('click', '[data-units]', function () {
        jQuery('#units_selector').val(this.dataset.units).trigger('change');
        setUnitsSync();
    });
    for (const id of ['iconScaleRange', 'userScaleRange'])
        document.getElementById(id).addEventListener('input', setUpdateRangeLabels);
    // keyboard: Toggle rows are divs; make Space/Enter flip them and keep aria-checked current
    jQuery(d).on('keydown', '.settingsOptionContainer', function (e) {
        if (e.key == ' ' || e.key == 'Enter') {
            e.preventDefault();
            jQuery(this).find('.settingsCheckbox').trigger('click');
        }
    });
    jQuery(d).on('click', '.settingsOptionContainer', function (e) {
        const cb = this.querySelector('.settingsCheckbox');
        if (e.target !== cb && !jQuery(e.target).closest('a, button, input, select').length) jQuery(cb).trigger('click');
        setTimeout(() => {
            this.setAttribute('aria-checked', cb.classList.contains('settingsCheckboxChecked') ? 'true' : 'false');
            setSyncSwitches();
        }, 0);
    });
    // while the dialog is open: Escape closes it, map hotkeys are paused
    window.addEventListener('keydown', function (e) {
        if (d.hidden) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeSettings();
            return;
        }
        // (script.js and ui/shell.js ignore keys while body.settingsOpen is set)
        if (e.key == 'Tab') {     // keep focus inside the dialog
            const f = [...d.querySelectorAll('button:not([hidden]), input:not([hidden]), select:not([hidden]), [tabindex="0"]')].filter(x => x.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
            else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
        }
    }, true);
}
jQuery(initSettings);
