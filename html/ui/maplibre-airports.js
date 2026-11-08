"use strict";
// Skywatch ADS-B: airport detail at high zoom.
//
// Data: the OpenMapTiles "aeroway" and "aerodrome_label" layers served by OpenFreeMap (keyless, OpenStreetMap
// data, ODbL). Of the three base-map providers only OpenFreeMap carries apron polygons, lettered taxiways, runway
// polygons with numbers and gate refs, so this one source is overlaid on every base map (the default CARTO/Protomaps
// style has only runway/taxiway lines and runway polygons, VersaTiles has no refs at all).
//
// Everything is only requested and drawn at high zoom (MapLibre zoom 13 and up; the airport chip from zoom 8), so
// world and country views are not affected. The layers sit under the aircraft layers, so planes always draw on top.

const AIRPORT = {
    tiles: 'https://tiles.openfreemap.org/planet',
    // Progressive reveal (MapLibre zoom). Each stage starts at its zoom and fades in over one zoom level (opacity
    // interpolation, no popping); the layers' minzoom is the start of the fade.
    runwayDbZoom: 9.3,      // runway shapes from the OurAirports data (large and medium airports)
    runwayDbSmallZoom: 11,  // ... and small airfields
    runwayZoom: 10.5,       // OpenFreeMap runway and taxiway lines
    detailZoom: 11,         // aprons, then runway polygons from 11.5
    numberZoom: 12.5,       // runway numbers
    gateZoom: 13,           // stand / gate refs
    buildingZoom: 13,       // building outlines (OpenFreeMap has no building data below zoom 13)
    taxiRefZoom: 13.5,      // taxiway letters
    fxZoom: 13,             // decorative lighting
    chipZoom: 8,            // airport chip with flag and name
    color: {
        apron: '#8f8c88',
        apronOpacity: 0.85,
        apronLine: '#a9a6a1',
        building: '#000000',
        runway: '#08080a',
        runwayLine: '#9a9aa2',
        taxi: '#4a4a52',
        taxiCase: '#0a0a0c',
        taxiLabel: '#d9c77a',
        number: '#f2f2f2',
        gateText: '#1b1306',
        gateFill: '#e0a22f',
        gateLine: '#f3c25e',
    },
};

// ICAO prefix to ISO country (for the flag in the airport chip). Two letters first, then the first letter.
const AIRPORT_PREFIX = {
    EG: 'GB', EI: 'IE', EH: 'NL', EB: 'BE', EL: 'LU', LF: 'FR', ED: 'DE', ET: 'DE', EK: 'DK', EN: 'NO', ES: 'SE', EF: 'FI',
    EE: 'EE', EV: 'LV', EY: 'LT', EP: 'PL', LK: 'CZ', LZ: 'SK', LO: 'AT', LS: 'CH', LI: 'IT', LE: 'ES', LP: 'PT', LG: 'GR',
    LT: 'TR', LH: 'HU', LR: 'RO', LB: 'BG', LY: 'RS', LD: 'HR', LJ: 'SI', LQ: 'BA', LW: 'MK', LA: 'AL', LM: 'MT', LC: 'CY',
    LL: 'IL', BI: 'IS', BG: 'GL', OJ: 'JO', OL: 'LB', OE: 'SA', OM: 'AE', OT: 'QA', OB: 'BH', OK: 'KW', OO: 'OM', OI: 'IR',
    OP: 'PK', OA: 'AF', VI: 'IN', VA: 'IN', VO: 'IN', VE: 'IN', VT: 'TH', VV: 'VN', VH: 'HK', VM: 'MO', WS: 'SG', WM: 'MY',
    WI: 'ID', WA: 'ID', RJ: 'JP', RO: 'JP', RK: 'KR', RC: 'TW', RP: 'PH', ZK: 'KP', ZM: 'MN', UK: 'UA', UM: 'BY', UA: 'KZ',
    UT: 'UZ', UD: 'AM', UG: 'GE', UB: 'AZ', FA: 'ZA', HE: 'EG', HK: 'KE', HA: 'ET', DT: 'TN', DA: 'DZ', GM: 'MA', DN: 'NG',
    SB: 'BR', SC: 'CL', SA: 'AR', SK: 'CO', SP: 'PE', SE: 'EC', SV: 'VE', SU: 'UY', MM: 'MX', MP: 'PA', MK: 'JM', MY: 'BS',
    MU: 'CU', NZ: 'NZ', NF: 'FJ', PH: 'US', PA: 'US', PG: 'US', CY: 'CA', CZ: 'CA',
};
const AIRPORT_LETTER = {K: 'US', C: 'CA', Y: 'AU', U: 'RU', Z: 'CN', P: 'US'};

