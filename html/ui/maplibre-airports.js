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
    markZoom: 13.5,         // runway centre line, threshold and touchdown markings, taxiway edge and centre lines
    lightZoom: 13.5,        // runway, approach and end lights, PAPI (fade in over one zoom level)
    taxiDotZoom: 14.5,      // taxiway lights and stop bars
    stopZoom: 14.5,
    haloZoom: 15,           // glow around the lights
    taxiWidth: 20,          // metres: drawn width of a taxiway (the tiles carry only centre lines)
    color: {
        ground: '#000000',       // airfield ground: black, darker than the map around it
        apron: '#6d6d6d',
        apronOpacity: 1,
        apronLine: '#6d6d6d',
        buildingLow: '#4f4f4f',  // flat neutral grey, lighter for the bigger buildings
        buildingHigh: '#7d7d7d',
        runway: '#151515',
        runwayLine: '#bababa',
        zebra: '#f2f2f2',
        taxi: '#151515',
        taxiLow: '#3c3c3c',      // taxiway fill at low zoom (reads as a line), settles to `taxi` by zoom 14
        taxiCase: '#3d3d3d',     // thin grey edge lines
        taxiCl: '#8c7a2c',       // thin yellow centre line
        stop: '#e04040',
        halo: '#0a0a0a',
        taxiLabel: '#e6c84a',
        number: '#f2f2f2',
        gateText: '#141414',
        gateFill: '#e0a22f',
        gateLine: '#f3c25e',
    },
};

// ICAO prefix to ISO country (for the flag in the airport chip). Two letters first, then the first letter.
const AIRPORT_CAT_COLOR = {VFR: '#3DDC97', MVFR: '#F5B94A', IFR: '#FF6B6B', LIFR: '#B07BFF'};
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

