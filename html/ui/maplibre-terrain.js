"use strict";
// Skywatch ADS-B: real terrain for the 3D view.
// Elevation: AWS Open Data "Terrain Tiles" (Terrarium PNG, no key, CORS open, maxzoom 15; we ask for up to zoom 12).
// Terrain is drawn only in 3D (never in 2D or Globe). A dark hillshade sits under the labels. Aircraft lift is measured
// from the terrain surface under the aircraft, so a low aircraft over a hill is not buried and stem and shadow stay attached
// (see the wrapped MLR.liftPxAlt below). Default: on for desktop with a hardware GPU, off on phones and software rendering.
const TERRAIN = {
    exag: 1.5, url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', maxzoom: 12,
    attr: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a> '
        + '(<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">SRTM, USGS 3DEP, Copernicus EU-DEM, Environment Agency and others</a>)',
};
try { const v = parseFloat(localStorage.getItem('terrainExag')); if (isFinite(v) && v >= 0 && v <= 3) TERRAIN.exag = v; } catch (e) { /* default */ }

MLR.terrainDefault = function () {
    try {
        if (matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) return false;
        const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
        if (!gl) return false;
        const x = gl.getExtension('WEBGL_debug_renderer_info'), r = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : '';
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
        return !!r && !/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(r);
    } catch (e) { return false; }
};
MLR.terrainWanted = function () { return typeof terrain3d != 'undefined' && !!terrain3d && TERRAIN.exag > 0 && (!this.q || this.q.terrain); };
// effective exaggeration and DEM max zoom at the current quality level (light terrain: x0.7 and DEM zoom 9)
MLR.terrainExag = function () { return TERRAIN.exag * (this.q && this.q.terrainDetail === 'light' ? 0.7 : 1); };
MLR.terrainDemMax = function () { return this.q && this.q.terrainDetail === 'light' ? 9 : TERRAIN.maxzoom; };
MLR.terrainActive = function () { return !!(this.ready && this.is3D && !this.isGlobe() && this.terrainWanted() && this.map && this.map.getTerrain && this.map.getTerrain()); };

// metres above sea level under ll with the exaggeration removed (null when the tile is not loaded yet)
MLR.terrainElev = function (ll) {
    try { const e = this.map.queryTerrainElevation(ll); return (typeof e == 'number' && TERRAIN.exag > 0) ? e / this.terrainExag() : null; } catch (err) { return null; }
};

// called from install() on every style load: the DEM source and hillshade are part of the style and must be re-added
MLR.installTerrain = function () {
    const m = this.map;
    if (!this.terrainWanted()) return;
    this.terrainSync();
};

MLR.terrainSync = function () {
    const m = this.map;
    if (!m || !this.ready && !m.isStyleLoaded()) return;
    const want = this.terrainWanted() && this.is3D && !this.isGlobe();
    if (want) {
        const dem = {type: 'raster-dem', tiles: [TERRAIN.url], tileSize: 256, maxzoom: this.terrainDemMax(), encoding: 'terrarium', attribution: ''};
        if (this._demMax != null && this._demMax !== dem.maxzoom && m.getSource('tar-dem')) {      // DEM detail changed: the sources are re-added
            try { m.setTerrain(null); } catch (e) { /* ignore */ }
            if (m.getLayer('tar-hillshade')) m.removeLayer('tar-hillshade');
            for (const s of ['tar-dem-hs', 'tar-dem']) if (m.getSource(s)) m.removeSource(s);
        }
        this._demMax = dem.maxzoom;
        if (!m.getSource('tar-dem')) m.addSource('tar-dem', dem);
        if (!m.getSource('tar-dem-hs')) m.addSource('tar-dem-hs', dem);      // MapLibre advises a separate source for hillshade
        if (!m.getLayer('tar-hillshade')) {
            const first = m.getStyle().layers.find(l => l.type === 'symbol');
            m.addLayer({id: 'tar-hillshade', type: 'hillshade', source: 'tar-dem-hs', paint: {
                'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#000000',
                'hillshade-exaggeration': 0.35, 'hillshade-illumination-direction': 315,
            }}, first && first.id);
        }
        m.setTerrain({source: 'tar-dem', exaggeration: this.terrainExag()});
        this.terrainElevCacheClear && this.terrainElevCacheClear();
    } else {
        try { if (m.getTerrain()) m.setTerrain(null); } catch (e) { /* ignore */ }
        if (m.getLayer('tar-hillshade')) m.removeLayer('tar-hillshade');
        if (m.getSource('tar-dem-hs')) m.removeSource('tar-dem-hs');
        if (m.getSource('tar-dem')) m.removeSource('tar-dem');
    }
    this.updateAttribution && this.updateAttribution();
    this.terrainRefresh();
};

MLR.terrainRefresh = function () {
    if (!this.ready) return;
    clearTimeout(this._terrT);
    this._terrT = setTimeout(() => { try { this.liftFlushAll && this.liftFlushAll(); this.liftCamera && this.liftCamera(); this.touch('planes'); } catch (e) { console.warn('terrain refresh:', e); } }, 120);
};

// altitude lift relative to the terrain under the aircraft (alt is feet)
(function () {
    const orig = MLR.liftPxAlt;
    MLR.liftPxAlt = function (ll, alt) {
        if (alt > 0 && this.terrainActive()) {
            const e = this.terrainElev(ll);
            if (e != null && e > 0) alt = alt - e / LIFT.ft;
        }
        return orig.call(this, ll, alt);
    };
    const attr = MLR.updateAttribution;
    MLR.updateAttribution = function () {
        attr.call(this);
        const el = document.getElementById('mlAttribution');
        if (el && this.terrainActive()) el.innerHTML += ' · ' + TERRAIN.attr;
    };
    const s3 = MLR.sync3DLayers;
    MLR.sync3DLayers = function () { s3.call(this); try { this.terrainSync(); } catch (e) { console.warn('terrain:', e); } };
})();

jQuery(function () {
    new Toggle({key: 'terrain3d', display: 'Terrain in 3D view (elevation tiles from AWS Open Data)', container: '#set_appearance', init: MLR.terrainDefault(),
        setState: function (s) { terrain3d = s; if (MLR.ready) MLR.terrainSync(); }});
    const t = setInterval(() => {
        if (!MLR.map) return;
        clearInterval(t);
        let q = 0;
        MLR.map.on('sourcedata', (e) => { if (e.sourceId === 'tar-dem' && e.isSourceLoaded && ++q) MLR.terrainRefresh(); });
    }, 100);
    const inp = document.getElementById('terrainExagRange'), out = document.getElementById('terrainExagValue');
    if (!inp) return;
    const sync = () => { inp.style.setProperty('--fill', (inp.value - inp.min) / (inp.max - inp.min) * 100 + '%'); out.textContent = Number(inp.value) == 0 ? 'off' : Number(inp.value).toFixed(1).replace(/\.0$/, '') + '×'; };
    inp.value = TERRAIN.exag; sync();
    inp.addEventListener('input', () => { TERRAIN.exag = Number(inp.value); sync(); if (MLR.ready) MLR.terrainSync(); });
    inp.addEventListener('change', () => { try { localStorage.setItem('terrainExag', String(TERRAIN.exag)); } catch (e) { /* ignore */ } });
});
window.TERRAIN = TERRAIN;
