"use strict";
// Skywatch ADS-B: jet-black map style for MapLibre.
//
// The stock OpenFreeMap and CARTO styles are close to what the design wants but not black: land, water and
// background are dark greys, roads are busy and labels are loud. mlBlackStyle() rewrites a style JSON (fetched
// at load, see ui/maplibre-layers.js) into the calm map of the mockups. Edit ML_STYLE below to tune the look.
//
// ---------------------------------------------------------------------------------------------
// MapLibre version (ui/maplibre-layers.js). MapLibre uses the style JSON directly, so the style is
// rewritten here into a calm, sparse map: black background, near-black land and water, a few dim
// grey roads with a clear hierarchy, no rail/paths/POIs, small subdued labels.
// OpenFreeMap and CARTO Dark Matter (both keyless) use different layer ids; both are handled.
// ---------------------------------------------------------------------------------------------
const ML_STYLE = {
    land: (function () { try { return getComputedStyle(document.documentElement).getPropertyValue('--map-land').trim() || '#0d0d0f'; } catch (e) { return '#0d0d0f'; } })(),   // --map-land in theme.css;             // dark charcoal land; the ocean is pure black, so coastlines read through contrast alone
    water: '#000000',
    label: {country: '#9a9a9a', state: '#4b4b4b', city: '#707070', town: '#646464', small: '#585858', water: '#3e3e3e', halo: 'rgba(0,0,0,0.9)'},
    // roads: white at low alpha so a dense network reads at UK zoom without getting loud
    road: {motorway: 'rgba(255,255,255,0.15)', trunk: 'rgba(255,255,255,0.13)', primary: 'rgba(255,255,255,0.09)', secondary: 'rgba(255,255,255,0.06)', minor: 'rgba(255,255,255,0.045)'},
    // line width (px) of each road class at MapLibre zoom 5 / 9 / 14
    roadWidth: {motorway: [0.7, 1.0, 3], trunk: [0.6, 0.9, 2.6], primary: [0.5, 0.8, 2.2], secondary: [0.5, 0.7, 1.8], minor: [0.5, 0.6, 1.4]},
    urbanLift: 0.04,            // built-up areas: land + this fraction toward white
    boundary: {country: '#262626', state: '#1f1f1f'},
    widthScale: 0.8,
};

// text-font stacks per provider (only fonts that provider's glyph server actually has)
const ML_FONTS = {
    carto: {reg: ['Noto Sans Regular'], semi: ['Montserrat SemiBold'], ital: ['Open Sans Italic']},
    ofm:   {reg: ['Noto Sans Regular'], semi: ['Noto Sans Bold'],      ital: ['Noto Sans Italic']},
    vt:    {reg: ['noto_sans_regular'], semi: ['noto_sans_bold'],      ital: ['noto_sans_regular']},
};

// multiply the numeric outputs of a width value / interpolate expression
function mlScaleWidth(v, k) {
    if (typeof v === 'number') return v * k;
    if (Array.isArray(v) && v[0] === 'interpolate') return v.map((x, i) => (i >= 4 && i % 2 === 0 && typeof x === 'number') ? x * k : x);
    return v;
}

let ML_CUR_KIND = 'ofm';   // provider of the style being rewritten

function mlHide(l) { l.layout = Object.assign(l.layout || {}, {visibility: 'none'}); }

// role: country | state | city | town | small | water.  Hierarchy: countries larger, medium-light, semi-bold;
// regions small, dim, uppercase, letter-spaced; cities small and dim; water names italic and very dim.
function mlLabelStyle(l, role, size, minzoom) {
    const paint = l.paint || (l.paint = {});
    const f = ML_FONTS[ML_CUR_KIND];
    paint['text-color'] = ML_STYLE.label[role];
    paint['text-halo-color'] = ML_STYLE.label.halo;
    paint['text-halo-width'] = 1.2;
    delete paint['icon-color']; delete paint['icon-opacity'];
    const lay = l.layout || (l.layout = {});
    delete lay['icon-image']; delete lay['text-transform']; delete lay['text-letter-spacing'];
    lay['text-font'] = role === 'water' ? f.ital : f.reg;
    if (role === 'country') { size = ['interpolate', ['linear'], ['zoom'], 1, 9, 4, 10, 7, 11]; paint['text-opacity'] = 0.35; }   // countries: small and heavily dimmed
    if (role === 'state') { lay['text-transform'] = 'uppercase'; lay['text-letter-spacing'] = 0.14; size = size || 10; }
    if (role === 'water') { lay['text-letter-spacing'] = 0.08; size = size || 12; }
    if (size) lay['text-size'] = size;
    if (minzoom != null) l.minzoom = Math.max(l.minzoom || 0, minzoom);
}

