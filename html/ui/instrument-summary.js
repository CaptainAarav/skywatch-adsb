"use strict";
// Skywatch ADS-B: the SUMMARY lines of the instrument cards (altitude, speed, direction). Pure and unit tested
// (tools/test/instrument-summary.test.js). Callers pass raw receiver values plus a formatter for their units; a value the
// receiver does not have comes back as DASH (shown muted), never as a guess.
const INSTSUM = (function () {
    const DASH = '–';
    const num = (v) => typeof v === 'number' && isFinite(v);
    // altitude headline: {value, unit, fl}; fl is a flight level string at or above 18,000 ft (feet are always the input)
    function altitude(altFt, onGround, fmt, unit) {
        if (onGround) return {value: 'Ground', unit: '', fl: ''};
        if (!num(altFt)) return {value: DASH, unit: '', fl: ''};
        return {value: fmt(altFt), unit: unit || '', fl: altFt >= 18000 ? 'FL' + String(Math.round(altFt / 100)).padStart(3, '0') : ''};
    }
    // vertical trend from the vertical rate in ft/min; text is the already formatted magnitude with its unit
    function trend(rate, magText) {
        if (!num(rate)) return {cls: '', glyph: '', text: ''};
        if (rate > 300) return {cls: 'climb', glyph: '▲', text: magText};
        if (rate < -300) return {cls: 'descend', glyph: '▼', text: magText};
        return {cls: 'level', glyph: '', text: 'Level'};
    }
    // speed headline: ground speed, else true, else indicated; sub line: Mach if known, else IAS/TAS when the headline is ground speed
    function speed(s, fmt, unit) {
        const kind = num(s.gs) ? 'GS' : num(s.tas) ? 'TAS' : num(s.ias) ? 'IAS' : '';
        const v = kind === 'GS' ? s.gs : kind === 'TAS' ? s.tas : kind === 'IAS' ? s.ias : null;
        let sub = '';
        if (num(s.mach) && s.mach > 0) sub = 'Mach ' + s.mach.toFixed(2);
        else if (kind === 'GS' && num(s.ias)) sub = 'IAS ' + fmt(s.ias);
        else if (kind === 'GS' && num(s.tas)) sub = 'TAS ' + fmt(s.tas);
        return {value: v == null ? DASH : fmt(v), unit: v == null ? '' : unit || '', kind, sub};
    }
    const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    // direction headline: track as a 3 digit degree value and its compass point
    function direction(track) {
        if (!num(track)) return {value: DASH, sub: ''};
        const t = ((Math.round(track) % 360) + 360) % 360;
        return {value: String(t).padStart(3, '0') + '°', sub: NAMES[Math.floor((t + 22.5) / 45) % 8]};
    }
    return {altitude, trend, speed, direction, DASH};
})();
if (typeof module !== 'undefined') module.exports = INSTSUM;
