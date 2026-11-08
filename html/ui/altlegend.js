// Skywatch ADS-B: altitude legend
//
// Draws the legend from the same altitudeColor() the aircraft
// icons use (planeObject.js), sampled at evenly spaced altitudes, so the
// ticks sit where those colours really are. Follows the altitude unit
// setting, ColorByAlt overrides in config.js and the "Darker Colors" toggle.
"use strict";

function renderAltitudeLegend(container) {
    if (!container)
        return;

    const metric = units_for('altitude', DisplayUnits) === 'metric';
    const FEET_PER_METRE = 3.28084;
    // ticks in display units; the last one is open-ended ("40k+")
    const ticks = metric ? [0, 3000, 6000, 9000, 12000] : [0, 10000, 20000, 30000, 40000];
    const max = ticks[ticks.length - 1];
    const toFeet = (v) => metric ? v * FEET_PER_METRE : v;

    // CSS gradient sampled from the real colour scale (40 stops is plenty for a 6px bar)
    const steps = 40;
    const stops = [];
    for (let i = 0; i <= steps; i++) {
        const c = altitudeColor(toFeet(max * i / steps));
        stops.push('hsl(' + c[0].toFixed(1) + ',' + c[1].toFixed(1) + '%,' + c[2].toFixed(1) + '%) '
            + (100 * i / steps).toFixed(1) + '%');
    }

    // ticks are evenly spaced in altitude, so space-between puts each label at its colour
    const label = (v) => (v === 0 ? '0' : (v / 1000) + 'k');
    const tickHtml = ticks.map((t, i) => '<span>' + label(t) + (i === ticks.length - 1 ? '+' : '') + '</span>').join('');

    const unit = metric ? 'm' : 'ft';
    container.innerHTML =
        '<div class="altLegendHead"><span>Altitude</span><span class="altLegendUnit">' + unit + '</span></div>'
        + '<div class="altLegendBar" role="img" aria-label="Altitude colour scale, 0 to ' + label(max) + ' ' + unit
        + ' and above" style="background:linear-gradient(90deg,' + stops.join(',') + ')"></div>'
        + '<div class="altLegendTicks" aria-hidden="true">' + tickHtml + '</div>';
}