function mlBlackStyle(style, def) {
    style = JSON.parse(JSON.stringify(style));
    const kind = /^Carto/.test(def.name) ? 'carto' : /^VersaTiles/.test(def.name) ? 'vt' : 'ofm';
    ML_CUR_KIND = kind;
    for (const l of style.layers) {
        const id = l.id, paint = l.paint || (l.paint = {});
        delete paint['fill-pattern'];
        if (l.type === 'background') { paint['background-color'] = ML_STYLE.land; continue; }
        if (l.type === 'raster' || l.type === 'hillshade') { mlHide(l); continue; }
        if (l.type === 'fill' || l.type === 'fill-extrusion') {
            if (id === 'water' || (kind === 'vt' && /^water-(ocean|area)/.test(id))) { paint['fill-color'] = ML_STYLE.water; delete paint['fill-outline-color']; continue; }
            if (/^building/.test(id)) { l.minzoom = Math.max(l.minzoom || 0, 14); paint['fill-color'] = '#000000'; paint['fill-outline-color'] = '#181818'; continue; }
            if (/residential/.test(id)) { paint['fill-color'] = mlLift(ML_STYLE.land, ML_STYLE.urbanLift); paint['fill-opacity'] = 1; delete paint['fill-outline-color']; delete paint['fill-antialias']; continue; }   // built-up areas glow subtly
            if (/^(landcover|land-|landuse_park|landcover_)/.test(id) && !/ice|glacier|rock|sand|wetland|waste|burial|commercial|industrial|water/.test(id)) {
                if (kind === 'carto' && id === 'landcover') {
                    const d = (k) => mlLift(ML_STYLE.land, k);
                    paint['fill-color'] = ['match', ['get', 'kind'], ['wood', 'forest'], d(ML_GROUND.wood),
                        ['grass', 'park', 'meadow', 'scrub', 'garden', 'recreation_ground', 'village_green', 'golf_course', 'playground'], d(ML_GROUND.grass), d(ML_GROUND.farm)];
                    paint['fill-opacity'] = 1; delete paint['fill-outline-color']; continue;
                }
                const dl = mlGroundDelta(id);
                if (dl != null) { paint['fill-color'] = mlLift(ML_STYLE.land, dl); paint['fill-opacity'] = 1; delete paint['fill-outline-color']; continue; }
            }
            mlHide(l);       // other land use / cover: black anyway
            continue;
        }
        if (l.type === 'line') { mlBlackLine(l, kind); continue; }
        if (l.type === 'symbol') { mlBlackSymbol(l, kind); continue; }
    }
    return style;
}

// MapLibre zoom (tar1090 zoom - 1) from which each road class appears: a faint network from UK zoom 7-8.
const ML_ROAD_MINZOOM = {motorway: 4, trunk: 5, primary: 6.5, secondary: 8, minor: 12};

function mlRoadClass(id) {
    if (/motorway|_mot_/.test(id)) return 'motorway';
    if (/trunk/.test(id)) return 'trunk';
    if (/major|_pri_|primary/.test(id)) return 'primary';
    if (/_sec_|secondary|tertiary/.test(id)) return 'secondary';
    return 'minor';
}

function mlRoadWidth(cls) {
    const w = ML_STYLE.roadWidth[cls];
    return ['interpolate', ['linear'], ['zoom'], 5, w[0], 9, w[1], 14, w[2]];
}

// landcover tones around the land colour (fraction toward white, negative = toward black): woods a touch darker,
// grass and parks a touch lighter, farmland slightly lighter
const ML_GROUND = {wood: -0.03, grass: 0.025, farm: 0.012};
function mlGroundDelta(id) {
    if (/wood|forest/.test(id)) return ML_GROUND.wood;
    if (/grass|park|meadow|vegetation|heath|scrub|leisure|garden|recreation/.test(id)) return ML_GROUND.grass;
    if (/agri|farm/.test(id)) return ML_GROUND.farm;
    return null;
}

// colour a little lighter than `hex` (fraction toward white)
function mlLift(hex, k) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    if (!m) return hex;
    const c = [1, 2, 3].map(i => { const v = parseInt(m[i], 16); return Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)))); });
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

function mlRoadLine(l, cls, scale) {
    const paint = l.paint;
    paint['line-color'] = ML_STYLE.road[cls];
    paint['line-opacity'] = 1;
    delete paint['line-gradient']; delete paint['line-dasharray'];
    paint['line-width'] = mlRoadWidth(cls);
    l.minzoom = Math.max(l.minzoom || 0, ML_ROAD_MINZOOM[cls]);
    if (l.layout) delete l.layout['line-cap'];
}