// width in px of `metres` on the ground at `lat` as zoom stops (doubling per zoom level), never below minPx; `add` px on top
function airportPx(lat, metres, minPx, add, sign) {
    const c = Math.cos(lat * Math.PI / 180) || 1, e = ['interpolate', ['exponential', 2], ['zoom']];
    for (let z = 8; z <= 20; z++) e.push(z, (sign || 1) * (Math.max(minPx || 0, metres * Math.pow(2, z) / (78271.517 * c)) + (add || 0)));
    return e;
}
// dash pattern (in units of the line width) for dashes of dashM and gaps of gapM metres, as zoom stops
function airportDash(lat, dashM, gapM, w) {
    const c = Math.cos(lat * Math.PI / 180) || 1, at = (z) => { const mpp = 78271.517 * c / Math.pow(2, z); return ['literal', [Math.max(1, dashM / mpp / w), Math.max(1, gapM / mpp / w)]]; };
    const e = ['step', ['zoom'], at(12.5)];
    for (let z = 13; z <= 20; z += 0.5) e.push(z, at(z));
    return e;
}
// the layers whose width depends on the metres per pixel (re-stated when the map moves to another latitude)
MLR.applyAirportMetres = function (force) {
    const m = this.map;
    if (!m || !AIRPORT.metreLayers) return;
    const lat = m.getCenter().lat;
    if (!force && this._metreLat != null && Math.abs(lat - this._metreLat) < 1) return;
    this._metreLat = lat;
    for (const l of AIRPORT.metreLayers) if (m.getLayer(l.id)) m.setPaintProperty(l.id, l.prop, l.prop === 'line-dasharray' ? airportDash(lat, l.m, l.gap, l.w) : airportPx(lat, l.m, l.min, l.add, l.sign));
};

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
    // airfield ground: inside the aerodrome polygon of the tiles, near-black, with a feathered edge. Where the tiles carry no aerodrome
    // polygon, a rounded buffer of the airport's pavement (built in updateAirportGeometry) takes its place.
    AIRPORT.metreLayers = [];
    const lat0 = m.getCenter().lat, ML = AIRPORT.metreLayers;
    const metre = (id, prop, metres, min, add, extra) => { ML.push(Object.assign({id, prop, m: metres, min, add}, extra)); return airportPx(lat0, metres, min, add, extra && extra.sign); };
    m.addSource('tar-ap-ground-fb', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    const aero = polyFilter('aerodrome');
    // The edge is feathered over 100 m with three stacked lines of growing width and low opacity (stepped; a blurred line breaks up into
    // spikes on a detailed outline). The opacities make the transparency fall off about linearly with the distance from the edge.
    const FEATHER = 3, featherAlpha = [];
    {
        const T = (i) => 0.08 + 0.92 * (i - 0.5) / FEATHER;                     // wanted transparency in band i (1 = nearest the edge)
        for (let i = 1; i <= FEATHER; i++) featherAlpha.push(1 - T(i) / (i === FEATHER ? 1 : T(i + 1)));
    }
    const groundLayers = (id, source, sl, filter) => {
        const base = Object.assign({source, minzoom: Z}, sl ? {'source-layer': sl} : {});
        m.addLayer(Object.assign({id, type: 'fill', filter, paint: {'fill-color': C.ground, 'fill-opacity': ramp(Z, 1)}}, base));   // antialiased outline hides the hairline between tiles in 3D
        for (let i = 1; i <= FEATHER; i++) {
            const lid = id + '-edge' + i;
            // a line offset outward by half its width: the band lies wholly outside the polygon (outer rings run clockwise on screen, holes
            // the other way, so a negative offset is always the polygon's outside); nothing is drawn over the polygon itself
            const w = 100 * (FEATHER - i + 1) / FEATHER;
            m.addLayer(Object.assign({id: lid, type: 'line', filter, layout: {'line-join': 'round'},
                paint: {'line-color': C.ground, 'line-opacity': ramp(Z, featherAlpha[FEATHER - i]), 'line-width': metre(lid, 'line-width', w, 0, 0),
                    'line-offset': metre(lid, 'line-offset', w / 2, 0, 0, {sign: -1})}}, base));
        }
    };
    groundLayers('tar-ap-ground', src, 'aeroway', aero);
    groundLayers('tar-ap-ground-fb', 'tar-ap-ground-fb', null, ['==', ['geometry-type'], 'Polygon']);
    // apron and helipad: lighter than the land
    L({id: 'tar-ap-apron', type: 'fill', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'class'], ['literal', ['apron', 'helipad']]]],
        paint: {'fill-color': C.apron, 'fill-opacity': ramp(Z, C.apronOpacity * 0.5), 'fill-outline-color': C.apronLine}});
    // aprons that contain or lie within 100 m of a stand: full brightness (computed in updateRunwayNumbers)
    m.addSource('tar-apron-main', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    m.addLayer({id: 'tar-ap-apron-main', type: 'fill', source: 'tar-apron-main', minzoom: Z,
        paint: {'fill-color': C.apron, 'fill-opacity': ramp(Z, C.apronOpacity), 'fill-outline-color': C.apronLine}});
    // buildings: flat warm grey without an outline, lighter for the bigger ones (taller buildings are the terminals)
    m.addLayer({id: 'tar-ap-building', type: 'fill', source: src, 'source-layer': 'building', minzoom: AIRPORT.buildingZoom,
        paint: {'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 4, C.buildingLow, 28, C.buildingHigh],
            'fill-opacity': ramp(AIRPORT.buildingZoom, 1), 'fill-antialias': false}});
    // runways that exist in the tiles only as a centre line: a dark line while the runway model (below) is not drawn yet (fades out by 13.5)
    L({id: 'tar-ap-runway-cl', type: 'line', minzoom: RZ, filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'runway']],
        paint: {'line-color': C.runway, 'line-opacity': ['interpolate', ['linear'], ['zoom'], RZ, 0, RZ + 1, 1, 12.5, 1, 13.5, 0],
            'line-width': ['interpolate', ['exponential', 2], ['zoom'], 10.5, 1.6, 12, 2.4, 13, 4, 14, 8]}, layout: {'line-cap': 'butt'}});
    // taxiways: pavement with two thin olive-grey edge lines and a thin yellow centre line. The tiles carry the centre line only, so the
    // drawn width is a nominal 20 m (the edge line layer is 2 px wider than the pavement layer: 1 px edges). Casing first, then every
    // pavement, so crossings and junctions merge cleanly.
    const taxi = ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway']];
    const TZ = AIRPORT.markZoom, rj = {'line-cap': 'round', 'line-join': 'round'};
    L({id: 'tar-ap-taxi-case', type: 'line', minzoom: TZ, filter: taxi, layout: rj,
        paint: {'line-color': C.taxiCase, 'line-opacity': ramp(TZ, 1), 'line-width': metre('tar-ap-taxi-case', 'line-width', AIRPORT.taxiWidth, 1.2, 2)}});
    L({id: 'tar-ap-taxi', type: 'line', minzoom: RZ + 0.5, filter: taxi, layout: rj,
        paint: {'line-color': ['interpolate', ['linear'], ['zoom'], 12.5, C.taxiLow, 14, C.taxi], 'line-opacity': ramp(RZ + 0.5, 1),
            'line-width': metre('tar-ap-taxi', 'line-width', AIRPORT.taxiWidth, 0.9, 0)}});
    L({id: 'tar-ap-taxi-cl', type: 'line', minzoom: TZ, filter: taxi, layout: rj,
        paint: {'line-color': C.taxiCl, 'line-opacity': ramp(TZ, 1), 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 17, 1.2]}});
    // runway model (updateAirportGeometry): pavement, thin edge lines, dashed centre line, zebra and touchdown-zone bars, stop bars
    const fc0 = () => ({type: 'FeatureCollection', features: []});
    m.addSource('tar-mk-polys', {type: 'geojson', data: fc0()});
    m.addSource('tar-mk-lines', {type: 'geojson', data: fc0()});
    const kf = (...k) => ['in', ['get', 'k'], ['literal', k]];
    m.addLayer({id: 'tar-mk-pave', type: 'fill', source: 'tar-mk-polys', minzoom: Z + 0.5, filter: kf('pave'),
        paint: {'fill-color': C.runway, 'fill-opacity': ramp(Z + 0.5, 1), 'fill-antialias': false}});
    m.addLayer({id: 'tar-mk-edge', type: 'line', source: 'tar-mk-lines', minzoom: Z + 0.5, filter: kf('edge'),
        paint: {'line-color': C.runwayLine, 'line-opacity': ramp(Z + 0.5, 0.9), 'line-width': ['interpolate', ['linear'], ['zoom'], 11.5, 0.5, 14, 1, 18, 1.4]}});
    m.addLayer({id: 'tar-mk-cl', type: 'line', source: 'tar-mk-lines', minzoom: AIRPORT.markZoom, filter: kf('cl'), layout: {'line-cap': 'butt'},
        paint: {'line-color': C.runwayLine, 'line-opacity': ramp(AIRPORT.markZoom, 0.85), 'line-width': 1.2}});
    ML.push({id: 'tar-mk-cl', prop: 'line-dasharray', m: 30, gap: 20, w: 1.2});
    m.addLayer({id: 'tar-mk-zebra', type: 'fill', source: 'tar-mk-polys', minzoom: AIRPORT.markZoom, filter: kf('zebra'),
        paint: {'fill-color': C.zebra, 'fill-opacity': ramp(AIRPORT.markZoom, 0.95)}});
    m.addLayer({id: 'tar-mk-tdz', type: 'fill', source: 'tar-mk-polys', minzoom: AIRPORT.markZoom, filter: kf('tdz'),
        paint: {'fill-color': C.runwayLine, 'fill-opacity': ramp(AIRPORT.markZoom, 0.8)}});
    m.addLayer({id: 'tar-mk-stop', type: 'line', source: 'tar-mk-lines', minzoom: AIRPORT.stopZoom, filter: kf('stop'), layout: {'line-cap': 'butt'},
        paint: {'line-color': C.stop, 'line-opacity': ramp(AIRPORT.stopZoom, 1), 'line-width': 2}});
    // Runway shapes from the OurAirports data (html/airport-db/airports.json): drawn from zoom 9.5 so a medium airport is
    // recognisable long before the vector tiles carry any runway geometry. Large and medium airports first, small
    // airfields from zoom 11. They fade out again (12.5 to 13.3) as the OpenFreeMap runway polygons take over.
    m.addSource('tar-rwy-db', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    const dbOp = (z0, v) => ['interpolate', ['linear'], ['zoom'], z0, 0, z0 + 1, v, 12.5, v, 13.3, 0];
    const dbW = (extra) => ['interpolate', ['linear'], ['zoom'], 9.5, 1.6 + extra, 11, 2.6 + extra, 12, 4.2 + extra, 13, 8 + extra];
    for (const [tag, z0, sm] of [['L', AIRPORT.runwayDbZoom, 0], ['S', AIRPORT.runwayDbSmallZoom, 1]]) {
        const f = ['==', ['get', 's'], sm];
        m.addLayer({id: 'tar-ap-rwydb-case-' + tag, type: 'line', source: 'tar-rwy-db', minzoom: z0, filter: f, layout: {'line-cap': 'butt'},
            paint: {'line-color': '#b7b7b7', 'line-opacity': dbOp(z0, 0.8), 'line-width': dbW(1.4)}}, 'tar-ap-apron');
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
    // ---- DECORATIVE LIGHTS (illustrative only) ----
    // Everything below is cosmetic. It is generated from the runway and taxiway geometry (updateAirportGeometry), there is no
    // lighting or status data behind it: it is NOT live airport status and must not be used for navigation. All of it is GL layers
    // (no DOM): one circle layer for the light cores, two for the glow (circle-blur, low opacity, only from zoom 15 / 16), plus a few
    // line layers for the end bars, approach bars and the joining segments. The group can be switched off in Settings
    // ("Airport detail effects"); that removes only the lights, not the pavement or the painted markings.
    const LZ = AIRPORT.lightZoom, TDZ = AIRPORT.taxiDotZoom, HZ = AIRPORT.haloZoom;
    const FX = AIRPORT.fxLayers = [];
    m.addSource('tar-fx-pts', {type: 'geojson', data: fc0()});
    m.addSource('tar-fx-lines', {type: 'geojson', data: fc0()});
    const fxAdd = (l) => { m.addLayer(l); FX.push(l.id); };
    const rr = (v) => ['*', ['get', 'r'], v];
    const isR = ['==', ['get', 'g'], 'r'];
    fxAdd({id: 'tar-fx-join', type: 'line', source: 'tar-fx-lines', minzoom: LZ, filter: kf('join'), layout: {'line-cap': 'butt'},
        paint: {'line-color': '#ffffff', 'line-opacity': ramp(LZ, 0.4), 'line-width': 1}});
    fxAdd({id: 'tar-fx-bar-halo', type: 'line', source: 'tar-fx-lines', minzoom: HZ, filter: kf('endbar', 'abar'), layout: {'line-cap': 'butt'},
        paint: {'line-color': ['get', 'c'], 'line-blur': 4, 'line-opacity': ['interpolate', ['linear'], ['zoom'], HZ, 0, HZ + 1, 0.4],
            'line-width': ['interpolate', ['linear'], ['zoom'], HZ, 7, 18, 14]}});
    fxAdd({id: 'tar-fx-bar', type: 'line', source: 'tar-fx-lines', minzoom: LZ, filter: kf('endbar', 'abar'), layout: {'line-cap': 'butt'},
        paint: {'line-color': ['get', 'c'], 'line-opacity': ramp(LZ, 1),
            'line-width': ['interpolate', ['linear'], ['zoom'], LZ, ['case', ['==', ['get', 'k'], 'endbar'], 2.2, 1.2], 17, ['case', ['==', ['get', 'k'], 'endbar'], 4, 2]]}});
    fxAdd({id: 'tar-fx-halo', type: 'circle', source: 'tar-fx-pts', minzoom: HZ, filter: isR,
        paint: {'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], HZ, 0, HZ + 1, 0.32],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], HZ, rr(3.5), 18, rr(8)]}});
    fxAdd({id: 'tar-fx-halo-t', type: 'circle', source: 'tar-fx-pts', minzoom: 16, filter: ['!', isR],
        paint: {'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0, 17, 0.18],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, rr(3.2), 18, rr(6)]}});
    fxAdd({id: 'tar-fx-core', type: 'circle', source: 'tar-fx-pts', minzoom: LZ,
        paint: {'circle-color': ['get', 'c'],
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], LZ, 0, LZ + 1, ['case', isR, 1, 0], TDZ + 1, 1],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], LZ, rr(0.55), 15, rr(0.8), 16, rr(1), 17, rr(1.4), 19, rr(2.2)]}});
    // taxiway letters along the line
    L({id: 'tar-ap-taxi-ref', type: 'symbol', minzoom: AIRPORT.taxiRefZoom,
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'class'], 'taxiway'], ['has', 'ref']],
        layout: {'symbol-placement': 'line', 'symbol-spacing': 260, 'text-field': ['case', ['==', ['slice', ['get', 'ref'], 0, 8], 'Taxiway '], ['slice', ['get', 'ref'], 8], ['get', 'ref']], 'text-font': font,
            'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 17], 'text-keep-upright': true, 'text-max-angle': 40,
            'text-padding': 4},
        paint: {'text-color': C.taxiLabel, 'text-halo-color': C.halo, 'text-halo-width': 2, 'text-opacity': ramp(AIRPORT.taxiRefZoom, 1)}});
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
    this.applyAirportFx();
    this.applyAirportMetres(true);
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
    if (m.getZoom() < AIRPORT.detailZoom - 0.2) { if (this._rwyHad) { nums.setData({type: 'FeatureCollection', features: []}); this._rwyHad = false; } MLR.updateAirportGeometry([]); return; }
    let feats = [];
    const axes = [];
    try { feats = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['all', ['==', ['get', 'class'], 'runway'], ['has', 'ref']]}); } catch (e) { return; }
    // Runway axes from the tiles, one per ref and place (the same ref exists at many airports). A queried feature is cut at its tile
    // (plus buffer), so a runway whose ends lie outside the loaded tiles has artificial ends: such an axis is marked `clipped` and not
    // used for placing anything (the OurAirports runway ends are used instead, or nothing is drawn).
    const groups = [];
    const addPts = (ref, pts, tile) => {
        let g = groups.find(q => q.ref === ref && Math.abs(q.lon - pts[0][0]) < 0.05 && Math.abs(q.lat - pts[0][1]) < 0.05);
        if (!g) { g = {ref, lon: pts[0][0], lat: pts[0][1], pts: []}; groups.push(g); }
        for (const p of pts) {
            let out = false;
            if (tile) { const tx = AIRPORT_TX(p[0], tile.z) - tile.x, ty = AIRPORT_TY(p[1], tile.z) - tile.y; out = tx < 0.0005 || tx > 0.9995 || ty < 0.0005 || ty > 0.9995; }
            g.pts.push([p[0], p[1], out]);
        }
    };
    const flat = (c, out) => { if (typeof c[0] === 'number') out.push(c); else for (const x of c) flat(x, out); return out; };
    for (const f of feats) addPts(f.properties.ref, flat(f.geometry.coordinates, []), airportTile(f));
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
        const sOf = (p) => (mx(p) - cx) * ux + (my(p) - cy) * uy;
        let lo = Infinity, hi = -Infinity;
        for (const p of g.pts) { const v = sOf(p); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo < 300) continue;
        // an end is artificial when every point at that end lies outside its own tile
        const endOpen = (v) => g.pts.filter(p => Math.abs(sOf(p) - v) < 1).every(p => p[2]);
        let hw = 0;
        for (const p of g.pts) { const d = Math.abs(-(mx(p) - cx) * uy + (my(p) - cy) * ux); if (d > hw) hw = d; }
        // the heading at each end picks which of the two numbers belongs to it
        const brg = (dx, dy) => (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const ids = [parts[0], parts[parts.length - 1]];
        if (parts.length > 1) [[0, 1], [1, -1]].forEach(([e, dir]) => {
            const b = brg(ux * dir, uy * dir);
            let best = parts[0], bd = 999;
            for (const n of parts) { const v = parseInt(n, 10) * 10; if (isNaN(v)) continue; const d = Math.abs(((v - b + 540) % 360) - 180); if (d < bd) { bd = d; best = n; } }
            ids[e] = best;
        });
        axes.push({g, k, cx, cy, ux, uy, lo, hi, rawHw: hw, ids, parts, clipped: endOpen(lo) || endOpen(hi)});
    }
    MLR.applyAirportMetres();
    const numbers = MLR.updateAirportGeometry(axes);
    this._rwyHad = numbers.length > 0;
    nums.setData({type: 'FeatureCollection', features: numbers});
    MLR.updateMainAprons();
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

