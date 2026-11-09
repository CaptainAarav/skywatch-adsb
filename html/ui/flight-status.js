"use strict";
// Skywatch ADS-B: the one-sentence flight status shown in the selected-aircraft sheet. Pure and unit tested
// (tools/test/flight-status.test.js). Built only from received data; with too little data it says nothing.
const FLIGHTSTATUS = (function () {
    const fmt = (n) => Math.round(n).toLocaleString('en-GB');
    // alt: feet (number) or 'ground' or null; vr: ft/min or null; gs: knots or null; metric: show metres
    function sentence(alt, vr, gs, metric) {
        if (alt === 'ground') return (gs != null && gs > 5) ? 'Taxiing on the ground at ' + fmt(gs) + ' kt' : 'On the ground';
        if (typeof alt !== 'number' || !isFinite(alt)) return '';
        const shown = metric ? fmt(alt * 0.3048) + ' m' : fmt(alt) + ' ft';
        if (typeof vr === 'number' && vr <= -300) return 'Descending through ' + shown;
        if (typeof vr === 'number' && vr >= 300) return 'Climbing through ' + shown;
        if (alt >= 18000 && !metric) return 'Cruising at FL' + String(Math.round(alt / 100)).padStart(3, '0');
        if (alt >= 18000) return 'Cruising at ' + shown;
        return 'Level at ' + shown;
    }
    return {sentence};
})();
if (typeof module !== 'undefined') module.exports = FLIGHTSTATUS;
