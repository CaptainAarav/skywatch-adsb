"use strict";
// Skywatch ADS-B: lightweight 2D radar used ONLY when the browser has no WebGL (the map cannot draw).
// A plain canvas: range rings, the receiver, and aircraft with labels, from the same plane data and the same altitude colours as the map.
// Redraws once a second and not at all while the page is hidden, so it is cheap on a software-rendered kiosk.
const RADAR2D = (function () {
    const NM = 1852, FONT = '12px Inter, system-ui, sans-serif';
    // pure helpers (unit tested in tools/test/radar2d.test.js)
    function project(site, pos, scale) {                  // metres east/north of the site -> canvas offsets (y down); equirectangular is exact enough at receiver range
        const lat0 = site[1] * Math.PI / 180, R = 6371008.8;
        const dx = (pos[0] - site[0]) * Math.PI / 180 * Math.cos(lat0) * R, dy = (pos[1] - site[1]) * Math.PI / 180 * R;
        return [dx * scale, -dy * scale, Math.hypot(dx, dy)];
    }
    function niceRange(maxMetres) {                        // smallest of 25/50/100/150/200/300/400/500 nm that holds everything with margin
        const steps = [25, 50, 100, 150, 200, 300, 400, 500, 800];
        const need = maxMetres / NM * 1.08;
        return (steps.find(s => s >= need) || steps[steps.length - 1]) * NM;
    }
    function ringStep(rangeM) { const nm = rangeM / NM; return (nm <= 50 ? 10 : nm <= 100 ? 25 : nm <= 200 ? 50 : 100) * NM; }
    function label(p) { return (p.flight || '').trim() || (p.registration || '') || (p.icao || '').toUpperCase(); }

    let cv = null, ctx = null, timer = null;
    function css(n, d) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } }
    function draw() {
        if (!cv || document.hidden) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const site = (typeof SitePosition != 'undefined' && SitePosition) || [CenterLon, CenterLat];
        const planes = (g.planesOrdered || []).filter(p => p.position);
        let far = 0;
        for (const p of planes) far = Math.max(far, project(site, p.position, 1)[2]);
        const range = niceRange(far || 25 * NM), cx = W / 2, cy = H / 2, scale = Math.min(W, H) * 0.46 / range;
        ctx.lineWidth = 1; ctx.font = FONT; ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.fillStyle = 'rgba(255,255,255,.55)';
        const step = ringStep(range);
        for (let r = step; r <= range + 1; r += step) {
            ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2); ctx.stroke();
            ctx.fillText(Math.round(r / NM) + ' nm', cx + 4, cy - r * scale + 8);
        }
        ctx.beginPath(); ctx.moveTo(cx - range * scale, cy); ctx.lineTo(cx + range * scale, cy); ctx.moveTo(cx, cy - range * scale); ctx.lineTo(cx, cy + range * scale); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
        for (const p of planes) {
            const q = project(site, p.position, scale), x = cx + q[0], y = cy + q[1];
            let col = '#8899cc';
            try { col = hslToRgb(altitudeColor(p.altitude)) || col; } catch (e) { /* keep default */ }
            ctx.fillStyle = col; ctx.strokeStyle = col;
            const hd = ((p.track != null ? p.track : p.true_heading) || 0) * Math.PI / 180;
            ctx.save(); ctx.translate(x, y); ctx.rotate(hd);
            ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
            ctx.fillStyle = '#fff'; ctx.fillText(label(p), x + 9, y);
        }
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.fillText(planes.length + ' aircraft · range ' + Math.round(range / NM) + ' nm · 2D radar (this screen has no WebGL)', 14, H - 14);
    }
    function start() {
        if (cv) return;
        const host = document.getElementById('map_canvas') || document.body;
        cv = document.createElement('canvas'); cv.id = 'radar2d'; cv.setAttribute('aria-label', '2D radar: aircraft around the receiver');
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:1;background:#000';
        host.appendChild(cv); ctx = cv.getContext('2d');
        const n = document.getElementById('webglNotice'); if (n) n.remove();
        try { if (typeof SKYUI != 'undefined') SKYUI.conn.setMap(false); } catch (e) { /* banner is optional */ }
        draw(); timer = setInterval(draw, 1000);
    }
    return {project, niceRange, ringStep, label, start, draw};
})();
if (typeof module !== 'undefined') module.exports = RADAR2D;
