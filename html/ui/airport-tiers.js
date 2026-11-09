"use strict";
// Skywatch ADS-B: which airports get a dot, a code and a name at which zoom. Pure (unit tested in tools/test/airport-tiers.test.js).
// Input is a row of html/airport-db/airports.json:
//   [icao, iata, typeIdx, name, lat, lon, elev, country, region, city, wiki, runways[], freqs[], scheduled(0|1)]
// typeIdx: 0 large_airport, 1 medium_airport, 2 small_airport, 3 seaplane_base, 4 balloonport. The data has no heliports and no closed
// airfields (tools/build-airports.py drops them), so those two OurAirports types can never appear on the map.
const AIRTIERS = (function () {
    const FT_PER_800M = 2624.9;                   // 800 m
    // tier id -> minimum zoom of the dot, the code and the name (desktop, "Normal" density)
    const TIERS = {
        large:    {dot: 3.5,  code: 5,    name: 8},
        medium:   {dot: 5.5,  code: 7,    name: 9.5},
        regional: {dot: 8,    code: 9,    name: 10.5},     // small airport with a paved runway of 800 m or more, or scheduled service
        field:    {dot: 10,   code: 11,   name: 12.5},     // other small airfields (name after the code; the brief names no zoom for it)
        water:    {dot: 11.5, code: 12,   name: 13},       // seaplane bases and balloon ports (heliports are not in the data)
    };
    const ORDER = ['large', 'medium', 'regional', 'field', 'water'];
    const PHONE_SHIFT = -0.5;                      // phones show everything half a zoom level earlier
    const DENSITY = {fewer: 1.5, normal: 0, more: -1.5};
    // OurAirports surfaces are free text ("ASP", "ASPH-G", "Concrete", "GRVL-F", "Grassed brown clay"): take the part before the
    // condition suffix and accept the paved families only. Unknown or blank surfaces are NOT assumed to be paved.
    const PAVED_BASE = /^(ASP|ASPH|ASPHALT|CON|CONC|CONCRETE|PEM|PER|BIT|BITUMEN|PAVED|PAVEMENT|TARMAC|TAR|MAC|MACADAM)$/;
    function isPaved(surface) {
        const base = String(surface == null ? '' : surface).split(/[-\/]/)[0].trim().toUpperCase();
        return PAVED_BASE.test(base);
    }
    // longest runway in feet, optionally only the paved ones
    function longestFt(rwys, pavedOnly) {
        let best = 0;
        for (const r of rwys || []) {
            const len = r && typeof r[2] == 'number' ? r[2] : 0;
            if (pavedOnly && !isPaved(r && r[4])) continue;
            if (len > best) best = len;
        }
        return best;
    }
    // tier id for a database row
    function tierOf(row) {
        const type = row[2];
        if (type === 0) return 'large';
        if (type === 1) return 'medium';
        if (type === 2) {
            if (row[13] === 1 || longestFt(row[11], true) >= FT_PER_800M) return 'regional';
            return 'field';
        }
        return 'water';
    }
    // minimum zooms for a row: {tier, dot, code, name}. opts: {phone, density: fewer|normal|more}
    function minZooms(row, opts) {
        const o = opts || {}, t = tierOf(row), z = TIERS[t];
        const shift = (DENSITY[o.density || 'normal'] || 0) + (o.phone ? PHONE_SHIFT : 0);
        const f = (v) => Math.max(0, Math.round((v + shift) * 100) / 100);
        return {tier: t, dot: f(z.dot), code: f(z.code), name: f(z.name)};
    }
    // minimum zooms of a whole tier (what a layer filter by tier uses)
    function tierZooms(tier, opts) {
        const o = opts || {}, z = TIERS[tier];
        const shift = (DENSITY[o.density || 'normal'] || 0) + (o.phone ? PHONE_SHIFT : 0);
        const f = (v) => Math.max(0, Math.round((v + shift) * 100) / 100);
        return {dot: f(z.dot), code: f(z.code), name: f(z.name)};
    }
    // importance, lower = more important: type first, then runway length, then scheduled service (MapLibre symbol-sort-key)
    function sortKey(row) {
        const typeRank = row[2] <= 3 ? row[2] : 4;
        const len = Math.min(99999, longestFt(row[11], false));
        return typeRank * 1000000 + (99999 - len) * 10 + (row[13] === 1 ? 0 : 1);
    }
    // the code shown on the map: IATA, else ICAO
    function code(row) { return row[1] || row[0]; }
    // label at low zoom is the code only; "IATA  Name" when there is room (a name is added by the name layer)
    function nameText(row) { return code(row) + '  ' + String(row[3] || '').replace(/\s+(International|Intl\.?)?\s*Airport$/i, '').replace(/\s+Airport$/i, '').trim(); }
    function densityFrom(v) { return v === 'fewer' || v === 'more' ? v : 'normal'; }
    return {TIERS, ORDER, DENSITY, PHONE_SHIFT, FT_PER_800M, isPaved, longestFt, tierOf, minZooms, tierZooms, sortKey, code, nameText, densityFrom};
})();
if (typeof module !== 'undefined') module.exports = AIRTIERS;
