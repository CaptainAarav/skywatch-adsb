"use strict";
// Skywatch ADS-B: MapLibre GL JS renderer (BSD-3, vendored in libs/).
//
// The plane data layer (fetching, filters, history,
// trail segments) is unchanged; this file draws it. Aircraft, trails, labels and the range overlays are
// GeoJSON sources with data-driven layers, so rendering stays fast with hundreds of aircraft.
//
// Providers are keyless on purpose: the site is public, so there must be no API keys and no billing
// risk. CARTO may require a key for vector styles in future; MLR.baseFailed() then falls back to the
// other provider, so the map never goes blank.

// Minimal feature list used by the range outline code in script.js.
class MLSource {
    constructor(kind) { this.kind = kind; this.f = []; }
    clear() { this.f = []; MLR.touch(this.kind); }
    addFeature(f) { this.f.push(f); MLR.touch(this.kind); }
    addFeatures(a) { for (const f of a) this.f.push(f); MLR.touch(this.kind); }
    getFeatures() { return this.f; }
}

const MLR = {
    map: null,
    ready: false,                    // style loaded and our layers installed
    planes: new Map(),               // icao -> {plane, icon, rot, scale, label, z, pill, feat}
    trails: new Map(),               // icao -> {segs: [{seg, feat}], labels: [feat], elastic, heading, shown}
    icons: new Map(),                // image id -> {shape, fill, sw}
    iconData: new Map(),             // image id -> ImageData (kept across style changes)
    pendingIcons: new Set(),
    dirty: {},
    flushTimer: null,
    baseToken: 0,
    baseName: null,
    tried: new Set(),
    tileErr: 0,
    tileOk: 0,
    overlayTimers: {},
    dim: 0,
    userData: {circles: null, calc: null},
    labelPx: 12,
};

const ML_LAYER_IDS = {
    siteCircles: ['tar-circles', 'tar-circle-labels'],
    locationDot: ['tar-location'],
    actualRangeOutline: ['tar-outline'],
    calcOutline: ['tar-calc'],
    ac_trail: ['tar-trail-casing', 'tar-trail-line', 'tar-trail-dash', 'tar-trail-heading', 'tar-trail-pts', 'tar-trail-labels', 'tar-trail-label-dots'],
    iconLayer: ['tar-planes', 'tar-plane-labels', 'tar-plane-labels-top'],
};

// ------------------------------------------------------------------------------------------
// map creation
// ------------------------------------------------------------------------------------------
MLR.init = function () {
    if (!MAP_WEBGL) return;                  // no WebGL: the notice from ui/mapgeo.js is shown, the map calls below are no-ops
    const container = document.getElementById('map_canvas');
    const m = this.map = new maplibregl.Map({
        container,
        style: {version: 8, glyphs: ML_GLYPHS, sources: {}, layers: [{id: 'bg', type: 'background', paint: {'background-color': '#000'}}]},
        center: [CenterLon, CenterLat],
        zoom: g.zoomLvl - 1,                       // MapLibre's world is 512 px, tar1090's zoom numbering assumes 256 px
        bearing: -g.mapOrientation * 180 / Math.PI,
        pitch: 0,
        maxPitch: 0,
        attributionControl: false,
        fadeDuration: 0,
        dragRotate: true,                          // right-drag / ctrl-drag rotates in 2D and 3D (pitch is clamped to 0 in 2D)
        pitchWithRotate: true,
        renderWorldCopies: true,
        maxTileCacheSize: 400,
        transformRequest: mlTransformRequest,
    });
    m.touchZoomRotate.enableRotation();
    m.on('move', () => this.syncNorth());
    m.keyboard.disable();                           // tar1090 has its own hotkeys

    m.on('style.load', () => this.install());
    m.on('zoomend', () => { if (this.isGlobe()) this.applySky(); });
    m.on('styleimagemissing', (e) => this.loadIcon(e.id));
    // MapLibre fires moveend synchronously inside jumpTo(), before
    // callers such as PlaneObject.setProjection() finish updating their own state. Defer and coalesce it.
    let moveTimer = null;
    m.on('moveend', () => {
        if (moveTimer) return;
        moveTimer = setTimeout(() => { moveTimer = null; checkMovement(); }, 0);
    });
    m.on('zoomend', () => this.touch('planes'));   // label offsets follow the icon size
    m.on('click', (e) => this.onClick(e, false));
    m.on('dblclick', (e) => this.onClick(e, true));
    m.on('sourcedata', (e) => { if (e.tile && e.sourceId && !/^(tar-|ov-)/.test(e.sourceId)) this.tileOk++; });
    m.on('error', (e) => this.onError(e));

    this.buildControls(container);

    // 2D / 3D / Globe switch
    for (const [id, mode] of [['view2d', '2d'], ['view3d', '3d'], ['viewGlobe', 'globe']])
        document.getElementById(id).addEventListener('click', () => this.setView(mode));
    if (!MAP_GLOBE) document.getElementById('viewGlobe').hidden = true;
    let saved = '2d';
    try { saved = loStore['viewMode'] || (loStore['view3d'] === '1' ? '3d' : '2d'); } catch (e) {}
    if (saved === 'globe' && !MAP_GLOBE) saved = '2d';
    this.viewMode = saved;                                   // projection is applied in install(), after each style load
    m.once('style.load', () => { if (saved === '3d' || saved === 'globe') this.setView(saved, true); else this.syncViewButtons(); });
};

MLR.buildControls = function (container) {
    // zoom and attribution controls (class names are historical; ui/shell.css styles them)
    const zoom = document.createElement('div');
    zoom.className = 'ol-zoom ol-control';
    zoom.innerHTML = '<button class="ol-zoom-in" type="button" title="Zoom in" aria-label="Zoom in">+</button>'
        + '<button class="ol-zoom-out" type="button" title="Zoom out" aria-label="Zoom out">−</button>';
    zoom.querySelector('.ol-zoom-in').addEventListener('click', () => zoomIn());
    zoom.querySelector('.ol-zoom-out').addEventListener('click', () => zoomOut());
    container.appendChild(zoom);

    const attr = document.createElement('div');
    attr.className = 'ol-attribution ol-control';
    attr.innerHTML = '<ul><li id="mlAttribution"></li></ul>';
    container.appendChild(attr);
};

MLR.updateAttribution = function () {
    const el = document.getElementById('mlAttribution');
    if (!el) return;
    const parts = [];
    const base = this.findLayer(this.activeBase || this.baseName);
    if (base && base.get('attribution')) parts.push(base.get('attribution'));
    for (const l of layers.getArray())
        if (l.get('type') === 'overlay' && l.visible && l.get('attribution')) parts.push(l.get('attribution'));
    // airport detail comes from OpenFreeMap whatever the base map is: credit it only while that detail is on screen
    const m = this.map;
    if (m && typeof airportDetail != 'undefined' && airportDetail && m.getSource('tar-airport') && m.getZoom() >= 8 && !parts.some(x => /OpenFreeMap/.test(x))) parts.push(ML_ATTR.ofm);
    if (m && !this._attrZoomHook) { this._attrZoomHook = true; m.on('zoomend', () => this.updateAttribution()); }
    el.innerHTML = parts.join(' · ');
};

MLR.findLayer = function (name) {
    if (!name || typeof layers == 'undefined') return null;
    return layers.getArray().find(l => l.get('name') === name) || null;
};

// ------------------------------------------------------------------------------------------
// base map and overlays
// ------------------------------------------------------------------------------------------
MLR.layerVisibility = function (l) {
    if (!this.map) return;
    const type = l.get('type'), kind = l.get('kind');
    if (type === 'base') {
        if (!l.visible) return;
        for (const o of layers.getArray()) if (o !== l && o.get('type') === 'base') o.visible = false;
        this.tried.clear();
        this.selectBase(l.get('name'));
        return;
    }
    if (kind === 'builtin') { this.syncBuiltin(l); return; }
    this.syncOverlay(l);
    this.updateAttribution();
};

