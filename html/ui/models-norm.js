"use strict";
// Skywatch ADS-B: normalise a real glTF aircraft model into the frame the 3D layer's instances use (pure maths, unit tested in tools/test/models-norm.test.js).
// Target frame (the same one the procedural archetypes are authored in): +Y nose, +X right wing, +Z up, origin at the BELLY centre (x and y centred, z = 0 at the
// lowest point), unit span along X, unit length along Y and Z (the layer scales X by the type's wingspan and Y and Z by its length).
// Per-vertex `part`: 0 body (tinted), 1 trim (glass, engines, gear: neutral grey), 2 tail fin (takes the optional airline tail tint).
const MODELNORM = (function () {
    const TRIM_RE = /glass|window|cockpit|canopy|windshield|engine|nacelle|turbine|fan|propeller|prop|rotor|wheel|tyre|tire|gear|landing/i;
    // forward axis of the SOURCE model as a unit vector in glTF space (+Y is up in glTF); '-z' is the common export, '+z' is the glTF spec's "front".
    const AXES = {'+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1]};
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    // prims: [{pos: Float32Array xyz (world space, glTF axes), nor: Float32Array xyz, material: string}]  (non-indexed triangles)
    // opts: {forward: '-z'|'+z'|'+x'|'-x'}
    function normalize(prims, opts) {
        opts = opts || {};
        const f = AXES[opts.forward || '-z'];
        if (!f) throw new Error('unknown forward axis ' + opts.forward);
        const up = [0, 1, 0], right = cross(f, up);
        let n = 0; for (const p of prims) n += p.pos.length / 3;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
        let o = 0;
        for (const p of prims) {
            const c = p.pos.length / 3, trim = TRIM_RE.test(p.material || '') ? 1 : 0;
            for (let i = 0; i < c; i++, o++) {
                const x = p.pos[i * 3], y = p.pos[i * 3 + 1], z = p.pos[i * 3 + 2], nx = p.nor[i * 3], ny = p.nor[i * 3 + 1], nz = p.nor[i * 3 + 2];
                pos[o * 3] = x * right[0] + y * right[1] + z * right[2]; pos[o * 3 + 1] = x * f[0] + y * f[1] + z * f[2]; pos[o * 3 + 2] = y;
                nor[o * 3] = nx * right[0] + ny * right[1] + nz * right[2]; nor[o * 3 + 1] = nx * f[0] + ny * f[1] + nz * f[2]; nor[o * 3 + 2] = ny;
                part[o] = trim;
            }
        }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
        const span = x1 - x0, length = y1 - y0, height = z1 - z0;
        if (!(span > 0 && length > 0)) throw new Error('model has no extent');
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        for (let i = 0; i < n; i++) { pos[i * 3] = (pos[i * 3] - cx) / span; pos[i * 3 + 1] = (pos[i * 3 + 1] - cy) / length; pos[i * 3 + 2] = (pos[i * 3 + 2] - z0) / length; }
        // normals under the non-uniform scale: n' = normalize(n / s)
        for (let i = 0; i < n; i++) {
            const a = nor[i * 3] / span, b = nor[i * 3 + 1] / length, c = nor[i * 3 + 2] / length, l = Math.hypot(a, b, c) || 1;
            nor[i * 3] = a / l; nor[i * 3 + 1] = b / l; nor[i * 3 + 2] = c / l;
        }
        // the tail fin: the rear fifth, in the top 40% of the model's height, near the centreline (not a wing, which is wide in X)
        const hz = height / length;
        for (let i = 0; i < n; i++) if (!part[i] && pos[i * 3 + 1] < -0.22 && pos[i * 3 + 2] > 0.6 * hz && Math.abs(pos[i * 3]) < 0.06) part[i] = 2;
        return {pos, nor, part, triangles: Math.floor(n / 3), span, length, height, ratio: span / length};
    }
    // does a model's proportions fit its archetype's table dimensions (a sanity check on the axis/scale, used by the optimise script and the loader)?
    function proportionsOk(span, length, tableSpan, tableLength, tol) {
        const a = span / length, b = tableSpan / tableLength, t = tol || 0.35;
        return Math.abs(a - b) / b <= t;
    }
    return {normalize, proportionsOk, TRIM_RE, AXES};
})();
if (typeof module !== 'undefined') module.exports = MODELNORM;
