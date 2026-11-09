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
})();
