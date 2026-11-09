"use strict";
// Skywatch ADS-B: watchlist alerts in the browser (Settings > Alerts). Rules live in this browser's localStorage only.
// Browser notifications work only while this page is open; the optional server-side sender (docs/ALERTS.md) covers the rest.
// All text is set with createElement/textContent.
const ALERTS = (function () {
    const KEY = 'skywatch_alerts', C = ALERTCALC;
    let cfg = {on: false, notify: false, sound: false, rules: [], snoozeUntil: 0};
    const state = {seen: {}, recent: [], off: true, snoozeUntil: 0};
    let timer = null;

    function load() {
        try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && typeof j === 'object') {
            cfg.on = !!j.on; cfg.notify = !!j.notify; cfg.sound = !!j.sound; cfg.snoozeUntil = +j.snoozeUntil || 0;
            cfg.rules = (Array.isArray(j.rules) ? j.rules : []).map(C.clean).filter(Boolean).slice(0, 50);
        } } catch (e) { /* storage unavailable: defaults */ }
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ } }
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    function beep() {
        try {
            const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain();
            o.type = 'sine'; o.frequency.value = 660; g.gain.value = 0.04; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.18);
            setTimeout(() => ac.close(), 400);
        } catch (e) { /* no audio */ }
    }
    function fire(ev) {
        const who = ev.flight || ev.hex.toUpperCase(), detail = [ev.reg, ev.type].filter(Boolean).join(' ');
        const msg = who + (detail ? ' (' + detail + ')' : '') + ': ' + ev.reason;
        const pick = () => { try { window.focus(); selectPlaneByHex(ev.hex, {follow: true}); } catch (e) { console.error(e); } };
        if (typeof SKYUI != 'undefined') SKYUI.toast(msg, {kind: ev.emergency ? 'error' : 'warn', ms: 15000, action: {label: 'Select', run: pick}});
        if (cfg.notify && 'Notification' in window && Notification.permission === 'granted') {
            try { const n = new Notification('Skywatch alert', {body: msg, tag: 'sw-' + ev.hex, silent: !cfg.sound}); n.onclick = () => { pick(); n.close(); }; } catch (e) { /* ignore */ }
        }
        if (cfg.sound) beep();
    }
    function snapshot() {
        const out = [];
        for (const p of (g.planesOrdered || [])) {
            if (!p || !p.icao || (p.seen != null && p.seen > 60)) continue;
            out.push({hex: p.icao, flight: p.flight, reg: p.registration, type: p.icaoType, squawk: p.squawk, military: p.military, interesting: p.interesting});
        }
        return out;
    }
    function tick() {
        state.off = !cfg.on; state.snoozeUntil = cfg.snoozeUntil;
        if (!cfg.on || !cfg.rules.length) return;
        for (const ev of C.evaluate(snapshot(), cfg.rules, state, Date.now())) fire(ev);
    }
    function sync() { clearInterval(timer); timer = cfg.on ? setInterval(tick, 3000) : null; }

    // ---- Settings > Alerts ----
    function switchRow(label, sub, checked, onChange) {
        const row = el('label', 'setRow'), txt = el('span', 'setRowText', label);
        if (sub) txt.appendChild(el('span', 'lbl setRowSub', sub));
        const cb = el('input', 'setSwitch'); cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.checked = checked;
        cb.addEventListener('change', () => onChange(cb.checked, cb));
        row.append(txt, cb, el('span', 'switch'));
        row.lastChild.setAttribute('aria-hidden', 'true');
        return row;
    }
    function render() {
        const host = document.getElementById('alertsBody');
        if (!host) return;
        host.replaceChildren();
        const sw = el('div', 'setList');
        sw.appendChild(switchRow('Alerts', 'Show a message when an aircraft matches a rule', cfg.on, (v) => { cfg.on = v; save(); sync(); render(); }));
        const supported = 'Notification' in window;
        sw.appendChild(switchRow('Browser notifications', supported ? 'Only while this page is open. Asks for permission when you turn it on.' : 'Not supported in this browser', cfg.notify && supported, (v, cb) => {
            if (!v) { cfg.notify = false; save(); return; }
            if (!supported) { cb.checked = false; return; }
            Notification.requestPermission().then((p) => {
                cfg.notify = p === 'granted'; cb.checked = cfg.notify; save();
                if (p !== 'granted' && typeof SKYUI != 'undefined') SKYUI.toast('Notifications are blocked for this site in the browser settings.', {kind: 'warn'});
            });
        }));
        sw.appendChild(switchRow('Soft sound', 'A short quiet tone with each alert', cfg.sound, (v) => { cfg.sound = v; save(); if (v) beep(); }));
        host.appendChild(sw);

        const snz = el('div', 'alSnooze'), left = cfg.snoozeUntil - Date.now();
        if (left > 0) {
            snz.appendChild(el('span', 'lbl', 'Snoozed until ' + new Date(cfg.snoozeUntil).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})));
            const b = el('button', 'formButton', 'Resume'); b.type = 'button'; b.addEventListener('click', () => { cfg.snoozeUntil = 0; save(); render(); }); snz.appendChild(b);
        } else {
            const b = el('button', 'formButton', 'Snooze for 1 hour'); b.type = 'button'; b.addEventListener('click', () => { cfg.snoozeUntil = Date.now() + C.SNOOZE_MS; save(); render(); }); snz.appendChild(b);
        }
        host.appendChild(snz);

        host.appendChild(el('div', 'lbl setLbl', 'Rules'));
        const list = el('ul', 'alRules');
        if (!cfg.rules.length) list.appendChild(el('li', 'setNote', 'No rules yet. Add one below.'));
        cfg.rules.forEach((r, i) => {
            const li = el('li', 'alRule'), t = el('span', 'alRuleText', C.label(r));
            const on = el('input'); on.type = 'checkbox'; on.checked = r.on; on.setAttribute('aria-label', 'Enable ' + C.label(r));
            on.addEventListener('change', () => { r.on = on.checked; save(); });
            const rm = el('button', 'formButton', 'Remove'); rm.type = 'button'; rm.setAttribute('aria-label', 'Remove ' + C.label(r));
            rm.addEventListener('click', () => { cfg.rules.splice(i, 1); save(); render(); });
            li.append(on, t, rm); list.appendChild(li);
        });
        host.appendChild(list);

        const form = el('form', 'alForm'), sel = el('select', 'searchInput'), val = el('input', 'searchInput'), add = el('button', 'formButton', 'Add');
        sel.setAttribute('aria-label', 'Rule type');
        for (const k in C.TYPES) { const o = el('option', null, C.TYPES[k]); o.value = k; sel.appendChild(o); }
        val.type = 'text'; val.maxLength = 12; val.setAttribute('aria-label', 'Rule value'); val.autocomplete = 'off'; val.spellcheck = false;
        add.type = 'submit';
        const syncVal = () => { const n = !!C.NEEDS_VALUE[sel.value]; val.hidden = !n; val.placeholder = sel.value === 'hex' ? '6 hex digits' : sel.value === 'type' ? 'e.g. A388' : sel.value === 'reg' ? 'e.g. G-ABCD' : 'e.g. RRR'; };
        sel.addEventListener('change', syncVal); syncVal();
        const err = el('div', 'setNote alErr'); err.setAttribute('role', 'alert');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const r = C.clean({type: sel.value, value: val.value});
            if (!r) { err.textContent = 'That value is not valid for this rule.'; val.focus(); return; }
            if (cfg.rules.some(x => C.sameRule(x, r))) { err.textContent = 'That rule is already in the list.'; return; }
            if (cfg.rules.length >= 50) { err.textContent = 'Fifty rules is the limit.'; return; }
            cfg.rules.push(r); save(); render();
        });
        form.append(sel, val, add);
        host.append(form, err);
        host.appendChild(el('p', 'setNote', 'Rules and settings are stored only in this browser. Alerts repeat for the same aircraft at most every 30 minutes, and no more than five appear per minute. To be told while the page is closed, use the optional server-side sender described in docs/ALERTS.md.'));
    }
    function init() { load(); sync(); render(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    return {tick, fire, render, config: () => cfg, snapshot};
})();
