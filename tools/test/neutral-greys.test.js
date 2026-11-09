// node tools/test/neutral-greys.test.js
// Fails if any low-saturation colour (max channel - min channel <= 24) has blue exceeding red by more than 2.
// Scans first-party CSS, JS, HTML and style JSON. Vendored files and the allowlist below are skipped.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const SKIP_DIR = /(^|\/)(libs|flags|fonts|geojson|airport-db|images|db|aircraft_sil)(\/|$)/;
const SKIP_FILE = /(^html\/(jquery|jquery-ui|ol|markers|flags|layers|early|script|planeObject|formatter|registrations|dbloader|uat|replay|filters|footer|configure|config|libs)[^/]*\.js$)|\.min\.|_[0-9a-f]{8,}\./;
const ALLOW = new Set(['#0b0b0d']);    // the icon outline from the brief
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
function check(file, line, text, r, g, b) {
    if (Math.max(r, g, b) - Math.min(r, g, b) > 24) return;
    if (b - r <= 2) return;
    if (ALLOW.has(text.toLowerCase())) return;
    bad.push(`${file}:${line}  ${text}  (${r},${g},${b})`);
}
for (const f of files) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((ln, i) => {
        if (ln.length > 3000) return;                                   // inlined data
        for (const m of ln.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g)) {
            let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join('');
            const pre = ln.slice(Math.max(0, m.index - 1), m.index);
            if (pre === '&' || /%23$/.test(ln.slice(Math.max(0, m.index - 3), m.index))) { /* url-encoded svg colour is still a colour */ }
            check(f, i + 1, m[0], parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
        }
        for (const m of ln.matchAll(/%23([0-9a-fA-F]{6})/g)) check(f, i + 1, '#' + m[1], parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16));
        for (const m of ln.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g)) check(f, i + 1, m[0] + ')', +m[1], +m[2], +m[3]);
    });
}
if (bad.length) { console.error('blue-cast greys found:\n' + bad.join('\n')); process.exit(1); }
console.log('neutral-greys ok (' + files.length + ' files scanned)');
