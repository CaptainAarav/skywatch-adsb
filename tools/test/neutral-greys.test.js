// node tools/test/neutral-greys.test.js
// Fails on any low-saturation colour (effective max-min <= 24) whose channels differ by more than 2 (warm or cool).
// Parses hex, rgb()/rgba(), hsl()/hsla(), colour inside color-mix()/gradients, url-encoded SVG fills and MapLibre paint JSON.
// An rgba() is judged by its effective colour: alpha composited over the dark surface it normally sits on (BASES).
// Vendored files, status colours, flight categories and the altitude gradient are allowed (ALLOW_BASE).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const SKIP_DIR = /(^|\/)(libs|flags|fonts|geojson|airport-db|images|db|aircraft_sil|logo)(\/|$)/;
const SKIP_FILE = /(^html\/(jquery|jquery-ui|ol|markers|flags|layers|early|script|planeObject|formatter|registrations|dbloader|uat|replay|filters|footer|configure|config|libs)[^/]*\.js$)|\.min\.|_[0-9a-f]{8,}\./;
const ALLOW_HEX = new Set(['#0b0b0d']);                                  // icon outline from the brief
// status colours, flight categories, source colours: intentionally coloured, allowed at any alpha
const ALLOW_BASE = [[61,220,151],[245,185,74],[255,107,107],[95,182,217],[201,160,240],[255,0,0],[255,69,58],[255,59,48],[255,149,0],[255,204,0],[52,199,89],[10,132,255],[191,90,242],[255,45,85],[48,209,88],[100,210,255],[255,159,10],[255,214,10]];
const BASES = [0x0d, 0x1e];                                              // composite over panel and card grey
const exts = /\.(css|js|html|json)$/;
const files = [];
(function walk(d) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
        const rel = d + '/' + f, st = fs.statSync(path.join(ROOT, rel));
        if (st.isDirectory()) { if (!SKIP_DIR.test(rel)) walk(rel); }
        else if (exts.test(f) && !SKIP_FILE.test(rel)) files.push(rel);
    }
})('html');
const bad = [];
const near = (a, b) => Math.abs(a[0] - b[0]) <= 6 && Math.abs(a[1] - b[1]) <= 6 && Math.abs(a[2] - b[2]) <= 6;
function check(file, line, text, r, g, b, a) {
    if (a === 0) return;
    if (ALLOW_HEX.has(text.toLowerCase())) return;
    if (ALLOW_BASE.some(c => near(c, [r, g, b]))) return;
    for (const base of BASES) {
        const e = [r, g, b].map(v => v * a + base * (1 - a));
        if (Math.max(...e) - Math.min(...e) > 24) continue;              // clearly coloured, not a tinted neutral
        if (Math.max(Math.abs(e[0] - e[1]), Math.abs(e[1] - e[2]), Math.abs(e[0] - e[2])) > 2) { bad.push(`${file}:${line}  ${text}  (effective ${e.map(Math.round)} over #${base.toString(16)})`); return; }
    }
}
function hsl2rgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12, aa = s * Math.min(l, 1 - l);
    const f = n => l - aa * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const hex = h => h.length === 3 ? [...h].map(c => c + c).join('') : h;
for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((ln, i) => {
        if (ln.length > 3000) return;                                    // inlined data
        const L = i + 1;
        for (const m of ln.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g)) {
            const h = m[1].length === 8 ? m[1].slice(0, 6) : hex(m[1]), al = m[1].length === 8 ? parseInt(m[1].slice(6), 16) / 255 : 1;
            check(f, L, m[0], parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), al);
        }
        for (const m of ln.matchAll(/%23([0-9a-fA-F]{6})/g)) check(f, L, '#' + m[1], parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1);
        for (const m of ln.matchAll(/rgba?\(\s*(\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)\s*[, ]\s*(\d{1,3}(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+%?))?\s*\)/g)) {
            let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
            check(f, L, m[0], +m[1], +m[2], +m[3], a);
        }
        for (const m of ln.matchAll(/hsla?\(\s*(\d+(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d+(?:\.\d+)?)%\s*[, ]\s*(\d+(?:\.\d+)?)%\s*(?:[,/]\s*(\d*\.?\d+%?))?\s*\)/g)) {
            const [r, g, b] = hsl2rgb(+m[1], +m[2], +m[3]);
            let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
            check(f, L, m[0], r, g, b, a);
        }
    });
}
// MapLibre style: every colour in paint/layout is already matched by the scans above (they are strings in the JSON).
if (bad.length) { console.error('tinted greys found (' + bad.length + '):\n' + bad.join('\n')); process.exit(1); }
console.log('neutral-greys ok (' + files.length + ' files scanned)');
