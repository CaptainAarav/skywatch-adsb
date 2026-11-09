"use strict";
// Skywatch ADS-B: pure snap logic for the phone bottom sheet (unit tested in tools/test/sheet-snap.test.js).
// Heights are the visible height of the sheet in px (bigger = more open). Velocity is px per ms, positive = opening.
const SHEETSNAP = (function () {
    const COAST_MS = 180;                          // how far a flick carries the sheet before it settles
    // pick the snap point nearest to where the sheet would coast to
    function snap(height, velocity, points) {
        const pts = points.slice().sort((a, b) => a - b);
        const target = height + (velocity || 0) * COAST_MS;
        let best = pts[0];
        for (const p of pts) if (Math.abs(p - target) < Math.abs(best - target)) best = p;
        // a clear flick always moves at least one step in its direction
        if (Math.abs(velocity || 0) > 0.6) {
            const i = pts.indexOf(best), cur = nearestIndex(height, pts);
            if (velocity > 0 && i <= cur && cur < pts.length - 1) best = pts[cur + 1];
            if (velocity < 0 && i >= cur && cur > 0) best = pts[cur - 1];
        }
        return best;
    }
    function nearestIndex(h, pts) { let b = 0; for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i] - h) < Math.abs(pts[b] - h)) b = i; return b; }
    // resistance past the ends while dragging: 30% of the overshoot passes through, never more than 60 px
    function rubber(h, min, max) {
        if (h > max) return max + Math.min(60, (h - max) * 0.3);
        if (h < min) return min - Math.min(60, (min - h) * 0.3);
        return h;
    }
    // snap points for a viewport (peek grows by `extra` when a header is pinned in the peek)
    function points(viewportH, peek, safeTop) {
        const full = Math.round(viewportH - (safeTop || 0) - 12), half = Math.round(viewportH * 0.52);
        return [Math.min(peek, half - 40), Math.max(half, peek + 80), Math.max(full, half + 120)];
    }
    return {snap, rubber, points, nearestIndex};
})();
if (typeof module !== 'undefined') module.exports = SHEETSNAP;