function mlBlackLine(l, kind) {
    const id = l.id, paint = l.paint;
    const carto = kind === 'carto';
    if (kind === 'vt') {
        let m;
        if (/:outline$|tunnel|disputed|maritime|^way-|bridge-way/.test(id)) { mlHide(l); return; }
        if ((m = /^(?:bridge-)?street-(motorway|trunk|primary|secondary|tertiary|minor|residential)$/.exec(id))) {
            mlRoadLine(l, mlRoadClass(m[1]), ML_STYLE.widthScale); return;
        }
        if (/^boundary-(country|state)$/.test(id)) {
            const state = /state/.test(id);
            paint['line-color'] = state ? ML_STYLE.boundary.state : ML_STYLE.boundary.country;
            delete paint['line-blur']; delete paint['line-dasharray'];
            paint['line-width'] = state ? 0.8 : 1;
            l.minzoom = Math.max(l.minzoom || 0, state ? 5 : 0);
            return;
        }
        if (/^airport-runway$/.test(id)) { paint['line-color'] = '#000'; return; }
        mlHide(l); return;
    }
    if (carto && /^(road|bridge)_(mot|trunk|pri|sec)_case(_noramp)?$/.test(id)) {
        // Dark Matter only draws the fills from zoom 10; the casings start at 5-8, so they carry the network
        mlRoadLine(l, mlRoadClass(id), 0.5); return;
    }
    if (carto && /^(road|bridge)_(mot|trunk|pri|sec)_fill(_noramp)?$/.test(id)) { mlHide(l); return; }
    if (/waterway/.test(id)) { mlHide(l); return; }
    if (/^boundary/.test(id)) {
        if (/county|outline/.test(id) || /maritime/.test(id)) { mlHide(l); return; }
        const state = /state/.test(id);
        paint['line-color'] = state ? ML_STYLE.boundary.state : ML_STYLE.boundary.country;
        delete paint['line-blur'];
        paint['line-width'] = state ? 0.8 : 1;
        l.minzoom = Math.max(l.minzoom || 0, state ? 5 : 0);
        return;
    }
    if (/rail|tunnel|_path|^highway_path|taxiway/.test(id)) { mlHide(l); return; }
    if (/aeroway/.test(id)) {
        if (/casing/.test(id)) { paint['line-color'] = '#202020'; return; }
        paint['line-color'] = '#000'; return;
    }
    if (/case|casing|_dashline/.test(id)) { mlHide(l); return; }        // outlines make roads busy
    if (/^(highway|road|bridge)/.test(id)) {
        const cls = mlRoadClass(id);
        if (/service/.test(id)) { mlHide(l); return; }
        paint['line-color'] = ML_STYLE.road[cls];
        paint['line-opacity'] = 1;
        paint['line-width'] = mlRoadWidth(cls);
        const minz = ML_ROAD_MINZOOM[cls];
        l.minzoom = Math.max(l.minzoom || 0, minz);
        return;
    }
    mlHide(l);
}

function mlBlackSymbol(l, kind) {
    let id = l.id;
    if (kind === 'vt') {
        if (!/^label-(place|boundary|water-area-(major|large))/.test(id)) { mlHide(l); return; }
        id = id.replace(/^label-/, '').replace(/-/g, '_');
    }
    // water names: only the big ones (oceans, seas, gulfs); lakes, rivers and streams are hidden
    if (/^watername_(ocean|sea)$|^water_name$|^water_area_(major|large)$/.test(id)) { mlLabelStyle(l, 'water', null, id === 'water_name' ? 3 : null); return; }
    if (/water|poi|housenumber|oneway|waterway|roadname_(minor|sec)|continent/.test(id)) { mlHide(l); return; }
    if (/^highway_name|^roadname/.test(id)) { mlLabelStyle(l, 'small', 9, 12); return; }
    if (/(place|boundary)_country/.test(id)) { mlLabelStyle(l, 'country', null, null); return; }
    if (/(place|boundary)_state/.test(id)) { mlLabelStyle(l, 'state', null, 4); return; }
    if (/place_(hamlet|suburb|other|neighbourhood|quarter)/.test(id)) { mlLabelStyle(l, 'small', 10, 12); return; }
    if (/place_(village|villages)/.test(id)) { mlLabelStyle(l, 'small', 10, 10); return; }
    if (/place_town/.test(id)) { mlLabelStyle(l, 'town', 10, 8); return; }
    if (/place_(city|capital|statecapital)/.test(id)) { mlLabelStyle(l, 'city', 10.5, 5); return; }
    mlLabelStyle(l, 'small', 10, null);
}
