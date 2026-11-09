"use strict";
// Skywatch ADS-B: Settings > Aircraft colour. White (default) or by altitude. Affects map aircraft icons only;
// tracks always use the altitude gradient. Stored in this browser under its own key.
(function () {
    const KEY = 'aircraftColor2';
    try { const v = localStorage.getItem(KEY); if (v === 'white' || v === 'altitude') aircraftColor = v; } catch (e) { /* default */ }
    function apply() {
        if (typeof g == 'undefined' || !g.planesOrdered) return;
        for (const p of g.planesOrdered) { try { p.updateIcon(); } catch (e) { /* plane without a shape yet */ } }
        if (typeof MLR != 'undefined' && MLR.ready) MLR.touch('planes');
        const lg = document.getElementById('altitude_legend');
        if (lg && typeof renderAltitudeLegend == 'function') renderAltitudeLegend(lg);
    }
    jQuery(function () {
        const list = document.getElementById('set_appearance');
        if (!list) return;
        const row = document.createElement('div'); row.className = 'setSlider';
        const lab = document.createElement('label'); lab.htmlFor = 'aircraftColorSel';
        const t = document.createElement('span'); t.textContent = 'Aircraft colour';
        lab.appendChild(t);
        const sel = document.createElement('select'); sel.id = 'aircraftColorSel'; sel.className = 'searchInput';
        for (const [v, n] of [['white', 'White'], ['altitude', 'By altitude']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); }
        sel.value = aircraftColor;
        sel.addEventListener('change', () => { aircraftColor = sel.value; try { localStorage.setItem(KEY, aircraftColor); } catch (e) { /* ignore */ } apply(); });
        row.append(lab, sel);
        list.insertBefore(row, list.firstChild);
    });
    // "Dim other aircraft": while one is selected the rest draw at about 60%; the selected one stays at full brightness
    function syncDim() {
        const m = typeof MLR != 'undefined' && MLR.map;
        if (!m || !MLR.ready || !m.getLayer('tar-planes')) return;
        const on = !!dimOthers && document.body.classList.contains('infoOpen');
        try { m.setPaintProperty('tar-planes', 'icon-opacity', on ? ['case', ['==', ['get', 'sel'], 1], 1, 0.6] : 1); } catch (e) { /* style changing */ }
    }
    jQuery(function () {
        new Toggle({key: 'dimOthers', display: 'Dim other aircraft when one is selected', container: '#set_appearance', init: dimOthers,
            setState: function (s) { dimOthers = s; syncDim(); }});
        new MutationObserver(syncDim).observe(document.body, {attributes: true, attributeFilter: ['class']});
        const t = setInterval(() => { if (typeof MLR == 'undefined' || !MLR.map) return; clearInterval(t); MLR.map.on('style.load', () => setTimeout(syncDim, 80)); }, 200);
    });
})();
