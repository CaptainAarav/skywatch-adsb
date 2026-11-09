"use strict";
// Skywatch ADS-B: ranking for the command palette (pure, unit tested in tools/test/palette-rank.test.js).
const PALRANK = (function () {
    // lower is better; -1 = no match. Tiers: exact (0), prefix (1), word prefix (2), substring (3), subsequence (4)
    function fuzzy(q, text) {
        q = String(q || '').toLowerCase().trim();
        text = String(text || '').toLowerCase();
        if (!q || !text) return -1;
        if (text === q) return 0;
        if (text.startsWith(q)) return 1;
        if (text.split(/[\s\-_/(),.]+/).some(w => w.startsWith(q))) return 2;
        if (text.includes(q)) return 3;
        if (q.length >= 3) {
            let i = 0;
            for (const c of text) { if (c === q[i]) i++; if (i === q.length) return 4; }
        }
        return -1;
    }
    function distNm(la1, lo1, la2, lo2) {
        const r = Math.PI / 180, dl = (la2 - la1) * r, dn = (lo2 - lo1) * r * Math.cos((la1 + la2) * r / 2);
        return Math.hypot(dl, dn) * 3440.065;
    }
    // rows: [icao, iata, type(0 large..), name, lat, lon, ...city at 9]; view: {lat, lon}
    function rankAirports(q, rows, view, limit) {
        const out = [];
        for (const r of rows) {
            const codes = [fuzzy(q, r[0]), r[1] ? fuzzy(q, r[1]) : -1].filter(x => x >= 0 && x <= 1);
            const nm = Math.max(-1, fuzzy(q, r[3])), city = fuzzy(q, r[9]);
            let tier = codes.length ? Math.min(...codes) : -1;       // a code match always beats a name match
            if (tier < 0) { const n = [nm, city].filter(x => x >= 0); if (!n.length) continue; tier = 10 + Math.min(...n); }
            const d = view ? distNm(view.lat, view.lon, r[4], r[5]) : 0;
            out.push({row: r, score: tier * 1e5 + r[2] * 2000 + Math.min(d, 9999)});
        }
        out.sort((a, b) => a.score - b.score);
        return out.slice(0, limit || 6);
    }
    // planes: [{hex, flight, reg, type}]
    function rankAircraft(q, planes, limit) {
        const out = [];
        for (const p of planes) {
            const s = [fuzzy(q, p.flight), fuzzy(q, p.reg), fuzzy(q, p.hex), fuzzy(q, p.type)].filter(x => x >= 0);
            if (!s.length) continue;
            out.push({plane: p, score: Math.min(...s)});
        }
        out.sort((a, b) => a.score - b.score || String(a.plane.flight || a.plane.hex).localeCompare(String(b.plane.flight || b.plane.hex)));
        return out.slice(0, limit || 6);
    }
    function rankActions(q, actions, limit) {
        const out = [];
        for (const a of actions) {
            const s = q ? Math.min(...[fuzzy(q, a.title)].concat((a.keys || []).map(k => fuzzy(q, k))).filter(x => x >= 0).concat([99])) : 5;
            if (s === 99) continue;
            out.push({action: a, score: s});
        }
        out.sort((a, b) => a.score - b.score);
        return out.slice(0, limit || 6);
    }
    return {fuzzy, distNm, rankAirports, rankAircraft, rankActions};
})();
if (typeof module !== 'undefined') module.exports = PALRANK;