// ----- airport geometry: runway model, markings, lights, ground (geometry in ui/airport-geom.js) -----
// Everything is placed from real geometry: the runway ends found in the OpenFreeMap tiles (OurAirports runway ends are the
// fallback for runways the tiles lack), the runway width from the tile polygon or the OurAirports width, the taxiway centre
// lines of the tiles. With no usable geometry nothing is drawn. Per airport the geometry is built once and cached; only
// airports in view above the zoom threshold are built.
const AIRPORT_TX = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
const AIRPORT_TY = (lat, z) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z); };
const AIRPORT_LON = (x, z) => x / Math.pow(2, z) * 360 - 180;
const AIRPORT_LAT = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / Math.pow(2, z)))) * 180 / Math.PI;

// tile a queried feature came from (MapLibre keeps it on the vector tile feature), or null
function airportTile(f) {
    const t = f.tile;
    return t && typeof t.z === 'number' && typeof t.x === 'number' ? {z: t.z, x: t.x, y: t.y} : null;
}
// A queried feature is clipped to its tile plus a buffer, so neighbouring tiles overlap. Cut each line to its own tile so
// the pieces abut exactly and nothing is doubled.
function airportClip(line, t) {
    const z = t.z, p = line.map(c => [AIRPORT_TX(c[0], z) - t.x, AIRPORT_TY(c[1], z) - t.y]);
    const runs = [], out = (q) => [AIRPORT_LON(q[0] + t.x, z), AIRPORT_LAT(q[1] + t.y, z)];
    let cur = null;
    for (let i = 1; i < p.length; i++) {
        const x0 = p[i - 1][0], y0 = p[i - 1][1], dx = p[i][0] - x0, dy = p[i][1] - y0;
        let u0 = 0, u1 = 1, ok = true;
        for (const [pp, qq] of [[-dx, x0], [dx, 1 - x0], [-dy, y0], [dy, 1 - y0]]) {
            if (pp === 0) { if (qq < 0) ok = false; continue; }
            const r = qq / pp;
            if (pp < 0) { if (r > u1) ok = false; else if (r > u0) u0 = r; } else { if (r < u0) ok = false; else if (r < u1) u1 = r; }
        }
        if (!ok || u0 > u1) { cur = null; continue; }
        if (!cur || u0 > 0) { cur = [out([x0 + dx * u0, y0 + dy * u0])]; runs.push(cur); }
        cur.push(out([x0 + dx * u1, y0 + dy * u1]));
        if (u1 < 1) cur = null;
    }
    return runs.filter(r => r.length > 1);
}

