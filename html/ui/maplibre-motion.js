"use strict";
// Skywatch ADS-B: smooth aircraft movement.
//
// Between real position updates each aircraft's DRAWN position is extrapolated (dead reckoning) from its last real
// position using ground speed and track (and track rate for turns). When a new real position arrives the drawn
// position is blended toward it over ~0.5 s with easing, and never moves backwards along the track.
//
// Data honesty: p.position / p.proj (table, details panel, trails, distance, "in view" filtering) are never touched.
// Only the icon, its label, the selected pill and the Follow camera use the drawn position (e.dLL, p.mdraw).
// Off in replay / history animation, for aircraft on the ground, slow, stale, and when the user prefers reduced motion.
const MOTION = {
    on: true,                 // the "Smooth movement" setting
    reduced: false,           // prefers-reduced-motion
    blendMs: 500,
    limitMs: 8000,            // stop extrapolating after this long without a fix (hold position)
    limitSlowMs: 20000,       // MLAT / TIS-B / other sources update less often
    minKt: 20,                // below this speed (or on the ground) an aircraft is not extrapolated
    otherFps: 12,             // update rate for aircraft that are not selected / followed (adapts to the load)
    cost: 0,                  // moving average of the cost of one animation tick, ms
    frames: 0, ticks: 0,
    lastOther: 0,
    hot: new Set(),
};
try { MOTION.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

const MOTION_RAD = Math.PI / 180;

MLR.smoothActive = function () {
    if (!MOTION.on || MOTION.reduced) return false;
    if (typeof replay != 'undefined' && replay) return false;
    if (typeof showTrace != 'undefined' && showTrace) return false;
    if (typeof traceOpts != 'undefined' && traceOpts && traceOpts.animate) return false;
    return true;
};

MLR.baseLL = function (e) {                      // ground position (what the data says)
    return (e.dLL && this.smoothActive()) ? e.dLL : mapgeo.toLonLat(e.plane.proj);
};
MLR.drawnLL = function (e) {                     // where the icon is drawn: lifted by altitude in 3D (ui/maplibre-lift.js)
    const g = this.baseLL(e);
    return this.liftLL ? this.liftLL(g, e.plane) : g;
};

function motionPos(f, t) {
    if (f.v <= 0) return [f.x, f.y];
    const dt = Math.max(0, Math.min(t - f.t, f.limit)) / 1000;
    const h = (f.trk + f.rate * dt / 2) * MOTION_RAD;
    const d = f.v * dt * f.k;
    return [f.x + d * Math.sin(h), f.y + d * Math.cos(h)];
}

// called from PlaneObject.setProjection(): a new real position has arrived
MLR.onFix = function (p) {
    if (!this.smoothActive()) { p.mfix = null; p.mdraw = null; const e0 = this.planes.get(p.icao); if (e0) e0.dLL = null; return; }
    if (!p.proj || !p.position) return;
    const prev = p.mfix;
    if (prev && p.position_time === prev.pt && p.proj[0] === prev.x && p.proj[1] === prev.y) return;   // same fix again
    const now = performance.now();
    const age = Math.min(4, Math.max(0, +p.seen_pos || 0));
    const kt = p.speed;
    const moving = !p.onGround && kt != null && kt >= MOTION.minKt && age <= 3;
    const slow = !(p.dataSource == 'adsb' || p.dataSource == 'uat' || p.dataSource == 'adsr' || p.dataSource == 'modeS') || p.position_from_mlat;
    const f = {
        x: p.proj[0], y: p.proj[1], t: now - age * 1000, pt: p.position_time,
        v: moving ? kt * 0.514444 : 0,
        trk: p.track != null ? p.track : (p.rotation || 0),
        rate: Math.max(-6, Math.min(6, +p.track_rate || 0)),
        k: 1 / Math.max(0.05, Math.cos(p.position[1] * MOTION_RAD)),        // Web Mercator metres per ground metre
        limit: (p.dataSource == 'mlat' || p.dataSource == 'tisb' || p.dataSource == 'other' || p.dataSource == 'adsc') ? MOTION.limitSlowMs : MOTION.limitMs,
        off: [0, 0], t0: now,
    };
    if (slow) f.limit = Math.max(f.limit, MOTION.limitSlowMs);
    // blend from where the aircraft is drawn now to the new track: keep the difference and fade it out
    if (p.mdraw) {
        const T = motionPos(f, now);
        const ox = p.mdraw[0] - T[0], oy = p.mdraw[1] - T[1];
        if (Math.hypot(ox, oy) < 3000) f.off = [ox, oy];        // a bigger jump is a real discontinuity: don't smear it
    }
    p.mfix = f;
};

MLR.motionHot = function () {
    const hot = MOTION.hot; hot.clear();
    if (typeof SelectedPlane != 'undefined' && SelectedPlane) hot.add(SelectedPlane.icao);
    if (typeof SelPlanes != 'undefined') for (const p of SelPlanes) hot.add(p.icao);
    return hot;
};

// Select => zoom + follow. The camera eases (~1.2 s) onto the aircraft's DRAWN icon, zooms in to at least
// FOCUS_ZOOM (never out), and leaves the aircraft in the middle of the free map area: the open panel is applied as
// camera padding. Each frame the target is the live smoothed icon position, so the ease ends exactly on it and
// Follow carries on from there (motionTick). A user drag/pinch cancels the ease; Follow then drops by itself
// (checkFollow notices the centre moved).
const FOCUS_ZOOM = 9.5, FOCUS_MS = 1200;
MLR.focusPadding = function () {
    const phone = window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
    const w = this.map.getContainer().clientWidth, h = this.map.getContainer().clientHeight;
    let left = 0, bottom = 0;
    for (const id of ['selected_infoblock', 'sidebar_container']) {
        const el = document.getElementById(id);
        if (!el || !el.offsetParent) continue;
        if (phone) bottom = Math.max(bottom, Math.min(h * 0.6, el.offsetHeight || 300));
        else left = Math.max(left, el.offsetLeft + el.offsetWidth + 24);
    }
    if (phone) return {left: 0, right: 0, top: 70, bottom: Math.max(bottom, 0)};
    return {left: Math.min(left, w * 0.55), right: 0, top: 0, bottom: 0};
};
MLR.focusOn = function (p, opts) {
    if (!this.ready || !p || !(p.mdraw || p.proj)) return;
    const m = this.map, now = performance.now();
    opts = opts || {};
    const a = {
        p, t0: now, dur: MOTION.reduced ? 0 : (opts.dur != null ? opts.dur : FOCUS_MS),
        c0: mapa.getCenterProj(), z0: m.getZoom(), pad0: Object.assign({left: 0, right: 0, top: 0, bottom: 0}, m.getPadding()),
    };
    a.z1 = opts.keepZoom ? a.z0 : Math.max(a.z0, FOCUS_ZOOM);
    a.pad1 = this.focusPadding();
    this.focusAnim = a;
    if (a.dur == 0) this.focusStep(now);
};
MLR.focusStep = function (now) {
    const a = this.focusAnim;
    if (!a) return;
    const p = a.p;
    if (typeof SelectedPlane == 'undefined' || SelectedPlane !== p || !(p.mdraw || p.proj)) { this.focusAnim = null; return; }
    const m = this.map;
    const tgt = this.liftProj(p, (this.smoothActive() && p.mdraw) ? p.mdraw : p.proj);
    const s = a.dur > 0 ? Math.max(0, Math.min(1, (now - a.t0) / a.dur)) : 1;   // rAF timestamps can precede t0
    const e = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;          // ease in-out cubic
    const pad = {};
    for (const k of ['left', 'right', 'top', 'bottom']) pad[k] = a.pad0[k] + (a.pad1[k] - a.pad0[k]) * e;
    const c = [a.c0[0] + (tgt[0] - a.c0[0]) * e, a.c0[1] + (tgt[1] - a.c0[1]) * e];
    this._focusMoving = true;
    m.jumpTo({center: mapgeo.toLonLat(c), zoom: a.z0 + (a.z1 - a.z0) * e, padding: pad});
    this._focusMoving = false;
    if (s >= 1) {
        this.focusAnim = null;
        this.followProj = tgt.slice();
    }
};
// a panel opened/closed/widened while following: slide the aircraft to the middle of the new free area
MLR.refocusPadding = function () {
    if (!this.ready || typeof SelectedPlane == 'undefined' || !SelectedPlane || !FollowSelected) return;
    this.focusOn(SelectedPlane, {keepZoom: true, dur: 350});
};
// leaving the selection: drop the padding without moving what is on screen
MLR.clearFocus = function () {
    this.focusAnim = null;
    if (!this.ready) return;
    const m = this.map, pd = m.getPadding();
    if (!pd.left && !pd.right && !pd.top && !pd.bottom) return;
    const c = m.getContainer();
    const at = m.unproject([c.clientWidth / 2, c.clientHeight / 2]);
    m.jumpTo({center: at, padding: {left: 0, right: 0, top: 0, bottom: 0}});
};
// while Follow is on, wheel / pinch zoom around the screen (padded) centre so the aircraft stays put
MLR.syncFollowZoom = function (on) {
    if (!this.ready) return;
    const o = on ? {around: 'center'} : {};
    this.map.scrollZoom.enable(o);
    this.map.touchZoomRotate.enable(o);
};

MLR.followStart = function (p, proj) {
    if (this.focusAnim) return;                 // the focus ease brings the camera there itself
    const pos = this.liftProj(p, p.mdraw || proj);
    mapa.setCenterProj(pos);
    this.followProj = pos.slice();
};

MLR.motionTick = function (now) {
    if (!this.ready || document.hidden) return;
    const active = this.smoothActive();
    if (!active) {
        if (this.motionWas) {
            this.motionWas = false;
            for (const e of this.planes.values()) { e.dLL = null; e.rotDraw = null; e.plane.mdraw = null; e.plane.mfix = null; }
            this.followProj = null;
            this.touch('planes');
        }
        return;
    }
    this.motionWas = true;
    const t0 = performance.now();
    const hot = this.motionHot();
    const doOthers = now - MOTION.lastOther >= 1000 / MOTION.otherFps;
    let bounds = null;
    if (doOthers) {
        MOTION.lastOther = now;
        if (!this.isGlobe()) { try { bounds = this.map.getBounds(); } catch (err) {} }
    }
    const updates = [], stemU = [], shU = [];
    const m = this.map;
    for (const e of this.planes.values()) {
        const p = e.plane, f = p.mfix;
        if (!f || !e.id) continue;
        const isHot = hot.has(p.icao);
        if (!isHot && !doOthers) continue;
        let dtR = e.tR ? Math.min(0.1, (now - e.tR) / 1000) : 0.016;
        // aircraft outside the current view are not animated; they catch up when they come back (cheap, drawn from the real fix)
        if (!isHot && bounds && p.position && !bounds.contains(new maplibregl.LngLat(p.position[0], p.position[1]))) { p.mdraw = null; if (e.dLL) { e.dLL = null; } continue; }
        const T = motionPos(f, now);
        const s = Math.max(0, Math.min(1, (now - f.t0) / MOTION.blendMs));
        const w = 1 - s * s * (3 - 2 * s);                      // smoothstep ease-out of the correction
        let X = T[0] + f.off[0] * w, Y = T[1] + f.off[1] * w;
        const prev = p.mdraw;
        if (prev && f.v > 0) {                                  // never move backwards along the track
            const h = f.trk * MOTION_RAD, ux = Math.sin(h), uy = Math.cos(h);
            const along = (X - prev[0]) * ux + (Y - prev[1]) * uy;
            if (along < 0) { X -= along * ux; Y -= along * uy; }
        }
        p.mdraw = [X, Y];
        const ll = mapgeo.toLonLat(p.mdraw);
        e.dLL = ll;
        // heading: shortest way round, eased
        let rotChanged = false;
        if (e.rotDraw == null) e.rotDraw = e.rot;
        let diff = ((e.rot - e.rotDraw + 540) % 360) - 180;
        if (Math.abs(diff) > 0.05) {
            e.rotDraw = (e.rotDraw + diff * (1 - Math.exp(-dtR / 0.22)) + 360) % 360;
            rotChanged = true;
        } else if (e.rotDraw !== e.rot) { e.rotDraw = e.rot; rotChanged = true; }
        e.tR = now;
        const lf = this.liftLL(ll, p);
        const u = {id: e.id, newGeometry: {type: 'Point', coordinates: lf}};
        if (lf !== ll) { const f = this.liftFeats(e, ll, lf); if (f) { stemU.push({id: e.id, newGeometry: f.s.geometry}); if (f.h) shU.push({id: e.id, newGeometry: f.h.geometry}); } }
        if (rotChanged) u.addOrUpdateProperties = [{key: 'rot', value: e.rotDraw}];
        updates.push(u);
    }
    if (updates.length) {
        try {
            const src = m.getSource('tar-planes'); src && src.updateData({update: updates});
            if (stemU.length) {
                const a = m.getSource('tar-lift-stems'), b = m.getSource('tar-lift-shadows');
                a && a.updateData({update: stemU}); b && b.updateData({update: shU});
            }
        } catch (err) { /* source not ready */ }
    }
    // Follow: the camera follows the drawn position
    if (typeof FollowSelected != 'undefined' && FollowSelected && SelectedPlane && SelectedPlane.mdraw
        && typeof checkFollow == 'function' && !this.focusAnim) {
        if (!this.followProj || checkFollow()) {
            const c = this.liftProj(SelectedPlane, SelectedPlane.mdraw);
            mapa.setCenterProj(c);
            this.followProj = c.slice();
        }
    }
    this.updateSelHead && this.updateSelHead();   // the selected trail's head and the dashed route follow the drawn icon every frame
    this.updateSelRoute && this.updateSelRoute();
    // keep the cost bounded: lower the update rate of the other aircraft when ticks get expensive
    const cost = performance.now() - t0;
    MOTION.ticks++;
    MOTION.cost = MOTION.cost * 0.9 + cost * 0.1;
    if (MOTION.ticks % 30 == 0) {
        if (MOTION.cost > 8 && MOTION.otherFps > 4) MOTION.otherFps -= 2;
        else if (MOTION.cost < 3 && MOTION.otherFps < 12) MOTION.otherFps += 1;
    }
};

MLR.motionLoop = function (now) {
    MOTION.frames++;
    try { MLR.focusStep(now); } catch (err) { MLR.focusAnim = null; console.warn('focus:', err); }
    try { MLR.motionTick(now); } catch (err) { if (!MOTION.err) { MOTION.err = 1; console.warn('smooth movement:', err); } }
    requestAnimationFrame(MLR.motionLoop);
};

jQuery(function () {
    new Toggle({
        key: 'smoothMove',
        display: 'Smooth movement',
        container: '#settingsRight',
        init: !MOTION.reduced,
        setState: function (state) {
            MOTION.on = state;
            if (typeof MLR != 'undefined' && MLR.ready) MLR.touch('planes');
        },
    });
    requestAnimationFrame(MLR.motionLoop);
});
