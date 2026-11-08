"use strict";
// Skywatch ADS-B: MapLibre layer proxies, base map / overlay registry and style assembly.
//
// script.js and settings.js drive map layers through a small OpenLayers-style interface
// (get, getVisible, setVisible, on('change:visible')). MLLayer provides that interface on top of
// MapLibre, so that code keeps working unchanged while the renderer differs.
//
// Providers: keyless only. This site is public, so there must be no API keys and no billing risk.
// CARTO may start requiring a key for its vector styles in future; the automatic fallback below
// (see MLR.baseFailed) keeps the map alive if that happens or if a provider rate-limits (429).

const ML_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
// Label font for everything WE draw (aircraft labels, trails, range rings, airports, GeoJSON layers). The SDF glyph
// files are self-hosted in fonts/glyphs/<stack>/ (made by scripts/gen-sdf-glyphs.py from the OFL fonts in fonts/).
// Flip this one constant to 'JetBrains Mono SemiBold' for a monospaced look. Base-map labels keep the base map's fonts.
const LABEL_FONT = 'Inter SemiBold';
const ML_FONT = [LABEL_FONT];
const ML_LOCAL_STACKS = ['Inter SemiBold', 'JetBrains Mono SemiBold'];
// glyph requests for our own stacks go to the local files, everything else to the base map's glyph server
function mlTransformRequest(url, type) {
    if (type !== 'Glyphs') return undefined;
    const m = /\/([^/]+)\/(\d+-\d+)\.pbf(?:$|\?)/.exec(url);
    if (!m) return undefined;
    const stack = decodeURIComponent(m[1]);
    if (!ML_LOCAL_STACKS.includes(stack)) return undefined;
    return {url: new URL('fonts/glyphs/' + encodeURIComponent(stack) + '/' + m[2] + '.pbf', document.baseURI).href};
}

const ML_ATTR = {
    ofm: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> '
        + '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> '
        + 'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    carto: '© <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> '
        + '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    versatiles: '<a href="https://versatiles.org" target="_blank" rel="noopener">VersaTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    osm: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    esri: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> — Sources: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    arcgis: 'Tiles courtesy of <a href="https://tiles.arcgis.com/" target="_blank" rel="noopener">arcgis.com</a>',
};

// ---------- OpenLayers-style layer proxy ----------
class MLLayer {
    constructor(props) {
        this.p = props;
        this.visible = !!props.visible;
        this.opacity = props.opacity != null ? props.opacity : 1;
        this.h = {};
    }
    get(k) { return this.p[k]; }
    set(k, v) { this.p[k] = v; }
    getVisible() { return this.visible; }
    setVisible(v) {
        v = !!v;
        if (v === this.visible) return;
        this.visible = v;
        MLR.layerVisibility(this);
        this.fire('change:visible');
    }
    getOpacity() { return this.opacity; }
    setOpacity(o) { this.opacity = o; MLR.layerOpacity(this); }
    on(evt, fn) { (this.h[evt] || (this.h[evt] = [])).push(fn); return {layer: this, evt, fn}; }
    un(evt, fn) { this.h[evt] = (this.h[evt] || []).filter(f => f !== fn); }
    fire(evt) { for (const fn of (this.h[evt] || []).slice()) fn({target: this, type: evt}); }
    changed() {}
}

class MLCollection {
    constructor() { this.a = []; }
    push(l) { this.a.push(l); return this.a.length; }
    remove(l) { this.a = this.a.filter(x => x !== l); }
    getArray() { return this.a; }
    getLength() { return this.a.length; }
}

// {a-d} / {1-3} subdomain patterns (OpenLayers) -> list of URLs
function mlExpandUrl(url) {
    const m = url.match(/\{([a-z0-9])-([a-z0-9])\}/);
    if (!m) return [url];
    const out = [];
    for (let c = m[1].charCodeAt(0); c <= m[2].charCodeAt(0); c++)
        out.push(url.replace(m[0], String.fromCharCode(c)));
    return out;
}

