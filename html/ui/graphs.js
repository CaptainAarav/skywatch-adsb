// Skywatch ADS-B: live charts for the Graphs overlay (canvas, no library).
// Data: /globe_history/skywatch/history.json + polar.json, written once a minute by scripts/skywatch-recorder.py.
// Without it the overlay falls back to the graphs1090 images. Only distances / bearings relative to the receiver are used:
// no coordinates are ever stored or drawn.
"use strict";

const GRAPHS = (function () {
    const BASE = 'globe_history/skywatch/';
    const PERIODS = [['6h', 6], ['24h', 24], ['48h', 48], ['7d', 168]];
    const CARDS = [
        {id: 'aircraft', title: 'Aircraft with position', col: 1, color: '#FFFFFF', fmt: v => Math.round(v), unit: ''},
        {id: 'msg', title: 'Messages per second', col: 3, color: '#4FD1D9', fmt: v => Math.round(v), unit: '/s'},
        {id: 'range', title: 'Maximum range', col: 4, color: '#B07BFF', fmt: v => Math.round(v), unit: 'nm', dist: true},
        {id: 'signal', title: 'Signal strength', col: 5, color: '#3DDC97', fmt: v => v.toFixed(1), unit: 'dBFS'},
    ];
    // classic graphs1090 images (fallback), graphs1090 draws 2h/8h/24h/48h/7d
    const CLASSIC = [['aircraft', 'Aircraft tracked'], ['aircraft_message_rate', 'Messages per aircraft'], ['range', 'Range'], ['signal', 'Signal'], ['tracks', 'Tracks'], ['local_trailing_rate', 'Message rate']];
    const CLASSIC_P = {'6h': '8h', '24h': '24h', '48h': '48h', '7d': '7d'};
    let period = '24h', data = null, polar = null, mode = null, charts = [];
    try { period = localStorage.getItem('graphsPeriod2') || '24h'; } catch (e) {}
    if (!PERIODS.some(p => p[0] == period)) period = '24h';

    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

    async function load() {
        try {
            const r = await fetch(BASE + 'history.json', {cache: 'no-store'});
            if (!r.ok) throw 0;
            const d = await r.json();
            if (!d.samples || d.samples.length < 2) throw 0;
            data = d;
            try { const pr = await fetch(BASE + 'polar.json', {cache: 'no-store'}); polar = pr.ok ? await pr.json() : null; } catch (e) { polar = null; }
            return true;
        } catch (e) { data = null; return false; }
    }

    function available() {
        return fetch(BASE + 'history.json', {method: 'HEAD', cache: 'no-store'}).then(r => r.ok).catch(() => false)
            .then(ok => ok || fetch('/graphs1090/', {method: 'HEAD', cache: 'no-store'}).then(r => r.ok).catch(() => false));
    }

    // ---- series helpers ----
    function series(col, hours, agg) {
        const now = data.samples[data.samples.length - 1][0], t0 = now - hours * 3600;
        const pts = [];
        for (const s of data.samples) if (s[0] >= t0 && s[col] != null) pts.push([s[0], s[col]]);
        // thin to <= ~360 points: mean per bucket (max for range)
        const target = 360;
        if (pts.length <= target) return {pts, t0, t1: now};
        const step = (now - t0) / target, out = [];
        let i = 0;
        for (let b = 0; b < target; b++) {
            const lo = t0 + b * step, hi = lo + step;
            let sum = 0, n = 0, mx = -Infinity, ts = 0;
            while (i < pts.length && pts[i][0] < hi) { sum += pts[i][1]; mx = Math.max(mx, pts[i][1]); ts += pts[i][0]; n++; i++; }
            if (n) out.push([ts / n, agg == 'max' ? mx : sum / n]);
        }
        return {pts: out, t0, t1: now};
    }
    function stats(col, hours) {
        const now = data.samples[data.samples.length - 1][0], t0 = now - hours * 3600;
        let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
        for (const s of data.samples) if (s[0] >= t0 && s[col] != null) { mn = Math.min(mn, s[col]); mx = Math.max(mx, s[col]); sum += s[col]; n++; }
        return n ? {min: mn, max: mx, avg: sum / n} : null;
    }
    const latest = col => { for (let i = data.samples.length - 1; i >= 0; i--) if (data.samples[i][col] != null) return data.samples[i][col]; return null; };

    // monotone cubic path through points (no overshoot)
    function curve(ctx, P) {
        const n = P.length;
        if (n < 2) return;
        const dx = [], m = [], t = new Array(n);
        for (let i = 0; i < n - 1; i++) { dx.push(P[i + 1][0] - P[i][0]); m.push((P[i + 1][1] - P[i][1]) / (dx[i] || 1)); }
        t[0] = m[0]; t[n - 1] = m[n - 2];
        for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
        for (let i = 0; i < n - 1; i++) {
            if (m[i] == 0) { t[i] = 0; t[i + 1] = 0; continue; }
            const a = t[i] / m[i], b = t[i + 1] / m[i], h = Math.hypot(a, b);
            if (h > 3) { t[i] = 3 * a / h * m[i]; t[i + 1] = 3 * b / h * m[i]; }
        }
        ctx.moveTo(P[0][0], P[0][1]);
        for (let i = 0; i < n - 1; i++) {
            const d = dx[i] / 3;
            ctx.bezierCurveTo(P[i][0] + d, P[i][1] + t[i] * d, P[i + 1][0] - d, P[i + 1][1] - t[i + 1] * d, P[i + 1][0], P[i + 1][1]);
        }
    }
    function niceTicks(lo, hi, n) {
        const span = Math.max(hi - lo, 1e-9), raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
        const f = raw / p, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
        const out = [];
        for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(6));
        return {ticks: out, step};
    }
    const fmtClock = (t, hours) => {
        const d = new Date(t * 1000);
        if (hours > 30) return d.toLocaleDateString(undefined, {weekday: 'short'}) + ' ' + String(d.getHours()).padStart(2, '0') + ':00';
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    // ---- chart card ----
    function makeCard(grid, c) {
        const card = el('figure', 'gCard gLive', grid);
        const head = el('div', 'gCardHead', card);
        el('figcaption', null, head, c.title);
        const big = el('div', 'gBig', card);
        const val = el('span', 'gVal', big), unit = el('span', 'gUnit', big);
        const sub = el('div', 'gSub', card);
        const wrap = el('div', 'gPlot', card);
        const cv = el('canvas', null, wrap);
        cv.setAttribute('role', 'img');
        const tip = el('div', 'gTip', wrap); tip.hidden = true;
        const ch = {c, card, val, unit, sub, cv, tip, wrap, hover: null};
        cv.addEventListener('pointermove', ev => { ch.hover = ev.offsetX; draw(ch); });
        cv.addEventListener('pointerleave', () => { ch.hover = null; draw(ch); });
        return ch;
    }
    const cv = c => c.dist && typeof convert_distance == 'function' ? (v => convert_distance(v * 1852, DisplayUnits)) : (v => v);
    const unitLabel = c => c.dist && typeof get_unit_label == 'function' ? get_unit_label('distance', DisplayUnits) : c.unit;

    function fill(ch) {
        const c = ch.c, f = cv(c), cur = latest(c.col);
        ch.val.textContent = cur == null ? '–' : c.fmt(f(cur));
        ch.unit.textContent = cur == null ? '' : unitLabel(c);
        const st = stats(c.col, 24);
        ch.sub.textContent = st ? `24 h  min ${c.fmt(f(st.min))} · avg ${c.fmt(f(st.avg))} · max ${c.fmt(f(st.max))}` : 'no data yet';
        const hrs = PERIODS.find(p => p[0] == period)[1];
        ch.s = series(c.col, hrs, c.id == 'range' ? 'max' : 'mean');
        ch.hours = hrs;
        const cur2 = cur == null ? 'no data' : c.fmt(f(cur)) + ' ' + unitLabel(c);
        ch.cv.setAttribute('aria-label', `${c.title}, last ${period}. Now ${cur2}. ` + (st ? `24 hour minimum ${c.fmt(f(st.min))}, average ${c.fmt(f(st.avg))}, maximum ${c.fmt(f(st.max))}.` : ''));
        draw(ch);
    }

    function draw(ch) {
        const cvs = ch.cv, wrap = ch.wrap;
        const w = wrap.clientWidth, h = wrap.clientHeight;
        if (!w || !h || !ch.s) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        if (cvs.width != Math.round(w * dpr) || cvs.height != Math.round(h * dpr)) { cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr); cvs.style.width = w + 'px'; cvs.style.height = h + 'px'; }
        const ctx = cvs.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const c = ch.c, f = cv(c), pts = ch.s.pts.map(p => [p[0], f(p[1])]);
        const L = 40, R = 10, T = 10, B = 22, pw = w - L - R, ph = h - T - B;
        if (pts.length < 2) { ctx.fillStyle = css('--muted') || '#B8B8B8'; ctx.font = '13px Inter, system-ui, sans-serif'; ctx.fillText('Collecting data…', L, h / 2); return; }
        let lo = Infinity, hi = -Infinity;
        for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
        const pad = (hi - lo) * 0.12 || Math.max(1, Math.abs(hi) * 0.1);
        if (c.id != 'signal' && c.id != 'range' || lo - pad > 0) lo = Math.max(0, lo - pad); else lo -= pad;
        if (c.id == 'aircraft' || c.id == 'msg') lo = Math.max(0, Math.min(lo, hi * 0.5));
        hi += pad;
        const nt = niceTicks(lo, hi, 4);
        lo = Math.min(lo, nt.ticks[0] ?? lo); hi = Math.max(hi, nt.ticks[nt.ticks.length - 1] ?? hi);
        const X = t => L + (t - ch.s.t0) / (ch.s.t1 - ch.s.t0) * pw, Y = v => T + ph - (v - lo) / (hi - lo) * ph;
        // grid + y labels
        ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
        for (const v of nt.ticks) {
            const y = Math.round(Y(v)) + .5;
            ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke();
            ctx.fillStyle = 'rgba(184,184,184,.9)'; ctx.fillText(nt.step < 1 ? v.toFixed(1) : String(Math.round(v)), L - 8, y);
        }
        // x labels
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        const nx = w < 420 ? 3 : 5;
        for (let i = 0; i <= nx; i++) {
            const t = ch.s.t0 + (ch.s.t1 - ch.s.t0) * i / nx;
            ctx.textAlign = i == 0 ? 'left' : i == nx ? 'right' : 'center';
            ctx.fillStyle = 'rgba(184,184,184,.9)';
            ctx.fillText(fmtClock(t, ch.hours), L + pw * i / nx + (i == 0 ? -2 : i == nx ? 2 : 0), h - B + 6);
        }
        const P = pts.map(p => [X(p[0]), Y(p[1])]);
        // area + line
        const grad = ctx.createLinearGradient(0, T, 0, T + ph);
        grad.addColorStop(0, hexA(c.color, .32)); grad.addColorStop(1, hexA(c.color, 0));
        ctx.beginPath(); curve(ctx, P); ctx.lineTo(P[P.length - 1][0], T + ph); ctx.lineTo(P[0][0], T + ph); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); curve(ctx, P); ctx.strokeStyle = c.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        // latest point
        const last = P[P.length - 1];
        ctx.beginPath(); ctx.arc(last[0], last[1], 3.5, 0, 7); ctx.fillStyle = c.color; ctx.fill();
        // hover crosshair
        ch.tip.hidden = ch.hover == null;
        if (ch.hover != null) {
            let bi = 0, bd = 1e9;
            P.forEach((p, i) => { const d = Math.abs(p[0] - ch.hover); if (d < bd) { bd = d; bi = i; } });
            const p = P[bi], q = pts[bi];
            ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(p[0]) + .5, T); ctx.lineTo(Math.round(p[0]) + .5, T + ph); ctx.stroke();
            ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fillStyle = '#15161a'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = c.color; ctx.stroke();
            ch.tip.textContent = '';
            const b = el('b', null, ch.tip, c.fmt(q[1]) + ' ' + unitLabel(c));
            el('span', null, ch.tip, new Date(q[0] * 1000).toLocaleString(undefined, {weekday: 'short', hour: '2-digit', minute: '2-digit'}));
            ch.tip.style.left = Math.min(w - 120, Math.max(4, p[0] - 56)) + 'px';
            ch.tip.style.top = Math.max(0, p[1] - 56) + 'px';
        }
    }
    const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

    // ---- polar plot: max range per bearing over the selected period (relative to the receiver; no position involved) ----
    function makePolar(grid) {
        const card = el('figure', 'gCard gLive gPolarCard', grid);
        el('div', 'gCardHead', card).appendChild(el('figcaption', null, null, 'Range by bearing'));
        const sub = el('div', 'gSub', card);
        const wrap = el('div', 'gPlot', card), cvs = el('canvas', null, wrap);
        cvs.setAttribute('role', 'img');
        return {polar: true, card, sub, cv: cvs, wrap};
    }
    function drawPolar(ch) {
        const hrs = PERIODS.find(p => p[0] == period)[1];
        const w = ch.wrap.clientWidth, h = ch.wrap.clientHeight;
        if (!w || !h) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        ch.cv.width = Math.round(w * dpr); ch.cv.height = Math.round(h * dpr); ch.cv.style.width = w + 'px'; ch.cv.style.height = h + 'px';
        const ctx = ch.cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        const bins = polar && polar.bins || 36, mx = new Array(bins).fill(0);
        const now = Math.floor(Date.now() / 3600e3);
        if (polar) for (const k in polar.hours) if (now - Number(k) < hrs + 1) polar.hours[k].forEach((v, i) => { if (v > mx[i]) mx[i] = v; });
        const f = cv({dist: true}), lab = unitLabel({dist: true});
        const top = Math.max(...mx);
        if (!(top > 0)) { ctx.fillStyle = '#B8B8B8'; ctx.font = '13px Inter, system-ui, sans-serif'; ctx.fillText('Collecting data…', 40, h / 2); ch.sub.textContent = 'no data yet'; return; }
        const nt = niceTicks(0, f(top), 3), rmax = nt.ticks[nt.ticks.length - 1] >= f(top) ? nt.ticks[nt.ticks.length - 1] : nt.ticks[nt.ticks.length - 1] + nt.step;
        const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 22;
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.fillStyle = 'rgba(184,184,184,.9)'; ctx.font = '11px Inter, system-ui, sans-serif'; ctx.lineWidth = 1;
        for (const v of nt.ticks) { if (v <= 0) continue; ctx.beginPath(); ctx.arc(cx, cy, v / rmax * R, 0, 7); ctx.stroke(); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(Math.round(v) + ' ' + lab, cx + 4, cy - v / rmax * R - 1); }
        ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => { const r = a * Math.PI / 180; ctx.fillText(t, cx + Math.sin(r) * (R + 12), cy - Math.cos(r) * (R + 12)); });
        const pt = (i, v) => { const a = (i + 0.5) / bins * 2 * Math.PI; return [cx + Math.sin(a) * v / rmax * R, cy - Math.cos(a) * v / rmax * R]; };
        ctx.beginPath();
        mx.forEach((v, i) => { const p = pt(i, f(v)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
        ctx.closePath(); ctx.fillStyle = hexA('#B07BFF', .25); ctx.fill(); ctx.strokeStyle = '#B07BFF'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
        const bi = mx.indexOf(top);
        ch.sub.textContent = `Last ${period}: longest ${Math.round(f(top))} ${lab} towards ${Math.round((bi + 0.5) * 360 / bins)}°`;
        ch.cv.setAttribute('aria-label', `Range by bearing, last ${period}. ${ch.sub.textContent}`);
    }

    // ---- overlay ----
    function ensureShell() {
        const ov = document.getElementById('graphsOverlay'), tabs = ov.querySelector('.gTabs');
        if (!tabs.firstChild) for (const [k] of PERIODS) {
            const b = el('button', null, tabs, k == '7d' ? '7 days' : k.replace('h', ' h'));
            b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.period = k;
            b.addEventListener('click', () => { period = k; try { localStorage.setItem('graphsPeriod2', k); } catch (e) {} render(true); });
        }
        for (const b of tabs.children) { const on = b.dataset.period == period; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
        return ov.querySelector('.gGrid');
    }

    async function render(keep) {
        const grid = ensureShell();
        const ov = document.getElementById('graphsOverlay');
        if (ov.hidden) return;
        const ok = await load();
        const want = ok ? 'live' : 'classic';
        if (mode != want || !keep && !charts.length) {
            grid.textContent = ''; charts = []; mode = want;
            if (ok) {
                for (const c of CARDS) charts.push(makeCard(grid, c));
                if (polar) charts.push(makePolar(grid));
            } else {
                const note = el('div', 'gNote', grid, 'Live charts need the Skywatch recorder (scripts/skywatch-recorder.py); showing the classic graphs1090 images instead.');
                for (const [k, l] of CLASSIC) {
                    const c = el('figure', 'gCard', grid); c.dataset.g = k;
                    el('figcaption', null, c, l);
                    const i = el('img', null, c); i.alt = l + ' graph'; i.loading = 'lazy';
                    i.addEventListener('error', () => c.classList.add('gMissing'));
                }
            }
        }
        if (ok) for (const ch of charts) ch.polar ? drawPolar(ch) : fill(ch);
        else {
            const ts = Math.floor(Date.now() / 60000);
            for (const c of grid.querySelectorAll('figure[data-g]')) c.querySelector('img').src = `/graphs1090/graphs/dump1090-localhost-${c.dataset.g}-${CLASSIC_P[period]}.png?t=${ts}`;
        }
    }
    window.addEventListener('resize', () => { for (const ch of charts) ch.polar ? drawPolar(ch) : draw(ch); });
    return {render, available, load};
})();