function airportFlagExpr(prefix) {
    prefix = prefix || 'flag-';
    const m = ['match', ['slice', ['coalesce', ['get', 'icao'], 'XX'], 0, 2]];
    for (const k in AIRPORT_PREFIX) m.push(k, prefix + AIRPORT_PREFIX[k]);
    m.push(['match', ['slice', ['coalesce', ['get', 'icao'], 'XX'], 0, 1],
        ...Object.entries(AIRPORT_LETTER).flatMap(([k, v]) => [k, prefix + v]), prefix + 'XX']);
    return m;
}

// small rounded rectangle used behind stand refs and the airport chip (9-slice, stretched by icon-text-fit)
function airportChipImage(fill, line) {
    const s = 32, c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.beginPath();
    x.roundRect ? x.roundRect(1.5, 1.5, s - 3, s - 3, 11) : x.rect(1.5, 1.5, s - 3, s - 3);
    x.fillStyle = fill; x.fill();
    x.lineWidth = 2; x.strokeStyle = line; x.stroke();
    return x.getImageData(0, 0, s, s);
}

// stand chip: amber rounded rectangle with a soft drop shadow baked in (9-slice; the content box excludes the shadow)
function airportGateImage(fill, line) {
    const s = 48, c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 7; x.shadowOffsetY = 2;
    x.beginPath();
    x.roundRect ? x.roundRect(8, 8, s - 16, s - 16, 12) : x.rect(8, 8, s - 16, s - 16);
    x.fillStyle = fill; x.fill();
    x.shadowColor = 'transparent';
    x.lineWidth = 2; x.strokeStyle = line; x.stroke();
    return x.getImageData(0, 0, s, s);
}

