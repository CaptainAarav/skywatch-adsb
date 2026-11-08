"use strict";
// Skywatch ADS-B: instruments of the selected-aircraft panel (new-designs/INSTRUMENT-SPEC.md, mockups 07-09).
//
//  * Only real data: every instrument is built from fields the aircraft really sent. An instrument whose
//    inputs are missing is hidden (never a fake zero). When almost nothing exists: "Limited data from this aircraft".
//  * SVG is real DOM (createElementNS / setAttribute / textContent). No aircraft-derived string ever goes through innerHTML.
//  * Updates are throttled to 4 Hz; CSS transitions are off under prefers-reduced-motion; each instrument has an aria-label
//    that states its values.
//  * Privacy: Receiver view, distance and bearing need the receiver position AND the "show site position" setting.
//    The receiver's coordinates are never printed.
//
// infoblock.js calls IBI.renderCompact / renderWide / renderPhone from ibRender().

const IBI = {
    NS: 'http://www.w3.org/2000/svg',
    cold: '#4FD1D9', desc: '#F5B94A', bad: '#FF6B6B',
    uid: 0, lastT: 0, key: null, inst: {}, hist: new WeakMap(),
    HZ: 4,
};

// ---------------------------------------------------------------- DOM helpers (no innerHTML)
IBI.svg = function (tag, attrs, parent, text) {
    const e = document.createElementNS(IBI.NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
};
IBI.h = function (tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
};
IBI.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
IBI.$ = function (id) { return ibEl(id); };
IBI.set = function (id, v) {                       // text, never HTML
    const e = ibEl(id);
    if (!e) return;
    const s = (v == null) ? '' : String(v);
    if (e.textContent !== s) e.textContent = s;
};
IBI.show = function (id, on) {
    const e = typeof id == 'string' ? ibEl(id) : id;
    if (e && e.hidden !== !on) e.hidden = !on;
};
IBI.label = function (el, text) {
    if (el && el.getAttribute('aria-label') !== text) el.setAttribute('aria-label', text);
};
IBI.pill = function (parent, text, on) {
    return IBI.h('span', 'pill ' + (on ? 'on' : 'off'), parent, text);
};
IBI.grad = function (svg, id, y1, y2, flip) {       // the map legend's altitude gradient, low = orange, high = purple
    const defs = IBI.svg('defs', null, svg);
    const g = IBI.svg('linearGradient', {id, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1, y2}, defs);
    const cols = ['#B07BFF', '#5B8CFF', '#4FD1D9', '#6BD96B', '#F2E44A', '#F5994A'];
    cols.forEach((c, i) => IBI.svg('stop', {offset: i / 5, 'stop-color': c}, g));
    return g;
};

IBI.compassName = function (t) {
    if (t == null) return null;
    return ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'][Math.floor((360 + t % 360 + 22.5) / 45) % 8];
};
IBI.wrap180 = function (d) { return ((d % 360) + 540) % 360 - 180; };

IBI.SQUAWK = {
    '7500': 'Hijack', '7600': 'Radio failure', '7700': 'General emergency',
    '7000': 'Conspicuity (UK VFR)', '1200': 'VFR (US)', '2000': 'IFR, no code',
};
IBI.EMERG = {general: 'General emergency', lifeguard: 'Medical emergency', minfuel: 'Minimum fuel', nordo: 'Radio failure',
    unlawful: 'Hijack', downed: 'Downed aircraft', reserved: 'Reserved'};
IBI.CATEGORY = {
    A0: 'No information', A1: 'Light', A2: 'Small', A3: 'Large', A4: 'High vortex large', A5: 'Heavy', A6: 'High performance', A7: 'Rotorcraft',
    B0: 'No information', B1: 'Glider', B2: 'Lighter than air', B3: 'Parachutist', B4: 'Ultralight', B6: 'UAV', B7: 'Space vehicle',
    C0: 'No information', C1: 'Emergency vehicle', C2: 'Service vehicle', C3: 'Obstacle', C4: 'Cluster obstacle', C5: 'Line obstacle',
};
IBI.NACP = {11: '< 3 m', 10: '< 10 m', 9: '< 30 m', 8: '< 93 m', 7: '< 0.1 nmi', 6: '< 0.3 nmi', 5: '< 0.5 nmi', 4: '< 1 nmi', 3: '< 2 nmi', 2: '< 4 nmi', 1: '< 10 nmi', 0: 'unknown'};
IBI.NACV = {4: '< 0.3 m/s', 3: '< 1 m/s', 2: '< 3 m/s', 1: '< 10 m/s', 0: 'unknown'};
IBI.SIL = {3: '1e-7 /h', 2: '1e-5 /h', 1: '1e-3 /h', 0: 'unknown'};

// ---------------------------------------------------------------- derived values
IBI.receiverVisible = function () {
    return !!(typeof SitePosition != 'undefined' && SitePosition && typeof SiteShow != 'undefined' && SiteShow);
};

IBI.derive = function (p) {
    const d = {};
    d.onGround = p.altitude === 'ground';
    d.altFt = (!d.onGround && p.altitude != null) ? adjust_baro_alt(p.altitude) : null;
    d.geomFt = p.alt_geom != null ? adjust_geom_alt(p.alt_geom, p.position) : null;
    d.rate = p.baro_rate != null ? p.baro_rate : (p.geom_rate != null ? p.geom_rate : p.vert_rate);
    d.rate = (d.rate != null && isFinite(d.rate)) ? d.rate : null;
    d.selAlt = p.nav_altitude != null ? p.nav_altitude : null;
    d.selHdg = p.nav_heading != null ? p.nav_heading : null;
    d.qnh = p.nav_qnh != null ? p.nav_qnh : null;
    d.track = p.track != null ? p.track : null;
    d.thdg = p.true_heading != null ? p.true_heading : null;
    d.gs = p.gs != null ? p.gs : null;
    d.tas = p.tas != null ? p.tas : null;
    d.ias = p.ias != null ? p.ias : null;
    d.mach = p.mach != null ? p.mach : null;
    d.ws = (p.ws != null && p.wd != null) ? p.ws : null;
    d.wd = d.ws != null ? p.wd : null;
    d.head = d.cross = null;
    if (d.ws != null && d.track != null) {
        const a = (d.wd - d.track) * Math.PI / 180;
        d.head = d.ws * Math.cos(a);       // + = headwind, - = tailwind
        d.cross = d.ws * Math.sin(a);      // + = from the right
    }
    d.drift = (d.thdg != null && d.track != null) ? IBI.wrap180(d.thdg - d.track) : null;
    d.phase = d.onGround ? 'On ground' : d.rate == null ? null : d.rate > 300 ? 'Climbing' : d.rate < -300 ? 'Descending' : 'Level';
    d.sq = (p.squawk == null || p.squawk == '0000') ? null : String(p.squawk);
    d.emerg = (d.sq && emergencySquawks.has(d.sq)) ? d.sq : null;
    d.emergState = (p.emergency && p.emergency != 'none') ? p.emergency : null;
    d.rx = IBI.receiverVisible() && p.position;
    d.dist = d.rx ? mapgeo.getDistance(SitePosition, p.position) : null;
    d.brg = d.rx ? ibBearing(SitePosition, p.position) : null;
    return d;
};

// session history (ground speed, RSSI, message rate): one sample every ~4 s while an aircraft is selected
IBI.sample = function (p, d) {
    let h = IBI.hist.get(p);
    const now = Date.now() / 1000;
    if (!h) {
        h = {gs: [], rssi: [], rate: [], t: 0};
        // back-fill ground speed from the track segments the page already holds
        for (const s of p.track_linesegs || []) if (s.speed != null && s.ts) h.gs.push([s.ts, s.speed]);
        IBI.hist.set(p, h);
    }
    if (now - h.t < 4) return h;
    h.t = now;
    const push = (a, v) => { if (v != null && isFinite(v)) { a.push([now, v]); if (a.length > 200) a.splice(0, a.length - 150); } };
    push(h.gs, d.gs); push(h.rssi, p.rssi); push(h.rate, p.messageRate);
    return h;
};

// ---------------------------------------------------------------- sparkline
IBI.makeSpark = function (slot, w, h) {
    const svg = IBI.svg('svg', {role: 'img', width: '100%', height: h, viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none'}, slot);
    const id = 'ibsp' + (++IBI.uid);
    const defs = IBI.svg('defs', null, svg);
    const g = IBI.svg('linearGradient', {id, x1: 0, y1: 0, x2: 0, y2: 1}, defs);
    IBI.svg('stop', {offset: 0, 'stop-color': '#fff', 'stop-opacity': '.22'}, g);
    IBI.svg('stop', {offset: 1, 'stop-color': '#fff', 'stop-opacity': '0'}, g);
    const area = IBI.svg('path', {fill: `url(#${id})`}, svg);
    const line = IBI.svg('path', {fill: 'none', stroke: '#fff', 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke'}, svg);
    return {svg, update(pts, aria) {
        if (!pts || pts.length < 2) return false;
        let lo = Infinity, hi = -Infinity;
        for (const q of pts) { if (q[1] < lo) lo = q[1]; if (q[1] > hi) hi = q[1]; }
        const minSpan = Math.max(Math.abs(hi) * 0.04, 1e-6), span = Math.max(hi - lo, minSpan); lo -= (span - (hi - lo)) / 2; const t0 = pts[0][0], t1 = pts[pts.length - 1][0], dt = Math.max(1e-6, t1 - t0);
        let dstr = '';
        pts.forEach((q, i) => {
            const x = (q[0] - t0) / dt * w, y = h - 4 - (q[1] - lo) / span * (h - 8);
            dstr += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        });
        line.setAttribute('d', dstr);
        area.setAttribute('d', dstr + `L${w} ${h}L0 ${h}Z`);
        IBI.label(svg, aria);
        return true;
    }};
};

// ---------------------------------------------------------------- altitude tape (compact)
IBI.makeTape = function (slot) {
    const svg = IBI.svg('svg', {role: 'img', width: 130, height: 176, viewBox: '0 0 130 176'}, slot);
    const gid = 'ibtape' + (++IBI.uid);
    IBI.grad(svg, gid, 10, 160).setAttribute('id', gid);
    IBI.svg('rect', {x: 34, y: 10, width: 12, height: 150, rx: 6, fill: `url(#${gid})`, opacity: '.9'}, svg);
    const labels = IBI.svg('g', {'font-family': 'JetBrains Mono,monospace', 'font-size': 9, fill: '#B8B8B8', 'text-anchor': 'end'}, svg);
    IBI.tapeY = (ft) => 160 - Math.max(0, Math.min(45000, ft)) / 45000 * 150;
    for (const k of [40, 30, 20, 10, 0]) IBI.svg('text', {x: 28, y: IBI.tapeY(k * 1000) + 3}, labels, k ? k + 'k' : '0');
    const link = IBI.svg('line', {x1: 40, x2: 40, stroke: '#fff', 'stroke-width': 1.6, 'stroke-dasharray': '2 3'}, svg);
    const nowG = IBI.svg('g', null, svg);
    IBI.svg('line', {x1: 46, x2: 52, stroke: '#fff', 'stroke-width': 2, y1: 0, y2: 0}, nowG);
    const nowTri = IBI.svg('path', {fill: '#fff'}, nowG);
    const nowTxt = IBI.svg('text', {x: 68, 'font-family': 'JetBrains Mono,monospace', 'font-size': 9, fill: '#B8B8B8'}, svg, 'NOW');
    const selG = IBI.svg('g', null, svg);
    const dia = IBI.svg('path', {fill: '#1d1e22', stroke: '#fff', 'stroke-width': 1.6, 'stroke-linejoin': 'round'}, selG);
    const selTxt = IBI.svg('text', {x: 68, 'font-family': 'JetBrains Mono,monospace', 'font-size': 9, 'font-weight': 600, fill: '#F5F7FA'}, svg);
    return {svg, update(altFt, selFt, nowText, selText) {
        const yn = IBI.tapeY(altFt);
        nowG.firstChild.setAttribute('y1', yn); nowG.firstChild.setAttribute('y2', yn);
        nowTri.setAttribute('d', `M52 ${yn}L63 ${yn - 6.5}V${yn + 6.5}Z`);
        let nty = yn + 3;
        nowTxt.setAttribute('y', nty);
        const hasSel = selFt != null;
        link.style.display = selG.style.display = selTxt.style.display = hasSel ? '' : 'none';
        if (hasSel) {
            const ys = IBI.tapeY(selFt);
            link.setAttribute('y1', Math.min(yn, ys)); link.setAttribute('y2', Math.max(yn, ys));
            dia.setAttribute('d', `M56 ${ys - 6}L62 ${ys}L56 ${ys + 6}L50 ${ys}Z`);
            let sty = ys + 4;                                   // keep the two captions apart when the altitudes are close
            if (Math.abs(sty - nty) < 12) { if (ys >= yn) sty = nty + 12; else sty = nty - 12; }
            selTxt.setAttribute('y', sty);
            selTxt.textContent = 'SEL ' + selText;
        }
        IBI.label(svg, `Altitude tape: ${nowText} now` + (hasSel ? `, ${selText} selected` : ''));
    }};
};

// ---------------------------------------------------------------- compass (Direction & wind)
IBI.makeCompass = function (slot, phone) {
    const size = phone ? 156 : 264;
    const svg = IBI.svg('svg', {role: 'img', width: size, height: size, viewBox: '-24 -24 288 288'}, slot);
    const C = (a, parent) => IBI.svg('circle', Object.assign({cx: 120, cy: 120}, a), parent || svg);
    C({r: 101, fill: phone ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.035)'});
    C({r: 96, fill: 'none', stroke: phone ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.38)', 'stroke-width': phone ? 7 : 6,
        'stroke-dasharray': phone ? '2.4 14.355' : '2 14.755', 'stroke-dashoffset': phone ? 1.2 : 1, transform: 'rotate(-90 120 120)'});
    C({r: 94, fill: 'none', stroke: '#F5F7FA', 'stroke-width': phone ? 11 : 10,
        'stroke-dasharray': phone ? '3.6 45.618' : '3 46.218', 'stroke-dashoffset': phone ? 1.8 : 1.5, transform: 'rotate(-90 120 120)'});
    if (!phone) C({r: 58, fill: 'none', stroke: 'rgba(255,255,255,.12)'});
    const R = phone ? 70 : 76;
    const cardinals = IBI.svg('g', {'font-family': 'Inter,sans-serif', 'font-size': phone ? 22 : 14, 'font-weight': 700, fill: '#F5F7FA', 'text-anchor': 'middle', 'dominant-baseline': 'central'}, svg);
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => IBI.svg('text',
        {x: 120 + R * Math.sin(a * Math.PI / 180), y: 120 - R * Math.cos(a * Math.PI / 180)}, cardinals, t));
    if (!phone) {
        const nums = IBI.svg('g', {'font-family': 'JetBrains Mono,monospace', 'font-size': 10, fill: '#B8B8B8', 'text-anchor': 'middle', 'dominant-baseline': 'central'}, svg);
        [[3, 30], [6, 60], [12, 120], [15, 150], [21, 210], [24, 240], [30, 300], [33, 330]].forEach(([t, a]) => IBI.svg('text',
            {x: 120 + 76 * Math.sin(a * Math.PI / 180), y: 120 - 76 * Math.cos(a * Math.PI / 180)}, nums, String(t)));
    }
    // wind: arrow at the direction the wind comes FROM, pointing inward
    const wind = IBI.svg('g', null, svg);
    IBI.svg('line', {x1: 120, y1: phone ? -16 : -14, x2: 120, y2: 8, stroke: IBI.cold, 'stroke-width': phone ? 4 : 3, 'stroke-linecap': 'round'}, wind);
    IBI.svg('path', {d: phone ? 'M110 3L120 20L130 3Z' : 'M112 4L120 19L128 4Z', fill: IBI.cold}, wind);
    const windTxt = IBI.svg('text', {'font-family': 'JetBrains Mono,monospace', 'font-size': 11, 'font-weight': 600, fill: IBI.cold, 'text-anchor': 'middle', 'dominant-baseline': 'central'}, svg);
    // selected heading: hollow circle on the ring
    const sel = IBI.svg('g', null, svg);
    IBI.svg('circle', {cx: 120, cy: 12, r: phone ? 5 : 4.5, fill: 'none', stroke: '#fff', 'stroke-width': phone ? 2.4 : 1.8}, sel);
    if (!phone) IBI.svg('line', {x1: 120, y1: 62, x2: 120, y2: 89, stroke: '#fff', 'stroke-opacity': '.5', 'stroke-width': 1.5, 'stroke-dasharray': '3 4'}, sel);
    // track: filled triangle on the outer ring
    const trk = IBI.svg('g', null, svg);
    IBI.svg('path', {d: phone ? 'M120 21L111 3H129Z' : 'M120 21L112.5 5H127.5Z', fill: '#fff'}, trk);
    IBI.svg('line', {x1: 120, y1: phone ? 66 : 64, x2: 120, y2: 89, stroke: '#fff', 'stroke-width': phone ? 3 : 2.4, 'stroke-linecap': 'round'}, trk);
    // true heading: hollow triangle on the inner ring
    const hdg = IBI.svg('g', null, svg);
    IBI.svg('path', {d: phone ? 'M120 58L112.5 73H127.5Z' : 'M120 57L113.5 70H126.5Z', fill: 'none', stroke: '#fff', 'stroke-width': phone ? 2.4 : 1.8, 'stroke-linejoin': 'round'}, hdg);
    const big = IBI.svg('text', {x: 120, y: phone ? 132 : 118, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': phone ? 52 : 38, 'font-weight': 600, fill: '#F5F7FA'}, svg);
    const sub = phone ? null : IBI.svg('text', {x: 120, y: 138, 'text-anchor': 'middle', 'font-family': 'Inter,sans-serif', 'font-size': 11, fill: '#B8B8B8'}, svg);

    return {svg, update(d, windLabel) {
        const rot = (g, a) => g.setAttribute('transform', `rotate(${a.toFixed(1)} 120 120)`);
        const has = (g, on) => { g.style.display = on ? '' : 'none'; };
        has(trk, d.track != null); if (d.track != null) rot(trk, d.track);
        has(hdg, d.thdg != null); if (d.thdg != null) rot(hdg, d.thdg);
        has(sel, d.selHdg != null); if (d.selHdg != null) rot(sel, d.selHdg);
        const w = d.ws != null;
        has(wind, w); windTxt.style.display = w ? '' : 'none';
        if (w) {
            rot(wind, d.wd);
            const a = d.wd * Math.PI / 180;
            let x = 120 + 128 * Math.sin(a) + 22 * Math.cos(a), y = 120 - 128 * Math.cos(a) + 22 * Math.sin(a);
            x = Math.max(-6, Math.min(246, x)); y = Math.max(-14, Math.min(254, y));
            windTxt.setAttribute('x', x.toFixed(1)); windTxt.setAttribute('y', y.toFixed(1));
            windTxt.textContent = windLabel;
        }
        if (d.gs != null) { big.textContent = ibSpeed(d.gs); if (sub) { sub.textContent = ibUnit('speed') + ' ground speed'; sub.style.display = ''; } }
        else { big.textContent = d.track != null ? ibDeg(d.track) : ''; if (sub) sub.style.display = 'none'; }
        let t = 'Compass, north up.';
        if (d.track != null) t += ` Track ${ibDeg(d.track)}.`;
        if (d.thdg != null) t += ` True heading ${ibDeg(d.thdg)}.`;
        if (d.selHdg != null) t += ` Selected heading ${ibDeg(d.selHdg)}.`;
        if (w) t += ` Wind from ${ibDeg(d.wd)} at ${windLabel}.`;
        if (d.gs != null) t += ` Ground speed ${ibSpeed(d.gs)} ${ibUnit('speed')}.`;
        IBI.label(svg, t);
    }};
};

// ---------------------------------------------------------------- attitude (wide)
IBI.makeAttitude = function (slot) {
    const svg = IBI.svg('svg', {role: 'img', width: 210, height: 136, viewBox: '0 0 200 130'}, slot);
    IBI.svg('path', {d: 'M30.72 60A80 80 0 0 1 169.28 60', fill: 'none', stroke: 'rgba(255,255,255,.3)', 'stroke-width': 2}, svg);
    const ticks = IBI.svg('g', {stroke: '#F5F7FA', 'stroke-width': 2, 'stroke-linecap': 'round'}, svg);
    for (const [a, len] of [[-60, 12], [-45, 7], [-30, 12], [-20, 7], [-10, 7], [0, 14], [10, 7], [20, 7], [30, 12], [45, 7], [60, 12]])
        IBI.svg('line', {x1: 100, y1: 20, x2: 100, y2: 20 + len, transform: `rotate(${a} 100 100)`}, ticks);
    IBI.svg('line', {x1: 40, y1: 100, x2: 160, y2: 100, stroke: 'rgba(255,255,255,.25)', 'stroke-dasharray': '3 4'}, svg);
    const ptr = IBI.svg('g', null, svg);
    IBI.svg('path', {d: 'M100 40L93.5 54H106.5Z', fill: '#fff'}, ptr);
    const body = IBI.svg('g', {stroke: '#fff', 'stroke-width': 4, 'stroke-linecap': 'round'}, svg);
    IBI.svg('line', {x1: 58, y1: 100, x2: 142, y2: 100}, body);
    IBI.svg('line', {x1: 100, y1: 100, x2: 100, y2: 84}, body);
    IBI.svg('circle', {cx: 100, cy: 100, r: 5, fill: '#fff'}, body);
    return {svg, update(roll) {
        const a = Math.max(-75, Math.min(75, roll)).toFixed(1);
        ptr.setAttribute('transform', `rotate(${a} 100 100)`); body.setAttribute('transform', `rotate(${a} 100 100)`);
        const r = Math.round(Math.abs(roll));
        IBI.label(svg, r === 0 ? 'Bank angle: wings level' : `Bank angle ${r} degrees ${roll > 0 ? 'right' : 'left'}`);
    }};
};
IBI.makeTurnBar = function (slot) {
    const svg = IBI.svg('svg', {role: 'img', width: '100%', height: 38, viewBox: '0 0 440 38', preserveAspectRatio: 'none'}, slot);
    IBI.svg('rect', {x: 0, y: 14, width: 440, height: 6, rx: 3, fill: 'rgba(255,255,255,.1)'}, svg);
    const fill = IBI.svg('rect', {y: 14, height: 6, rx: 3, fill: '#fff'}, svg);
    IBI.svg('line', {x1: 220, y1: 8, x2: 220, y2: 26, stroke: '#fff', 'stroke-width': 2}, svg);
    IBI.svg('line', {x1: 1, y1: 10, x2: 1, y2: 24, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 2}, svg);
    IBI.svg('line', {x1: 439, y1: 10, x2: 439, y2: 24, stroke: 'rgba(255,255,255,.5)', 'stroke-width': 2}, svg);
    const f = {'font-family': 'JetBrains Mono,monospace', 'font-size': 9, fill: '#B8B8B8'};
    IBI.svg('text', Object.assign({x: 0, y: 36}, f), svg, 'L 3°/s');
    IBI.svg('text', Object.assign({x: 440, y: 36, 'text-anchor': 'end'}, f), svg, 'R 3°/s');
    return {svg, update(rate) {
        const w = Math.min(220, Math.abs(rate) / 3 * 220);
        fill.setAttribute('width', Math.max(w, 0).toFixed(1));
        fill.setAttribute('x', (rate >= 0 ? 220 : 220 - w).toFixed(1));
        const frac = Math.abs(rate) / 3;
        IBI.label(svg, `Turn rate: ${Math.abs(rate) < 0.05 ? 'straight' : (rate > 0 ? 'right ' : 'left ') + Math.abs(rate).toFixed(1) + ' degrees per second'}, ${Math.round(frac * 100)} percent of standard rate`);
    }};
};

// ---------------------------------------------------------------- thermometer (wide)
IBI.thermo = function (parent, name, c, op) {
    const wrap = IBI.h('div', 'ibThermo', parent);
    const svg = IBI.svg('svg', {role: 'img', width: 28, height: 112, viewBox: '0 0 28 112'}, wrap);
    IBI.svg('rect', {x: 7, y: 4, width: 14, height: 92, rx: 7, fill: 'rgba(255,255,255,.1)'}, svg);
    const fillAttr = {x: 7, width: 14, rx: 7, fill: IBI.cold, 'fill-opacity': op};
    const fill = IBI.svg('rect', fillAttr, svg);
    IBI.svg('circle', {cx: 14, cy: 98, r: 9, fill: IBI.cold, 'fill-opacity': op}, svg);
    const lbl = IBI.h('div', 'lbl ibSmall', wrap, name);
    const val = IBI.h('div', 'v mono ibSm2', wrap, '');
    const f = Math.max(0.04, Math.min(1, (c + 50) / 80));          // -50 .. +30 degC
    fill.setAttribute('y', (96 - 92 * f).toFixed(1)); fill.setAttribute('height', (92 * f).toFixed(1));
    val.textContent = ibNum(c) + '°C';
    IBI.label(svg, `${name === 'OAT' ? 'Outside' : 'Total'} air temperature ${ibNum(c)} degrees Celsius`);
    return wrap;
};

// ---------------------------------------------------------------- altitude profile (wide)
IBI.profile = function (slot, p, d, route) {
    const pts = [];
    for (const s of p.track_linesegs || []) {
        if (!s.ts) continue;
        const a = s.alt_real === 'ground' ? 0 : (typeof s.alt_real == 'number' ? s.alt_real : null);
        if (a != null) pts.push([s.ts, a]);
    }
    const nowT = Date.now() / 1000;
    if (d.altFt != null) pts.push([Math.max(nowT, pts.length ? pts[pts.length - 1][0] + 1 : nowT), d.altFt]);
    else if (d.onGround) pts.push([Math.max(nowT, pts.length ? pts[pts.length - 1][0] + 1 : nowT), 0]);
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length < 2 || pts[pts.length - 1][0] - pts[0][0] < 30) return null;
    const W = 952, H = 210, L = 40, Rr = 940, T = 20, B = 170;
    let max = 0;
    for (const q of pts) if (q[1] > max) max = q[1];
    const top = Math.max(10000, Math.ceil(max / 10000) * 10000);
    const X = (t) => L + (t - pts[0][0]) / (pts[pts.length - 1][0] - pts[0][0]) * (Rr - L);
    const Y = (a) => B - Math.max(0, a) / top * (B - T);
    IBI.clear(slot);
    const svg = IBI.svg('svg', {role: 'img', width: '100%', height: 236, viewBox: `0 0 ${W} ${H}`}, slot);
    const gid = 'ibprof' + (++IBI.uid);
    // the legend gradient spans 0..45,000 ft
    const g = IBI.grad(svg, gid, B - 45000 / top * (B - T), B);
    g.setAttribute('id', gid);
    const grid = IBI.svg('g', {stroke: 'rgba(255,255,255,.08)'}, svg), lab = IBI.svg('g', {'font-family': 'JetBrains Mono,monospace', 'font-size': 10, fill: '#B8B8B8'}, svg);
    const step = top / 10000 > 5 ? 2 : 1;
    for (let a = 0; a <= top; a += step * 10000) {
        IBI.svg('line', {x1: L, x2: Rr, y1: Y(a), y2: Y(a)}, grid);
        IBI.svg('text', {x: 4, y: Y(a) + 4}, lab, a ? (convert_altitude(a, DisplayUnits) / 1000).toFixed(0) + 'k' : '0');
    }
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const fmt = (t) => { const dt = new Date(t * 1000); return String(dt.getUTCHours()).padStart(2, '0') + ':' + String(dt.getUTCMinutes()).padStart(2, '0'); };
    for (let i = 0; i < 4; i++) {
        const t = t0 + (t1 - t0) * i / 3;
        IBI.svg('text', {x: X(t), y: 196, 'text-anchor': i == 0 ? 'start' : i == 3 ? 'end' : 'middle'}, lab, fmt(t));
    }
    let dstr = '';
    pts.forEach((q, i) => { dstr += (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ' ' + Y(q[1]).toFixed(1); });
    IBI.svg('path', {d: dstr + `L${X(t1).toFixed(1)} ${B}L${L} ${B}Z`, fill: 'rgba(255,255,255,.05)'}, svg);
    IBI.svg('path', {d: dstr, fill: 'none', stroke: `url(#${gid})`, 'stroke-width': 3.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'}, svg);
    const last = pts[pts.length - 1], lx = X(last[0]), ly = Y(last[1]);
    IBI.svg('circle', {cx: lx, cy: ly, r: 11, fill: 'rgba(255,255,255,.18)'}, svg);
    IBI.svg('circle', {cx: lx, cy: ly, r: 5, fill: '#fff'}, svg);
    const nowTxt = ibAlt(last[1]) + ' ' + ibUnit('altitude') + ' · now';
    IBI.svg('text', {x: Math.min(lx, Rr - 60), y: ly + 26 > B + 6 ? ly - 16 : ly + 26, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': 11, 'font-weight': 600, fill: '#F5F7FA'}, svg, nowTxt);
    if (max > 0) {
        const mi = pts.findIndex(q => q[1] === max);
        if (mi > 0 && mi < pts.length - 1) IBI.svg('text', {x: X(pts[mi][0]), y: Math.max(12, Y(max) - 6), 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': 10, fill: '#B8B8B8'}, svg, ibAlt(max) + ' ' + ibUnit('altitude'));
    }
    if (route) IBI.svg('text', {x: L + 8, y: Y(pts[0][1]) - 10 < T ? T + 12 : Y(pts[0][1]) - 10, 'font-family': 'JetBrains Mono,monospace', 'font-size': 10, fill: '#B8B8B8'}, svg, route);
    IBI.label(svg, `Altitude profile over ${Math.round((t1 - t0) / 60)} minutes: from ${ibAlt(pts[0][1])} to ${ibAlt(last[1])} ${ibUnit('altitude')} now, highest ${ibAlt(max)}`);
    return {minutes: Math.max(1, Math.round((t1 - t0) / 60)), n: pts.length};
};

// ---------------------------------------------------------------- receiver view (wide; needs the receiver location AND SiteShow)
IBI.radar = function (slot, p, d) {
    IBI.clear(slot);
    const dispDist = convert_distance(d.dist, DisplayUnits);
    const steps = [0.5, 1, 2.5, 5, 10, 25, 50, 100, 150, 200, 300, 400, 600];
    let step = steps[steps.length - 1];
    for (const s of steps) if (s * 4 >= dispDist * 1.08) { step = s; break; }
    const px = (v) => v / step * 25;
    const svg = IBI.svg('svg', {role: 'img', width: 228, height: 228, viewBox: '0 0 220 220'}, slot);
    IBI.svg('circle', {cx: 110, cy: 110, r: 100, fill: 'rgba(255,255,255,.03)'}, svg);
    const g = IBI.svg('g', {fill: 'none', stroke: 'rgba(255,255,255,.12)'}, svg);
    for (const r of [25, 50, 75, 100]) IBI.svg('circle', {cx: 110, cy: 110, r}, g);
    IBI.svg('line', {x1: 110, y1: 10, x2: 110, y2: 210}, g); IBI.svg('line', {x1: 10, y1: 110, x2: 210, y2: 110}, g);
    const t = IBI.svg('g', {'font-family': 'JetBrains Mono,monospace', 'font-size': 8, fill: '#B8B8B8'}, svg);
    [1, 2, 3].forEach(i => IBI.svg('text', {x: 110 + i * 25 + 2, y: 106}, t, String(+(step * i).toFixed(1))));
    IBI.svg('text', {x: 113, y: 20}, t, 'N');
    const toXY = (pos) => {
        const dd = convert_distance(mapgeo.getDistance(SitePosition, pos), DisplayUnits), b = ibBearing(SitePosition, pos) * Math.PI / 180;
        return [110 + Math.sin(b) * px(dd), 110 - Math.cos(b) * px(dd)];
    };
    const [ax, ay] = toXY(p.position);
    const trail = [];
    for (const s of p.track_linesegs || []) if (s.position) trail.push(toXY(s.position));
    trail.push([ax, ay]);
    if (trail.length > 1)
        IBI.svg('polyline', {points: trail.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '), fill: 'none', stroke: '#C8E04C', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}, svg);
    IBI.svg('line', {x1: 110, y1: 110, x2: ax, y2: ay, stroke: 'rgba(255,255,255,.45)', 'stroke-dasharray': '3 4'}, svg);
    const rot = d.track != null ? d.track : (p.rotation || 0);
    const pl = IBI.svg('path', {d: 'M12 1.5c.9 0 1.6 1 1.6 2.2v5.6l8.4 4.9v2.2l-8.4-2.4v4.2l2.2 1.7v1.6L12 20.6l-3.8 1v-1.6l2.2-1.7v-4.2L2 16.4v-2.2l8.4-4.9V3.7c0-1.2.7-2.2 1.6-2.2z', fill: '#fff',
        transform: `translate(${(ax - 11).toFixed(1)} ${(ay - 11).toFixed(1)}) rotate(${rot.toFixed(0)} 11 11) scale(.917)`}, svg);
    IBI.svg('circle', {cx: 110, cy: 110, r: 9, fill: 'none', stroke: 'rgba(255,255,255,.5)'}, svg);
    IBI.svg('circle', {cx: 110, cy: 110, r: 4, fill: '#fff'}, svg);
    IBI.label(svg, `Receiver view: aircraft ${ibDist(d.dist)} ${ibUnit('distance')} ${IBI.compassName(d.brg).toLowerCase()} of the receiver` + (d.track != null ? `, heading ${IBI.compassName(d.track).toLowerCase()}` : ''));
};

// ================================================================= renderers
IBI.ensure = function () {
    const I = IBI.inst;
    if (!I.built) {
        I.built = true;
        I.tape = IBI.makeTape(ibEl('ib_alt_tape'));
        I.compass = IBI.makeCompass(ibEl('ib_compass'), false);
        I.compassPhone = IBI.makeCompass(ibEl('ib_compass_phone'), true);
        I.gsSpark = IBI.makeSpark(ibEl('ib_gs_spark'), 130, 44);
        I.att = IBI.makeAttitude(ibEl('ib_att'));
        I.turn = IBI.makeTurnBar(ibEl('ib_turn'));
        I.spRate = IBI.makeSpark(ibEl('ib_sp_rate'), 200, 34);
        I.spRssi = IBI.makeSpark(ibEl('ib_sp_rssi'), 200, 34);
    }
    return I;
};

IBI.speedLabel = (v) => ibSpeed(v);

IBI.renderCompact = function (p, d, sitedist) {
    const I = IBI.ensure();
    const u = {alt: ibUnit('altitude'), spd: ibUnit('speed'), vr: ibUnit('verticalRate')};
    let any = false;

    // ---- Altitude
    const altOn = d.onGround || d.altFt != null;
    IBI.show('ib_alt_card', altOn); any = any || altOn;
    if (altOn) {
        IBI.set('ib_alt_v', d.onGround ? 'Ground' : ibAlt(d.altFt));
        IBI.set('ib_alt_u', d.onGround ? '' : u.alt);
        IBI.show(I.tape.svg.parentNode, d.altFt != null);
        if (d.altFt != null) {
            const selFt = d.selAlt;
            I.tape.update(d.altFt, selFt, ibAlt(d.altFt) + ' ' + u.alt, selFt != null ? ibAlt(selFt) : '');
        }
        const vs = ibEl('ib_alt_vs');
        if (d.rate != null && !d.onGround) {
            const up = d.rate > 300, down = d.rate < -300;
            const metric = units_for('verticalRate', DisplayUnits) === 'metric';
            const num = ibNum(Math.abs(convert_vert_rate(d.rate, DisplayUnits)), metric ? 1 : 0);
            vs.textContent = up || down ? (up ? '▲ ' : '▼ ') + num + ' ' + u.vr : 'Level';
            vs.className = 'ibVs mono ' + (up ? 'climb' : down ? 'descend' : 'level');
            vs.hidden = false;
        } else vs.hidden = true;
        const gl = ibEl('ib_alt_geom');
        if (d.geomFt != null && d.altFt != null) {
            const diff = convert_altitude(d.geomFt, DisplayUnits) - convert_altitude(d.altFt, DisplayUnits);
            gl.textContent = 'Geometric ' + ibSigned(Math.round(diff)) + ' ' + u.alt; gl.hidden = false;
        } else gl.hidden = true;
    }

    // ---- Speed
    const spdVal = d.gs != null ? d.gs : d.tas != null ? d.tas : d.ias;
    const spdOn = spdVal != null;
    IBI.show('ib_spd_card', spdOn); any = any || spdOn;
    if (spdOn) {
        IBI.set('ib_spd_v', ibSpeed(spdVal));
        IBI.set('ib_spd_u', u.spd + (d.gs != null ? ' GS' : d.tas != null ? ' TAS' : ' IAS'));
        for (const [k, v] of [['ias', d.ias], ['tas', d.tas], ['gs', d.gs]]) {
            const row = document.querySelector('#ib_spd_bars [data-bar="' + k + '"]');
            row.hidden = v == null;
            if (v != null) {
                row.querySelector('.ibBarFill').style.width = Math.min(100, v / 600 * 100).toFixed(1) + '%';
                const t = ibSpeed(v);
                const el = row.querySelector('.ibBarV'); if (el.textContent !== t) el.textContent = t;
            }
        }
        const pills = ibEl('ib_spd_pills');
        IBI.clear(pills);
        if (d.mach != null) IBI.h('span', 'chip ibChipS', pills, 'Mach ' + d.mach.toFixed(2));
        let wind = d.head != null ? -d.head : (d.gs != null && d.tas != null ? d.gs - d.tas : null);
        if (wind != null && Math.abs(wind) >= 0.5) {
            const w = IBI.h('span', 'chip ibChipS ibWindChip', pills, ibSigned(Math.round(convert_speed(wind, DisplayUnits))) + ' ' + u.spd + ' wind');
        }
        pills.hidden = !pills.firstChild;
        const h = IBI.hist.get(p);
        const spark = h && h.gs.length >= 3 && h.gs[h.gs.length - 1][0] - h.gs[0][0] >= 30;
        IBI.show('ib_gs_spark_wrap', !!spark);
        if (spark) {
            const mins = Math.min(10, Math.max(1, Math.round((h.gs[h.gs.length - 1][0] - h.gs[0][0]) / 60)));
            const cut = h.gs[h.gs.length - 1][0] - 600;
            const pts = h.gs.filter(q => q[0] >= cut);
            const ok = I.gsSpark.update(pts, `Ground speed over the last ${mins} minutes, now ${ibSpeed(d.gs)} ${u.spd}`);
            IBI.set('ib_gs_spark_l', 'GS · last ' + (mins >= 10 ? '10 min' : mins + ' min'));
            if (!ok) IBI.show('ib_gs_spark_wrap', false);
        }
    }

    // ---- Direction & wind
    const dirOn = d.track != null;
    IBI.show('ib_dir_card', dirOn); any = any || dirOn;
    if (dirOn) {
        const windLabel = d.ws != null ? ibSpeed(d.ws) + ' ' + u.spd : '';
        if (!ibIsPhone()) I.compass.update(d, windLabel);
        const minis = (id, on, label, val, unit, cls) => {
            IBI.show(id, on);
            if (!on) return;
            IBI.set(id + '_v', val); IBI.set(id + '_u', unit || '');
            const m = ibEl(id); m.classList.toggle('cold', !!cls);
            if (label) m.querySelector('.lbl').textContent = label;
        };
        if (d.head != null) {
            const tail = d.head < 0;
            minis('ib_m_tail', true, tail ? 'Tailwind' : 'Headwind', ibSpeed(Math.abs(d.head)), u.spd, tail);
            minis('ib_m_cross', true, 'Crosswind', ibSpeed(Math.abs(d.cross)), u.spd + (Math.abs(d.cross) >= 0.5 ? (d.cross > 0 ? ' R' : ' L') : ''), false);
        } else { IBI.show('ib_m_tail', false); IBI.show('ib_m_cross', false); }
        if (d.drift != null) minis('ib_m_drift', true, 'Drift', Math.abs(Math.round(d.drift)) + '°', Math.abs(d.drift) < 0.5 ? 'on track' : 'crab ' + (d.drift > 0 ? 'R' : 'L'), false);
        else IBI.show('ib_m_drift', false);
        IBI.show('ib_dir_minis', d.head != null || d.drift != null);
        // legend chips
        const lg = ibEl('ib_dir_legend');
        IBI.clear(lg);
        const chip = (sym, text, col) => {
            const c = IBI.h('span', 'chip ibChipS', lg);
            const s = IBI.svg('svg', {width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true'}, c);
            if (sym == 'fill') IBI.svg('path', {d: 'M5 9L0.5 1H9.5Z', fill: col || '#fff'}, s);
            else if (sym == 'hollow') IBI.svg('path', {d: 'M5 1L9 9H1Z', fill: 'none', stroke: '#fff', 'stroke-width': 1.4, 'stroke-linejoin': 'round'}, s);
            else IBI.svg('circle', {cx: 5, cy: 5, r: 3.5, fill: 'none', stroke: '#fff', 'stroke-width': 1.4}, s);
            c.appendChild(document.createTextNode(text));
        };
        chip('fill', 'Track ' + ibDeg(d.track));
        if (d.thdg != null) chip('hollow', 'Heading ' + ibDeg(d.thdg));
        if (d.selHdg != null) chip('circle', 'Selected ' + ibDeg(d.selHdg));
        if (d.ws != null) chip('fill', 'Wind ' + ibDeg(d.wd) + ' · ' + windLabel, IBI.cold);
    }

    // ---- Track / Squawk / Distance tiles
    IBI.show('ib_t_trk', d.track != null);
    IBI.set('ib_trk', ibDeg(d.track)); IBI.set('ib_trk_sub', IBI.compassName(d.track));
    IBI.show('ib_t_sq', !!d.sq);
    let sqText = d.sq; if (d.sq && p.spi) sqText = d.sq + ' IDENT';
    IBI.set('ib_sq', sqText);
    IBI.set('ib_sq_sub', d.sq ? (IBI.SQUAWK[d.sq] || 'Discrete') : '');
    ibEl('ib_t_sq').classList.toggle('emergency', !!d.emerg);
    const distOn = sitedist != null;
    IBI.show('ib_t_dist', distOn);
    IBI.set('ib_dist', distOn ? ibDist(sitedist) : ''); IBI.set('ib_dist_u', distOn ? ibUnit('distance') : '');
    IBI.set('ib_dist_sub', distOn && d.brg != null ? ibCompass(d.brg) + ' of you' : '');
    const t3 = ibEl('ib_tiles3');
    const n3 = (d.track != null) + !!d.sq + distOn;
    t3.hidden = n3 === 0; t3.dataset.n = n3;
    any = any || n3 > 0;

    // ---- Autopilot strip (modes are wide-only: they come from too few aircraft)
    const apOn = d.selAlt != null || d.selHdg != null || d.qnh != null;
    IBI.show('ib_ap_card', apOn); any = any || apOn;
    if (apOn) {
        const cell = (k, v) => { const c = document.querySelector('#ib_ap_vals [data-ap="' + k + '"]'); c.hidden = v == null; if (v != null) c.querySelector('.v').textContent = v; };
        cell('alt', d.selAlt != null ? ibAlt(d.selAlt) : null);
        cell('hdg', d.selHdg != null ? ibDeg(d.selHdg) : null);
        cell('qnh', d.qnh != null ? String(Math.round(d.qnh)) : null);
        const bar = ibEl('ib_ap_bar'), show = d.selAlt != null && d.altFt != null;
        bar.hidden = !show;
        if (show) {
            const to = Math.abs(d.altFt - d.selAlt);
            bar.querySelector('.ibBarFill').style.width = ((1 - Math.min(to, 10000) / 10000) * 100).toFixed(1) + '%';
            IBI.set('ib_ap_togo', ibNum(convert_altitude(to, DisplayUnits)) + ' ' + u.alt + ' to go');
        }
    }
    IBI.show('ib_limited_c', !any);
    return any;
};

// phone sheet
IBI.renderPhone = function (p, d, sitedist) {
    const I = IBI.ensure();
    const u = ibUnit('speed');
    const windLabel = d.ws != null ? ibSpeed(d.ws) + ' ' + u : '';
    const compassOn = d.track != null;
    IBI.show('ib_compass_phone', compassOn);
    if (compassOn) I.compassPhone.update(d, windLabel);
    IBI.set('ib_p_wind', d.ws != null ? ibDeg(d.wd) : null);
    IBI.set('ib_p_wind_u', d.ws != null ? windLabel : '');
    ibEl('ib_p_wind').closest('[data-row]').hidden = d.ws == null;
    // chips: phase, tailwind, selected altitude
    const ch = ibEl('ib_p_chips');
    IBI.clear(ch);
    if (d.phase && d.phase != 'Level') { const c = IBI.h('span', 'chip ibPhase', ch, d.phase); }
    if (d.head != null) IBI.h('span', 'chip', ch, (d.head < 0 ? 'Tailwind ' : 'Headwind ') + ibSpeed(Math.abs(d.head)) + ' ' + u);
    if (d.selAlt != null) IBI.h('span', 'chip mono', ch, 'Sel ' + ibAlt(d.selAlt));
    ch.hidden = !ch.firstChild;
    ibEl('ib_p_sq_t').hidden = !d.sq;
    ibEl('ib_p_sq_t').classList.toggle('emergency', !!d.emerg);
};

// ---------------------------------------------------------------- wide grid
IBI.renderWide = function (p, d) {
    const I = IBI.ensure();
    const u = {alt: ibUnit('altitude'), spd: ibUnit('speed')};
    let any = false;

    // Attitude
    const rollOn = p.roll != null, rateOn = p.track_rate != null;
    IBI.show('wc_att', rollOn || rateOn); any = any || rollOn || rateOn;
    ibEl('ib_att').hidden = !rollOn;
    if (rollOn) {
        I.att.update(p.roll);
        IBI.set('ib_roll', Math.abs(Math.round(p.roll)) + '°');
        ibEl('ib_roll').dataset.dir = Math.abs(p.roll) < 0.5 ? '' : (p.roll > 0 ? 'right' : 'left');
    }
    if (ibEl('ib_roll').previousElementSibling) ibEl('ib_roll').previousElementSibling.hidden = !rollOn; ibEl('ib_roll').hidden = !rollOn;
    ibEl('ib_trate_l').hidden = !rateOn; ibEl('ib_trate').hidden = !rateOn;
    IBI.set('ib_trate', rateOn ? ibSigned(p.track_rate, 1) + ' °/s' : '');
    ibEl('ib_turn').hidden = !rateOn;
    if (rateOn) I.turn.update(p.track_rate);

    // Autopilot
    const apv = d.selAlt != null || d.selHdg != null || d.qnh != null, modes = Array.isArray(p.nav_modes);
    IBI.show('wc_ap', apv || modes); any = any || apv || modes;
    const pills = ibEl('ib_ap_pills_w');
    IBI.clear(pills);
    if (modes) {
        const m = new Set(p.nav_modes);
        for (const [k, t] of [['autopilot', 'AP'], ['lnav', 'LNAV'], ['vnav', 'VNAV'], ['approach', 'APPR'], ['althold', 'ALT HOLD'], ['tcas', 'TCAS']])
            IBI.pill(pills, t, m.has(k));
        pills.setAttribute('aria-label', 'Autopilot modes active: ' + (p.nav_modes.length ? p.nav_modes.join(', ') : 'none'));
    }
    const tile = (id, v, unit) => { IBI.show(id + '_t', v != null); if (v != null) { IBI.set(id, v); if (unit != null) IBI.set(id + '_u', unit); } };
    tile('ib_apw_alt', d.selAlt != null ? ibAlt(d.selAlt) : null, ' ' + u.alt);
    tile('ib_apw_hdg', d.selHdg != null ? ibDeg(d.selHdg) : null);
    tile('ib_apw_qnh', d.qnh != null ? String(Math.round(d.qnh)) : null);
    const barOn = d.selAlt != null && d.altFt != null;
    IBI.show('ib_apw_bar', barOn);
    if (barOn) {
        const to = Math.abs(d.altFt - d.selAlt);
        ibEl('ib_apw_bar').querySelector('.ibBarFill').style.width = ((1 - Math.min(to, 10000) / 10000) * 100).toFixed(1) + '%';
        IBI.set('ib_apw_now', ibAlt(d.altFt) + ' ' + u.alt + ' now'); IBI.set('ib_apw_sel', ibAlt(d.selAlt) + ' ' + u.alt + ' selected');
        IBI.set('ib_apw_note', ibNum(convert_altitude(to, DisplayUnits)) + ' ' + u.alt + ' to go · shown only when the aircraft broadcasts its selected values');
    }

    // Altitude profile
    const prof = IBI.profile(ibEl('ib_prof'), p, d, (() => { const r = ibRoute(p); return r ? ibCode(r._airports[0]) : ''; })());
    IBI.show('wc_prof', !!prof); any = any || !!prof;
    if (prof) IBI.set('ib_prof_meta', `Tracked ${prof.minutes} min · ${ibNum(p.history_size || prof.n)} position fixes`);

    // Receiver view (privacy: receiver location set AND shown; coordinates are never printed)
    const rxOn = d.rx && d.dist != null;
    IBI.show('wc_rx', !!rxOn); any = any || !!rxOn;
    if (rxOn) {
        IBI.radar(ibEl('ib_rx'), p, d);
        IBI.set('ib_rx_dist', ibDist(d.dist)); IBI.set('ib_rx_dist_u', ' ' + ibUnit('distance'));
        IBI.set('ib_rx_brg', ibDeg(d.brg)); IBI.set('ib_rx_brg_u', ' ' + ibCompass(d.brg));
        let dir = '';
        if (d.track != null) {
            const delta = Math.abs(IBI.wrap180(d.track - (d.brg + 180)));
            dir = delta < 50 ? 'Inbound: heading toward your receiver' : delta > 130 ? 'Outbound: heading away from your receiver' : 'Passing: flying across your receiver';
        }
        IBI.set('ib_rx_dir', dir);
    }

    // Signal
    const sigOn = !showTrace && (p.rssi != null || p.messages != null || p.seen != null || p.seen_pos != null || p.messageRate != null);
    IBI.show('wc_sig', sigOn); any = any || sigOn;
    if (sigOn) {
        const h = IBI.hist.get(p);
        IBI.set('ib_sig_src', '');
        const sc = ibEl('ib_sig_src'); IBI.clear(sc);
        if (p.dataSource) { const c = IBI.h('span', 'chip ibSrc src-' + sourceGroup(p.dataSource), sc); IBI.h('span', 'ibDot', c); c.appendChild(document.createTextNode(format_data_source(p.dataSource))); }
        const rssiOn = p.rssi != null;
        IBI.show('ib_sig_rssi_blk', rssiOn);
        if (rssiOn) {
            IBI.set('ib_sig_rssi', ibNum(p.rssi, 1));
            ibEl('ib_sig_bar').style.width = (Math.max(0, Math.min(1, (p.rssi + 35) / 35)) * 100).toFixed(1) + '%';
            ibEl('ib_sig_bar').closest('.ibBarTrack').setAttribute('aria-label', `Signal strength ${ibNum(p.rssi, 1)} dBFS, scale from minus 35 weak to 0 strong`);
        }
        const rs = h && h.rate.length >= 3, ri = h && h.rssi.length >= 3;
        IBI.show('ib_sp_rate_blk', !!rs); IBI.show('ib_sp_rssi_blk', !!ri);
        if (rs) {
            const mins = Math.max(1, Math.round((h.rate[h.rate.length - 1][0] - h.rate[0][0]) / 60));
            IBI.set('ib_sp_rate_l', 'Message rate · ' + Math.min(mins, 5) + ' min');
            I.spRate.update(h.rate.slice(-75), `Message rate over the last ${Math.min(mins, 5)} minutes, now ${ibNum(p.messageRate, 1)} per second`);
        }
        if (ri) {
            const mins = Math.max(1, Math.round((h.rssi[h.rssi.length - 1][0] - h.rssi[0][0]) / 60));
            IBI.set('ib_sp_rssi_l', 'RSSI · ' + Math.min(mins, 5) + ' min');
            I.spRssi.update(h.rssi.slice(-75), `Signal strength over the last ${Math.min(mins, 5)} minutes, now ${ibNum(p.rssi, 1)} dBFS`);
        }
        ibEl('ib_sig_sparks').hidden = !rs && !ri;
        const rxMode = ((p.messages == undefined && p.receiverCount) || (globeIndex && binCraft));
        const msgs = rxMode ? (p.receiverCount >= 5 && p.dataSource != 'mlat' ? '> ' + p.receiverCount : p.receiverCount) : ibNum(p.messages);
        const m4 = (id, v) => { IBI.show(id + '_t', v != null && v !== ''); IBI.set(id, v); };
        m4('ib_sg_msgs', msgs); IBI.set('ib_sg_msgs_l', rxMode ? 'Receivers' : 'Messages');
        m4('ib_sg_rate', p.messageRate != null ? ibNum(p.messageRate, p.messageRate < 10 ? 1 : 0) + '/s' : null);
        m4('ib_sg_seen', p.seen != null && p.seen < 1e6 ? format_duration(p.seen) : null);
        m4('ib_sg_pos', p.seen_pos != null && p.seen_pos < 1e6 ? format_duration(p.seen_pos) : null);
    }

    // Accuracy & integrity
    const accRows = [];
    const row = (label, n, val, lit, txt) => { if (val != null) accRows.push({label, n, lit, txt}); };
    if (p.nac_p != null) row('NACp', 12, p.nac_p, p.nac_p + 1, `${p.nac_p} · ${IBI.NACP[p.nac_p] || 'unknown'}`);
    if (p.nac_v != null) row('NACv', 5, p.nac_v, p.nac_v + 1, `${p.nac_v} · ${IBI.NACV[p.nac_v] || 'unknown'}`);
    if (p.sil != null) row('SIL', 4, p.sil, p.sil + 1, `${p.sil} · ${IBI.SIL[p.sil] || 'unknown'}`);
    if (p.nic_baro != null) row('NICbaro', 2, p.nic_baro, p.nic_baro + 1, `${p.nic_baro} · ${p.nic_baro == 1 ? 'checked' : 'not checked'}`);
    IBI.show('wc_acc', accRows.length > 0); any = any || accRows.length > 0;
    if (accRows.length) {
        const box = ibEl('ib_acc_rows'); IBI.clear(box);
        for (const r of accRows) {
            const li = IBI.h('div', 'ibAccRow', box);
            IBI.h('span', 'lbl ibAccL', li, r.label);
            const bar = IBI.h('div', 'ibSegs', li);
            bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', `${r.label}: ${r.txt}`);
            for (let i = 0; i < r.n; i++) IBI.h('span', 'seg' + (i < r.lit ? ' l' : ''), bar);
            IBI.h('span', 'mono ibAccV', li, r.txt);
        }
        const vs = ibEl('ib_acc_ver'); IBI.clear(vs);
        if (p.version != null) IBI.h('span', 'chip mono', vs, ibVersion(p.version));
    }

    // Temperature & wind
    let oat = null, tat = null;
    if (p.tat != null && p.oat != null) { oat = p.oat; tat = p.tat; }
    else if (!globeIndex && p.mach != null && p.tas != null && p.mach > 0.395) {
        oat = Math.pow((p.tas / 661.47 / p.mach), 2) * 288.15 - 273.15;
        tat = -273.15 + (oat + 273.15) * (1 + 0.2 * p.mach * p.mach);
    }
    const tmpOn = oat != null || d.ws != null;
    IBI.show('wc_tmp', tmpOn); any = any || tmpOn;
    if (tmpOn) {
        const th = ibEl('ib_thermos'); IBI.clear(th);
        if (oat != null) IBI.thermo(th, 'OAT', oat, 1);
        if (tat != null) IBI.thermo(th, 'TAT', tat, 0.7);
        th.hidden = oat == null;
        IBI.show('ib_tmp_wind', d.ws != null);
        if (d.ws != null) {
            IBI.set('ib_tmp_wind_v', ibDeg(d.wd)); IBI.set('ib_tmp_wind_u', ' / ' + ibSpeed(d.ws) + ' ' + u.spd);
            IBI.show('ib_tw_tail', d.head != null); IBI.show('ib_tw_cross', d.cross != null);
            if (d.head != null) {
                IBI.set('ib_tw_tail_l', d.head < 0 ? 'Tailwind' : 'Headwind');
                IBI.set('ib_tw_tail_v', ibSpeed(Math.abs(d.head)) + ' ' + u.spd);
                IBI.set('ib_tw_cross_v', ibSpeed(Math.abs(d.cross)) + ' ' + u.spd + (Math.abs(d.cross) >= 0.5 ? (d.cross > 0 ? ' R' : ' L') : ''));
            }
        }
        IBI.set('ib_tmp_note', 'Derived by tar1090 from TAS, GS, track and heading. Hidden when the aircraft does not send them.');
    }

    // Identity & status
    const cat = p.category ? p.category.toUpperCase() : null;
    IBI.set('ib_id_cat', cat ? cat + (IBI.CATEGORY[cat] ? ' · ' + IBI.CATEGORY[cat] : '') : '');
    const yr = p.year ? Number(p.year) : null;
    IBI.set('ib_id_built', yr ? yr + ' · ' + Math.max(0, new Date().getUTCFullYear() - yr) + ' yrs' : '');
    IBI.set('ib_id_owner', p.ownOp || ibAirline(p) || '');
    let first = null;
    for (const s of p.track_linesegs || []) if (s.ts) { first = s.ts; break; }
    IBI.set('ib_id_first', first ? (() => { const dt = new Date(first * 1000); return String(dt.getUTCHours()).padStart(2, '0') + ':' + String(dt.getUTCMinutes()).padStart(2, '0') + ' UTC'; })() : '');
    IBI.set('ib_id_pos', p.position ? ibNum(p.position[1], 3) + ', ' + ibNum(p.position[0], 3) : '');
    for (const id of ['ib_id_cat', 'ib_id_built', 'ib_id_owner', 'ib_id_first', 'ib_id_pos']) {
        const e = ibEl(id); e.closest('[data-row]').hidden = e.textContent === '';
    }
    const fl = ibEl('ib_id_flags'); IBI.clear(fl);
    for (const [t, on] of [['MILITARY', p.military], ['INTERESTING', p.interesting], ['PIA', p.pia], ['LADD', p.ladd]]) IBI.pill(fl, t, !!on);
    IBI.set('ib_id_sq_t', d.sq ? 'Squawk ' + d.sq : '');
    IBI.set('ib_id_sq_d', d.sq ? (IBI.SQUAWK[d.sq] ? IBI.SQUAWK[d.sq] + '.' : 'Discrete code, no special meaning. Known codes (7000, 2000, 1200…) get a label.') : '');
    const emText = d.emerg ? IBI.SQUAWK[d.emerg] : d.emergState ? (IBI.EMERG[d.emergState] || d.emergState) : '';
    IBI.show('ib_id_emerg', !!(d.emerg || d.emergState));
    IBI.set('ib_id_emerg_code', d.emerg || d.sq || '');
    IBI.set('ib_id_emerg_txt', emText);
    ibEl('ib_id_emerg_note').hidden = !!(d.emerg || d.emergState);
    return any;
};

// ---------------------------------------------------------------- driver
// panel-wide emergency outline; throttled to 4 Hz except when the aircraft changes
IBI.due = function (p, force) {
    const now = performance.now();
    const k = p.icao + (ibIsPhone() ? 'p' : 'd') + (document.body.classList.contains('infoWide') ? 'w' : 'c');
    if (!force && k === IBI.key && now - IBI.lastT < 1000 / IBI.HZ) return false;
    IBI.key = k; IBI.lastT = now;
    return true;
};

jQuery(function () {
    const b = document.getElementById('ib_copy_hex');
    if (b) b.addEventListener('click', function () {
        if (!SelectedPlane) return;
        const hex = SelectedPlane.icao.toUpperCase(), lab = this.querySelector('span');
        const done = () => { lab.textContent = 'Copied'; setTimeout(() => { lab.textContent = 'Copy hex'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(hex).then(done, () => {});
        else done();
    });
});
