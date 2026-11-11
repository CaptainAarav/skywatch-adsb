"use strict";
// Skywatch ADS-B: 3D quality ladder (pure, unit tested in tools/test/quality-calc.test.js; applied to the map by ui/maplibre-quality.js).
//
// A level is a number 0..7. Every level includes everything the lower levels turned down. Steps, in the order they are taken when frames get slow:
//   1 pixel ratio capped lower     2 ground shadows off          3 label density down + collision frozen while the camera moves (and no antialias next load)
//   4 model level of detail low    5 terrain detail and exaggeration down     6 terrain off      7 models off (2D icons)
// Settings > Map > "3D quality": Auto (the controller below picks the level from real frame times), High (0), Balanced (3), Low (6).
const QUALITY = (function () {
    const MAX_LEVEL = 7;
    const NAMES = ['full', 'pixel ratio', 'no shadows', 'fewer labels', 'low model detail', 'light terrain', 'no terrain', 'no models'];
    const FIXED = {high: 0, balanced: 3, low: 6};
    const MODES = ['auto', 'high', 'balanced', 'low'];
    const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;
    const isSoftware = (renderer) => !!renderer && SOFTWARE_RE.test(String(renderer));
    const modeFrom = (v) => MODES.indexOf(v) >= 0 ? v : 'auto';
    // device pixel ratio actually used for the canvas. Level 0 allows 2 (1.5 above ~4 MP of canvas pixels); level 1+ caps at 1.5, and 1.25 / 1 on very large canvases.
    function pixelRatio(level, dpr, cssW, cssH) {
        dpr = dpr > 0 ? dpr : 1;
        const cap = level <= 0 ? 2 : 1.5;
        let r = Math.min(dpr, cap);
        const px = (w, h, k) => w * h * k * k;
        for (const lower of level <= 0 ? [1.5, 1.25, 1] : [1.25, 1]) if (px(cssW, cssH, r) > 4e6) r = Math.min(r, lower);
        return Math.max(1, Math.round(r * 100) / 100);
    }
    // what each level means for the map. Pure data so the test can check the ladder is monotonic (each level only ever turns things DOWN).
    function settings(level) {
        const l = Math.max(0, Math.min(MAX_LEVEL, level | 0));
        return {
            level: l, name: NAMES[l],
            pixelRatioCap: l <= 0 ? 2 : 1.5,
            shadows: l < 2,
            labelDensity: l < 3 ? 'full' : 'reduced',
            freezeLabelsWhileMoving: l >= 3,
            antialias: l < 3,
            modelLod: l < 4 ? 'high' : 'low',
            terrainDetail: l < 5 ? 'full' : 'light',          // light: exaggeration x0.7 and DEM maxzoom 9
            terrain: l < 6,
            models: l < 7,
        };
    }
    // The Auto controller. push(frameMs, nowMs) with every frame; level() is the current step.
    //   down: p95 of the last WINDOW_MS above DOWN_MS (30 ms) with at least MIN_FRAMES samples, no more often than every COOL_DOWN_MS;
    //   up:   p95 below UP_MS (18 ms) for UP_HOLD_MS (20 s) in a row, and never within HOLD_AFTER_DOWN_MS (30 s) of the last step down, then ONE step up;
    //   after a step up that is followed by a step down within 60 s the up step is penalised (the hold doubles, up to 4 min), so it never flaps.
    function controller(opts) {
        const o = Object.assign({windowMs: 3000, downMs: 30, upMs: 18, minFrames: 20, coolDownMs: 2500, upHoldMs: 20000, holdAfterDownMs: 30000, start: 0, max: MAX_LEVEL}, opts || {});
        let level = o.start, lastDown = -1e12, lastUp = -1e12, goodSince = null, penalty = 1;
        const win = [];   // {t, ms}
        function p95() {
            if (!win.length) return null;
            const s = win.map(f => f.ms).sort((a, b) => a - b);
            return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
        }
        return {
            push(ms, now) {
                win.push({t: now, ms});
                while (win.length && now - win[0].t > o.windowMs) win.shift();
                if (win.length < o.minFrames) return level;
                const q = p95();
                if (q > o.downMs) {
                    goodSince = null;
                    if (level < o.max && now - lastDown >= o.coolDownMs) {
                        if (now - lastUp < 60000 && lastUp > lastDown) penalty = Math.min(8, penalty * 2);
                        level++; lastDown = now; win.length = 0;       // a fresh window for the new level
                    }
                } else if (q < o.upMs) {
                    if (goodSince == null) goodSince = now;
                    if (level > 0 && now - goodSince >= o.upHoldMs * penalty && now - lastDown >= o.holdAfterDownMs * penalty) {
                        level--; lastUp = now; goodSince = null; win.length = 0;
                    }
                } else goodSince = null;
                return level;
            },
            level: () => level,
            force(l) { level = Math.max(0, Math.min(o.max, l | 0)); goodSince = null; win.length = 0; },
            p95,
            state: () => ({level, p95: p95(), penalty, samples: win.length}),
        };
    }
    return {MAX_LEVEL, NAMES, FIXED, MODES, isSoftware, modeFrom, pixelRatio, settings, controller};
})();
if (typeof module !== 'undefined') module.exports = QUALITY;
