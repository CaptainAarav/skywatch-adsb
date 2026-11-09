"use strict";
// Skywatch ADS-B: watchlist rule matching and throttling (pure; unit tested in tools/test/alerts-calc.test.js).
const ALERTCALC = (function () {
    const TYPES = {
        reg: 'Registration', hex: 'Hex code', callsign_prefix: 'Callsign starts with', type: 'Aircraft type',
        military: 'Any military aircraft', emergency: 'Emergency squawk (7500, 7600, 7700)', interesting: 'Interesting aircraft (database)',
    };
    const NEEDS_VALUE = {reg: 1, hex: 1, callsign_prefix: 1, type: 1};
    const SQ = {'7500': 'hijack', '7600': 'radio failure', '7700': 'general emergency'};
    const DEDUPE_MS = 30 * 60 * 1000, SNOOZE_MS = 60 * 60 * 1000, MAX_PER_MIN = 5;

    function clean(rule) {                      // returns a safe rule or null
        if (!rule || !TYPES[rule.type]) return null;
        let v = String(rule.value == null ? '' : rule.value).trim().toUpperCase().slice(0, 12);
        if (NEEDS_VALUE[rule.type]) {
            if (!v) return null;
            if (rule.type === 'hex') { v = v.replace(/^~/, ''); if (!/^[0-9A-F]{6}$/.test(v)) return null; }
            else if (!/^[A-Z0-9\-]+$/.test(v)) return null;
        } else v = '';
        return {type: rule.type, value: v, on: rule.on !== false};
    }
    function sameRule(a, b) { return a.type === b.type && a.value === b.value; }
    function label(rule) { return NEEDS_VALUE[rule.type] ? TYPES[rule.type] + ' ' + rule.value : TYPES[rule.type]; }

    // plane: {hex, flight, reg, type, squawk, military, interesting}; returns a reason or null
    function match(plane, rule) {
        if (!rule || rule.on === false) return null;
        const hex = String(plane.hex || '').toUpperCase().replace(/^~/, ''), flight = String(plane.flight || '').trim().toUpperCase();
        const reg = String(plane.reg || '').toUpperCase(), type = String(plane.type || '').toUpperCase(), sq = String(plane.squawk || '');
        switch (rule.type) {
            case 'emergency': return SQ[sq] ? 'Squawking ' + sq + ' (' + SQ[sq] + ')' : null;
            case 'military': return plane.military ? 'Military aircraft' : null;
            case 'interesting': return plane.interesting ? 'Interesting aircraft' : null;
            case 'hex': return hex && hex === rule.value ? 'Hex ' + hex : null;
            case 'reg': return reg && reg === rule.value ? 'Registration ' + reg : null;
            case 'callsign_prefix': return flight && rule.value && flight.startsWith(rule.value) ? 'Callsign ' + rule.value + '*' : null;
            case 'type': return type && type === rule.value ? 'Type ' + type : null;
        }
        return null;
    }

    // state: {off, snoozeUntil, seen:{key:ts}, recent:[ts]}; returns events to show, mutates state
    function evaluate(planes, rules, state, now) {
        const out = [];
        if (!state || state.off || (state.snoozeUntil && now < state.snoozeUntil)) return out;
        state.seen = state.seen || {}; state.recent = (state.recent || []).filter(t => now - t < 60000);
        for (const p of planes) {
            for (const r of rules) {
                const why = match(p, r);
                if (!why) continue;
                const key = p.hex + '|' + r.type + '|' + r.value;
                if (state.seen[key] && now - state.seen[key] < DEDUPE_MS) continue;
                if (state.recent.length >= MAX_PER_MIN) return out;
                state.seen[key] = now; state.recent.push(now);
                out.push({hex: p.hex, flight: String(p.flight || '').trim(), reg: p.reg || '', type: p.type || '', reason: why, emergency: r.type === 'emergency'});
                break;                             // one alert per aircraft per pass
            }
        }
        const keys = Object.keys(state.seen);
        if (keys.length > 1000) for (const k of keys) if (now - state.seen[k] > DEDUPE_MS) delete state.seen[k];
        return out;
    }
    return {TYPES, NEEDS_VALUE, DEDUPE_MS, SNOOZE_MS, MAX_PER_MIN, clean, sameRule, label, match, evaluate};
})();
if (typeof module !== 'undefined') module.exports = ALERTCALC;