const AIRPORT_RWY_DEFAULT_WIDTH = (len) => len >= 2400 ? 45 : len >= 1500 ? 30 : len >= 800 ? 23 : 18;

// width (m) of a runway from the OurAirports data: the runway of the nearest airport that shares an ident or has ends within 600 m
MLR.dbRunwayWidth = function (a, b, ids) {
    const st = typeof AIRPT != 'undefined' && AIRPT.state && AIRPT.state.db;
    if (!st) return null;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = Math.cos(my * Math.PI / 180);
    let best = null, bd = 600;
    for (const r of st.a) {
        if (Math.abs(r[4] - my) > 0.06 || Math.abs(r[5] - mx) > 0.09) continue;
        for (const rw of r[11]) {
            if (rw.length < 12 || rw[8] == null || !(rw[3] > 0)) continue;
            const ex = (p, q) => Math.hypot((p[0] - q[0]) * 111320 * k, (p[1] - q[1]) * 110540);
            const e0 = [rw[9] / 1e4, rw[8] / 1e4], e1 = [rw[11] / 1e4, rw[10] / 1e4];
            const d = Math.min(ex(a, e0) + ex(b, e1), ex(a, e1) + ex(b, e0)) / 2;
            if (d < bd) { bd = d; best = rw[3] * 0.3048; }
        }
    }
    return best;
};

