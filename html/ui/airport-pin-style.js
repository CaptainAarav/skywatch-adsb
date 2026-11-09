"use strict";
// Skywatch ADS-B: the airport marker (restored from commit 8577ca7, ui/maplibre-airports.js "airport pin"): a round flag inside a dark circle whose
// RING is the colour indicator (flight category from a METAR under 3 h old, neutral grey otherwise), the airport CODE below it (IATA, else ICAO)
// and, at a tier's detail zoom, the airport name on a second line in the old styling. Pure data: the values below are pinned against that commit in
// tools/test/airport-pin-style.test.js (only the zoom range and the tier filter differ from it).
const AIRPIN = (function () {
    const SPRITE = {size: 48, pixelRatio: 2, fill: '#1c1c1c', clipInset: 2, ringInset: 2.5, ringWidth: 5, neutralRing: '#6e6e6e'};
    const CAT_COLOR = {VFR: '#3DDC97', MVFR: '#F5B94A', IFR: '#FF6B6B', LIFR: '#B07BFF'};
    // layout of a pin layer, as in the old commit (text-size 11 * globalScale, font = ML_FONT)
    function layout(font, gs, textField) {
        return {
            'icon-image': ['concat', 'flagc-', ['get', 'f'], '-', ['get', 'w']], 'icon-size': 1, 'icon-allow-overlap': false,
            'text-field': textField,
            'text-font': font, 'text-size': 11 * gs, 'text-anchor': 'top', 'text-offset': [0, 1.0], 'text-optional': true, 'text-max-width': 12,
            'symbol-sort-key': ['get', 's'],
            'icon-padding': 6, 'text-padding': 3,
        };
    }
    const PAINT = {'text-color': '#8f8f8f', 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 0.8};
    // label of a tier layer: the code from the dot zoom, code + name (second line, smaller, #aaaaaa) from the detail zoom
    function textField(zDot, zDetail) {
        const code = ['get', 'c'];
        const withName = ['format', code, {'font-scale': 0.95}, '\n', {}, ['get', 'nm'], {'font-scale': 0.85, 'text-color': '#aaaaaa'}];
        return zDetail <= zDot ? withName : ['step', ['zoom'], code, zDetail, withName];
    }
    // image id for a feature: flagc-<ISO country>-<VFR|MVFR|IFR|LIFR|N>
    const ID_RE = /^flagc-([A-Z]{2})-(VFR|MVFR|IFR|LIFR|N)$/;
    function imageId(cc, cat) { return 'flagc-' + (/^[A-Z]{2}$/.test(cc || '') ? cc : 'XX') + '-' + (CAT_COLOR[cat] ? cat : 'N'); }
    return {SPRITE, CAT_COLOR, layout, PAINT, textField, ID_RE, imageId};
})();
if (typeof module !== 'undefined') module.exports = AIRPIN;
