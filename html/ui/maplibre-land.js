"use strict";
// Skywatch ADS-B: while an aircraft is selected the land fill lifts from the land colour to #2c2c2c (a paint-property transition of
// about 300 ms, instant under prefers-reduced-motion) and returns on deselect. Nothing is repainted per frame.
(function () {
    const LAND_IDS = ['background', 'landuse_residential', 'landcover_wood', 'landuse_park'];
    const K = (0x2c - 0x18) / (255 - 0x18);                       // fraction toward white that takes the land (#181818) to #2c2c2c
    let lifted = false, base = null;
    const lift = (hex) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); if (!m) return hex;
        return '#' + [1, 2, 3].map(i => { const v = parseInt(m[i], 16); return Math.round(v + (255 - v) * K).toString(16).padStart(2, '0'); }).join(''); };
    const prop = (m, id) => (m.getLayer(id).type === 'background' ? 'background-color' : 'fill-color');
    function apply(on) {
        const m = typeof MLR != 'undefined' && MLR.map;
        if (!m || !MLR.ready) return;
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!base) base = {};
        for (const id of LAND_IDS) {
            if (!m.getLayer(id)) continue;
            const p = prop(m, id);
            if (base[id] == null) { const c = m.getPaintProperty(id, p); if (typeof c != 'string' || !/^#[0-9a-f]{6}$/i.test(c)) continue; base[id] = c; }
            m.setPaintProperty(id, p + '-transition', {duration: reduce ? 0 : 300, delay: 0});
            m.setPaintProperty(id, p, on ? lift(base[id]) : base[id]);
        }
        lifted = on;
    }
    const want = () => !!(typeof liftMapOnSelect != 'undefined' && liftMapOnSelect) && document.body.classList.contains('infoOpen');
    function sync() { const w = want(); if (w !== lifted) apply(w); }
    jQuery(function () {
        new Toggle({key: 'liftMapOnSelect', display: 'Lift map when an aircraft is selected', container: '#set_appearance', init: typeof liftMapOnSelect == 'undefined' ? true : liftMapOnSelect,
            setState: function (s) { liftMapOnSelect = s; sync(); }});
        new MutationObserver(sync).observe(document.body, {attributes: true, attributeFilter: ['class']});
    });
    // a new style (provider switch) drops our changes: forget the cache and re-apply
    const t = setInterval(() => { if (typeof MLR == 'undefined' || !MLR.map) return; clearInterval(t); MLR.map.on('style.load', () => { base = null; lifted = false; setTimeout(sync, 50); }); }, 200);
})();
