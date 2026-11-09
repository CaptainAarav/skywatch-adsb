// Skywatch ADS-B: airport panel (click an airport, or search ICAO / IATA / name).
//
// Data: html/airport-db/airports.json (OurAirports, public domain; built by tools/build-airports.py), loaded lazily on first use.
// Weather: globe_history/skywatch/wx.json, written by scripts/skywatch-recorder.py (METAR/TAF from aviationweather.gov; the
// browser cannot call that API itself, it sends no CORS headers). Traffic: computed here from the aircraft already loaded.
// Every string from those files or from aircraft is untrusted: the DOM is built with createElement / createElementNS and
// textContent only, never innerHTML. Links open in a new tab and are never embedded.
"use strict";

const AIRPT = (function () {
    const A = AIRCALC, SVGNS = 'http://www.w3.org/2000/svg';
    const DB_URL = 'airport-db/airports.json', WX_URL = 'globe_history/skywatch/wx.json', MV_URL = 'globe_history/skywatch/movements.json';
    const WX_MAX_AGE = 3 * 3600, WX_REFRESH = 5 * 60 * 1000;
    const TYPE_NAME = ['Large airport', 'Medium airport', 'Small airport', 'Seaplane base', 'Balloon port'];
    const CAT_CLASS = {VFR: 'ok', MVFR: 'mv', IFR: 'bad', LIFR: 'lf'};
    const FREQ_ORDER = ['ATIS', 'TWR', 'GND', 'APP', 'DEP', 'CTAF', 'A/D', 'AFIS', 'UNIC', 'CNTR', 'RDO', 'MISC'];
    const FREQ_COL = {ATIS: '#4FD1D9', TWR: '#B07BFF', GND: '#F5B94A', APP: '#3DDC97', DEP: '#3DDC97'};

    const st = {db: null, loading: null, byIcao: new Map(), byIata: new Map(), cur: null, wx: null, wxAt: 0, wxFail: false,
        samples: [], timer: null, wxTimer: null, isolating: false, root: null};

    // ---------- DOM helpers (textContent only) ----------
    function h(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    function sv(tag, attrs, text) {
        const e = document.createElementNS(SVGNS, tag);
        for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
        if (text != null) e.textContent = text;
        return e;
    }
    function add(p) { for (let i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p; }
    function tile(label, value, mono) { return add(h('div', 'apTile'), h('small', null, label), h('b', mono === false ? null : 'mono', value)); }
    function card(title, extra) {
        const c = h('section', 'apCard'), t = h('h3', null, title);
        if (extra) t.appendChild(extra);
        c.appendChild(t);
        return c;
    }
    const fmt = (n) => Math.round(n).toLocaleString('en-GB');
    const pad2 = (n) => String(n).padStart(2, '0');
    const hhmm = (d) => pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());

    // ---------- data ----------
    function load() {
        if (st.db) return Promise.resolve(st.db);
        if (st.loading) return st.loading;
        st.loading = fetch(DB_URL, {cache: 'default'}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
            st.db = d;
            for (const r of d.a) {
                if (!st.byIcao.has(r[0])) st.byIcao.set(r[0], r);
                if (r[1] && !st.byIata.has(r[1])) st.byIata.set(r[1], r);
            }
            return d;
        }).catch(e => { st.loading = null; console.warn('airport database failed:', e); return null; });
        return st.loading;
    }
    function rec(r) {
        return {icao: r[0], iata: r[1], type: r[2], name: r[3], lat: r[4], lon: r[5], elev: r[6], country: r[7], region: r[8],
            city: r[9], wiki: r[10], rwys: r[11] || [], freqs: r[12] || []};
    }
    function nearest(lat, lon, maxNm, minType) {
        let best = null, bd = maxNm;
        if (!st.db) return null;
        for (const r of st.db.a) {
            if (minType != null && r[2] > minType) continue;
            if (Math.abs(r[4] - lat) > 1 || Math.abs(r[5] - lon) > 1.5) continue;
            const d = A.distNm(lat, lon, r[4], r[5]);
            if (d < bd) { bd = d; best = r; }
        }
        return best;
    }
    function search(term) {
        const t = term.trim();
        if (!t || !st.db) return null;
        const u = t.toUpperCase();
        if (/^[A-Z0-9]{3,4}$/.test(u)) {
            const r = st.byIcao.get(u) || st.byIata.get(u);
            if (r) return r;
        }
        if (t.length < 3) return null;
        const lo = t.toLowerCase();
        let best = null, bs = 1e9;
        for (const r of st.db.a) {
            const nm = r[3].toLowerCase(), city = (r[9] || '').toLowerCase();
            let s = nm.startsWith(lo) ? 0 : nm.includes(lo) ? 10 : city.startsWith(lo) ? 20 : -1;
            if (s < 0) continue;
            s += r[2] * 3 + (r[1] ? 0 : 2);
            if (s < bs) { bs = s; best = r; }
        }
        return best;
    }

    function fetchWx() {
        if (!airportWeather) { st.wx = null; return Promise.resolve(null); }
        return fetch(WX_URL, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { st.wx = d; st.wxAt = Date.now(); st.wxFail = false; return d; })
            .catch(() => { st.wx = null; st.wxFail = true; return null; });
    }
    // inferred movements written by the recorder (rolling 24 h); a missing or old file just means no card
    function fetchMv() {
        return fetch(MV_URL, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { st.mv = d && Array.isArray(d.movements) ? d : null; return st.mv; })
            .catch(() => { st.mv = null; return null; });
    }
    function movementsCard(r) {
        const all = st.mv && st.mv.movements ? st.mv.movements.filter(m => m && m.airport === r.icao && typeof m.t === 'number') : [];
        if (!all.length) return null;
        const list = all.slice(-12).reverse();
        const c = h('section', 'apCard'), d = h('details', 'apMoves');
        d.open = st.mvOpen !== false;
        d.addEventListener('toggle', () => { st.mvOpen = d.open; });
        const sum = h('summary'); sum.appendChild(h('h3', null, 'Recent movements (' + all.length + ' in 24 h)'));
        d.appendChild(sum);
        d.appendChild(h('div', 'apNote', 'Inferred from receiver data: only aircraft this receiver heard.'));
        const rows = h('div', 'apList');
        for (const m of list) {
            const row = h('button', 'apRow'); row.type = 'button';
            const left = h('span');
            left.appendChild(h('b', 'mono', m.callsign || m.reg || '?'));
            left.appendChild(h('span', 'mut', ' ' + [m.type, m.dir === 'landing' ? 'landed' : 'departed', m.rwy ? 'runway ' + m.rwy : ''].filter(Boolean).join(' · ')));
            row.appendChild(left);
            row.appendChild(h('span', 'mono mut', new Date(m.t * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})));
            const live = (typeof g != 'undefined' && g.planesOrdered || []).find(p => p && ((m.callsign && (p.flight || '').trim() === m.callsign) || (m.reg && p.registration === m.reg)));
            if (live) row.addEventListener('click', () => { if (typeof selectPlaneByHex == 'function') selectPlaneByHex(live.icao, {follow: true}); });
            else row.disabled = true;
            rows.appendChild(row);
        }
        d.appendChild(rows);
        c.appendChild(d);
        return c;
    }
    function wxFor(icao) {
        const d = st.wx;
        if (!airportWeather || !d || !d.stations || typeof d.fetched_at !== 'number') return null;
        if (Date.now() / 1000 - d.fetched_at > WX_MAX_AGE) return null;
        const s = d.stations[icao];
        return s && (s.m || s.t) ? s : null;
    }

    // ---------- weather cards ----------
    function visText(sm) {
        const v = A.visSM(sm);
        if (v == null) return null;
        const m = v * 1609.344;
        if (m >= 9500 || (typeof sm === 'string' && sm.endsWith('+') && m >= 9000)) return '10 km+';
        if (m >= 5000) return (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
        return fmt(Math.round(m / 100) * 100) + ' m';
    }
    function cloudText(cl) {
        if (!cl || !cl.length) return 'Clear';
        return cl.slice(0, 3).map(l => (typeof l[1] == 'number' ? l[0] + ' ' + fmt(l[1]) + ' ft' : String(l[0]))).join(' · ');
    }
    function catChip(cat) {
        const c = h('span', 'apCat ' + (CAT_CLASS[cat] || ''));
        c.appendChild(h('i'));
        c.appendChild(document.createTextNode(cat));
        return c;
    }
    function ageText(secs) {
        const m = Math.max(0, Math.round(secs / 60));
        return m < 90 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
    }
    function metarCard(r, m) {
        const vis = A.visSM(m.vis), ceil = A.ceilingFt(m.clouds, null);
        const cat = A.metarCategory(m);
        const age = h('span', 'age');
        if (typeof m.obs === 'number') {
            const d = new Date(m.obs * 1000);
            age.textContent = hhmm(d) + 'Z · ' + ageText(Date.now() / 1000 - m.obs);
        }
        const c = card('Weather · METAR', add(h('span', 'apSpacer'), cat ? catChip(cat) : null, age));
        const g = h('div', 'apGrid');
        if (typeof m.wspd === 'number') {
            let w = (typeof m.wdir === 'number' ? pad3(m.wdir) + '°' : 'VRB') + ' / ' + m.wspd + (typeof m.wgst === 'number' ? 'G' + m.wgst : '') + ' kt';
            if (m.wspd === 0) w = 'Calm';
            g.appendChild(tile('Wind', w));
        }
        const vt = visText(m.vis);
        if (vt) g.appendChild(tile('Visibility', vt));
        if (Array.isArray(m.clouds)) g.appendChild(tile('Clouds', cloudText(m.clouds)));
        if (typeof m.temp === 'number') g.appendChild(tile('Temp / Dew point', Math.round(m.temp) + '° / ' + (typeof m.dew === 'number' ? Math.round(m.dew) + '°' : '–')));
        if (typeof m.qnh === 'number') g.appendChild(tile('QNH', Math.round(m.qnh) + ' hPa'));
        const da = A.densityAltitude(r.elev, m.qnh, m.temp);
        if (da != null) g.appendChild(tile('Density altitude', '~ ' + fmt(Math.round(da / 100) * 100) + ' ft'));
        c.appendChild(g);
        if (m.raw) c.appendChild(h('div', 'apRaw mono', m.raw));
        return c;
    }
    function tafCard(t, m) {
        const start = Math.floor(Date.now() / 1000 / 10800) * 10800;
        const slots = A.tafSlots(t.f, start, 6, 10800);
        const c = card('Forecast · TAF', add(h('span', 'apSpacer'), t.issue ? h('span', 'age', 'issued ' + t.issue.slice(11, 16) + 'Z') : null));
        if (slots.some(s => s.cat)) {
            const strip = h('div', 'apTaf'), axis = h('div', 'apAxis');
            for (const s of slots) {
                const e = h('span', 'apTafSlot ' + (CAT_CLASS[s.cat] || 'na'), s.cat || '–');
                if (s.temp) { e.classList.add('tmp'); e.title = 'TEMPO or PROB group: ' + s.temp; }
                strip.appendChild(e);
                axis.appendChild(h('span', null, pad2(new Date(s.t * 1000).getUTCHours()) + 'Z'));
            }
            c.appendChild(strip);
            c.appendChild(axis);
            c.appendChild(h('div', 'apNote', 'Category per 3 h slot, derived from the forecast groups (approximate). Dashed = a worse TEMPO or PROB group.'));
        }
        if (t.raw) c.appendChild(h('div', 'apRaw mono', t.raw));
        return c;
    }
    const pad3 = (n) => String(Math.round(n) % 360 || 360).padStart(3, '0');

    // ---------- runways ----------
    function runwayList(r) {
        const out = [];
        for (const w of r.rwys) {
            const hl = A.endHeading(w[0], w[6], typeof w[7] === 'number' ? w[7] : null);
            const hh = A.endHeading(w[1], w[7], typeof w[6] === 'number' ? w[6] : null);
            const e1 = w[0] && hl != null ? {id: w[0], hdg: hl} : null, e2 = w[1] && hh != null ? {id: w[1], hdg: hh} : null;
            if (!e1 && !e2) continue;
            out.push({ends: [e1, e2].filter(Boolean), len: w[2], wid: w[3], surf: w[4], lit: w[5]});
        }
        out.sort((a, b) => (b.len || 0) - (a.len || 0));
        return out.slice(0, 6);
    }
    const SURF = {ASP: 'Asphalt', ASPH: 'Asphalt', CON: 'Concrete', CONC: 'Concrete', GRS: 'Grass', GRE: 'Grass', GRASS: 'Grass', TURF: 'Turf', DIRT: 'Dirt', GRVL: 'Gravel', GVL: 'Gravel', WATER: 'Water', SAND: 'Sand', 'ASP-G': 'Asphalt'};
    function surfName(s) { if (!s) return null; const k = s.toUpperCase(); return SURF[k] || (SURF[k.split(/[-/]/)[0]] || null); }

    function compass(rw, wd, ws) {
        const svg = sv('svg', {viewBox: '0 0 200 200', width: 168, height: 168, role: 'img'});
        svg.setAttribute('aria-label', typeof wd === 'number' && ws ? 'Runways with wind from ' + Math.round(wd) + ' degrees at ' + ws + ' knots' : 'Runways');
        svg.appendChild(sv('circle', {cx: 100, cy: 100, r: 96, fill: 'rgba(255,255,255,.03)', stroke: 'rgba(255,255,255,.12)'}));
        for (let a = 0; a < 360; a += 30) {
            const r1 = 96, r2 = a % 90 ? 90 : 87, x = Math.sin(a * Math.PI / 180), y = -Math.cos(a * Math.PI / 180);
            svg.appendChild(sv('line', {x1: 100 + x * r1, y1: 100 + y * r1, x2: 100 + x * r2, y2: 100 + y * r2, stroke: 'rgba(255,255,255,.4)'}));
        }
        svg.appendChild(sv('text', {x: 100, y: 22, fill: '#B8B8B8', 'font-size': 10, 'text-anchor': 'middle'}, 'N'));
        for (const w of rw.slice(0, 4)) {
            const e = w.ends[0], hd = e.hdg * Math.PI / 180, L = Math.min(78, 40 + (w.len || 4000) / 120);
            const dx = Math.sin(hd) * L, dy = -Math.cos(hd) * L;
            svg.appendChild(sv('line', {x1: 100 - dx, y1: 100 + dy, x2: 100 + dx, y2: 100 - dy, stroke: '#2f3036', 'stroke-width': 11}));
            svg.appendChild(sv('line', {x1: 100 - dx, y1: 100 + dy, x2: 100 + dx, y2: 100 - dy, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.3, 'stroke-dasharray': '5 4'}));
            for (const [en, s] of [[w.ends[0], 1], [w.ends[1], -1]]) {
                if (!en) continue;
                const a = en.hdg * Math.PI / 180, tx = 100 + Math.sin(a) * (L + 12), ty = 100 - Math.cos(a) * (L + 12);
                svg.appendChild(sv('text', {x: tx, y: ty, fill: '#F5F7FA', 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle', 'dominant-baseline': 'middle'}, String(en.id)));
            }
        }
        if (typeof wd === 'number' && ws > 0) {              // arrow pointing the way the wind blows, drawn from the upwind side
            const a = wd * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a);
            const x1 = 100 + sx * 88, y1 = 100 + sy * 88, x2 = 100 + sx * 52, y2 = 100 + sy * 52;
            svg.appendChild(sv('line', {x1, y1, x2, y2, stroke: '#4FD1D9', 'stroke-width': 3, 'stroke-linecap': 'round'}));
            const px = -sy, py = sx;
            svg.appendChild(sv('polygon', {points: [x2 + sx * 0, y2 + sy * 0, x2 + sx * 9 + px * 6, y2 + sy * 9 + py * 6, x2 + sx * 9 - px * 6, y2 + sy * 9 - py * 6].join(','), fill: '#4FD1D9'}));
            svg.appendChild(sv('text', {x: 100, y: 96, fill: '#F5F7FA', 'font-size': 17, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono, ui-monospace, monospace'}, String(ws)));
            svg.appendChild(sv('text', {x: 100, y: 110, fill: '#B8B8B8', 'font-size': 8, 'text-anchor': 'middle'}, 'kt from ' + pad3(wd) + '°'));
        }
        return svg;
    }
    function runwayCard(r, m) {
        const rw = runwayList(r);
        if (!rw.length) return null;
        const wd = m && typeof m.wdir === 'number' ? m.wdir : (m && m.wdir === 'VRB' ? 'VRB' : null), ws = m && typeof m.wspd === 'number' ? m.wspd : null;
        const c = card(ws != null ? 'Runways · wind components' : 'Runways');
        const row = h('div', 'apRwRow');
        row.appendChild(compass(rw, typeof wd === 'number' ? wd : null, ws));
        const ends = h('div', 'apEnds');
        const inferred = inferred_end(r, rw);
        for (const w of rw.slice(0, 3)) {
            const res = A.runwayWind(w.ends, wd, ws);
            for (const e of w.ends) {
                const d = h('div', 'apEnd' + (res.best === e.id ? ' best' : ''));
                const top = add(h('div', 'top'), h('b', 'mono', e.id), res.best === e.id ? h('span', 'bestTag', 'BEST') : null);
                d.appendChild(top);
                d.appendChild(h('small', null, pad3(e.hdg) + '°' + (inferred === e.id ? ' · in use (inferred)' : '')));
                const comp = res.byId[e.id];
                if (comp && ws) {
                    const hw = Math.round(comp.head), cw = Math.round(Math.abs(comp.cross));
                    const t = h('small', hw < 0 ? 'warn' : 'txt');
                    t.appendChild(h('span', 'mono', Math.abs(hw) + ' kt'));
                    t.appendChild(document.createTextNode(hw < 0 ? ' tail · ' : ' head · '));
                    t.appendChild(h('span', 'mono', cw + ' kt'));
                    t.appendChild(document.createTextNode(cw === 0 ? ' cross' : comp.cross > 0 ? ' cross R' : ' cross L'));
                    d.appendChild(t);
                }
                ends.appendChild(d);
            }
        }
        row.appendChild(ends);
        c.appendChild(row);
        const w0 = rw[0], meta = h('div', 'apMeta');
        if (w0.len) meta.appendChild(tile('Longest', fmt(w0.len * 0.3048) + ' m'));
        if (w0.wid) meta.appendChild(tile('Width', Math.round(w0.wid * 0.3048) + ' m'));
        const sn = surfName(w0.surf);
        if (sn) meta.appendChild(tile('Surface', sn, false));
        if (meta.childNodes.length) c.appendChild(meta);
        if (rw.length > 3) c.appendChild(h('div', 'apNote', rw.length + ' runways, first three shown.'));
        if (inferred) c.appendChild(h('div', 'apNote', 'In use now, inferred from live traffic: ' + inferred));
        return c;
    }
    function inferred_end(r, rw) { const e = A.inferRunwayEnd(st.samples, Date.now()); return e && rw.some(w => w.ends.some(x => x.id === e)) ? e : null; }

    // ---------- traffic (browser side, from the aircraft already loaded) ----------
    function planesNear(r, nm) {
        const out = [];
        if (typeof g === 'undefined' || !g.planesOrdered) return out;
        for (const p of g.planesOrdered) {
            if (!p.position || !p.visible && p.seen_pos > 60) continue;
            if (typeof p.seen_pos == 'number' && p.seen_pos > 60) continue;
            const d = A.distNm(r.lat, r.lon, p.position[1], p.position[0]);
            if (d <= nm) out.push({p, d});
        }
        out.sort((a, b) => a.d - b.d);
        return out;
    }
    function sampleTraffic() {
        const r = st.cur;
        if (!r) return;
        const rw = runwayList(r), now = Date.now(), fe = r.elev || 0;
        for (const {p, d} of planesNear(r, 6)) {
            const gnd = p.altitude === 'ground';
            const alt = typeof p.altitude === 'number' ? p.altitude : null;
            if (!gnd && (alt == null || alt - fe > 2000)) continue;
            const vr = typeof p.baro_rate === 'number' ? p.baro_rate : p.geom_rate;
            if (!gnd && !(typeof vr === 'number' && vr < -200)) continue;      // descending or on the ground
            if (typeof p.track !== 'number') continue;
            for (const w of rw) for (const e of w.ends) if (A.angDiff(p.track, e.hdg) <= 25) st.samples.push({t: now, end: e.id, key: p.icao});
        }
        st.samples = st.samples.filter(s => s.t > now - 15 * 60000);
    }
    function trafficCard(r) {
        const near = planesNear(r, 10);
        const c = card('Traffic now (from your receiver)');
        const ground = near.filter(x => x.p.altitude === 'ground' && x.d <= 3).length;
        const gr = h('div', 'apGrid');
        gr.appendChild(tile('On the ground', String(ground)));
        gr.appendChild(tile('Within 10 nm', String(near.length)));
        c.appendChild(gr);
        const list = h('div', 'apList');
        const fe = r.elev || 0;
        for (const {p, d} of near.slice(0, 5)) {
            const gnd = p.altitude === 'ground', alt = typeof p.altitude === 'number' ? p.altitude : null;
            const vr = typeof p.baro_rate === 'number' ? p.baro_rate : p.geom_rate;
            let st2 = gnd ? 'on ground' : typeof vr === 'number' && vr < -300 ? 'arriving' : typeof vr === 'number' && vr > 300 ? 'departing' : 'overhead';
            const row = h('button', 'apRow'), left = h('span');
            left.appendChild(h('b', 'mono', (p.flight || '').trim() || p.icao.toUpperCase()));
            left.appendChild(h('span', 'mut', ' ' + (p.icaoType || '') + ' · ' + st2));
            row.appendChild(left);
            row.appendChild(h('span', 'mono mut', (gnd ? 'ground' : alt != null ? fmt(alt) + ' ft' : '–') + ' · ' + d.toFixed(d < 10 ? 1 : 0) + ' nm'));
            row.type = 'button';
            row.addEventListener('click', () => { if (typeof selectPlaneByHex == 'function') selectPlaneByHex(p.icao, {follow: true}); });
            list.appendChild(row);
        }
        if (!near.length) list.appendChild(h('div', 'apNote', 'No aircraft within 10 nm right now.'));
        c.appendChild(list);
        return c;
    }

    function freqCard(r) {
        if (!r.freqs.length) return null;
        const seen = new Set(), fs = [];
        for (const f of r.freqs) { const k = f[0] + f[1]; if (!seen.has(k)) { seen.add(k); fs.push(f); } }
        fs.sort((a, b) => (FREQ_ORDER.indexOf(a[0]) + 100) % 100 - (FREQ_ORDER.indexOf(b[0]) + 100) % 100 || a[1] - b[1]);
        const c = card('Frequencies'), box = h('div');
        for (const f of fs.slice(0, 10)) {
            const p = h('span', 'apPill'), d = h('span', 'dot');
            d.style.background = FREQ_COL[f[0]] || '#8a8a92';
            add(p, d, document.createTextNode(f[0] + ' '), h('b', 'mono', f[1].toFixed(3)));
            box.appendChild(p);
        }
        c.appendChild(box);
        return c;
    }
    function sunCard(r) {
        const now = new Date(), s = A.sunTimes(now, r.lat, r.lon);
        const c = card('Sun · UTC'), row = h('div', 'apSun');
        if (s.polar) {
            c.appendChild(h('div', 'apNote', s.polar === 'day' ? 'The sun does not set today at this latitude.' : 'The sun does not rise today at this latitude.'));
            return c;
        }
        row.appendChild(h('span', 'mono', hhmm(s.rise)));
        const svg = sv('svg', {viewBox: '0 0 220 44'});
        svg.appendChild(sv('path', {d: 'M4 40 Q110 -26 216 40', fill: 'none', stroke: 'rgba(255,255,255,.3)', 'stroke-dasharray': '3 4'}));
        svg.appendChild(sv('line', {x1: 0, y1: 40, x2: 220, y2: 40, stroke: 'rgba(255,255,255,.15)'}));
        const f = (now - s.rise) / (s.set - s.rise), day = f >= 0 && f <= 1;
        if (day) {
            const t = f, x = 4 + 212 * t, y = (1 - t) * (1 - t) * 40 + 2 * (1 - t) * t * -26 + t * t * 40;
            svg.appendChild(sv('circle', {cx: x, cy: y, r: 5, fill: '#F5B94A'}));
        }
        row.appendChild(svg);
        row.appendChild(h('span', 'mono', hhmm(s.set)));
        c.appendChild(row);
        let note;
        if (day) note = 'Daylight · sunset ' + hhmm(s.set) + 'Z';
        else note = 'Night · daylight returns ' + (now < s.rise ? hhmm(s.rise) : 'after ' + hhmm(s.rise)) + 'Z';
        c.appendChild(h('div', 'apNote', note + ' (computed from the airport position)'));
        return c;
    }
    function linkRow(label, url, sub) {
        const a = h('a', 'apLink');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        add(a, h('span', null, label), h('span', 'mut', sub || '↗'));
        return a;
    }
    function linksCard(r) {
        if (!airportLinks) return null;
        const c = card('Charts & official info');
        if (/^EG/.test(r.icao)) c.appendChild(linkRow('UK AIP (NATS)', 'https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP/', 'find ' + r.icao + ' ↗'));
        c.appendChild(linkRow('SkyVector chart view', 'https://skyvector.com/airport/' + encodeURIComponent(r.icao)));
        if (r.wiki && /^[\w%().,'!~*-]+$/.test(r.wiki)) c.appendChild(linkRow('Wikipedia', 'https://en.wikipedia.org/wiki/' + r.wiki));
        c.appendChild(h('div', 'apNote', 'Charts are linked, not embedded. Never use for navigation.'));
        return c;
    }

    // ---------- panel ----------
    function render() {
        const root = st.root, r = st.cur;
        if (!root || !r) return;
        const scroll = root.querySelector('.apScroll'), keep = scroll ? scroll.scrollTop : 0;
        const body = h('div', 'apScroll');
        const head = h('div', 'apHead'), t = h('div', 'apTitle');
        t.appendChild(h('div', 'apIcao mono', r.icao));
        t.appendChild(h('div', 'apName', r.name));
        const x = h('button', 'apX'); x.type = 'button'; x.setAttribute('aria-label', 'Close airport panel'); x.title = 'Close (Esc)';
        x.appendChild(sv('svg', {viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round'})).appendChild(sv('path', {d: 'M6 6l12 12M18 6L6 18'}));
        x.addEventListener('click', close);
        add(head, t, x);
        body.appendChild(head);
        const chips = h('div', 'apChips');
        const cn = st.db.countries[r.country], rn = st.db.regions[r.region];
        const flag = r.country && /^[A-Z]{2}$/.test(r.country) ? String.fromCodePoint(...[...r.country].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) + ' ' : '';
        for (const [txt, k] of [[r.iata, ''], [TYPE_NAME[r.type], ''], [cn ? flag + cn : null, ''], [typeof r.elev == 'number' ? 'Elevation ' + fmt(r.elev) + ' ft' : null, 'k'], [r.city || rn, 'k']])
            if (txt) chips.appendChild(h('span', 'apChip ' + k, txt));
        body.appendChild(chips);

        const wx = wxFor(r.icao);
        const m = wx && wx.m ? wx.m : null;
        if (airportWeather) {
            if (wx && wx.m) body.appendChild(metarCard(r, wx.m));
            if (wx && wx.t) { const c = tafCard(wx.t, wx.m); if (c) body.appendChild(c); }
            if (!wx) {
                const why = !st.wx ? (st.wxFail ? 'Weather is not available: the recorder has not written wx.json.' : null)
                    : (Date.now() / 1000 - st.wx.fetched_at > WX_MAX_AGE ? 'Weather is hidden: the feed is more than 3 hours old.' : 'No METAR or TAF for this airport in the feed.');
                if (why) body.appendChild(h('div', 'apNote apWxNote', why));
            }
        }
        const rc = runwayCard(r, m); if (rc) body.appendChild(rc);
        body.appendChild(trafficCard(r));
        const mc = movementsCard(r); if (mc) body.appendChild(mc);
        const fc = freqCard(r); if (fc) body.appendChild(fc);
        body.appendChild(sunCard(r));
        const lc = linksCard(r); if (lc) body.appendChild(lc);
        body.appendChild(h('div', 'apFoot', 'Data: OurAirports (public domain)' + (wx ? ' · aviationweather.gov (METAR, TAF)' : '') + ' · your receiver. Never use for navigation.'));

        const bar = h('div', 'apBar');
        const b1 = h('button', 'apBtn p', st.isolating ? 'Show all traffic' : 'Show traffic here'); b1.type = 'button';
        b1.addEventListener('click', toggleTraffic);
        const b2 = h('button', 'apBtn', 'Zoom to airport'); b2.type = 'button';
        b2.addEventListener('click', () => fitAirport(r, true));
        const b3 = h('button', 'apBtn', 'Layers'); b3.type = 'button';
        b3.addEventListener('click', () => { const l = document.getElementById('layers_button'); l && l.click(); });
        add(bar, b1, b2, b3);
        root.replaceChildren(body, bar);
        body.scrollTop = keep;
    }

    // ---------- camera ----------
    // Bounds of the airport: OurAirports runway end points, plus the OpenFreeMap aeroway features that are loaded within
    // 6 km (aprons, taxiways, gates), with a small margin. Falls back to a box around the airport reference point.
    function airportBounds(r) {
        let w = r.lon, e = r.lon, so = r.lat, n = r.lat, have = false;
        const ext = (lon, lat) => { w = Math.min(w, lon); e = Math.max(e, lon); so = Math.min(so, lat); n = Math.max(n, lat); };
        for (const rw of r.rwys) {
            if (rw.length >= 12 && rw[8] != null && rw[9] != null && rw[10] != null && rw[11] != null) { ext(rw[9] / 1e4, rw[8] / 1e4); ext(rw[11] / 1e4, rw[10] / 1e4); have = true; }
            else if (typeof rw[2] === 'number') {                       // no end points in the data: a runway of the stated length through the reference point
                const hd = A.endHeading(rw[0], rw[6], null);
                if (hd != null) {
                    const half = rw[2] * 0.3048 / 2, rad = hd * Math.PI / 180;
                    const dLat = Math.cos(rad) * half / 111320, dLon = Math.sin(rad) * half / (111320 * Math.max(0.2, Math.cos(r.lat * Math.PI / 180)));
                    ext(r.lon - dLon, r.lat - dLat); ext(r.lon + dLon, r.lat + dLat); have = true;
                }
            }
        }
        try {
            const m = MLR.map;
            if (m.getSource('tar-airport') && m.getZoom() >= 10) {
                const kmLat = 6 / 111, kmLon = kmLat / Math.max(0.2, Math.cos(r.lat * Math.PI / 180));
                const fs = m.querySourceFeatures('tar-airport', {sourceLayer: 'aeroway', filter: ['in', ['get', 'class'], ['literal', ['runway', 'apron', 'taxiway', 'gate', 'helipad']]]});
                const flat = (c, out) => { if (typeof c[0] === 'number') out.push(c); else for (const x of c) flat(x, out); return out; };
                for (const f of fs) for (const p of flat(f.geometry.coordinates, [])) if (Math.abs(p[1] - r.lat) < kmLat && Math.abs(p[0] - r.lon) < kmLon) { ext(p[0], p[1]); have = true; }
            }
        } catch (err) { /* tiles not loaded: use the runway ends */ }
        if (!have || (e - w < 1e-4 && n - so < 1e-4)) { const d = r.type <= 1 ? 0.04 : 0.012; ext(r.lon - d * 1.6, r.lat - d); ext(r.lon + d * 1.6, r.lat + d); }
        const mx = (e - w) * 0.06, my = (n - so) * 0.06;
        return [[w - mx, so - my], [e + mx, n + my]];
    }
    // free map area: right of the panel on desktop, above the bottom sheet on phones; below the top bar
    function padding() {
        const phone = window.matchMedia('(max-width: 700px)').matches, p = st.root && !st.root.hidden ? st.root.getBoundingClientRect() : null;
        if (phone) return {top: 84, bottom: p ? Math.round(window.innerHeight - p.top + 16) : Math.round(window.innerHeight * 0.55), left: 20, right: 20};
        return {top: 84, bottom: 70, left: (p ? Math.round(p.right) : 408) + 28, right: 92};
    }
    // Ease the camera so the whole airport is in the free area. Never zooms out when the user is already closer
    // than the fit zoom (it then only centres), unless force is set (the "Zoom to airport" button).
    function fitAirport(r, force) {
        if (typeof MLR === 'undefined' || !MLR.map) return;
        const m = MLR.map, pad = padding(), b = airportBounds(r);
        const maxZ = 14.5, cur = m.getZoom();
        let fit = null;
        try { const cam = m.cameraForBounds(b, {padding: pad, bearing: m.getBearing(), pitch: m.getPitch(), maxZoom: maxZ}); fit = cam && typeof cam.zoom == 'number' ? cam.zoom : null; } catch (err) { /* ignore */ }
        if (fit == null) fit = r.type <= 1 ? 12.5 : 14;
        const zoom = force ? Math.min(fit, maxZ) : (cur >= fit ? cur : Math.min(fit, maxZ));
        const center = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
        const offset = [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2];
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const dur = 1000 + Math.min(200, Math.abs(zoom - cur) * 25);
        try {
            if (reduce) m.jumpTo({center, zoom});
            else m.easeTo({center, zoom, offset, duration: dur, easing: (t) => 1 - Math.pow(1 - t, 3), essential: false});
            if (reduce) m.panBy([-offset[0], -offset[1]], {duration: 0});
        } catch (err) { /* ignore */ }
    }
    function toggleTraffic() {
        const r = st.cur;
        if (!r || typeof select != 'function') return;
        if (st.isolating) {
            st.isolating = false;
            if (typeof toggleIsolation == 'function') toggleIsolation('off');
            if (typeof deselectAllPlanes == 'function') deselectAllPlanes();
            if (typeof toggleMultiSelect == 'function' && multiSelect) toggleMultiSelect('off');
        } else {
            const near = planesNear(r, 15);
            if (!near.length) { return; }
            if (typeof toggleMultiSelect == 'function' && !multiSelect) toggleMultiSelect('on');
            for (const {p} of near) { select(p, {}); p.updateTick(true); }
            SelectedPlane = null;
            if (typeof toggleIsolation == 'function') toggleIsolation('on');
            st.isolating = true;
        }
        render();
    }

    function open(row) {
        if (!row) return;
        const wasOpen = !!st.cur;
        st.cur = rec(row);
        st.samples = [];
        st.isolating = false;
        if (!st.root) st.root = document.getElementById('airport_panel');
        if (!st.root) return;
        const ib = document.getElementById('infoblock_close');
        if (document.body.classList.contains('infoOpen') && ib) ib.click();     // opening the airport panel closes the aircraft panel
        document.body.classList.add('airportOpen');
        st.root.hidden = false;
        if (typeof shellSync == 'function') shellSync();
        render();
        fitAirport(st.cur, false);
        fetchWx().then(() => { if (st.cur && st.cur.icao === row[0]) render(); });
        fetchMv().then(() => { if (st.cur && st.cur.icao === row[0]) render(); });
        clearInterval(st.timer);
        clearInterval(st.wxTimer);
        st.timer = setInterval(() => { if (st.cur) { sampleTraffic(); if (document.hidden) return; render(); } }, 5000);
        st.wxTimer = setInterval(() => Promise.all([fetchWx(), fetchMv()]).then(() => { st.cur && render(); }), WX_REFRESH);
        try { history.replaceState(null, '', location.href); } catch (e) { /* ignore */ }
    }
    function close() {
        if (!st.cur) return;
        st.cur = null;
        clearInterval(st.timer); clearInterval(st.wxTimer);
        if (st.isolating) { st.isolating = false; if (typeof toggleIsolation == 'function') toggleIsolation('off'); if (typeof deselectAllPlanes == 'function') deselectAllPlanes(); }
        document.body.classList.remove('airportOpen');
        if (st.root) { st.root.hidden = true; st.root.replaceChildren(); }
        if (typeof shellSync == 'function') shellSync();
    }

    // opening an aircraft closes the airport panel
    function watchBody() {
        new MutationObserver(() => { if (st.cur && document.body.classList.contains('infoOpen')) close(); })
            .observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    // ---------- entry points ----------
    // map click: returns true when the click was handled as an airport click
    function mapClick(e) {
        if (typeof MLR === 'undefined' || !MLR.map) return false;
        const m = MLR.map, x = e.point.x, y = e.point.y;
        const pinIds = ['tar-ap-pin', 'tar-ap-pin-name'].filter(id => m.getLayer(id));
        let feats = pinIds.length ? m.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]], {layers: pinIds}) : [];
        const go = (hit) => { load().then(() => { const row = hit(); if (row) open(row); }); return true; };
        if (feats.length) {
            const pr = feats[0].properties || {};
            return go(() => (pr.icao && st.byIcao.get(String(pr.icao).toUpperCase())) || (pr.iata && st.byIata.get(String(pr.iata).toUpperCase())) ||
                nearest(e.lngLat.lat, e.lngLat.lng, 5, 1));
        }
        if (m.getZoom() >= 11) {
            const ids = (m.getStyle().layers || []).map(l => l.id).filter(id => /^tar-ap-/.test(id) && !/pin/.test(id));
            if (ids.length && m.queryRenderedFeatures([[x - 2, y - 2], [x + 2, y + 2]], {layers: ids}).length)
                return go(() => nearest(e.lngLat.lat, e.lngLat.lng, 3, 2));
        }
        return false;
    }
    function searchAndOpen(term) {
        return load().then(db => {
            if (!db) return false;
            const row = search(term);
            if (!row) return false;
            open(row);
            return true;
        });
    }

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && st.cur) { ev.stopPropagation(); close(); } }, true);
    document.addEventListener('DOMContentLoaded', () => {
        st.root = document.getElementById('airport_panel');
        watchBody();
    });
    jQuery(function () {
        new Toggle({key: 'airportWeather', display: 'Airport weather (METAR and TAF from the recorder)', container: '#settingsRight', init: airportWeather,
            setState: function (s) { airportWeather = s; if (st.cur) { st.wx = null; fetchWx().then(render); render(); } refreshWx(); }});
        new Toggle({key: 'airportLinks', display: 'Airport links (SkyVector, AIP, Wikipedia)', container: '#settingsRight', init: airportLinks,
            setState: function (s) { airportLinks = s; st.cur && render(); }});
    });

    // pins and the palette: categories of every fresh station, refreshed with the feed
    function weatherCats() {
        const out = {};
        if (!airportWeather || !st.wx || !st.wx.stations) return out;
        for (const k in st.wx.stations) { const c = A.stationCategory(st.wx, k); if (c) out[k] = c; }
        return out;
    }
    const wxListeners = [];
    function refreshWx() { return fetchWx().then(() => { for (const f of wxListeners) { try { f(); } catch (e) { console.error(e); } } }); }
    function onWx(f) { wxListeners.push(f); }
    onWx(() => { if (typeof MLR != 'undefined' && MLR.map && MLR.applyPinWeather) MLR.applyPinWeather(); });
    setTimeout(refreshWx, 3000);
    setInterval(() => { if (!document.hidden) refreshWx(); }, WX_REFRESH);
    return {open, close, mapClick, searchAndOpen, load, state: st, weatherCats, onWx, refreshWx, wxFor, catChip, ageText, visText, cloudText};
})();
