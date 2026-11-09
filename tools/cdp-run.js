#!/usr/bin/env node
// Runs one in-page check snippet in headless Chromium over CDP and decides pass/fail. Used by tools/run-checks.sh (Node 22, global WebSocket).
// usage: node tools/cdp-run.js --cdp http://127.0.0.1:9222 --url http://127.0.0.1:8096/ --snippet tools/cdp-snippets/x.js
//        [--w 1440 --h 900] [--phone] [--prefix "window.X=1;"] [--timeout 300] [--boot 9] [--out result.json]
// The snippet is evaluated as one expression (awaited) and must return an object. PASS needs ALL of:
//   - `failures` is an empty array (every snippet reports its failed assertions there);
//   - no console error / uncaught exception / error-level log line in the page (WebGL/SwiftShader driver chatter is the only ignored text);
// Requests to api.planespotters.net are answered by the harness with an empty-photos 200 (that third party refuses automated/datacentre
// clients with a 403 that Chromium logs as a CORS error; the app's own handling of a failed lookup is covered by a dedicated check).
'use strict';
const fs = require('fs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const CDP = arg('cdp', 'http://127.0.0.1:9222'), URL_ = arg('url', 'http://127.0.0.1:8096/'), PHONE = !!arg('phone', false);
const W = +arg('w', PHONE ? 390 : 1440), H = +arg('h', PHONE ? 844 : 900), SNIP = arg('snippet'), PREFIX = (v => typeof v === 'string' ? v : '')(arg('prefix', '')), TMO = +arg('timeout', 300) * 1000, BOOT = +arg('boot', 9) * 1000, OUT = arg('out', '');
const NOISE = ['WebGL', 'swiftshader', 'GPU stall', 'GroupMarkerNotSet'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    let tab; for (let i = 0; i < 100 && !tab; i++) { try { tab = (await (await fetch(CDP + '/json')).json()).find(t => t.type === 'page'); } catch (e) { await sleep(200); } }
    if (!tab) { console.log('FAIL: no chromium page at ' + CDP); process.exit(2); }
    const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pend = new Map(), logs = [];
    const send = (method, params = {}) => new Promise(res => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({id: my, method, params})); });
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result || m.error); pend.delete(m.id); return; }
        if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error')) logs.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' '));
        else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; logs.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text) + ' @' + (d.url || '') + ':' + d.lineNumber); }
        else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('log.error: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
        else if (m.method === 'Fetch.requestPaused') {
            send('Fetch.fulfillRequest', {requestId: m.params.requestId, responseCode: 200, responseHeaders: [{name: 'Access-Control-Allow-Origin', value: '*'}, {name: 'Content-Type', value: 'application/json'}], body: Buffer.from('{"photos":[]}').toString('base64')});
        }
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Fetch.enable', {patterns: [{urlPattern: 'https://api.planespotters.net/*'}]});
    if (PHONE) {
        await send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: true});
        await send('Emulation.setUserAgentOverride', {userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'});
        await send('Emulation.setTouchEmulationEnabled', {enabled: true});
    } else await send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url: URL_});
    await sleep(BOOT);
    const src = PREFIX + fs.readFileSync(SNIP, 'utf8');
    let timer; const tmo = new Promise(r => { timer = setTimeout(() => r({timeout: true}), TMO); });
    const r = await Promise.race([send('Runtime.evaluate', {expression: src, awaitPromise: true, returnByValue: true}), tmo]); clearTimeout(timer);
    await sleep(500);
    const fails = [];
    let val = null;
    if (r.timeout) fails.push('snippet timed out after ' + TMO / 1000 + ' s');
    else if (r.exceptionDetails) fails.push('snippet exception: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300));
    else {
        val = r.result && r.result.value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch (e) { /* keep string */ } }
        if (!val || typeof val !== 'object') fails.push('snippet returned no object: ' + JSON.stringify(val));
        else if (!Array.isArray(val.failures)) fails.push('snippet result has no failures array');
        else for (const f of val.failures) fails.push('check failed: ' + (typeof f === 'string' ? f : JSON.stringify(f)).slice(0, 400));
    }
    const logs2 = logs.filter(l => !NOISE.some(n => l.includes(n)));
    for (const l of logs2) fails.push('console: ' + l.slice(0, 300));
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(val));
    console.log('RESULT ' + JSON.stringify(val).slice(0, 4000));
    console.log(fails.length ? 'FAIL (' + fails.length + ')' : 'PASS');
    for (const f of fails) console.log('  - ' + f);
    ws.close(); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('FAIL: runner error ' + e); process.exit(2); });