MLR.installAirports = function () {
    const m = this.map, C = AIRPORT.color;
    if (!m || m.getSource('tar-airport')) return;
    if (typeof airportDetail != 'undefined' && !airportDetail) return;     // switched off: no OpenFreeMap airport tile requests
    const kind = typeof ML_CUR_KIND !== 'undefined' && ML_CUR_KIND ? ML_CUR_KIND : 'ofm';
    const font = ML_FONT;
    const Z = AIRPORT.detailZoom, gs = globalScale || 1;
    const src = 'tar-airport';
    m.addSource(src, {type: 'vector', url: AIRPORT.tiles, minzoom: 0, maxzoom: 14});
    m.addSource('tar-rwy-nums', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});

    if (!m.hasImage('tar-chip-gate')) m.addImage('tar-chip-gate', airportGateImage(C.gateFill, C.gateLine), {pixelRatio: 2, stretchX: [[20, 28]], stretchY: [[20, 28]], content: [8, 8, 40, 40]});

    const polyFilter = (cls) => ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], cls]];
    const L = (l) => m.addLayer(Object.assign({source: src, 'source-layer': 'aeroway', minzoom: Z}, l));
    const ramp = (z0, v, len) => ['interpolate', ['linear'], ['zoom'], z0, 0, z0 + (len || 1), v];       // fade in over one zoom level
    const RZ = AIRPORT.runwayZoom;
    // apron and helipad: lighter than the land
    L({id: 'tar-ap-apron', type: 'fill', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'class'], ['literal', ['apron', 'helipad']]]],
        paint: {'fill-color': C.apron, 'fill-opacity': ramp(Z, C.apronOpacity * 0.5), 'fill-outline-color': C.apronLine}});
    // aprons that contain or lie within 100 m of a stand: full brightness (computed in updateRunwayNumbers)
    m.addSource('tar-apron-main', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    m.addLayer({id: 'tar-ap-apron-main', type: 'fill', source: 'tar-apron-main', minzoom: Z,
        paint: {'fill-color': C.apron, 'fill-opacity': ramp(Z, C.apronOpacity), 'fill-outline-color': C.apronLine}});
    // buildings: pure black polygons above the apron (the base map's own buildings sit under the apron)
    m.addLayer({id: 'tar-ap-building', type: 'fill', source: src, 'source-layer': 'building', minzoom: AIRPORT.buildingZoom,
        paint: {'fill-color': C.building, 'fill-opacity': ramp(AIRPORT.buildingZoom, 1), 'fill-outline-color': '#1c1c1e'}});
    // runway body: dark fill with a light outline
    L({id: 'tar-ap-runway', type: 'fill', minzoom: Z + 0.5, filter: polyFilter('runway'), paint: {'fill-color': C.runway, 'fill-opacity': ramp(Z + 0.5, 1)}});
    L({id: 'tar-ap-runway-line', type: 'line', minzoom: Z + 0.5, filter: polyFilter('runway'),
        paint: {'line-color': C.runwayLine, 'line-width': ['interpolate', ['linear'], ['zoom'], 11.5, 0.4, 13, 0.6, 17, 1.6], 'line-opacity': ramp(Z + 0.5, 0.9)}});
    // runways that only exist as a centre line
    L({id: 'tar-ap-runway-cl', type: 'line', minzoom: RZ, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']],
        paint: {'line-color': C.runway, 'line-opacity': ramp(RZ, 1), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10.5, 1.6, 12, 2.4, 13, 4, 17, 50],
            'line-gap-width': 0}, layout: {'line-cap': 'butt'}});
    // taxiways: outline plus stroke
    const taxi = ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']];
    L({id: 'tar-ap-taxi-case', type: 'line', minzoom: RZ + 0.5, filter: taxi, layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': C.taxiCase, 'line-opacity': ramp(RZ + 0.5, 1), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 0.9, 13, 2.2, 17, 20]}});
    L({id: 'tar-ap-taxi', type: 'line', minzoom: RZ + 0.5, filter: taxi, layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': C.taxi, 'line-opacity': ramp(RZ + 0.5, 1), 'line-width': ['interpolate', ['exponential', 2], ['zoom'], 11, 0.5, 13, 1.2, 17, 13]}});
    // Runway shapes from the OurAirports data (html/airport-db/airports.json): drawn from zoom 9.5 so a medium airport is
    // recognisable long before the vector tiles carry any runway geometry. Large and medium airports first, small
    // airfields from zoom 11. They fade out again (12.5 to 13.3) as the OpenFreeMap runway polygons take over.
    m.addSource('tar-rwy-db', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    const dbOp = (z0, v) => ['interpolate', ['linear'], ['zoom'], z0, 0, z0 + 1, v, 12.5, v, 13.3, 0];
    const dbW = (extra) => ['interpolate', ['linear'], ['zoom'], 9.5, 1.6 + extra, 11, 2.6 + extra, 12, 4.2 + extra, 13, 8 + extra];
    for (const [tag, z0, sm] of [['L', AIRPORT.runwayDbZoom, 0], ['S', AIRPORT.runwayDbSmallZoom, 1]]) {
        const f = ['==', ['get', 's'], sm];
        m.addLayer({id: 'tar-ap-rwydb-case-' + tag, type: 'line', source: 'tar-rwy-db', minzoom: z0, filter: f, layout: {'line-cap': 'butt'},
            paint: {'line-color': '#b4b4bc', 'line-opacity': dbOp(z0, 0.8), 'line-width': dbW(1.4)}}, 'tar-ap-apron');
        m.addLayer({id: 'tar-ap-rwydb-' + tag, type: 'line', source: 'tar-rwy-db', minzoom: z0, filter: f, layout: {'line-cap': 'butt'},
            paint: {'line-color': C.runway, 'line-opacity': dbOp(z0, 1), 'line-width': dbW(0)}}, 'tar-ap-apron');
    }
    if (!this._dbHook) {
        this._dbHook = true;
        const upd = () => MLR.updateDbRunways();
        m.on('moveend', upd);
        m.on('styledata', () => { if (!m.getSource('tar-rwy-db')) this._dbHook = false; });
    }
    this.updateDbRunways();
    // ---- DECORATIVE EFFECTS (illustrative only) ----
    // Everything below is cosmetic. It is generated from the runway and taxiway geometry, there is no lighting
    // or status data behind it: it is NOT live airport status and must not be used for navigation. Each layer is a
    // plain GPU line layer (round caps + dasharray make the dots), only drawn from zoom fxZoom, fading in over one
    // zoom level, and the whole group can be switched off in Settings ("Airport detail effects").
    const fade = (v) => ['interpolate', ['linear'], ['zoom'], AIRPORT.fxZoom, 0, AIRPORT.fxZoom + 1, v];
    const FX = AIRPORT.fxLayers = [];
    const fxLine = (id, source, sl, filter, paint, layout) => {
        const lay = {id, type: 'line', source, minzoom: AIRPORT.fxZoom, filter, paint, layout: Object.assign({'line-cap': 'round', 'line-join': 'round'}, layout || {})};
        if (sl) lay['source-layer'] = sl;
        m.addLayer(lay); FX.push(id);
    };
    const taxiLine = ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']];
    const half = (sign) => ['interpolate', ['exponential', 2], ['zoom'], 13, sign * 1.0, 17, sign * 7.5];       // about half the drawn taxiway width, each side
    // decorative: runway edge lights, a dotted white line along the runway outline
    fxLine('tar-fx-rwy-edge', src, 'aeroway', polyFilter('runway'),
        {'line-color': '#ffffff', 'line-opacity': fade(0.7), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.8, 17, 3.2], 'line-dasharray': [0, 5]});
    // decorative: taxiway centreline lights, green dots
    fxLine('tar-fx-taxi-cl', src, 'aeroway', taxiLine,
        {'line-color': '#63ff8f', 'line-opacity': fade(1), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.2, 17, 3.6], 'line-dasharray': [0, 8]});
    // decorative: taxiway edge lights, blue dots on an offset line either side
    for (const [id, sign] of [['tar-fx-taxi-edge-l', -1], ['tar-fx-taxi-edge-r', 1]])
        fxLine(id, src, 'aeroway', taxiLine,
            {'line-color': '#7db2ff', 'line-opacity': fade(1), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 3.2],
                'line-dasharray': [0, 9], 'line-offset': half(sign)});
    // decorative: runway centreline (white dashes), threshold stripes (white) and hold-short bars (red), from tar-rwy-marks
    m.addSource('tar-rwy-marks', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    fxLine('tar-fx-rwy-cl', 'tar-rwy-marks', null, ['==', ['get', 'k'], 'cl'],
        {'line-color': '#ffffff', 'line-opacity': fade(0.75), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 17, 2.4], 'line-dasharray': [5, 5]}, {'line-cap': 'butt'});
    fxLine('tar-fx-rwy-bars', 'tar-rwy-marks', null, ['==', ['get', 'k'], 'bar'],
        {'line-color': '#ffffff', 'line-opacity': fade(0.85), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 17, 3.2]}, {'line-cap': 'butt'});
    fxLine('tar-fx-hold', 'tar-rwy-marks', null, ['==', ['get', 'k'], 'hold'],
        {'line-color': '#ff4a4a', 'line-opacity': fade(0.95), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.6, 17, 3.6]}, {'line-cap': 'butt'});
    // taxiway letters along the line
    L({id: 'tar-ap-taxi-ref', type: 'symbol', minzoom: AIRPORT.taxiRefZoom,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway'], ['has', 'ref']],
        layout: {'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['case', ['==', ['slice', ['get', 'ref'], 0, 8], 'Taxiway '], ['slice', ['get', 'ref'], 8], ['get', 'ref']], 'text-font': font,
            'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 17], 'text-keep-upright': true, 'text-max-angle': 40,
            'text-padding': 4},
        paint: {'text-color': C.taxiLabel, 'text-halo-color': C.taxiCase, 'text-halo-width': 2, 'text-opacity': ramp(AIRPORT.taxiRefZoom, 1)}});
    // helipad "H"
    L({id: 'tar-ap-helipad', type: 'symbol', minzoom: 15, filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'helipad']],
        layout: {'text-field': 'H', 'text-font': font, 'text-size': 14}, paint: {'text-color': C.number}});
    // stand / gate refs: small rounded chips
    L({id: 'tar-ap-gate', type: 'symbol', minzoom: AIRPORT.gateZoom,
        filter: ['all', ['==', ['geometry-type'], 'Point'], ['==', ['get', 'class'], 'gate'], ['has', 'ref']],
        layout: {'text-field': ['get', 'ref'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9.5, 14, 14.4, 18, 20.8],   // stand chips 1.6x
            'icon-image': 'tar-chip-gate', 'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 7, 2, 7],
            'text-padding': 2, 'text-optional': false},
        paint: {'text-color': C.gateText, 'text-opacity': ramp(AIRPORT.gateZoom, 1), 'icon-opacity': ramp(AIRPORT.gateZoom, 1)}});
    // runway numbers (generated from the runway geometry, see below)
    m.addLayer({id: 'tar-ap-rwy-num', type: 'symbol', source: 'tar-rwy-nums', minzoom: AIRPORT.numberZoom,
        layout: {'text-field': ['get', 'n'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 8.5, 13.5, 11, 18, 34],
            'text-rotate': ['get', 'rot'], 'text-rotation-alignment': 'map', 'text-pitch-alignment': 'map',
            'text-allow-overlap': true, 'text-ignore-placement': true, 'text-letter-spacing': 0.06},
        paint: {'text-color': C.number, 'text-opacity': ramp(AIRPORT.numberZoom, 0.92)}});
    // airport pin: a round flag with the code (medium zoom) and the airport name below (higher zoom).
    // Only airports that have an IATA or ICAO code in the data are shown.
    const code = ['coalesce', ['get', 'iata'], ['get', 'icao']];
    const pin = (id, minz, maxz, withName) => m.addLayer({id, type: 'symbol', source: src, 'source-layer': 'aerodrome_label', minzoom: minz, maxzoom: maxz,
        filter: ['all', ['any', ['has', 'iata'], ['has', 'icao']], ['in', ['get', 'class'], ['literal', ['international', 'public', 'regional', 'military']]]],
        layout: {
            'icon-image': airportFlagExpr('flagc-'), 'icon-size': 1, 'icon-allow-overlap': false,
            'text-field': withName
                ? ['format', code, {'font-scale': 0.95}, '\n', {}, ['coalesce', ['get', 'name:latin'], ['get', 'name']], {'font-scale': 0.85, 'text-color': '#a8a8ae'}]
                : code,
            'text-font': font, 'text-size': 11 * gs, 'text-anchor': 'top', 'text-offset': [0, 1.0], 'text-optional': true, 'text-max-width': 12,
            'symbol-sort-key': ['match', ['get', 'class'], 'international', 0, 'public', 1, 'regional', 2, 3],
            'icon-padding': 6, 'text-padding': 3},
        paint: {'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4}});
    pin('tar-ap-pin', AIRPORT.chipZoom, 10, false);
    pin('tar-ap-pin-name', 10, 15.5, true);

    // flag images are created on demand from the bundled SVGs: flag-XX (rectangle) and flagc-XX (round pin)
    if (!this._flagHook) {
        this._flagHook = true;
        m.on('styleimagemissing', (e) => {
            const id = e.id, mm = /^(flagc?)-([A-Z]{2})$/.exec(id);
            if (!mm || m.hasImage(id)) return;
            const round = mm[1] === 'flagc';
            const blank = {width: 1, height: 1, data: new Uint8Array(4)};
            m.addImage(id, blank);
            const img = new Image();
            const draw = (withFlag) => {
                const W = round ? 48 : 30, H = round ? 48 : 20, c = document.createElement('canvas'); c.width = W; c.height = H;
                const x = c.getContext('2d');
                x.save(); x.beginPath();
                if (round) x.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); else x.roundRect ? x.roundRect(0, 0, W, H, 3) : x.rect(0, 0, W, H);
                x.fillStyle = '#26262b'; x.fill(); x.clip();
                if (withFlag) { const r = img.width / img.height, h = round ? H : H, w = h * r; x.drawImage(img, (W - w) / 2, 0, w, h); }
                x.restore();
                if (round) { x.beginPath(); x.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,0.85)'; x.stroke(); }
                try { m.removeImage(id); m.addImage(id, x.getImageData(0, 0, W, H), {pixelRatio: 2}); } catch (er) {}
            };
            if (mm[2] === 'XX') { if (round) draw(false); return; }
            img.onload = () => draw(true);
            img.onerror = () => { if (round) draw(false); };
            img.src = 'flags/3x2/' + mm[2] + '.svg';
        });
    }
    this.applyAirportFx();
    this.scheduleRunwayNumbers();
};

// ----- runway numbers -----
// The tiles carry one ref per runway ("07/25"). Collect each runway's geometry, find its two ends and write
// each number at its own end, rotated to the landing heading.
MLR.scheduleRunwayNumbers = function () {
    if (this._rwyHooked) return;
    this._rwyHooked = true;
    const m = this.map;
    let t = null;
    const kick = () => { clearTimeout(t); t = setTimeout(() => MLR.updateRunwayNumbers(), 250); };
    m.on('moveend', kick);
    m.on('sourcedata', (e) => { if (e.sourceId === 'tar-airport' && e.isSourceLoaded) kick(); });
    m.on('styledata', () => { if (!m.getSource('tar-rwy-nums')) this._rwyHooked = false; });
};

MLR.updateRunwayNumbers = function () {
    const m = this.map;
    const nums = m && m.getSource('tar-rwy-nums');
    if (!nums || !m.getSource('tar-airport')) return;
    if (m.getZoom() < AIRPORT.detailZoom - 0.2) { if (this._rwyHad) { nums.setData({type: 'FeatureCollection', features: []}); this._rwyHad = false; } return; }
    let feats = [];
    const marks = m.getSource('tar-rwy-marks'), axes = [];
    try { feats = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['all', ['==', ['get', 'class'], 'runway'], ['has', 'ref']]}); } catch (e) { return; }
    // group points by ref and place (the same ref exists at many airports)
    const groups = [];
    const addPts = (ref, pts) => {
        let g = groups.find(q => q.ref === ref && Math.abs(q.lon - pts[0][0]) < 0.05 && Math.abs(q.lat - pts[0][1]) < 0.05);
        if (!g) { g = {ref, lon: pts[0][0], lat: pts[0][1], pts: []}; groups.push(g); }
        for (const p of pts) g.pts.push(p);
    };
    const flat = (c, out) => { if (typeof c[0] === 'number') out.push(c); else for (const x of c) flat(x, out); return out; };
    for (const f of feats) addPts(f.properties.ref, flat(f.geometry.coordinates, []));
    const out = [];
    for (const g of groups) {
        const parts = String(g.ref).split('/').map(s => s.trim()).filter(Boolean);
        if (!parts.length || g.pts.length < 2) continue;
        const k = Math.cos(g.lat * Math.PI / 180), mx = (p) => (p[0] - g.lon) * 111320 * k, my = (p) => (p[1] - g.lat) * 110540;
        // principal axis of the points (a runway is long and thin)
        let cx = 0, cy = 0;
        for (const p of g.pts) { cx += mx(p); cy += my(p); }
        cx /= g.pts.length; cy /= g.pts.length;
        let sxx = 0, syy = 0, sxy = 0;
        for (const p of g.pts) { const x = mx(p) - cx, y = my(p) - cy; sxx += x * x; syy += y * y; sxy += x * y; }
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
        let lo = Infinity, hi = -Infinity;
        for (const p of g.pts) { const s = (mx(p) - cx) * ux + (my(p) - cy) * uy; if (s < lo) lo = s; if (s > hi) hi = s; }
        const len = hi - lo;
        if (len < 300) continue;
        let hw = 0;
        for (const p of g.pts) { const d = Math.abs(-(mx(p) - cx) * uy + (my(p) - cy) * ux); if (d > hw) hw = d; }
        axes.push({g, k, cx, cy, ux, uy, lo, hi, hw: Math.min(Math.max(hw, 15), 40)});
        const inset = 90 + len * 0.02;
        const brg = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;   // bearing of an (east, north) vector
        const ends = [[lo, 1], [hi, -1]];   // [position along the axis, direction toward the other end]
        for (const [s, dir] of ends) {
            const b = brg(ux * dir, uy * dir);   // landing heading when arriving at this end
            // pick the number whose heading is closest to b
            let best = parts[0], bd = 999;
            for (const n of parts) {
                const v = parseInt(n, 10) * 10;
                if (isNaN(v)) continue;
                const d = Math.abs(((v - b + 540) % 360) - 180);
                if (d < bd) { bd = d; best = n; }
            }
            if (parts.length === 1) best = parts[0];
            const ps = s + dir * inset;
            const x = cx + ux * ps - ux * 0, y = cy + uy * ps;
            out.push({type: 'Feature', properties: {n: best, rot: Math.round(b)},
                geometry: {type: 'Point', coordinates: [g.lon + x / (111320 * k), g.lat + y / 110540]}});
        }
    }
    this._rwyHad = out.length > 0;
    nums.setData({type: 'FeatureCollection', features: out});
    MLR.updateMainAprons();
    if (marks) marks.setData({type: 'FeatureCollection', features: AIRPORT.fx !== false && m.getZoom() >= AIRPORT.fxZoom - 0.2 ? MLR.runwayMarks(axes) : []});
};

