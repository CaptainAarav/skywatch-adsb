#!/usr/bin/env node
// Runtime colour audit (no screenshots). Drives headless Chromium over CDP, walks every visible element in a set of UI
// states, resolves text colour and the alpha-composited background, and fails on:
//   - a tinted neutral (low saturation but channels differing by more than 2),
//   - meaningful text darker than --text-3 (#7a7a7a),
//   - a rounded filled surface whose effective colour equals its parent surface (no elevation).
// usage: node tools/audit-colours.js --cdp http://127.0.0.1:9222 --url http://127.0.0.1:8096/ [--phone] [--out .private/colour-audit.md]
// Chromium must already be running with --remote-debugging-port (see docs/DEVELOPMENT.md). Needs Node 22 (global WebSocket).
'use strict';
const fs = require('fs');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const CDP = arg('cdp', 'http://127.0.0.1:9222'), URL_ = arg('url', 'http://127.0.0.1:8096/'), PHONE = !!arg('phone', false), OUT = arg('out', '.private/colour-audit.md');
const W = PHONE ? 390 : 1440, H = PHONE ? 844 : 900;

// ---- in-page audit (stringified and evaluated in the page) ----
function pageAudit(stateName) {
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map(i => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat(a); };
    const BASE = [24, 24, 24, 1];                                   // land colour: what a glass surface sits on at worst
    const bgCache = new Map();
    const effBg = (el) => {
        if (!el || el === document.documentElement) return [0, 0, 0, 1];
        if (bgCache.has(el)) return bgCache.get(el);
        const cs = getComputedStyle(el), own = parse(cs.backgroundColor);
        const par = el.parentElement ? effBg(el.parentElement) : BASE;
        const r = over(own, par); bgCache.set(el, r); return r;
    };
    const visible = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0 || n.hidden) return false;
        }
        const b = el.getBoundingClientRect(); return b.width > 1 && b.height > 1 && b.bottom > 0 && b.right > 0 && b.left < innerWidth && b.top < innerHeight;
    };
    const opac = (el) => { let o = 1; for (let n = el; n && n !== document.documentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; };
    const hex = (c) => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const spread = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
    const diff3 = (c) => Math.max(Math.abs(c[0] - c[1]), Math.abs(c[1] - c[2]), Math.abs(c[0] - c[2]));
    const lum = (c) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
    const LUM_T3 = lum([0x7a, 0x7a, 0x7a]);
    const STATUS = [[61,220,151],[245,185,74],[255,107,107],[95,182,217],[201,160,240],[255,69,58],[255,59,48],[255,149,0],[255,204,0],[52,199,89],[10,132,255],[191,90,242],[255,45,85]];
    const isStatus = (c) => STATUS.some(s => Math.abs(s[0] - c[0]) < 40 && Math.abs(s[1] - c[1]) < 40 && Math.abs(s[2] - c[2]) < 40);
    const label = (el) => (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') || el.tagName.toLowerCase();
    const rows = [], seen = new Set();
    for (const el of document.body.querySelectorAll('*')) {
        if (/^(SCRIPT|STYLE|CANVAS|SVG|PATH|G|CIRCLE|LINE|RECT|POLYGON|IMG|IFRAME|OPTION)$/i.test(el.tagName) || el.closest('svg')) continue;
        if (el.closest('.maplibregl-canvas-container, .airlineLogo, #selected_photo, .ibPhoto, .ibPhotoSlot')) continue;
        if (!visible(el)) continue;
        const cs = getComputedStyle(el), bg = effBg(el), parentBg = el.parentElement ? effBg(el.parentElement) : [0, 0, 0, 1];
        const own = parse(cs.backgroundColor);
        // text
        let hasText = false;
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
        if (hasText) {
            const tc = parse(cs.color), o = opac(el), eff = over([tc[0], tc[1], tc[2], tc[3] * o], bg);
            const decor = el.closest('[aria-hidden="true"], [disabled], .visuallyHidden') || el.matches('kbd');
            const k = 't|' + hex(eff) + '|' + hex(bg) + '|' + label(el);
            if (!seen.has(k)) {
                seen.add(k);
                const r = {state: stateName, kind: 'text', el: label(el), txt: el.textContent.trim().slice(0, 24), fg: hex(eff), bg: hex(bg), fail: []};
                if (!isStatus(eff) && spread(eff) <= 24 && diff3(eff) > 2) r.fail.push('tinted text');
                if (!decor && !isStatus(eff) && lum(eff) < LUM_T3 - 0.001 && lum(bg) < LUM_T3 && spread(eff) <= 24) r.fail.push('text darker than --text-3');
                rows.push(r);
            }
        }
        // surface
        if (own[3] > 0.02) {
            const k = 's|' + hex(bg) + '|' + hex(parentBg) + '|' + label(el);
            if (!seen.has(k)) {
                seen.add(k);
                const r = {state: stateName, kind: 'surface', el: label(el), txt: '', fg: '', bg: hex(bg), parent: hex(parentBg), fail: []};
                if (!isStatus(bg) && spread(bg) <= 24 && diff3(bg) > 2) r.fail.push('tinted surface');
                const rad = parseFloat(cs.borderTopLeftRadius) || 0, b = el.getBoundingClientRect();
                const pb = el.parentElement.getBoundingClientRect();
                const eq = Math.max(Math.abs(bg[0] - parentBg[0]), Math.abs(bg[1] - parentBg[1]), Math.abs(bg[2] - parentBg[2])) <= 2;
                if (eq && rad >= 12 && b.width < pb.width + 1 && b.width > 24 && !el.matches('input, select, textarea') && cs.borderTopWidth === '0px') r.fail.push('flat: equals parent surface');
                rows.push(r);
            }
        }
    }
    // intended elevation: these must differ from the surface they sit on (map = land colour)
    const ELEV = [['#selected_infoblock .ibCard', '#selected_infoblock'], ['#selected_infoblock #ib_route', '#selected_infoblock'], ['.apCard', '#airport_panel'], ['#search_form', 'map'], ['#controlStack', 'map'],
        ['#settingsCog', 'map'], ['.ol-zoom', 'map'], ['#sidebar_container', 'map'], ['#selected_infoblock', 'map'], ['#airport_panel', 'map'], ['#dimSwitch', 'map'], ['#toolbar', 'map']];
    for (const [sel, par] of ELEV) {
        const el = document.querySelector(sel); if (!el || !visible(el)) continue;
        const pb = par === 'map' ? BASE : effBg(document.querySelector(par)), b = effBg(el);
        const eq = Math.max(Math.abs(b[0] - pb[0]), Math.abs(b[1] - pb[1]), Math.abs(b[2] - pb[2])) <= 2;
        rows.push({state: stateName, kind: 'elevation', el: sel, txt: 'on ' + par, fg: '', bg: hex(b), parent: hex(pb), fail: eq ? ['flat: equals ' + par] : []});
    }
    return rows;
}

async function main() {
    const tabs = await (await fetch(CDP + '/json')).json();
    const tab = tabs.find(t => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pend = new Map(), errors = [];
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
        else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    });
    const send = (method, params) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({id: i, method, params: params || {}})); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: W, height: H, deviceScaleFactor: 1, mobile: PHONE});
    if (PHONE) await send('Emulation.setTouchEmulationEnabled', {enabled: true});
    await send('Page.navigate', {url: URL_});
    const sl = (ms) => new Promise(r => setTimeout(r, ms));
    await sl(9000);
    const first = () => `(()=>{const h=g.planesOrdered.find(p=>p.position&&p.altitude!=null);return h?h.icao:null})()`;
    const states = [['map', '1'],
        ['selected aircraft', `(async()=>{const i=${first()};if(i)selectPlaneByHex(i,{});await new Promise(r=>setTimeout(r,1500))})()`],
        ['selected, full', `(async()=>{if(window.PHONE&&PHONE.goto)PHONE.goto(2);document.body.classList.add('sheetFull');await new Promise(r=>setTimeout(r,600))})()`],
        ['deselected', `(async()=>{deselectAllPlanes();document.body.classList.remove('sheetFull');await new Promise(r=>setTimeout(r,600))})()`],
        ['aircraft list', `(async()=>{const b=document.getElementById('view_list');if(b)b.click();else{const t=document.querySelector('.psTab:nth-child(2)');t&&t.click()}await new Promise(r=>setTimeout(r,900))})()`],
        ['list back to map', `(async()=>{const b=document.getElementById('view_map');if(b)b.click();else{const t=document.querySelector('.psTab:nth-child(1)');t&&t.click()}await new Promise(r=>setTimeout(r,700))})()`],
        ['airport', `(async()=>{await AIRPT.searchAndOpen('EGLL');await new Promise(r=>setTimeout(r,2500))})()`],
        ['airport closed', `(async()=>{if(window.AIRPT&&AIRPT.close)AIRPT.close();await new Promise(r=>setTimeout(r,500))})()`],
        ['command palette', `(async()=>{PALETTE.show();await new Promise(r=>setTimeout(r,600))})()`],
        ['palette closed', `(async()=>{PALETTE.close();await new Promise(r=>setTimeout(r,300))})()`],
        ['layers', `(async()=>{const b=document.getElementById('layers_button');b&&b.click();await new Promise(r=>setTimeout(r,600))})()`],
        ['toast + banner + dialog', `(async()=>{SKYUI.toast('Audit toast',{kind:'warn'});SKYUI.banner&&SKYUI.banner('Audit banner',{});await new Promise(r=>setTimeout(r,500))})()`],
    ];
    const secs = ['map', 'aircraft', 'table', 'units', 'photos', 'alerts', 'advanced', 'about'];
    for (const s of secs) states.push(['settings: ' + s, `(async()=>{openSettings(${JSON.stringify(s)});await new Promise(r=>setTimeout(r,700))})()`]);
    states.push(['settings closed', `(async()=>{closeSettings();await new Promise(r=>setTimeout(r,400))})()`]);
    const all = [];
    for (const [name, js] of states) {
        try { await ev(js); } catch (e) { all.push({state: name, kind: 'driver', el: '(state not reachable)', txt: String(e.message).slice(0, 80), fail: []}); continue; }
        const rows = await ev('(' + pageAudit.toString() + ')(' + JSON.stringify(name) + ')');
        all.push(...rows);
    }
    const fails = all.filter(r => r.fail && r.fail.length);
    const lines = ['# Colour audit', '', `${PHONE ? 'phone 390x844' : 'desktop 1440x900'}, ${new Date().toISOString()}`, '',
        `rows: ${all.length}, failures: ${fails.length}`, '', '| state | kind | element | text | fg | bg | parent | result |', '|---|---|---|---|---|---|---|---|'];
    for (const r of all) lines.push(`| ${r.state} | ${r.kind} | ${String(r.el).replace(/\|/g, '/')} | ${String(r.txt || '').replace(/\|/g, '/')} | ${r.fg || ''} | ${r.bg || ''} | ${r.parent || ''} | ${(r.fail || []).join('; ') || 'ok'} |`);
    try { fs.mkdirSync(require('path').dirname(OUT), {recursive: true}); fs.writeFileSync(OUT.replace(/(\.md)?$/, PHONE ? '-phone.md' : '.md'), lines.join('\n') + '\n'); } catch (e) { console.error('report not written: ' + e.message); }
    const byKind = {}; for (const r of fails) for (const f of r.fail) byKind[f] = (byKind[f] || 0) + 1;
    console.log(`colour audit ${PHONE ? 'phone' : 'desktop'}: ${all.length} rows, ${fails.length} failing; ` + JSON.stringify(byKind) + (errors.length ? '; page exceptions: ' + errors.length : ''));
    const uniq = new Map(); for (const r of fails) { const k = r.fail.join(',') + ' ' + r.el + ' ' + r.fg + ' ' + r.bg; if (!uniq.has(k)) uniq.set(k, r); }
    let n = 0; for (const [k, r] of uniq) { if (n++ >= (arg('show', 60))) break; console.log(`  [${r.state}] ${r.fail.join(', ')}: ${r.el} "${r.txt}" fg=${r.fg} bg=${r.bg} parent=${r.parent || ''}`); }
    ws.close(); process.exit(fails.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