// ---------- base map definitions ----------
function mlVector(name, title, style, o) {
    return Object.assign({name, title, type: 'base', kind: 'vector', style, region: 'world', visible: false}, o || {});
}
function mlRasterBase(name, title, url, o) {
    return Object.assign({name, title, type: 'base', kind: 'raster', tiles: mlExpandUrl(url), tileSize: 256, region: 'world', visible: false}, o || {});
}

function mlBaseDefs() {
    const d = [];
    const ofm = 'https://tiles.openfreemap.org/styles/';
    if (typeof offlineMapDetailOFM != 'undefined' && offlineMapDetailOFM > 0) {
        d.push(mlVector('OpenFreeMapOfflineBright', 'OpenFreeMap Offl. Bright', './openfreemap_offline/bright', {attribution: ML_ATTR.ofm}));
        d.push(mlVector('OpenFreeMapOfflineLiberty', 'OpenFreeMap Offl. Lib.', './openfreemap_offline/liberty', {attribution: ML_ATTR.ofm}));
        d.push(mlVector('OpenFreeMapOfflinePositron', 'OpenFreeMap Offl. Pos.', './openfreemap_offline/positron', {attribution: ML_ATTR.ofm}));
        d.push(mlVector('OpenFreeMapOfflineDark', 'OpenFreeMap Offl. Dark', './openfreemap_offline/dark', {attribution: ML_ATTR.ofm, black: true}));
        d.push(mlVector('OpenFreeMapOfflineFiord', 'OpenFreeMap Offl. Fiord', './openfreemap_offline/fiord', {attribution: ML_ATTR.ofm}));
    }
    d.push(mlVector('OpenFreeMapDark', 'OpenFreeMap Dark', ofm + 'dark', {attribution: ML_ATTR.ofm, black: true, fallback: 'CartoDarkMatterVector'}));
    d.push(mlVector('CartoDarkMatterVector', 'CARTO Dark Matter', 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        {attribution: ML_ATTR.carto, black: true, fallback: 'OpenFreeMapDark'}));
    d.push(mlVector('VersaTilesDark', 'VersaTiles Dark', 'https://tiles.versatiles.org/assets/styles/colorful-dark/style.json',
        {attribution: ML_ATTR.versatiles, black: true, fallback: 'CartoDarkMatterVector'}));
    d.push(mlVector('OpenFreeMapPositron', 'OpenFreeMap Positron', ofm + 'positron', {attribution: ML_ATTR.ofm}));
    d.push(mlVector('OpenFreeMapFiord', 'OpenFreeMap Fiord', ofm + 'fiord', {attribution: ML_ATTR.ofm}));
    d.push(mlVector('OpenFreeMapLiberty', 'OpenFreeMap Liberty', ofm + 'liberty', {attribution: ML_ATTR.ofm}));
    d.push(mlVector('OpenFreeMapBright', 'OpenFreeMap Bright', ofm + 'bright', {attribution: ML_ATTR.ofm}));

    if (typeof loStore != 'undefined' && loStore['customTiles'] != undefined)
        d.push(mlRasterBase('custom_tiles', 'Custom tiles', loStore['customTiles'], {region: 'custom', maxzoom: 20}));
    if (typeof offlineMapDetail != 'undefined' && offlineMapDetail > 0)
        d.push(mlRasterBase('osm_tiles_offline', 'OpenStreetMap offline', 'osm_tiles_offline/{z}/{x}/{y}.png', {attribution: ML_ATTR.osm, maxzoom: offlineMapDetail}));
    d.push(mlRasterBase('osm', 'OpenStreetMap', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: ML_ATTR.osm, maxzoom: 17}));
    d.push(mlRasterBase('osm_de', 'OpenStreetMap DE', 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', {attribution: ML_ATTR.osm, maxzoom: 17}));
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    d.push(mlRasterBase('esri', 'ESRI.com Sat.', esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {attribution: ML_ATTR.esri, maxzoom: 17}));
    d.push(mlRasterBase('esri_gray', 'ESRI.com Gray', esri + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {attribution: ML_ATTR.esri, maxzoom: 16}));
    d.push(mlRasterBase('esri_streets', 'ESRI.com Streets', esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {attribution: ML_ATTR.esri, maxzoom: 17}));

    const date = new Date(Date.now() - 86400 * 1000);
    const y = date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
    d.push(mlRasterBase('gibs', 'GIBS Clouds ' + y,
        'https://gibs-{a-c}.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/' + y + '/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
        {attribution: 'MODIS Terra ' + y + ', NASA GIBS / EOSDIS', maxzoom: 9}));

    const arc = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
    const chart = (name, title, svc, min, max) => d.push(mlRasterBase(name, title, arc + svc + '/MapServer/tile/{z}/{y}/{x}',
        {attribution: ML_ATTR.arcgis, minzoom: min, maxzoom: max, region: 'us'}));
    chart('VFR_Sectional', 'VFR Sectional Chart', 'VFR_Sectional', 8, 12);
    chart('VFR_Terminal', 'VFR Terminal Chart', 'VFR_Terminal', 10, 12);
    chart('IFR_AreaLow', 'IFR Enroute Chart Low', 'IFR_AreaLow', 8, 11);
    chart('IFR_High', 'IFR Enroute Chart High', 'IFR_High', 7, 11);
    return d;
}

// ---------- overlay definitions ----------
function mlOverlayRaster(name, title, urls, o) {
    return Object.assign({name, title, type: 'overlay', kind: 'raster', tiles: urls, tileSize: 256, visible: false, region: 'world'}, o || {});
}
function mlOverlayGeo(title, name, url, fill, stroke, showLabel, region) {
    return {name, title, type: 'overlay', kind: 'geojson', url, fill, stroke, label: showLabel !== false, visible: false, region: region || 'world'};
}

function mlOverlayDefs() {
    const d = [];
    const wms = (base, layers, extra) => base + '?service=WMS&version=1.1.1&request=GetMap&layers=' + layers
        + '&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}' + (extra || '');
    d.push(mlOverlayRaster('openaip', 'openAIP TMS', ['https://map.adsbexchange.com/mapproxy/tiles/1.0.0/openaip/ul_grid/{z}/{x}/{y}.png'],
        {opacity: typeof openAIPOpacity != 'undefined' ? openAIPOpacity : 0.7, maxzoom: 12, attribution: 'openAIP.net'}));
    d.push(Object.assign(mlOverlayGeo('TFRs', 'tfrs', 'https://raw.githubusercontent.com/wiedehopf/tar1090-aux/master/tfrs.geojson',
        'rgba(255,0,0,0.08)', 'rgb(255,0,0)', true, 'us'), {labelProp: ['concat', ['get', 'NOTAM_KEY'], '\n', ['get', 'LEGAL']], refresh: 5 * 60 * 1000,
        opacity: typeof tfrOpacity != 'undefined' ? tfrOpacity : 0.8}));
    d.push(Object.assign(mlOverlayGeo('Special Use Airspace', 'sua', 'https://opendata.arcgis.com/datasets/dd0d1b726e504137ab3c41b21835d05b_0.geojson',
        'rgba(72,149,239,0.3)', 'rgb(72,149,239)', false, 'us'), {
        fillExpr: ['match', ['get', 'TYPE_CODE'], ['P', 'R', 'W'], 'rgba(72,149,239,0.3)', ['A', 'MOA'], 'rgba(133,45,69,0.3)', 'rgba(0,0,0,0)'],
        strokeExpr: ['match', ['get', 'TYPE_CODE'], ['P', 'R', 'W'], 'rgb(72,149,239)', ['A', 'MOA'], 'rgb(133,45,69)', 'rgba(0,0,0,0)'],
    }));
    d.push(mlOverlayRaster('nexrad', 'NEXRAD', ['https://mesonet{s}.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png'].flatMap(u => [1, 2, 3].map(i => u.replace('{s}', i))),
        {opacity: typeof nexradOpacity != 'undefined' ? nexradOpacity : 0.6, maxzoom: 8, attribution: 'NEXRAD courtesy of IEM', region: 'us', refresh: 2 * 60 * 1000, bust: true}));
    d.push(mlOverlayRaster('noaa_sat', 'NOAA Infrared Sat', [wms('https://nowcoast.noaa.gov/geoserver/satellite/wms', 'global_longwave_imagery_mosaic')],
        {opacity: typeof noaaInfraredOpacity != 'undefined' ? noaaInfraredOpacity : 0.35, attribution: 'NOAA', region: 'us', refresh: 15 * 60 * 1000, bust: true}));
    d.push(mlOverlayRaster('noaa_radar', 'NOAA Radar', [wms('https://nowcoast.noaa.gov/geoserver/weather_radar/wms', 'base_reflectivity_mosaic')],
        {opacity: typeof noaaRadarOpacity != 'undefined' ? noaaRadarOpacity : 0.8, attribution: 'NOAA', region: 'us', refresh: 5 * 60 * 1000, bust: true}));
    if (typeof enableDWD != 'undefined' && enableDWD) {
        d.push(mlOverlayRaster('radolan', 'DWD RADOLAN', [wms('https://maps.dwd.de/geoserver/wms', typeof dwdLayers != 'undefined' ? dwdLayers : 'dwd:RX')],
            {opacity: typeof dwdRadolanOpacity != 'undefined' ? dwdRadolanOpacity : 0.6, tileSize: 256, attribution: 'Deutscher Wetterdienst (DWD)', region: 'europe', refresh: 5 * 60 * 1000, bust: true}));
    }
    d.push(mlOverlayRaster('rainviewer_radar', 'RainViewer Radar', [], {
        opacity: typeof rainViewerRadarOpacity != 'undefined' ? rainViewerRadarOpacity : 0.6, tileSize: 512, maxzoom: 7,
        attribution: '<a href="https://www.rainviewer.com/api.html" target="_blank" rel="noopener">RainViewer.com</a>',
        dynamic: 'rainviewer', refresh: 2 * 60 * 1000,
    }));

    const amber = ['rgba(252,186,3,0.3)', 'rgba(252,186,3,1)'];
    const blue = ['rgba(52,50,168,0.3)', 'rgba(52,50,168,1)'];
    d.push(mlOverlayGeo('PL AWACS Orbits', 'plawacsorbits', 'geojson/PL_Mil_AWACS_Orbits.geojson', amber[0], amber[1], false, 'europe'));
    d.push(mlOverlayGeo('NL AWACS Orbits', 'nlawacsorbits', 'geojson/NL_Mil_AWACS_Orbits.geojson', amber[0], amber[1], false, 'europe'));
    d.push(mlOverlayGeo('DE AWACS Orbits', 'deawacsorbits', 'geojson/DE_Mil_AWACS_Orbits.geojson', amber[0], amber[1], false, 'europe'));
    d.push(mlOverlayGeo('DE Low Flying Areas', 'delowflyingareas', 'geojson/DE_Mil_LFA.geojson', 'rgba(255,60,0,0.25)', 'rgba(255,60,0,1)', false, 'europe'));
    d.push(mlOverlayGeo('UK Radar Corridors', 'ukradarcorridors', 'geojson/UK_Mil_RC.geojson', 'rgba(22,171,22,0.3)', 'rgba(22,171,22,1)', true, 'europe'));
    d.push(mlOverlayGeo('UK A2A Refueling', 'uka2arefueling', 'geojson/UK_Mil_AAR_Zones.geojson', blue[0], blue[1], true, 'europe'));
    d.push(mlOverlayGeo('UK AWACS Orbits', 'ukawacsorbits', 'geojson/UK_Mil_AWACS_Orbits.geojson', amber[0], amber[1], false, 'europe'));
    d.push(mlOverlayGeo('US A2A Refueling', 'usa2arefueling', 'geojson/US_A2A_refueling.geojson', blue[0], blue[1], true, 'us'));
    d.push(mlOverlayGeo('US ARTCC Boundaries', 'usartccboundaries', 'geojson/US_ARTCC_boundaries.geojson', 'rgba(255,0,255,0.3)', 'rgba(255,0,255,1)', false, 'us'));
    if (typeof uk_advisory != 'undefined' && uk_advisory) {
        d.push(mlOverlayGeo('uka_airports', 'uka_airports', 'geojson/uk_advisory/airports.geojson', 'rgba(255,255,255,1)', 'rgba(255,255,255,1)', true, 'europe'));
        d.push(mlOverlayGeo('uka_airspaces', 'uka_airspaces', 'https://raw.githubusercontent.com/wiedehopf/tar1090-aux/master/uk_advisory/airspaces.geojson', 'rgba(0,0,0,0.1)', 'rgba(0,30,255,0.2)', true, 'europe'));
        d.push(mlOverlayGeo('uka_runways', 'uka_runways', 'geojson/uk_advisory/runways.geojson', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.5)', true, 'europe'));
        d.push(mlOverlayGeo('uka_shoreham', 'uka_shoreham', 'geojson/uk_advisory/shoreham.geojson', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.5)', true, 'europe'));
    }
    if (typeof l3harris != 'undefined' && l3harris) {
        ['IFT_NAV_Routes.geojson', 'IFT_Training_Areas.geojson', 'USAFA_Training_Areas.geojson'].forEach((f, i) =>
            d.push(mlOverlayGeo(f.split('.')[0], 'ift' + i, 'geojson/IFT/' + f, blue[0], blue[1], true, 'us')));
    }
    return d;
}

// Called from initMapEarly(): builds the layer list script.js and settings.js expect.
function mlCreateLayers() {
    g.getRainviewerMaps = async function () {
        const response = await fetch("https://api.rainviewer.com/public/weather-maps.json", {credentials: "omit"});
        return await response.json();
    };
    layers = new MLCollection();
    layers_group = {getLayers() { return layers; }, get() { return undefined; }};
    for (const def of mlBaseDefs()) layers.push(new MLLayer(def));
    for (const def of mlOverlayDefs()) layers.push(new MLLayer(def));
}

// built-in overlays (range rings, receiver dot, outline, trails) are MLLayers too
function mlBuiltinLayer(props) {
    const l = new MLLayer(Object.assign({kind: 'builtin', region: ''}, props));
    layers.push(l);
    return l;
}

// ---------- style assembly ----------
// relative style URLs (offline maps) -> absolute; {z}/{x}/{y} tokens must survive
function mlAbsolute(u, base) {
    if (/^https?:\/\//.test(u)) return u;
    try { return new URL(u, base).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}'); } catch (e) { return u; }
}

async function mlBuildStyle(def) {
    if (def.kind === 'raster') {
        const src = {type: 'raster', tiles: def.tiles, tileSize: def.tileSize || 256, attribution: def.attribution || ''};
        if (def.maxzoom != null) src.maxzoom = def.maxzoom;
        if (def.minzoom != null) src.minzoom = def.minzoom;
        return {
            version: 8, glyphs: ML_GLYPHS,
            sources: {base: src},
            layers: [
                {id: 'bg', type: 'background', paint: {'background-color': '#000'}},
                {id: 'base', type: 'raster', source: 'base'},
            ],
        };
    }
    const url = mlAbsolute(def.style, location.href);
    const r = await fetch(url);
    if (!r.ok) throw new Error('style HTTP ' + r.status);
    let style = await r.json();
    for (const s of Object.values(style.sources || {})) {
        if (s.url) s.url = mlAbsolute(s.url, url);
        if (s.tiles) s.tiles = s.tiles.map(t => mlAbsolute(t, url));
    }
    if (Array.isArray(style.sprite)) style.sprite.forEach(sp => { sp.url = mlAbsolute(sp.url, url); });
    else if (style.sprite) style.sprite = mlAbsolute(style.sprite, url);
    if (style.glyphs) style.glyphs = mlAbsolute(style.glyphs, url);
    if (def.black) style = mlBlackStyle(style, def);
    if (!style.glyphs) style.glyphs = ML_GLYPHS;
    return style;
}
