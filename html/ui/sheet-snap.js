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
    // peek height measured from content: the net handle height plus the heights of the blocks that stay visible at peek
    // (header, instrument summaries, action bar), clamped so the map always keeps at least 38% of the viewport
    function peekHeight(parts, viewportH) {
        const sum = (parts.blocks || []).reduce((a, b) => a + (isFinite(b) && b > 0 ? b : 0), 0);
        const total = Math.ceil((parts.handle || 0) + sum + (parts.pad || 0));
        return Math.max(parts.min || 96, Math.min(total, Math.floor(viewportH * 0.62)));
    }
    // 'peek' | 'half' | 'full' for a sheet height among the snap points
    function snapName(h, pts) { return ['peek', 'half', 'full'][nearestIndex(h, pts)] || 'peek'; }
    // swiping the sheet down from peek by more than `slop` px, or flicking down faster than 0.4 px/ms, dismisses the selection
    function shouldDismiss(startH, h, velocity, peek, slop) {
        if (Math.abs(startH - peek) > 2) return false;
        return h < peek - (slop == null ? 14 : slop) || (velocity || 0) < -0.4;
    }
    return {snap, rubber, points, nearestIndex, peekHeight, snapName, shouldDismiss};
})();
if (typeof module !== 'undefined') module.exports = SHEETSNAP;