// Aprons with a stand on or within 100 m get full brightness, the other aprons (cargo / hangar ramps) stay at half.
MLR.updateMainAprons = function () {
    const m = this.map, src = m.getSource('tar-apron-main');
    if (!src) return;
    let gates = [], aprons = [];
    try {
        gates = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['==', ['get', 'class'], 'gate']}).filter(f => f.geometry.type === 'Point');
        aprons = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['==', ['get', 'class'], 'apron']});
    } catch (e) { return; }
    const out = [];
    if (gates.length && aprons.length && aprons.length < 600) {
        const pts = gates.map(f => f.geometry.coordinates);
        for (const f of aprons) {
            const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
            let near = false;
            for (const poly of polys) {
                const ring = poly[0];
                for (const q of pts) {
                    const k = Math.cos(q[1] * Math.PI / 180);
                    // inside?
                    let inside = false;
                    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
                        if ((ring[i][1] > q[1]) !== (ring[j][1] > q[1]) && q[0] < (ring[j][0] - ring[i][0]) * (q[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
                    if (!inside) {   // distance to the edges
                        for (let i = 1; i < ring.length && !inside; i++) {
                            const ax = (ring[i - 1][0] - q[0]) * 111320 * k, ay = (ring[i - 1][1] - q[1]) * 110540, bx = (ring[i][0] - q[0]) * 111320 * k, by = (ring[i][1] - q[1]) * 110540;
                            const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
                            const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
                            if (Math.hypot(ax + dx * t, ay + dy * t) <= 100) inside = true;
                        }
                    }
                    if (inside) { near = true; break; }
                }
                if (near) break;
            }
            if (near) out.push({type: 'Feature', properties: {}, geometry: f.geometry});
        }
    }
    const key = out.length + ':' + gates.length + ':' + aprons.length;
    if (key !== this._mainApronKey) { this._mainApronKey = key; src.setData({type: 'FeatureCollection', features: out}); }
};

// DECORATIVE: runway centreline, threshold stripes and hold-short bars, derived from the runway axis and the
// taxiway geometry in the loaded tiles (illustrative only, not airport data).
MLR.runwayMarks = function (axes) {
    const m = this.map, out = [];
    if (!axes.length) return out;
    const line = (a, coords, k) => out.push({type: 'Feature', properties: {k}, geometry: {type: 'LineString', coordinates: coords.map(([x, y]) => [a.g.lon + x / (111320 * a.k), a.g.lat + y / 110540])}});
    for (const a of axes) {
        const ux = a.ux, uy = a.uy, vx = -uy, vy = ux;
        const at = (s, d) => [a.cx + ux * s + vx * d, a.cy + uy * s + vy * d];
        line(a, [at(a.lo + 120, 0), at(a.hi - 120, 0)], 'cl');
        const step = (2 * a.hw * 0.8) / 7;
        for (const [s0, dir] of [[a.lo + 14, 1], [a.hi - 14, -1]])
            for (let j = -3.5; j <= 3.5; j += 1) line(a, [at(s0, j * step), at(s0 + dir * 32, j * step)], 'bar');
    }
    // hold-short bars: where a taxiway crosses the line a little outside the runway edge
    let tw = [];
    try { tw = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['all', ['==', ['get', 'class'], 'taxiway']]}); } catch (e) { return out; }
    const seen = [];
    const lines = (c, acc) => { if (typeof c[0][0] === 'number') acc.push(c); else for (const x of c) lines(x, acc); return acc; };
    for (const f of tw) {
        for (const ln of lines(f.geometry.coordinates, [])) {
            for (const a of axes) {
                const H = a.hw + 22, ux = a.ux, uy = a.uy;
                const loc = (p) => { const x = (p[0] - a.g.lon) * 111320 * a.k - a.cx, y = (p[1] - a.g.lat) * 110540 - a.cy; return [x * ux + y * uy, -x * uy + y * ux, x, y]; };
                let prev = loc(ln[0]);
                if (Math.abs(prev[0]) > 4000) continue;
                for (let i = 1; i < ln.length; i++) {
                    const cur = loc(ln[i]);
                    for (const t of [H, -H]) {
                        if ((prev[1] - t) * (cur[1] - t) < 0 && Math.abs(prev[1] - cur[1]) > 1e-6) {
                            const f2 = (t - prev[1]) / (cur[1] - prev[1]);
                            const s = prev[0] + (cur[0] - prev[0]) * f2;
                            if (s < a.lo - 15 || s > a.hi + 15) continue;
                            const px = prev[2] + (cur[2] - prev[2]) * f2, py = prev[3] + (cur[3] - prev[3]) * f2;
                            if (seen.some(q => Math.hypot(q[0] - px, q[1] - py) < 12)) continue;
                            seen.push([px, py]);
                            const dx = cur[2] - prev[2], dy = cur[3] - prev[3], dl = Math.hypot(dx, dy) || 1;
                            const nx = -dy / dl * 9, ny = dx / dl * 9;   // bar across the taxiway, 18 m long
                            line(a, [[a.cx + px - nx + 0, a.cy + py - ny + 0], [a.cx + px + nx, a.cy + py + ny]], 'hold');
                        }
                    }
                    prev = cur;
                }
            }
        }
    }
    return out;
};

