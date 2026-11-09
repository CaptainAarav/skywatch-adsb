"use strict";
// Skywatch ADS-B: ONE aircraft label pill for the map, track labels and 3D. The pill is a canvas-drawn sprite (text, optional airline
// chip and rounded fill baked into one image) that MapLibre places as a plain icon. Drawing it ourselves gives exact padding and a
// text box that is centred to the pixel, which glyph-based labels with icon-text-fit could not (see docs/DEVELOPMENT.md, "Label pills").
// The pure parts (text builder, metrics, offset, sort key) are unit tested in tools/test/label-sprite.test.js; the canvas part is
// asserted on its real ImageData by tools/cdp-snippets/label-sprite.js.
const LABELS = (function () {
    const MAX_CHARS = 12;
    const STYLE = {
        fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, fontPx: 13,
        padX: 6, padY: 4, optical: 0.5, radius: 9, lineH: 16, chip: 16, chipGap: 6, offsetGap: 6,
        fill: '#111111', fillAlpha: 0.92, border: 'rgba(255,255,255,0.10)', text: '#ffffff', text2: '#939393',
        selFill: '#ffffff', selText: '#000000', selText2: '#4d4d4d', dimAlpha: 0.6,
    };

    // ---- text ----
    const tidy = (s) => String(s == null ? '' : s).replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
    function ellipsize(text, max) {
        const t = tidy(text), m = max || MAX_CHARS;
        return t.length > m ? t.slice(0, m - 1) + '…' : t;
    }
    // callsign, else registration, else the hex id: a label is never empty for an aircraft we can see
    function callsign(o) {
        const f = tidy(o.flight);
        if (f) return f;
        const r = tidy(o.registration);
        if (r) return r;
        return tidy(o.hex).toUpperCase();
    }
    // second line: route (when known), then altitude and speed, each only when the receiver has it
    function detail(o) {
        const parts = [];
        const route = tidy(o.route); if (route) parts.push(route);
        const alt = tidy(o.alt); if (alt && alt !== '?') parts.push(alt);
        const spd = tidy(o.speed); if (spd && spd !== '?') parts.push(spd);
        return parts.join(' · ');
    }
    // {lines, logo}: one line unless a real second line has content
    function build(o) {
        const lines = [ellipsize(callsign(o))];
        if (o.extended || o.selected) { const d = detail(o); if (d) lines.push(d); }
        return {lines, logo: !!o.logo, selected: !!o.selected};
    }
    // legacy multi-line text (ATC / wind / track-point labels): split on newlines, drop blanks, never a trailing empty line
    function fromText(str, opts) {
        const lines = String(str == null ? '' : str).split('\n').map(tidy).filter(Boolean);
        if (opts && opts.ellipsizeFirst && lines.length) lines[0] = ellipsize(lines[0]);
        return {lines, logo: !!(opts && opts.logo), selected: !!(opts && opts.selected)};
    }

    // ---- metrics (CSS px) ----
    // widths: measured text width of each line; returns the pill box and where the text starts
    function metrics(widths, hasLogo, st) {
        st = st || STYLE;
        const n = Math.max(1, widths.length), textW = Math.max.apply(null, widths.concat([0]));
        const lead = hasLogo ? st.chip + st.chipGap : 0;
        return {w: Math.ceil((st.padX * 2 + lead + textW) * 2) / 2, h: st.padY * 2 + n * st.lineH, textX: st.padX + lead, lead, lines: n};
    }
    // pill centre sits to the RIGHT of the icon: 6 px gap + half the rendered icon width (shape width x icon-size at the zoom, selected scale included)
    function pillOffset(shapeW, iconScale, zoomFactor, gap) {
        const half = 0.5 * shapeW * iconScale * zoomFactor;
        return [Math.round((half + (gap == null ? STYLE.offsetGap : gap)) * 100) / 100, 0];
    }
    // MapLibre sorts ascending: pinned (selected / followed / hovered) first, then lowest altitude, then closest to the screen centre
    function sortKey(o) {
        if (o.pinned) return -1;
        const alt = typeof o.altFt === 'number' && isFinite(o.altFt) ? Math.max(0, Math.min(89000, o.altFt + 2000)) : 90000;
        const d = typeof o.distPx === 'number' && isFinite(o.distPx) ? Math.min(999, Math.round(o.distPx)) : 999;
        return Math.round(alt) * 1000 + d;
    }
    // small stable id for a sprite
    function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
    function spriteId(spec, dpr) {
        return 'lbl-' + hash([spec.lines.join('\u0001'), spec.logoKey || '', spec.selected ? 's' : '', spec.fontPx || STYLE.fontPx, dpr].join('|'));
    }

    // ---- canvas (browser only) ----
    // spec: {lines, selected, fontPx, logo: ImageData|null, logoDpr, mono: 'BAW'|null}. Returns {image: ImageData, w, h, dpr, ink} (w, h in CSS px).
    function render(spec, dpr) {
        const st = STYLE, fp = spec.fontPx || st.fontPx, k = fp / st.fontPx;
        const sc = dpr || 2, lineH = Math.round(st.lineH * k);
        const font = st.fontWeight + ' ' + fp + 'px ' + st.fontFamily;
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = font;
        // ink extents, not advance widths: the box hugs the glyphs, so left and right padding are equal whatever the first and last letters are
        const ink = spec.lines.map(l => { const t = probe.measureText(l); return {l: -(t.actualBoundingBoxLeft || 0), r: t.actualBoundingBoxRight || t.width}; });
        const inkL = Math.min.apply(null, ink.map(i => i.l)), inkR = Math.max.apply(null, ink.map(i => i.r));
        const mt = metrics([Math.max(0, inkR - inkL)], !!(spec.logo || spec.mono), Object.assign({}, st, {chip: Math.round(st.chip * k), lineH, padX: st.padX, padY: st.padY}));
        mt.lines = spec.lines.length; mt.h = st.padY * 2 + spec.lines.length * lineH;
        const c = document.createElement('canvas');
        c.width = Math.ceil(mt.w * sc); c.height = Math.ceil(mt.h * sc);
        const x = c.getContext('2d');
        x.scale(sc, sc);
        // fill and border: the border is drawn inside the box so it is never clipped
        x.beginPath();
        if (x.roundRect) x.roundRect(0.5, 0.5, mt.w - 1, mt.h - 1, st.radius); else x.rect(0.5, 0.5, mt.w - 1, mt.h - 1);
        x.globalAlpha = spec.selected ? 1 : st.fillAlpha; x.fillStyle = spec.selected ? st.selFill : st.fill; x.fill();
        x.globalAlpha = 1;
        if (!spec.selected) { x.lineWidth = 1; x.strokeStyle = st.border; x.stroke(); }
        // text: baseline placed so the cap-height box is centred in its line (callsigns are capitals and digits)
        x.font = font; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
        const capH = probe.measureText('H').actualBoundingBoxAscent || fp * 0.73;
        spec.lines.forEach((line, i) => {
            x.fillStyle = i === 0 ? (spec.color || (spec.selected ? st.selText : st.text)) : (spec.selected ? st.selText2 : st.text2);
            const base = st.padY + i * lineH + (lineH - capH) / 2 + capH + st.optical;      // cap-height box centred in the line, half pixels allowed (2x sprite)
            x.fillText(line, mt.textX - inkL, base);
        });
        // airline chip, vertically centred on the first line
        const chip = Math.round(st.chip * k);
        if (spec.logo || spec.mono) {
            const cy = st.padY + (lineH - chip) / 2, cx = st.padX;
            x.save();
            x.beginPath(); if (x.roundRect) x.roundRect(cx, cy, chip, chip, chip * 0.24); else x.rect(cx, cy, chip, chip); x.clip();
            if (spec.logo) {
                const t = document.createElement('canvas'); t.width = spec.logo.width; t.height = spec.logo.height; t.getContext('2d').putImageData(spec.logo, 0, 0);
                x.drawImage(t, cx, cy, chip, chip);
            } else {
                x.fillStyle = '#2e2e2e'; x.fillRect(cx, cy, chip, chip);
                x.fillStyle = '#d7d7d7'; x.font = '600 ' + Math.round(chip * 0.4) + 'px ' + st.fontFamily; x.textAlign = 'center'; x.textBaseline = 'middle';
                x.fillText(String(spec.mono).slice(0, 3), cx + chip / 2, cy + chip / 2 + chip * 0.03, chip * 0.9);
            }
            x.restore();
        }
        return {image: x.getImageData(0, 0, c.width, c.height), w: mt.w, h: mt.h, dpr: sc, metrics: mt};
    }
    const api = {STYLE, MAX_CHARS, tidy, ellipsize, callsign, detail, build, fromText, metrics, pillOffset, sortKey, hash, spriteId, render};
    return api;
})();
if (typeof module !== 'undefined') module.exports = LABELS;