MLR.layerOpacity = function (l) {
    if (!this.ready || l.get('kind') !== 'raster') return;
    const id = 'ov-' + l.get('name');
    if (this.map.getLayer(id)) this.map.setPaintProperty(id, 'raster-opacity', l.opacity);
};

MLR.selectBase = async function (name) {
    const layer = this.findLayer(name);
    if (!layer) return;
    const token = ++this.baseToken;
    this.baseName = name;
    this.activeBase = name;
    this.tried.add(name);
    this.tileErr = 0;
    this.tileOk = 0;
    let style;
    try {
        style = await mlBuildStyle(layer.p);
    } catch (err) {
        if (token === this.baseToken) this.baseFailed(name, err);
        return;
    }
    if (token !== this.baseToken) return;
    this.ready = false;
    this.baseDomains = mlStyleDomains(style);
    this.map.setStyle(style, {diff: false});
    this.updateAttribution();
    // base map tiles must arrive; otherwise try another provider (see onError)
    clearTimeout(this.baseWatch);
    this.baseWatch = setTimeout(() => {
        if (token === this.baseToken && this.tileOk === 0 && this.tileErr > 0) this.baseFailed(name, new Error('no tiles loaded'));
    }, 10000);
};

MLR.onError = function (e) {
    const msg = String((e && e.error && e.error.message) || '');
    const src = e && e.sourceId;
    const isTile = !!(e && e.tile) || /HTTP|Failed to fetch|NetworkError|429|Load failed/i.test(msg);
    if (!isTile) { console.warn('map:', msg); return; }
    if (src && /^(tar-|ov-)/.test(src)) return;     // overlay problems don't affect the base map
    // keep the evidence: URL and HTTP status of recent failures (window.MLR.tileFailures), one console line per 15 s
    const url = (e.error && e.error.url) || '', status = e.error && e.error.status;
    (this.tileFailures || (this.tileFailures = [])).push({t: Date.now(), status: status == null ? null : status, url: String(url).slice(0, 160), msg: msg.slice(0, 120)});
    if (this.tileFailures.length > 30) this.tileFailures.shift();
    if (!this._failLog || Date.now() - this._failLog > 15000) { this._failLog = Date.now(); console.warn('map tile request failed:', status == null ? '(no HTTP status: blocked or offline, often a CDN error page without CORS headers)' : status, url); }
    // a failure from the style we just left (requests still in flight after a provider switch) says nothing about the new one
    if (url && this.baseDomains && this.baseDomains.size) {
        let host = ''; try { host = new URL(url, location.href).hostname; } catch (err) { /* relative */ }
        if (host && host !== location.hostname && !this.baseDomains.has(mlDomain(host))) return;
    }
    if (++this.tileErr >= 4 && this.tileOk === 0) this.baseFailed(this.baseName, e.error || new Error(msg));
};

// Fall back to another keyless provider (never leave the map blank), without changing the saved choice.
MLR.baseFailed = function (name, err) {
    const def = this.findLayer(name);
    const chain = [def && def.get('fallback'), 'SkywatchDark', 'VersaTilesDark'].filter(Boolean);
    const next = chain.find(n => !this.tried.has(n) && this.findLayer(n));
    console.warn(`Base map "${name}" failed (${err && err.message || err}); ` + (next ? `falling back to "${next}"` : 'no fallback left'));
    if (typeof SKYUI != 'undefined') SKYUI.banner('map', next
        ? {kind: 'warn', title: 'Map provider switched', detail: (def ? def.get('title') : name) + ' is not answering, using ' + this.findLayer(next).get('title') + '.', action: {label: 'Dismiss', run: () => SKYUI.banner('map')}}
        : {kind: 'error', title: 'Map tiles unavailable', detail: 'No map provider is answering. Aircraft are still shown.'});
    if (!next) {
        // every provider failed (often a short CDN outage or a rate limit): try the first one again after a pause, once per failure
        const token = this.baseToken;
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { if (token === this.baseToken) { this.tried.clear(); this.selectBase(this.baseName); } }, 45000);
        return;
    }
    this.selectBase(next);
};

// registrable-ish domain (last two labels) of every host a style loads from: sources, sprite, glyphs
function mlDomain(host) { return host.split('.').slice(-2).join('.'); }
function mlStyleDomains(style) {
    const out = new Set(), add = (u) => { try { out.add(mlDomain(new URL(u, location.href).hostname)); } catch (err) { /* not a URL */ } };
    for (const k of Object.keys(style.sources || {})) { const s = style.sources[k]; if (s.url) add(s.url); for (const t of s.tiles || []) add(t); }
    if (typeof style.sprite === 'string') add(style.sprite);
    if (typeof style.glyphs === 'string') add(style.glyphs);
    return out;
}