// decorative effects on or off (Settings > "Airport detail effects")
// feed the runway-shape source with the airports in view (OurAirports data, loaded lazily on first need)
MLR.updateDbRunways = function () {
    const m = this.map, src = m && m.getSource('tar-rwy-db');
    if (!src) return;
    const z = m.getZoom();
    if (z < AIRPORT.runwayDbZoom - 0.3 || typeof AIRPT == 'undefined') {
        if (this._dbHad) { src.setData({type: 'FeatureCollection', features: []}); this._dbHad = false; }
        return;
    }
    const st = AIRPT.state;
    if (!st.db) { AIRPT.load().then(() => MLR.updateDbRunways()); return; }
    const b = m.getBounds(), pad = 0.15;
    const w = b.getWest() - pad, e = b.getEast() + pad, so = b.getSouth() - pad, n = b.getNorth() + pad;
    const small = z >= AIRPORT.runwayDbSmallZoom - 0.3;
    const feats = [];
    for (const r of st.db.a) {
        const lat = r[4], lon = r[5];
        if (lat < so || lat > n || lon < w || lon > e) continue;
        if (r[2] > 1 && !small) continue;
        for (const rw of r[11]) {
            if (rw.length < 12 || rw[8] == null || rw[9] == null || rw[10] == null || rw[11] == null) continue;
            feats.push({type: 'Feature', properties: {s: r[2] > 1 ? 1 : 0},
                geometry: {type: 'LineString', coordinates: [[rw[9] / 1e4, rw[8] / 1e4], [rw[11] / 1e4, rw[10] / 1e4]]}});
        }
        if (feats.length > 2500) break;
    }
    src.setData({type: 'FeatureCollection', features: feats});
    this._dbHad = true;
};

MLR.applyAirportFx = function () {
    const m = this.map;
    if (!m || !AIRPORT.fxLayers) return;
    const on = AIRPORT.fx !== false;
    for (const id of AIRPORT.fxLayers) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    if (on) this.updateRunwayNumbers(); else { const mk = m.getSource('tar-rwy-marks'); mk && mk.setData({type: 'FeatureCollection', features: []}); }
};

jQuery(function () {
    new Toggle({
        key: 'airportDetail',
        display: 'Airport detail (loads OpenFreeMap tiles, reload to apply)',
        container: '#settingsRight',
        init: typeof airportDetail == 'undefined' ? true : airportDetail,
        setState: function (state) { airportDetail = state; },
    });
    new Toggle({
        key: 'airportFx',
        display: 'Airport detail effects (decorative)',
        container: '#settingsRight',
        init: true,
        setState: function (state) {
            AIRPORT.fx = state;
            if (typeof MLR != 'undefined' && MLR.ready) MLR.applyAirportFx();
        },
    });
});
