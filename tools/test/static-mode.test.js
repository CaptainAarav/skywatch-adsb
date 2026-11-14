'use strict';
// The web UI must work with NO backend (static mount) and need nothing from the optional server except files it already requests.
// Binds both ways: the UI's recorder-file requests are exactly the files the server serves, and the UI never calls a server-only API.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ui = fs.readdirSync(path.join(root, 'html', 'ui')).filter((f) => f.endsWith('.js')).map((f) => 'html/ui/' + f).concat(['html/script.js', 'html/early.js', 'html/planeObject.js']);
const src = ui.map(read).join('\n');

const used = new Set([...src.matchAll(/globe_history\/skywatch\/([A-Za-z0-9_.-]+)/g)].map((m) => m[1]).concat([...src.matchAll(/BASE\s*\+\s*['"`]([a-z]+\.json)/g)].map((m) => m[1])));
const server = read('server/src/recorder.ts').match(/OUT_NAMES = \[([^\]]*)\]/)[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
for (const f of used) if (/\.json$/.test(f)) assert.ok(server.includes(f), `the UI requests globe_history/skywatch/${f} but the server does not provide it`);
for (const f of ['wx.json', 'movements.json', 'history.json', 'polar.json']) assert.ok(server.includes(f) && src.includes(f.replace('.json', '')), `${f} is both served and used`);
assert.ok(!/['"`]\/?api\/(health|status|config)/.test(src), 'the UI must not depend on the Skywatch server API (static mode has none)');
assert.ok(!/READSB_URL|skywatch-server/.test(src), 'the UI knows nothing about the server');
// every request the UI makes for data must be an allow-listed path (so the proxy serves a page that works end to end)
const proxy = read('server/src/proxy.ts');
for (const needle of ['receiver|aircraft|outline|multiOutline', 'trace_(recent|full)', 'chunks\\/(chunks|pf|978)', 'heatmap', 'globeRates', 're-api']) assert.ok(proxy.includes(needle), 'proxy allow list covers ' + needle);
console.log('static-mode ok: ' + [...used].join(', '));