// our sources and layers go on top of whatever style was just loaded
MLR.install = function () {
    const m = this.map;
    if (this.viewMode === 'globe') this.applyProjection();
    this.applyDim();
    try { this.installTerrain && this.installTerrain(); } catch (e) { console.warn('terrain:', e); }
    m.addLayer({id: 'tar-dim', type: 'background', paint: {'background-color': '#000', 'background-opacity': this.dim}});

    const fc = (f) => ({type: 'FeatureCollection', features: f || []});
    for (const id of ['circles', 'location', 'outline', 'calc', 'trails', 'trail-labels', 'planes'])
        m.addSource('tar-' + id, {type: 'geojson', data: fc()});

    // airport detail (apron, taxiways, runways, stands) goes under the aircraft layers
    try { this.installAirports && this.installAirports(); } catch (e) { console.warn('airport layers:', e); }
    try { this.installAirportPins && this.installAirportPins(); } catch (e) { console.warn('airport pins:', e); }
    for (const l of layers.getArray())
        if (l.get('type') === 'overlay' && l.get('kind') !== 'builtin' && l.visible) this.addOverlay(l);

    const fs = this.labelPx = 10 * globalScale * labelScale;
    m.addLayer({id: 'tar-circles', type: 'line', source: 'tar-circles', filter: ['==', ['get', 'k'], 'c'],
        paint: {'line-color': ['get', 'color'], 'line-width': Math.max(1, globalScale)},
        layout: {'line-cap': 'round'}});
    m.addLayer({id: 'tar-circle-labels', type: 'symbol', source: 'tar-circles', filter: ['==', ['get', 'k'], 'l'],
        layout: {'text-field': ['get', 'label'], 'text-font': ML_FONT, 'text-size': 10 * globalScale, 'text-anchor': 'bottom',
            'text-offset': [0, -0.3], 'text-allow-overlap': true, 'text-ignore-placement': true},
        paint: {'text-color': 'rgba(255,255,255,0.45)', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.2}});
    m.addLayer({id: 'tar-outline', type: 'line', source: 'tar-outline',
        paint: {'line-color': typeof actual_range_outline_color != 'undefined' ? actual_range_outline_color : '#fff',
            'line-width': typeof actual_range_outline_width != 'undefined' ? actual_range_outline_width : 1.5,
            'line-dasharray': this.dashArray(typeof actual_range_outline_dash != 'undefined' ? actual_range_outline_dash : null,
                typeof actual_range_outline_width != 'undefined' ? actual_range_outline_width : 1.5)}});
    m.addLayer({id: 'tar-calc', type: 'line', source: 'tar-calc',
        paint: {'line-color': ['get', 'color'], 'line-width': typeof range_outline_width != 'undefined' ? range_outline_width : 1.5}});

    // trails: dark casing, altitude-coloured line, dashes for estimated positions, dots for Mode S
    m.addLayer({id: 'tar-trail-casing', type: 'line', source: 'tar-trails', filter: ['==', ['get', 'k'], 's'],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': 'rgba(0,0,0,0.6)', 'line-width': ['+', ['get', 'w'], 2.4]}});
    m.addLayer({id: 'tar-trail-line', type: 'line', source: 'tar-trails', filter: ['==', ['get', 'k'], 's'],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': ['get', 'color'], 'line-width': ['get', 'w']}});
    m.addLayer({id: 'tar-trail-dash', type: 'line', source: 'tar-trails', filter: ['==', ['get', 'k'], 'd'],
        layout: {'line-join': 'round'},
        paint: {'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-dasharray': [2, 3]}});
    m.addLayer({id: 'tar-trail-heading', type: 'line', source: 'tar-trails', filter: ['==', ['get', 'k'], 'h'],
        paint: {'line-color': 'rgba(255,255,255,0.8)', 'line-width': ['get', 'w'], 'line-dasharray': [2, 3]}});
    m.addLayer({id: 'tar-trail-pts', type: 'circle', source: 'tar-trails', filter: ['==', ['get', 'k'], 'p'],
        paint: {'circle-color': ['get', 'color'], 'circle-radius': ['get', 'w'], 'circle-stroke-color': 'rgba(0,0,0,0.6)', 'circle-stroke-width': 1}});
    m.addLayer({id: 'tar-trail-label-dots', type: 'circle', source: 'tar-trail-labels',
        paint: {'circle-color': '#000', 'circle-radius': 2 * globalScale}});
    m.addLayer({id: 'tar-trail-labels', type: 'symbol', source: 'tar-trail-labels', filter: ['!=', ['get', 'limg'], ''],
        layout: {'icon-image': ['get', 'limg'], 'icon-anchor': ['get', 'anchor'], 'icon-offset': ['get', 'loff'], 'icon-size': 1, 'icon-padding': 1,
            'icon-allow-overlap': false, 'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport', 'symbol-sort-key': ['get', 'z']}});

    m.addLayer({id: 'tar-location', type: 'circle', source: 'tar-location',
        paint: {'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#000', 'circle-stroke-width': 2}});

    this.lblReset();
    // aircraft: icons, then labels in their own layers so label collision has its own priority.
    try { this.installLift && this.installLift(); } catch (e) { console.warn('lift layers:', e); }
    try { this.installSelection && this.installSelection(undefined); } catch (e) { console.warn('selection layers:', e); }
    // soft white glow ring behind the selected aircraft (everything is white now, so selection must stand out)
    m.addLayer({id: 'tar-plane-glow', type: 'circle', source: 'tar-planes', filter: ['==', ['get', 'sel'], 1],
        paint: {'circle-radius': 20, 'circle-color': 'rgba(255,255,255,0.16)', 'circle-blur': 0.7, 'circle-stroke-color': 'rgba(255,255,255,0.35)', 'circle-stroke-width': 1,
            'circle-pitch-alignment': 'viewport', 'circle-pitch-scale': 'viewport'}});
    const planeLayout = {
            'icon-image': ['get', 'icon'],
            // smaller icons when zoomed far out (world / globe view), so thousands of aircraft stay readable
            // about 16 px at UK zoom, growing smoothly to about 28 px by zoom 12 (factors of the shape's own size)
            'icon-size': ['interpolate', ['linear'], ['zoom']].concat([[1, 0.3], [5, 0.5], [7, 0.58], [12, 0.95], [16, 1.15]].flatMap(([z, f]) => [z, ['*', ['get', 'scale'], f]])),
            'icon-rotate': ['get', 'rot'],
            'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
            // aircraft always draw, but they take part in collision so the map's own labels give way to them
            'icon-allow-overlap': true, 'icon-ignore-placement': true,
            'symbol-sort-key': ['get', 'z'],
    };
    m.addLayer({id: 'tar-planes', type: 'symbol', source: 'tar-planes', layout: planeLayout});
    // ONE label pill (ui/label-sprite.js): a baked sprite placed as an icon, right of the aircraft, vertically centred.
    // Both layers sit ABOVE the aircraft icons (a dense cluster must never draw an icon over label text); the icons ignore placement, so a
    // label is only ever hidden by another label. Priority (symbol-sort-key): selected, then lowest altitude, then closest to the screen centre.
    // The 'top' layer (selected, followed, hovered) allows overlap, so those labels are always shown.
    const pillLayout = (extra) => Object.assign({
        'icon-image': ['get', 'limg'], 'icon-anchor': ['case', ['==', ['get', 'm'], 1], 'bottom', 'left'], 'icon-offset': ['get', 'loff'], 'icon-size': 1, 'icon-padding': 1,
        'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport',
    }, extra);
    m.addLayer({id: 'tar-plane-labels', type: 'symbol', source: 'tar-planes', filter: ['all', ['==', ['get', 'top'], 0], ['!=', ['get', 'limg'], '']], minzoom: 5.5,
        layout: pillLayout({'icon-allow-overlap': false, 'icon-ignore-placement': false, 'symbol-sort-key': ['get', 'lprio']})});
    m.addLayer({id: 'tar-plane-labels-top', type: 'symbol', source: 'tar-planes', filter: ['all', ['==', ['get', 'top'], 1], ['!=', ['get', 'limg'], '']],
        layout: pillLayout({'icon-allow-overlap': true, 'icon-ignore-placement': false})});
    // the selected aircraft's icon is drawn once more on top of everything (same layout as tar-planes), so it is never under a pill or a neighbour
    m.addLayer({id: 'tar-planes-sel', type: 'symbol', source: 'tar-planes', filter: ['==', ['get', 'sel'], 1], layout: planeLayout});

    this.ready = true;
    try { this.installModels && this.installModels(); } catch (e) { console.debug('3D models install:', e); }
    this.sync3DLayers();
    for (const l of layers.getArray()) if (l.get('kind') === 'builtin') this.syncBuiltin(l);
    this.dirty = {planes: true, trails: true, circles: true, location: true, outline: true, calc: true};
    this.dirtyIcons = true;
    this.flush();
    this.updateAttribution();
};

// ---- label sprites (ui/label-sprite.js) ----
// id -> {spec, dpr, used}. Images are added to the map on first use and dropped when unused for a few flushes.
MLR.lbl = new Map(); MLR.lblTick = 0; MLR.trailImgs = new Set();
MLR.lblReset = function () { this.lbl.clear(); this.lblTick = 0; this.trailImgs = new Set(); };
MLR.labelImage = function (spec) {
    const dpr = Math.max(2, mlDpr());
    spec.fontPx = Math.round(LABELS.STYLE.fontPx * globalScale * (typeof labelScale == 'number' ? labelScale : 1));
    if (!this.lblFontOk) {
        if (document.fonts && document.fonts.check(LABELS.STYLE.fontWeight + ' 13px Inter')) this.lblFontOk = true;
        else if (document.fonts && !this.lblFontWait) {
            this.lblFontWait = true;
            document.fonts.load(LABELS.STYLE.fontWeight + ' 13px Inter').then(() => { this.lblFontOk = true; this.lblClearImages(); this.touch('planes'); this.touch('trails'); }, () => { this.lblFontOk = true; });
        }
    }
    const id = LABELS.spriteId(spec, dpr), hit = this.lbl.get(id);
    if (hit) { hit.used = this.lblTick; return this.map.hasImage(id) ? id : (this.lblAdd(id, hit) ? id : ''); }
    const ent = {spec: {lines: spec.lines.slice(), selected: !!spec.selected, fontPx: spec.fontPx, logo: spec.logo || null, mono: spec.mono || null, color: spec.color || null}, dpr, used: this.lblTick};
    this.lbl.set(id, ent);
    return this.lblAdd(id, ent) ? id : '';
};
MLR.lblAdd = function (id, ent) {
    try {
        const r = LABELS.render(ent.spec, ent.dpr);
        ent.w = r.w; ent.h = r.h;
        if (!this.map.hasImage(id)) this.map.addImage(id, r.image, {pixelRatio: ent.dpr});
        return true;
    } catch (err) { return false; }       // style changing
};
MLR.lblClearImages = function () {
    for (const id of this.lbl.keys()) { try { if (this.map.hasImage(id)) this.map.removeImage(id); } catch (err) { /* ignore */ } }
    this.lbl.clear();
};
// drop sprites no label used for the last few flushes (trail labels are kept while shown)
MLR.lblSweep = function () {
    this.lblTick++;
    if (this.lbl.size < 240) return;
    for (const [id, ent] of this.lbl) {
        if (ent.used >= this.lblTick - 3 || this.trailImgs.has(id)) continue;
        try { if (this.map.hasImage(id)) this.map.removeImage(id); } catch (err) { /* ignore */ }
        this.lbl.delete(id);
    }
};

MLR.dashArray = function (dash, width) {
    if (!dash || !dash.length) return [1, 0];
    return dash.map(d => Math.max(0.1, d / Math.max(0.5, width)));
};

MLR.syncBuiltin = function (l) {
    if (!this.ready) return;
    const ids = ML_LAYER_IDS[l.get('name')] || [];
    for (const id of ids)
        if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', l.visible ? 'visible' : 'none');
};

MLR.syncOverlay = function (l) {
    if (!this.ready) return;
    this.removeOverlay(l);
    if (l.visible) this.addOverlay(l);
};

MLR.addOverlay = function (l) {
    const m = this.map, name = l.get('name'), id = 'ov-' + name;
    const before = m.getLayer('tar-circles') ? 'tar-circles' : undefined;
    if (m.getSource(id)) return;
    if (l.get('kind') === 'raster') {
        if (l.get('dynamic') === 'rainviewer') { this.addRainviewer(l); return; }
        let tiles = l.get('tiles');
        if (l.get('bust')) tiles = tiles.map(t => t + (t.includes('?') ? '&' : '?') + '_=' + Date.now());
        const src = {type: 'raster', tiles, tileSize: l.get('tileSize') || 256};
        if (l.get('maxzoom') != null) src.maxzoom = l.get('maxzoom');
        if (l.get('minzoom') != null) src.minzoom = l.get('minzoom');
        m.addSource(id, src);
        m.addLayer({id, type: 'raster', source: id, paint: {'raster-opacity': l.opacity}}, before);
        if (l.get('refresh')) {
            clearInterval(this.overlayTimers[name]);
            this.overlayTimers[name] = setInterval(() => { if (l.visible) this.syncOverlay(l); }, l.get('refresh'));
        }
    } else if (l.get('kind') === 'geojson') {
        m.addSource(id, {type: 'geojson', data: l.get('url')});
        m.addLayer({id: id + '-fill', type: 'fill', source: id, filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
            paint: {'fill-color': l.get('fillExpr') || l.get('fill'), 'fill-opacity': l.opacity}}, before);
        m.addLayer({id: id + '-line', type: 'line', source: id,
            paint: {'line-color': l.get('strokeExpr') || l.get('stroke'), 'line-width': 1.2}}, before);
        if (l.get('label'))
            m.addLayer({id: id + '-label', type: 'symbol', source: id,
                layout: {'text-field': l.get('labelProp') || ['get', 'name'], 'text-font': ML_FONT, 'text-size': 12},
                paint: {'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.4}}, before);
        if (l.get('refresh')) {
            clearInterval(this.overlayTimers[name]);
            this.overlayTimers[name] = setInterval(() => { const s = m.getSource(id); s && s.setData(l.get('url')); }, l.get('refresh'));
        }
    }
};

MLR.removeOverlay = function (l) {
    const m = this.map, name = l.get('name'), id = 'ov-' + name;
    clearInterval(this.overlayTimers[name]);
    for (const suffix of ['', '-fill', '-line', '-label'])
        if (m.getLayer(id + suffix)) m.removeLayer(id + suffix);
    if (m.getSource(id)) m.removeSource(id);
};

MLR.addRainviewer = async function (l) {
    const name = l.get('name'), id = 'ov-' + name;
    try {
        const maps = await g.getRainviewerMaps();
        const past = maps.radar.past;
        if (!l.visible || this.map.getSource(id)) return;
        const m = this.map;
        m.addSource(id, {type: 'raster', tileSize: 512, maxzoom: 7,
            tiles: [maps.host + past[past.length - 1].path + '/512/{z}/{x}/{y}/6/1_1.png']});
        m.addLayer({id, type: 'raster', source: id, paint: {'raster-opacity': l.opacity}}, m.getLayer('tar-circles') ? 'tar-circles' : undefined);
        clearInterval(this.overlayTimers[name]);
        this.overlayTimers[name] = setInterval(() => { if (l.visible) this.syncOverlay(l); }, l.get('refresh'));
    } catch (err) {
        console.warn('RainViewer unavailable:', err);
    }
};

// ------------------------------------------------------------------------------------------
// 2D / 3D: tilt and rotate, with extruded buildings in the same black styling
// ------------------------------------------------------------------------------------------
MLR.is3D = false;
MLR.viewMode = '2d';
MLR.isGlobe = function () { return this.viewMode === 'globe'; };

MLR.applyProjection = function () {
    try { this.map.setProjection({type: this.isGlobe() ? 'globe' : 'mercator'}); }
    catch (e) {
        console.warn('Globe projection failed, using the flat map:', e);
        this.viewMode = '2d';
        const g = document.getElementById('viewGlobe'); if (g) g.hidden = true;
    }
    this.skyOn = false;
    this.applySky();
};

// black space; a very faint atmosphere glow that fades out as the globe flattens into the map
MLR.applySky = function () {
    // the atmosphere is a full-screen pass: only used while zoomed out, where it is visible
    if (!this.isGlobe() || this.map.getZoom() >= 6) {
        if (this.skyOn) { try { this.map.setSky(undefined); } catch (e) {} this.skyOn = false; }
        return;
    }
    if (this.skyOn) return;
    this.skyOn = true;
    try {
        this.map.setSky({
            'sky-color': '#000000', 'horizon-color': '#151515', 'fog-color': '#000000',
            'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.5,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 0.2, 6, 0],
        });
    } catch (e) {}
};

MLR.setView = function (mode, init) {
    const m = this.map;
    if (mode === 'globe' && !MAP_GLOBE) mode = '2d';
    this.viewMode = mode;
    this.is3D = mode === '3d';
    if (this.is3D) {
        m.setMaxPitch(60);
        m.dragRotate.enable();
        m.touchPitch.enable();
    }
    this.applyProjection();
    if (this.is3D) {
        m.easeTo({pitch: 55, duration: init ? 0 : 700});
    } else {
        const b = mode === 'globe' ? m.getBearing() : -g.mapOrientation * 180 / Math.PI;
        m.easeTo({pitch: 0, bearing: b, duration: init ? 0 : 500});
        m.once('moveend', () => { if (!this.is3D) m.setMaxPitch(0); });
    }
    this.sync3DLayers();
    this.syncViewButtons();
    this.syncModels && this.syncModels();
    try { loStore['viewMode'] = mode; loStore['view3d'] = this.is3D ? '1' : '0'; } catch (e) {}
    if (typeof checkMovement == 'function') setTimeout(checkMovement, 0);
};
// North button: ease bearing AND pitch back to a flat, north-up view; the compass needle follows the bearing
MLR.resetNorth = function () {
    const m = this.map;
    let b = m.getBearing();
    b = ((b + 180) % 360 + 360) % 360 - 180;           // shortest way round
    m.jumpTo({bearing: b});
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    m.easeTo({bearing: 0, pitch: 0, duration: reduce ? 0 : 700, easing: t => 1 - Math.pow(1 - t, 3)});
};
MLR.syncNorth = function () {
    const m = this.map, el = this._northEl || (this._northEl = document.getElementById('north_up'));
    if (!el) return;
    const b = m.getBearing(), p = m.getPitch();
    if (b === this._nb && p === this._np) return;
    this._nb = b; this._np = p;
    const off = Math.abs(((b + 180) % 360 + 360) % 360 - 180) > 0.5 || p > 0.5;
    el.classList.toggle('on', off);
    el.setAttribute('aria-pressed', off ? 'true' : 'false');
    const needle = el.querySelector('.northNeedle');
    if (needle) needle.style.transform = 'rotate(' + (-b) + 'deg)';
};
MLR.set3D = function (on) { this.setView(on ? '3d' : '2d'); };

MLR.syncViewButtons = function () {
    for (const [id, mode] of [['view2d', '2d'], ['view3d', '3d'], ['viewGlobe', 'globe']]) {
        const b = document.getElementById(id), on = this.viewMode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    window.dispatchEvent(new CustomEvent('tar:viewmode', {detail: this.viewMode}));
};

// buildings come from the style's own building layer; shown extruded only in 3D (and only if the style has them)
MLR.sync3DLayers = function () {
    const m = this.map;
    if (!this.ready) return;
    if (m.getLayer('tar-buildings')) m.removeLayer('tar-buildings');
    if (!this.is3D) return;
    const b = m.getStyle().layers.find(l => /^building$/.test(l.id) && l.source && l['source-layer']);
    if (!b) return;
    m.addLayer({id: 'tar-buildings', type: 'fill-extrusion', source: b.source, 'source-layer': b['source-layer'], minzoom: 14,
        paint: {
            'fill-extrusion-color': '#101010',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
            'fill-extrusion-opacity': 0.92,
            'fill-extrusion-vertical-gradient': true,
        }}, 'tar-dim');
};

MLR.applyDim = function () {
    const on = typeof toggles != 'undefined' && toggles['MapDim'] && toggles['MapDim'].state;
    this.dim = on ? 0.4 : 0;
    if (this.ready && this.map.getLayer('tar-dim')) this.map.setPaintProperty('tar-dim', 'background-opacity', this.dim);
};

// ------------------------------------------------------------------------------------------
// aircraft
// ------------------------------------------------------------------------------------------
// size factor of the plane icons at a MapLibre zoom (same stops as the 'icon-size' expression of tar-planes)
MLR.iconZoomFactor = function (z) {
    const st = [[1, 0.3], [5, 0.5], [7, 0.58], [12, 0.95], [16, 1.15]];
    if (z <= st[0][0]) return st[0][1];
    for (let i = 1; i < st.length; i++) if (z <= st[i][0]) return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * (z - st[i - 1][0]) / (st[i][0] - st[i - 1][0]);
    return st[st.length - 1][1];
};

MLR.touch = function (kind) {
    this.dirty[kind] = true;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 60);
};

// called from PlaneObject.updateIcon(): colour, shape and label are decided by the data layer
MLR.setPlane = function (p, fillColor, svgKey, labelSpec, outline) {
    let e = this.planes.get(p.icao);
    if (!e) this.planes.set(p.icao, e = {plane: p, feat: null});
    if (!this.icons.has(svgKey)) this.icons.set(svgKey, {shape: p.shape, fill: fillColor, sw: p.strokeWidth, outline: outline || null});
    const sel = !!(p.selected && !SelectedAllPlanes);
    e.icon = svgKey;
    e.fillColor = fillColor;
    e.rot = p.shape.noRotate ? 0 : p.rotation;
    e.scale = p.scale * (sel ? 1.3 : 1);   // the selected aircraft is a little larger
    e.labelSpec = labelSpec && labelSpec.lines && labelSpec.lines.length ? labelSpec : null;
    e.label = e.labelSpec ? e.labelSpec.lines.join('\n') : '';
    e.sel = sel;
    e.z = p.zIndex || 0;
    e.w = p.shape.w;
    this.touch('planes');
};

MLR.removePlane = function (p) {
    if (this.planes.delete(p.icao)) this.touch('planes');
};

function mlDpr() { return Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1))); }

MLR.loadIcon = function (id) {
    if (id.startsWith('mono-')) {                       // monogram tile for airlines without a logo
        const [, code, px] = id.split('-');
        const dpr = mlDpr(), sz = Math.ceil(Number(px) * dpr);
        const c = document.createElement('canvas'); c.width = c.height = sz;
        const x = c.getContext('2d');
        x.fillStyle = '#2e2e2e'; x.beginPath(); x.roundRect ? x.roundRect(0, 0, sz, sz, sz * 0.24) : x.rect(0, 0, sz, sz); x.fill();
        x.fillStyle = '#d7d7d7'; x.font = '600 ' + Math.round(sz * 0.36) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(code.slice(0, 3), sz / 2, sz / 2 + sz * 0.03, sz * 0.9);
        try { if (!this.map.hasImage(id)) this.map.addImage(id, x.getImageData(0, 0, sz, sz), {pixelRatio: dpr}); } catch (err) { /* style changed */ }
        return;
    }
    if (id.startsWith('logo-')) {                       // airline logo for a label: logo-ICAO-px (ui/airlines.js)
        const [, icao, px] = id.split('-');
        const dpr = mlDpr(), data = AIRLOGO.mapImage(icao, Number(px), dpr);
        try { if (data && !this.map.hasImage(id)) this.map.addImage(id, data, {pixelRatio: dpr}); } catch (err) { /* style changed */ }
        return;
    }
    const d = this.icons.get(id);
    if (!d) return;
    const have = this.iconData.get(id);
    const add = (data, dpr) => {
        try { if (!this.map.hasImage(id)) this.map.addImage(id, data, {pixelRatio: dpr}); } catch (err) { /* style changed */ }
    };
    if (have) { add(have.data, have.dpr); return; }
    if (this.pendingIcons.has(id)) return;
    this.pendingIcons.add(id);
    const img = new Image();
    img.onload = () => {
        const dpr = mlDpr();
        const c = document.createElement('canvas');
        c.width = Math.ceil(d.shape.w * dpr);
        c.height = Math.ceil(d.shape.h * dpr);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        this.iconData.set(id, {data, dpr});
        this.pendingIcons.delete(id);
        add(data, dpr);
        this.touch('planes');
    };
    img.onerror = () => this.pendingIcons.delete(id);
    img.src = svgShapeToURI(d.shape, d.fill, d.outline || OutlineADSBColor, d.sw);
};

MLR.idSeq = 0;
MLR.hoverEntry = function (hov) { return hov ? this.planes.get(hov.icao) : null; };

MLR.flush = function () {
    this.flushTimer = null;
    if (!this.ready) return;
    const m = this.map, d = this.dirty;
    this.dirty = {};
    if (d.planes) {
        const fs = 10 * globalScale * labelScale;
        this.labelPx = fs;
        const feats = [];
        // with many labels in view show the callsign only until zoomed in
        let nLabels = 0;
        for (const e of this.planes.values()) if (e.label && e.plane.inView) nLabels++;
        this.callsignOnly = nLabels > 40 && m.getZoom() < 8.5;
        const hov = (typeof HighlightedPlane != 'undefined') ? HighlightedPlane : null;
        const zf = this.iconZoomFactor(m.getZoom()), ctr = m.project(m.getCenter());
        const logosOn = airlineLogosOn();
        if (this.modelsSelect) this.modelsSelect();
        for (const e of this.planes.values()) {
            const p = e.plane;
            if (!p.proj) continue;
            if (!this.iconData.has(e.icon) && !this.map.hasImage(e.icon)) this.loadIcon(e.icon);
            if (!e.id) e.id = ++this.idSeq;
            const lonlat = this.drawnLL(e);
            const isTop = (hov && p === hov) || e.sel;
            const md = this.modelSet && this.modelSet.get(p.icao);
            let limg = '', loff = [0, 0];
            if (e.labelSpec) {
                const spec = Object.assign({}, e.labelSpec, {selected: e.sel});
                if (this.callsignOnly && !isTop) spec.lines = spec.lines.slice(0, 1);
                if (spec.logo && logosOn) {                          // airline chip: the real logo once loaded, a monogram until then
                    const info = airlineFlight(p), st = info && AIRLOGO.get(info);
                    if (st && st.state === 'ok' && st.bitmap) { spec.logo = AIRLOGO.mapImage(info.icao, Math.round(LABELS.STYLE.chip * globalScale), Math.max(2, mlDpr())); spec.logoKey = 'L' + info.icao; }
                    else if (info) { spec.logo = null; spec.mono = info.icao; spec.logoKey = 'M' + info.icao; }
                    else spec.logo = null;
                } else spec.logo = null;
                limg = this.labelImage(spec);
                loff = LABELS.pillOffset(e.w, e.scale, zf);
                if (md) loff = [0, -(md.px / 2 + 6)];                 // model drawn: the pill sits centred above it
            }
            const sp = m.project(lonlat);
            const lprio = LABELS.sortKey({pinned: isTop, altFt: typeof p.altitude == 'number' ? p.altitude : null, distPx: Math.hypot(sp.x - ctr.x, sp.y - ctr.y)});
            if (!this.smoothActive() || e.rotDraw == null) e.rotDraw = e.rot;
            feats.push({type: 'Feature', geometry: {type: 'Point', coordinates: lonlat}, id: e.id,
                properties: {hex: p.icao, icon: e.icon, rot: e.rotDraw, scale: e.scale, limg, loff, lprio, z: e.z, sel: e.sel ? 1 : 0, top: isTop ? 1 : 0, m: md ? 1 : 0}});
            e.feat = true;
        }
        this.planeFeats = feats;                                   // the features the plane layers were just fed (read by the placement tests)
        const src = m.getSource('tar-planes');
        src && src.setData({type: 'FeatureCollection', features: feats});
        this.liftFlushAll && this.liftFlushAll();
        this.lblSweep();
    }
    if (d.trails) this.flushTrails();
    this.flushSelection && this.flushSelection();
    if (d.circles) this.flushCircles();
    if (d.location) this.flushLocation();
    if (d.outline) this.flushOutline();
    if (d.calc) this.flushCalc();
};

// true when a position is on the far side of the globe
MLR.occluded = function (ll) {
    try { return !!this.map.transform.isLocationOccluded(new maplibregl.LngLat(ll[0], ll[1])); } catch (e) { return false; }
};

MLR.closestPlane = function (px, radius) {
    let best = null, bd = Infinity;
    for (const e of this.planes.values()) {
        const p = e.plane;
        if (!p.proj) continue;
        const ll = this.drawnLL(e);                     // hit-testing uses the position that is drawn
        if (this.isGlobe() && this.occluded(ll)) continue;
        const q = this.map.project(ll);
        const dx = q.x - px[0], dy = q.y - px[1], d = dx * dx + dy * dy;
        const md = this.modelSet && this.modelSet.get(p.icao);          // a drawn 3D model is hit over its on-screen size
        const r = md ? Math.max(radius, md.px * 0.6) : radius;
        if (d < r * r && d < bd) { bd = d; best = p; }
    }
    return best;
};

// ------------------------------------------------------------------------------------------
// trails
// ------------------------------------------------------------------------------------------
MLR.trailFor = function (p) {
    let t = this.trails.get(p.icao);
    if (!t) this.trails.set(p.icao, t = {segs: [], labels: [], elastic: null, heading: null, shown: false});
    return t;
};
MLR.clearTrail = function (p) {
    const t = this.trails.get(p.icao);
    if (!t) return;
    t.segs = []; t.labels = []; t.elastic = null; t.heading = null;
    for (const s of p.track_linesegs || []) delete s.mlC;
    this.touch('trails');
};
MLR.hideTrail = function (p) {
    const t = this.trails.get(p.icao);
    if (t && t.shown) { t.shown = false; this.touch('trails'); }
};
MLR.destroyTrail = function (p) {
    if (this.trails.delete(p.icao)) this.touch('trails');
};

// lon/lat coordinates of a segment, converted incrementally as the segment grows
function mlSegCoords(seg) {
    const src = seg.fixed.getCoordinates();
    const c = seg.mlC || (seg.mlC = []);
    for (let i = c.length; i < src.length; i++) c.push(mapgeo.toLonLat(src[i]));
    return c;
}

MLR.flushTrails = function () {
    const lines = [], labels = [], used = new Set();
    for (const [thex, t] of this.trails) {
        if (!t.shown) continue;
        // the selected aircraft's track is drawn as one gradient line instead (ui/maplibre-route.js)
        const gp = this.gradientPlane && this.gradientPlane();
        const hidden = gp && g.planes[thex] === gp;
        for (const s of t.segs) {
            if (hidden && s.feat.properties.k !== 'p') continue;
            s.feat.geometry.coordinates = mlSegCoords(s.seg);
            lines.push(s.feat);
        }
        if (t.elastic && !hidden) lines.push(t.elastic);
        if (t.heading) lines.push(t.heading);
        for (const f of t.labels) {
            const pr = f.properties;
            const spec = LABELS.fromText(pr.label, {});
            spec.color = pr.tcolor !== '#ffffff' ? pr.tcolor : null;
            spec.logoKey = pr.tcolor;
            const id = spec.lines.length ? this.labelImage(spec) : '';
            pr.limg = id; pr.loff = pr.offpx;
            if (id) used.add(id);
            labels.push(f);
        }
    }
    this.trailImgs = used;
    const a = this.map.getSource('tar-trails'), b = this.map.getSource('tar-trail-labels');
    a && a.setData({type: 'FeatureCollection', features: lines});
    b && b.setData({type: 'FeatureCollection', features: labels});
};

MLR.closestTrail = function (px, radius) {
    let best = null, bd = radius * radius;
    for (const [hex, t] of this.trails) {
        if (!t.shown) continue;
        const p = g.planes[hex];
        if (!p) continue;
        for (const seg of p.track_linesegs) {
            const c = seg.fixed.getCoordinates();
            for (let k = 0; k < c.length; k++) {
                const q = this.map.project(mapgeo.toLonLat(c[k]));
                const dx = q.x - px[0], dy = q.y - px[1], d = dx * dx + dy * dy;
                if (d < bd) { bd = d; best = {hex, ts: Number(seg.ts)}; }
            }
        }
    }
    return best;
};

// trail colour: the altitude colour scale shared with the icons and the legend
function mlSegColor(seg) {
    let colorArr = altitudeColor(seg.altitude);
    if (seg.estimated) colorArr = [colorArr[0], colorArr[1], colorArr[2] * 0.8];
    return monochromeTracks ? monochromeTracks : hslToRgb(colorArr);
}

function mlSegFeature(p, seg, selected) {
    const modeS = (seg.dataSource == 'modeS');
    let mult = seg.estimated ? 0.6 : 1;
    if (noVanish) mult *= (seg.estimated ? 0.3 : 0.6);
    let w = 2 * newWidth * mult * (selected ? 1.35 : 1);
    let k = 's';
    if (modeS) { k = 'p'; w = 3 * newWidth; }
    else if (seg.estimated && !noVanish) { k = 'd'; w = 2 * newWidth; }
    return {type: 'Feature', geometry: {type: modeS ? 'MultiPoint' : 'LineString', coordinates: []},
        properties: {hex: p.icao, k, color: mlSegColor(seg), w, ts: Number(seg.ts)}};
}

PlaneObject.prototype.updateLinesML = function () {
    const selected = this.selected && !SelectedAllPlanes && !showTrace;
    if (this.mlSel !== selected) {
        this.mlSel = selected;
        this.removeTrail();
    }
    this.linesDrawn = true;
    this.clearTraceAfter = null;
    if (this.track_linesegs.length == 0) return;

    const t = MLR.trailFor(this);
    t.shown = true;

    for (let i = this.track_linesegs.length - 1; i >= 0; i--) {
        const seg = this.track_linesegs[i];
        if (seg.feature && (!trackLabels || seg.label))
            break;

        if (filterTracks && altFiltered(seg.altitude)) {
            seg.feature = true;
        } else if (!seg.feature) {
            seg.feature = true;
            t.segs.push({seg, feat: mlSegFeature(this, seg, selected)});
        }

        if (seg.label) {
            // already there
        } else if ((filterTracks && altFiltered(seg.altitude)) || seg.noLabel) {
            seg.label = true;
        } else if (trackLabels || ((i == 0 || i == this.track_linesegs.length - 1 || seg.leg) && showTrace && g.enableLabels)) {
            seg.label = true;
            const f = this.mlTrailLabel(seg, i);
            if (f) t.labels.push(f);
        }
    }

    // elastic band from the last fixed point to the current position
    t.elastic = null;
    t.heading = null;
    const lastseg = this.track_linesegs[this.track_linesegs.length - 1];
    const lastc = lastseg.fixed.getCoordinateAt(1.0);
    if (!showTrace && lastc && !(filterTracks && altFiltered(lastseg.altitude))) {
        const f = mlSegFeature(this, lastseg, selected);
        f.properties.k = 's';
        f.properties.w = 2 * newWidth * (selected ? 1.35 : 1);
        f.geometry = {type: 'LineString', coordinates: [mapgeo.toLonLat(lastc), this.position]};
        t.elastic = f;
    }
    // dashed line in the direction of travel for the selected aircraft
    if (headingLineMinutes > 0 && !showTrace && this.selected && !SelectedAllPlanes
        && this.track != null && this.gs > 0 && this.altitude != "ground" && this.seen_pos < 15) {
        const distance = this.gs * 1852 / 60 * headingLineMinutes;
        const end = TAR.utils.geodesic_destination(this.position, this.track * Math.PI / 180, distance);
        t.heading = {type: 'Feature', geometry: {type: 'LineString', coordinates: [this.position, end]},
            properties: {hex: this.icao, k: 'h', w: newWidth}};
    }
    MLR.touch('trails');
};

PlaneObject.prototype.mlTrailLabel = function (seg, i) {
    let altString;
    if (seg.alt_real == "ground") {
        altString = "Ground";
    } else {
        const alt = labelsGeom ? adjust_geom_alt(seg.alt_geom, seg.position) : adjust_baro_alt(seg.alt_real);
        altString = (alt == null) ? (NBSP + '?' + NBSP) : format_altitude_brief(alt, 0, DisplayUnits, showLabelUnits);
    }
    const speedString = (seg.speed == null) ? (NBSP + '?' + NBSP) : format_speed_brief(seg.speed, DisplayUnits, showLabelUnits).padStart(3, NBSP);

    const historic = (showTrace || replay);
    const useLocal = ((historic && !utcTimesHistoric) || (!historic && !utcTimesLive));
    const date = new Date(seg.ts * 1000);
    let refDate = showTrace ? traceDate : new Date();
    if (replay) refDate = replay.ts;
    let timestamp1 = '';
    if (useLocal && historic) timestamp1 = lDateString(date) + '\n';
    else if (getDay(refDate) != getDay(date)) timestamp1 = (useLocal ? lDateString(date) : zDateString(date)) + '\n';
    let timestamp2 = useLocal ? localTime(date) : zuluTime(date);
    if (traces_high_res || debugTracks) timestamp2 += '.' + (Math.floor((seg.ts * 10)) % 10);
    if (showTrace && !utcTimesHistoric) timestamp2 += '\n' + TIMEZONE;
    else if (!useLocal) timestamp2 += NBSP + 'Z';

    let text = speedString.padStart(3, NBSP) + "  " + altString.padStart(6, NBSP) + "\n" + timestamp1 + timestamp2;
    if (seg.rId && show_rId) text += "\n" + seg.rId.substring(0, 9);
    if (showTrace && !trackLabels) text = timestamp1 + timestamp2;

    let color = '#ffffff';
    let z = -i - 50 * (seg.alt_real == null);
    if (seg.leg == 'start') { color = '#88CC88'; z += 123499; }
    if (seg.leg == 'end') { color = '#8888CC'; z += 123455; }
    const otherDiag = seg.track != null && ((seg.track > 270 && seg.track < 360) || (seg.track > 90 && seg.track < 180));
    const c = seg.fixed.getFirstCoordinate();
    if (!c) return null;
    return {type: 'Feature', geometry: {type: 'Point', coordinates: mapgeo.toLonLat(c)},
        properties: {hex: this.icao, label: text, tcolor: color, z,
            anchor: otherDiag ? 'bottom-left' : 'top-left',
            offpx: [(otherDiag ? 4 : 8) * globalScale, (otherDiag ? -4 : 8) * globalScale], ts: Number(seg.ts)}};
};

// ------------------------------------------------------------------------------------------
// range rings, receiver, range outlines
// ------------------------------------------------------------------------------------------
MLR.drawSiteCircles = function () {
    const feats = [];
    if (SitePosition) {
        let circleColor = '#000000';
        for (let i = 0; i < SiteCirclesDistances.length; i++) {
            circleColor = i < SiteCirclesColors.length ? SiteCirclesColors[i] : circleColor;
            let conv = 1000.0;
            const distUnits = units_for('distance', DisplayUnits);
            if (distUnits === "nautical") conv = 1852.0;
            else if (distUnits === "imperial") conv = 1609.0;
            const distance = SiteCirclesDistances[i] * conv;
            const ring = TAR.utils.make_geodesic_circle(SitePosition, distance, 180).getCoordinates();
            // black rings would be invisible on the black map
            const color = /^(#000|#000000|black|rgb\(0, ?0, ?0\))$/i.test(circleColor) ? 'rgba(255,255,255,0.18)' : circleColor;
            feats.push({type: 'Feature', geometry: {type: 'LineString', coordinates: ring}, properties: {k: 'c', color}});
            feats.push({type: 'Feature', geometry: {type: 'Point', coordinates: ring[0]},
                properties: {k: 'l', label: format_distance_long(distance, DisplayUnits, 0)}});
        }
    }
    this.userData.circles = feats;
    this.touch('circles');
};
MLR.flushCircles = function () {
    const s = this.map.getSource('tar-circles');
    s && s.setData({type: 'FeatureCollection', features: this.userData.circles || []});
    if (this.ready) {
        this.map.setLayoutProperty('tar-circle-labels', 'text-size', 10 * globalScale);
        this.map.setPaintProperty('tar-circles', 'line-width', Math.max(1, globalScale));
    }
};

MLR.setLocation = function (pos) {
    this.userData.location = pos;
    this.touch('location');
};
MLR.flushLocation = function () {
    const pos = this.userData.location;
    const s = this.map.getSource('tar-location');
    s && s.setData({type: 'FeatureCollection', features: pos ? [{type: 'Feature', geometry: {type: 'Point', coordinates: pos}, properties: {}}] : []});
};

MLR.flushOutline = function () {
    const src = (typeof actualOutline != 'undefined' && actualOutline.features) ? actualOutline.features.getFeatures() : [];
    const feats = src.map(f => ({type: 'Feature', properties: {},
        geometry: {type: 'LineString', coordinates: f.getGeometry().getCoordinates().map(mapgeo.toLonLat)}}));
    const s = this.map.getSource('tar-outline');
    s && s.setData({type: 'FeatureCollection', features: feats});
};

MLR.setCalcOutline = function (data) {
    const feats = [];
    for (const ring of data.rings) {
        const pts = ring.points;
        if (!pts.length) continue;
        const altitude = (3.28084 * ring.alt).toFixed(0);
        let color = range_outline_color;
        if (range_outline_colored_by_altitude) {
            const c = altitudeColor(altitude);
            color = 'hsla(' + c[0].toFixed(0) + ',' + c[1].toFixed(0) + '%,' + c[2].toFixed(0) + '%,' + range_outline_alpha + ')';
        }
        const coords = pts.map(pt => [pt[1], pt[0]]);
        coords.push(coords[0]);
        feats.push({type: 'Feature', geometry: {type: 'LineString', coordinates: coords}, properties: {color}});
    }
    this.userData.calc = feats;
    this.touch('calc');
};
MLR.flushCalc = function () {
    const s = this.map.getSource('tar-calc');
    s && s.setData({type: 'FeatureCollection', features: this.userData.calc || []});
};

// ------------------------------------------------------------------------------------------
// interaction
// ------------------------------------------------------------------------------------------
MLR.onClick = function (e, dbl) {
    const px = [e.point.x, e.point.y];
    const radius = globalScale * (onMobile ? 30 : 20);
    const plane = this.closestPlane(px, radius);
    let planeHex = plane ? plane.icao : null;
    let trailHex = null, trailTS = null;
    if (!planeHex || showTrace) {
        const hit = this.closestTrail(px, showTrace ? 10000 : radius);
        if (hit) {
            if (showTrace) trailTS = hit.ts; else trailHex = hit.hex;
        }
    }
    if (dbl && planeHex && !showTrace) e.preventDefault();   // double click on an aircraft selects and follows it; no zoom
    if (!planeHex && !trailHex && !showTrace && typeof AIRPT != 'undefined' && AIRPT.mapClick(e)) return;   // airport pin or airport area
    mapClickResult(planeHex, trailHex, trailTS, dbl);
};

// ------------------------------------------------------------------------------------------
// view API (the `mapa` object declared in ui/map-adapter.js)
// ------------------------------------------------------------------------------------------
function mlWrapLon(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }

Object.assign(mapa, {
    renderer: 'maplibre',
    ready() { return !!MLR.map; },
    getCenter() { const c = MLR.map.getCenter(); return [mlWrapLon(c.lng), c.lat]; },
    getCenterProj() { return mapgeo.fromLonLat(this.getCenter()); },
    // OpenLayers fires no events when the view is set to what it already is; MapLibre's jumpTo always
    // fires moveend, which would re-enter checkMovement (follow, refresh). So no-op moves are skipped.
    setCenter(lonlat) {
        const c = MLR.map.getCenter();
        if (Math.abs(c.lng - lonlat[0]) < 1e-9 && Math.abs(c.lat - lonlat[1]) < 1e-9) return;
        MLR.map.jumpTo({center: lonlat});
    },
    setCenterProj(proj) { this.setCenter(mapgeo.toLonLat(proj)); },
    getZoom() { return MLR.map.getZoom() + 1; },
    setZoom(z) {
        if (Math.abs(MLR.map.getZoom() - (z - 1)) < 1e-9) return;
        MLR.map.jumpTo({zoom: z - 1});
    },
    setRotation(rad) {
        const b = -rad * 180 / Math.PI;
        if (Math.abs(MLR.map.getBearing() - b) < 1e-9) return;
        MLR.map.jumpTo({bearing: b});
    },
    getSize() { const c = MLR.map.getContainer(); return [c.clientWidth, c.clientHeight]; },
    calcExtent(size) {
        const m = MLR.map, c = m.getContainer();
        const w = c.clientWidth || 1, h = c.clientHeight || 1;
        const sw = size ? size[0] : w, sh = size ? size[1] : h;
        const x0 = (w - sw) / 2, y0 = (h - sh) / 2;
        const xs = [], ys = [];
        const globe = MLR.isGlobe();
        const WORLD = [-mapgeo.HALF - 2, -mapgeo.HALF, mapgeo.HALF + 2, mapgeo.HALF];
        // on the globe the window can include space beyond the horizon: sample a grid and, if any point
        // misses the sphere, treat the whole world as in view (the window is then zoomed far out anyway)
        const pts = [];
        if (globe) { for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push([x0 + sw * i / 4, y0 + sh * j / 4]); }
        else pts.push([x0, y0], [x0 + sw, y0], [x0 + sw, y0 + sh], [x0, y0 + sh]);
        for (const [x, y] of pts) {
            const ll = m.unproject([x, y]);
            if (globe) {
                const back = m.project(ll);
                if (!isFinite(ll.lng) || !isFinite(ll.lat) || Math.abs(back.x - x) > 2 || Math.abs(back.y - y) > 2) return WORLD;
            }
            const p = mapgeo.fromLonLat([ll.lng, ll.lat]);
            xs.push(p[0]); ys.push(p[1]);
        }
        if (globe && Math.max(...xs) - Math.min(...xs) > mapgeo.HALF * 1.2) return WORLD;   // crosses the antimeridian or very wide
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    },
    pixelFromProj(proj) { const q = MLR.map.project(mapgeo.toLonLat(proj)); return [q.x, q.y]; },
    isBusy() { return MLR.map.isMoving(); },
    updateSize() { MLR.map && MLR.map.resize(); },
    render() { MLR.map && (MLR.applyDim(), MLR.map.triggerRepaint()); },
    setScaleUnits() {},
    panEdge(dir) {
        const m = MLR.map, c = m.getCenter(), b = m.getBounds();
        const n = dir == 'up' ? [c.lng, (c.lat + b.getNorth()) / 2]
            : dir == 'down' ? [c.lng, (c.lat + b.getSouth()) / 2]
            : dir == 'left' ? [(c.lng + b.getWest()) / 2, c.lat]
            : [(c.lng + b.getEast()) / 2, c.lat];
        m.jumpTo({center: n});
    },
    resetNorth() { MLR.resetNorth(); },
    pointerMove(on) {
        const m = MLR.map;
        if (MLR.pointerFn) { m.off('mousemove', MLR.pointerFn); MLR.pointerFn = null; }
        if (on) {
            MLR.pointerFn = (e) => highlightPlane(MLR.closestPlane([e.point.x, e.point.y], globalScale * 20));
            m.on('mousemove', MLR.pointerFn);
        }
    },
    forEachLayer(fn) { if (typeof layers != 'undefined' && layers) for (const l of layers.getArray()) fn(l); },
});

function mlMapInit() { MLR.init(); }

// Without a map (no WebGL) the view calls return sensible values instead of throwing.
(function () {
    const fallback = {
        ready: () => false,
        getCenter: () => [CenterLon, CenterLat],
        getCenterProj: () => mapgeo.fromLonLat([CenterLon, CenterLat]),
        getZoom: () => g.zoomLvl,
        getSize: () => [window.innerWidth, window.innerHeight],
        calcExtent: () => { const c = mapgeo.fromLonLat([CenterLon, CenterLat]); return [c[0] - 1e6, c[1] - 1e6, c[0] + 1e6, c[1] + 1e6]; },
        pixelFromProj: () => [0, 0],
        isBusy: () => false,
    };
    for (const k of Object.keys(mapa)) {
        const f = mapa[k];
        if (typeof f !== 'function') continue;
        mapa[k] = function (...a) {
            if (MLR.map) return f.apply(mapa, a);
            return fallback[k] ? fallback[k]() : undefined;
        };
    }
})();