// OurAirports runways inside the view: [{a, b, ids, width, src}] with lon/lat ends
MLR.dbRunways = function (bounds) {
    const st = typeof AIRPT != 'undefined' && AIRPT.state && AIRPT.state.db;
    if (!st) { if (typeof AIRPT != 'undefined' && AIRPT.load) AIRPT.load().then(() => MLR.updateRunwayNumbers()); return []; }
    const out = [], w = bounds.getWest() - 0.03, e = bounds.getEast() + 0.03, s = bounds.getSouth() - 0.03, n = bounds.getNorth() + 0.03;
    for (const r of st.a) {
        if (r[4] < s || r[4] > n || r[5] < w || r[5] > e) continue;
        for (const rw of r[11]) {
            if (rw.length < 12 || rw[8] == null || rw[9] == null || rw[10] == null || rw[11] == null) continue;
            const a = [rw[9] / 1e4, rw[8] / 1e4], b = [rw[11] / 1e4, rw[10] / 1e4], k = Math.cos(a[1] * Math.PI / 180);
            const len = Math.hypot((b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110540);
            if (len < 300) continue;
            out.push({a, b, ids: [String(rw[0]), String(rw[1])], width: rw[3] > 0 ? rw[3] * 0.3048 : AIRPORT_RWY_DEFAULT_WIDTH(len), src: 'db'});
        }
    }
    return out;
};

// colours of the lights (decorative)
const AIRPORT_LIGHT = {runway: '#fff3d6', red: '#ff3b30', green: '#35e06a', blue: '#4a8cff', white: '#ffffff'};

// Build (or fetch from the cache) the geometry of one airport: everything except the zoom-dependent thinning of the rows.
MLR.buildAirport = function (ap, tiles, z) {
    const G = AIRGEOM, fr = ap.fr, T = AIRPORT;
    const out = {mkPolys: [], mkLines: [], hold: [], taxi: [], ground: null, groundTest: null, rw: []};
    const toLL = (p) => fr.ll(p);
    // runway models
    for (const r of ap.recs) {
        const a = fr.xy(r.a), b = fr.xy(r.b), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 300) continue;
        let width = r.width;
        if (width == null) width = this.dbRunwayWidth(r.a, r.b, r.ids);
        if (width == null) width = AIRPORT_RWY_DEFAULT_WIDTH(len);
        out.rw.push({rw: G.runway(a, b, Math.min(Math.max(width, 12), 80)), ids: r.ids});
    }
    if (!out.rw.length) return out;
    // ground: the aerodrome polygons of the tiles when a runway lies inside one, else a rounded buffer of the airport's pavement
    const rings = tiles.aero.map(poly => poly.map(fr.xy));
    const inAero = (p) => rings.some(rg => G.inPoly(p, rg));
    out.groundTest = inAero;
    const loose = out.rw.filter(q => !inAero([(q.rw.a[0] + q.rw.b[0]) / 2, (q.rw.a[1] + q.rw.b[1]) / 2]));
    if (loose.length) {
        const pts = [];
        for (const q of loose) pts.push(q.rw.a, q.rw.b);
        const cx = loose.reduce((s, q) => s + (q.rw.a[0] + q.rw.b[0]) / 2, 0) / loose.length, cy = loose.reduce((s, q) => s + (q.rw.a[1] + q.rw.b[1]) / 2, 0) / loose.length;
        for (const ln of tiles.taxi) for (const c of ln) { const p = fr.xy(c); if (Math.hypot(p[0] - cx, p[1] - cy) < 2500) pts.push(p); }
        for (const poly of tiles.apron) for (const c of poly) { const p = fr.xy(c); if (Math.hypot(p[0] - cx, p[1] - cy) < 2500) pts.push(p); }
        out.ground = G.bufferHull(pts, 150, 20);
        const hullTest = (p) => G.inPoly(p, out.ground);
        out.groundTest = (p) => inAero(p) || hullTest(p);
    }
    // taxiways in the airport frame, with their lights (centre and both edges) and the hold-short positions
    if (tiles.taxi.length) {
        const lines = tiles.taxi.map(ln => ln.map(fr.xy));
        const halfW = T.taxiWidth / 2, idx = new Map(), cell = 40;
        const key = (x, y) => Math.floor(x / cell) + ':' + Math.floor(y / cell);
        lines.forEach((ln, li) => { for (let i = 1; i < ln.length; i++) {
            const x0 = Math.min(ln[i - 1][0], ln[i][0]), x1 = Math.max(ln[i - 1][0], ln[i][0]), y0 = Math.min(ln[i - 1][1], ln[i][1]), y1 = Math.max(ln[i - 1][1], ln[i][1]);
            for (let cx = Math.floor((x0 - halfW) / cell); cx <= Math.floor((x1 + halfW) / cell); cx++) for (let cy = Math.floor((y0 - halfW) / cell); cy <= Math.floor((y1 + halfW) / cell); cy++) {
                const k = cx + ':' + cy; (idx.get(k) || idx.set(k, []).get(k)).push([li, ln[i - 1], ln[i]]);
            }
        } });
        const nearOther = (p, li, r) => { for (const s of idx.get(key(p[0], p[1])) || []) if (s[0] !== li && G.segDist(p, s[1], s[2]) < r) return true; return false; };
        const onRunway = (p, m) => out.rw.some(q => q.rw.inside(p, m));
        const seen = [];       // kept dots, to drop duplicates where taxiways meet
        const cands = [];
        lines.forEach((ln, li) => {
            const L = G.taxiLights(ln, halfW, 20);
            for (let i = 0; i < L.centre.length; i++) {
                if (onRunway(L.centre[i], 3)) continue;
                cands.push({li, i, c: L.centre[i], l: L.left[i], r: L.right[i]});
            }
        });
        const keepC = G.dedupe(cands, 8, q => q.c);
        for (const q of keepC) {
            out.taxi.push({p: q.c, k: 'g', i: q.i, li: q.li});
            for (const e of [q.l, q.r]) if (!onRunway(e, 2) && !nearOther(e, q.li, halfW - 2.5)) seen.push({p: e, i: q.i, li: q.li});
        }
        for (const q of G.dedupe(seen, 7, q => q.p)) out.taxi.push({p: q.p, k: 'b', i: q.i, li: q.li});
        // hold-short positions (stop bars), 45 m back from each runway edge
        const holds = [];
        for (const ln of lines) for (const q of out.rw) for (const h of G.holdShort(ln, q.rw, 45)) holds.push(h);
        for (const h of G.dedupe(holds, 10, q => q.p)) out.hold.push(G.stopBar(h, T.taxiWidth * 0.85).map(toLL));
    }
    return out;
};

// Rebuild the runway model, markings and lights for the airports in view. Returns the extra runway-number features
// (for runways only the OurAirports data has).
MLR.updateAirportGeometry = function (axes) {
    const m = this.map, G = AIRGEOM, T = AIRPORT, z = m.getZoom();
    const S = {};
    for (const id of ['tar-mk-polys', 'tar-mk-lines', 'tar-fx-pts', 'tar-fx-lines', 'tar-ap-ground-fb']) { S[id] = m.getSource(id); if (!S[id]) return []; }
    const st = this._ap = this._ap || {cache: new Map(), key: '', had: false};
    const wantMk = z >= T.detailZoom + 0.3, wantFx = T.fx !== false && z >= T.lightZoom - 0.3, wantTaxi = z >= T.taxiDotZoom - 0.3;
    const empty = {type: 'FeatureCollection', features: []};
    const clear = () => { if (st.had) { for (const id in S) S[id].setData(empty); st.had = false; st.key = ''; } return []; };
    if (!wantMk) return clear();
    // runway records: the OurAirports runway ends where the data has them (true thresholds), else a tile runway whose ends are both loaded
    const b = m.getBounds();
    const recs = this.dbRunways(b);
    const sameIds = (r, a) => a.parts.length > 1 ? a.parts.includes(r.ids[0]) && a.parts.includes(r.ids[1]) : a.parts[0] === r.ids[0] || a.parts[0] === r.ids[1];
    for (const a of axes) {
        if (a.clipped) continue;
        const ll = (s) => [a.g.lon + (a.cx + a.ux * s) / (111320 * a.k), a.g.lat + (a.cy + a.uy * s) / 110540];
        const c = ll((a.lo + a.hi) / 2), k = Math.cos(c[1] * Math.PI / 180);
        if (recs.some(r => sameIds(r, a) && Math.hypot(((r.a[0] + r.b[0]) / 2 - c[0]) * 111320 * k, ((r.a[1] + r.b[1]) / 2 - c[1]) * 110540) < 6000)) continue;
        recs.push({a: ll(a.lo), b: ll(a.hi), ids: a.ids, width: a.rawHw > 8 ? Math.min(a.rawHw * 2, 80) : null, src: 'ofm'});
    }
    const numbers = [];
    for (const r of recs) {
        const k = Math.cos(r.a[1] * Math.PI / 180), dx = (r.b[0] - r.a[0]) * 111320 * k, dy = (r.b[1] - r.a[1]) * 110540, len = Math.hypot(dx, dy);
        if (len < 300) continue;
        const inset = 90 + len * 0.02;
        for (let e = 0; e < 2; e++) {
            const sg = e ? -1 : 1, base = e ? r.b : r.a;
            if (!r.ids[e]) continue;
            numbers.push({type: 'Feature', properties: {n: r.ids[e], rot: Math.round((Math.atan2(dx * sg, dy * sg) * 180 / Math.PI + 360) % 360)},
                geometry: {type: 'Point', coordinates: [base[0] + dx * sg / len * inset / (111320 * k), base[1] + dy * sg / len * inset / 110540]}});
        }
    }
    const extra = numbers;
    if (!recs.length) return clear();
    // group runways into airports (mid points within 5 km)
    const mid = (r) => [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2];
    const aps = [];
    for (const r of recs) {
        const p = mid(r), k = Math.cos(p[1] * Math.PI / 180);
        let ap = aps.find(q => Math.hypot((q.c[0] - p[0]) * 111320 * k, (q.c[1] - p[1]) * 110540) < 5000);
        if (!ap) { ap = {c: p, recs: []}; aps.push(ap); }
        ap.recs.push(r);
    }
    // tile features (only those of the current source zoom, cut to their own tile)
    const zs = Math.min(14, Math.max(0, Math.floor(z)));
    const get = (filter) => { let f = []; try { f = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter}); } catch (e) {} return f; };
    const sameZ = (f) => { const t = airportTile(f); return !t || t.z === zs || t.z === Math.min(zs, 14); };
    const lineList = (fs, clipper) => {
        const out = [];
        for (const f of fs) {
            if (!sameZ(f)) continue;
            const g = f.geometry, t = airportTile(f);
            const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
            for (const ln of parts) { if (t) for (const r of airportClip(ln, t)) out.push(r); else out.push(ln); }
        }
        return out;
    };
    const aeroF = get(['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'class'], 'aerodrome']]).filter(sameZ);
    const aeroAll = [];
    for (const f of get(['==', ['get', 'class'], 'aerodrome']).filter(sameZ)) {
        const g = f.geometry;
        if (g.type === 'Polygon') aeroAll.push(g.coordinates[0]); else if (g.type === 'MultiPolygon') for (const p of g.coordinates) aeroAll.push(p[0]);
    }
    const taxiLines = wantTaxi ? lineList(get(['==', ['get', 'class'], 'taxiway'])) : [];
    const apronRings = [];
    if (wantMk) for (const f of get(['all', ['==', ['get', 'class'], 'apron']]).filter(sameZ)) {
        const g = f.geometry;
        if (g.type === 'Polygon') apronRings.push(g.coordinates[0]); else if (g.type === 'MultiPolygon') for (const p of g.coordinates) apronRings.push(p[0]);
    }
    const fxOn = wantFx;
    const mpp = (lat) => 78271.517 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
    const lvTaxi = G.strideLevel(20, mpp(aps[0].c[1]), 8);
    const key = [z >= T.stopZoom - 0.3 ? 1 : 0, wantFx ? 1 : 0, wantTaxi ? 1 : 0, lvTaxi, aeroAll.length, taxiLines.length, apronRings.length,
        aps.map(a => a.recs.map(r => r.a.map(v => v.toFixed(5)).join(',') + r.b.map(v => v.toFixed(5)).join(',')).join(';')).join('|')].join('#');
    if (key === st.key) return extra;
    st.key = key;
    const polys = [], lines = [], fpts = [], flines = [];
    const P = (props, ring) => polys.push({type: 'Feature', properties: props, geometry: {type: 'Polygon', coordinates: [ring.concat([ring[0]])]}});
    const Ln = (arr, props, coords) => arr.push({type: 'Feature', properties: props, geometry: {type: 'LineString', coordinates: coords}});
    const gfb = [];
    for (const ap of aps) {
        const fr = G.frame(ap.c[0], ap.c[1]);
        ap.fr = fr;
        const cx = fr.xy(ap.c);
        const near = (poly) => poly.some(c => { const p = fr.xy(c); return Math.hypot(p[0], p[1]) < 3500; });
        const sig = ap.recs.map(r => r.a.join(',') + r.b.join(',')).join(';');
        const tiles = {aero: aeroAll.filter(near), taxi: taxiLines.filter(near), apron: apronRings.filter(near)};
        const ck = sig + '|' + tiles.aero.length + '|' + tiles.taxi.length + '|' + tiles.taxi.reduce((s, l) => s + l.length, 0) + '|' + tiles.apron.length + '|' + wantTaxi;
        let ent = st.cache.get(sig);
        if (!ent || ent.ck !== ck) { ent = this.buildAirport(ap, tiles, z); ent.ck = ck; st.cache.set(sig, ent); if (st.cache.size > 12) st.cache.delete(st.cache.keys().next().value); }
        const ll = (p) => fr.ll(p);
        if (ent.ground) gfb.push({type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [ent.ground.map(ll).concat([ll(ent.ground[0])])]}});
        for (const {rw} of ent.rw) {
            const at = (e, s, l) => ll(rw.at(e, s, l));
            P({k: 'pave'}, [at(0, 0, -rw.hw), at(0, rw.len, -rw.hw), at(0, rw.len, rw.hw), at(0, 0, rw.hw)]);
            Ln(lines, {k: 'edge'}, [at(0, 0, rw.hw), at(0, rw.len, rw.hw)]);
            Ln(lines, {k: 'edge'}, [at(0, 0, -rw.hw), at(0, rw.len, -rw.hw)]);
            if (z >= T.markZoom - 0.3) {
                const M = G.markings(rw);
                Ln(lines, {k: 'cl'}, M.centreline.map(ll));
                for (const r of M.zebra) P({k: 'zebra'}, r.map(ll));
                for (const r of M.tdz) P({k: 'tdz'}, r.map(ll));
            }
            if (fxOn) {
                const mp = mpp(ap.c[1]);
                const lvC = G.strideLevel(15, mp, 8), lvE = G.strideLevel(60, mp, 8), lvA = G.strideLevel(30, mp, 8);
                const L = G.runwayLights(rw, {centreSpacing: 15 * (1 << lvC), edgeSpacing: 60 * (1 << lvE)});
                const dot = (p, c, r, g, h) => fpts.push({type: 'Feature', properties: {c, r, g, h}, geometry: {type: 'Point', coordinates: ll(p)}});
                for (const p of L.centre) dot(p, AIRPORT_LIGHT.runway, 1.25, 'r', 1);
                for (const p of L.edgeL.concat(L.edgeR)) dot(p, AIRPORT_LIGHT.runway, 1.5, 'r', 1);
                for (let e = 0; e < 2; e++) {
                    for (const p of L.threshold[e]) dot(p, AIRPORT_LIGHT.green, 1.4, 'r', 1);
                    Ln(flines, {k: 'endbar', c: AIRPORT_LIGHT.red}, L.endBars[e].map(ll));
                    // approach lights, only as far as the ground goes
                    if (rw.len >= 1800) {
                        const lim = G.approachLimit(rw, e, ent.groundTest || (() => false), 900);
                        const A = G.approach(rw, e, lim);
                        const q = 1 << lvA;
                        A.dots.forEach((o, i) => { if ((i + 1) % q === 0) dot(o.p, AIRPORT_LIGHT.runway, o.big ? 2.2 : 1.5, 'r', 1); });
                        for (const br of A.bars) Ln(flines, {k: 'abar', c: AIRPORT_LIGHT.white}, br.map(ll));
                    }
                    for (const o of G.papi(rw, e)) dot(o.p, o.c === 'w' ? AIRPORT_LIGHT.white : AIRPORT_LIGHT.red, 2, 'r', 1);
                }
                // short joining segments along the centre line (every second gap)
                const cl = L.centre;
                for (let i = 0; i + 1 < cl.length; i += 2) Ln(flines, {k: 'join'}, [ll(cl[i]), ll(cl[i + 1])]);
            }
        }
        if (wantTaxi) {
            for (const h of ent.hold) Ln(lines, {k: 'stop'}, h);
            if (fxOn) for (const q of ent.taxi) {
                if (q.i % (1 << lvTaxi) !== 0) continue;
                fpts.push({type: 'Feature', properties: {c: q.k === 'g' ? AIRPORT_LIGHT.green : AIRPORT_LIGHT.blue, r: 1, g: 't', h: 0.6}, geometry: {type: 'Point', coordinates: ll(q.p)}});
            }
        }
    }
    const fc = (f) => ({type: 'FeatureCollection', features: f});
    S['tar-mk-polys'].setData(fc(polys)); S['tar-mk-lines'].setData(fc(lines));
    S['tar-fx-pts'].setData(fc(fpts)); S['tar-fx-lines'].setData(fc(flines));
    S['tar-ap-ground-fb'].setData(fc(gfb));
    st.had = true;
    return extra;
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
    if (this._ap) this._ap.key = '';          // rebuild: lights are only generated while switched on
    this.updateRunwayNumbers();
};

jQuery(function () {
    new Toggle({key: 'airportPinWx', display: 'Weather on airport pins (ring by flight category)', container: '#settingsRight',
        init: typeof airportPinWx == 'undefined' ? true : airportPinWx, setState: function (st) { airportPinWx = st; if (typeof MLR != 'undefined' && MLR.ready) MLR.applyPinWeather(); }});
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
