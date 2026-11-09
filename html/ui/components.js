"use strict";
// Skywatch ADS-B: shared UI components (toast, banner, dialog, empty state, tooltip). DOM is built with createElement and
// textContent only, so no aircraft- or network-derived string is ever parsed as HTML.
const SKYUI = (function () {
    const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let host = null;
    function root() {
        if (host) return host;
        host = h('div', 'sk-host');
        const toasts = h('div', 'sk-toasts'); toasts.setAttribute('aria-live', 'polite'); toasts.setAttribute('role', 'status');
        const banners = h('div', 'sk-banners');
        host.append(banners, toasts); host._t = toasts; host._b = banners;
        document.body.appendChild(host);
        return host;
    }
    function button(label, kind, onClick) {
        const b = h('button', 'sk-btn' + (kind ? ' sk-' + kind : ''), label); b.type = 'button';
        if (onClick) b.addEventListener('click', onClick);
        return b;
    }

    // ---- Toast: kind info|success|warn|error, auto-dismiss, stackable (max 4), closable ----
    function toast(msg, o) {
        o = o || {};
        const kind = o.kind || 'info', r = root();
        const t = h('div', 'sk-toast sk-' + kind);
        t.appendChild(h('span', 'sk-dot'));
        t.appendChild(h('span', 'sk-msg', msg));
        if (o.action) t.appendChild(button(o.action.label, 'sec', () => { try { o.action.run(); } catch (e) { console.error(e); } close(); }));
        const x = h('button', 'sk-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Dismiss');
        t.appendChild(x);
        let timer = null;
        const close = () => { clearTimeout(timer); if (t.parentNode) t.remove(); };
        x.addEventListener('click', close);
        r._t.appendChild(t);
        while (r._t.children.length > 4) r._t.firstChild.remove();
        if (o.ms !== 0) timer = setTimeout(close, o.ms || (kind === 'error' ? 8000 : 4500));
        return {close};
    }

    // ---- Banner: a persistent glass bar; id keeps one banner per topic ----
    const banners = new Map();
    function banner(id, o) {
        const r = root();
        let b = banners.get(id);
        if (!o) { if (b) { b.el.remove(); banners.delete(id); } return null; }
        if (!b) {
            const el = h('div', 'sk-banner'); el.setAttribute('role', 'status');
            b = {el, msg: h('span', 'sk-msg'), sub: h('span', 'sk-sub'), act: null};
            const txt = h('div', 'sk-btxt'); txt.append(b.msg, b.sub);
            el.append(h('span', 'sk-dot'), txt);
            r._b.appendChild(el); banners.set(id, b);
        }
        b.el.className = 'sk-banner sk-' + (o.kind || 'warn');
        b.msg.textContent = o.title || '';
        b.sub.textContent = o.detail || '';
        b.sub.style.display = o.detail ? '' : 'none';
        if (b.act) { b.act.remove(); b.act = null; }
        if (o.action) { b.act = button(o.action.label, 'sec', o.action.run); b.el.appendChild(b.act); }
        return b;
    }

    // ---- Dialog: focus trap, Esc, backdrop; resolves a promise ----
    function dialog(o) {
        return new Promise((resolve) => {
            const prev = document.activeElement;
            const back = h('div', 'sk-backdrop'), box = h('div', 'sk-dialog');
            box.setAttribute('role', o.danger ? 'alertdialog' : 'dialog'); box.setAttribute('aria-modal', 'true');
            const tid = 'skd' + Math.random().toString(36).slice(2);
            box.setAttribute('aria-labelledby', tid);
            const title = h('h2', 'sk-dtitle', o.title || ''); title.id = tid;
            box.appendChild(title);
            const xb = h('button', 'sk-x', '\u00d7'); xb.type = 'button'; xb.setAttribute('aria-label', 'Close'); xb.addEventListener('click', () => done(input ? null : false)); box.appendChild(xb);
            if (o.body) box.appendChild(h('p', 'sk-dbody', o.body));
            let input = null;
            if (o.input) { input = h('input', 'sk-input'); input.type = 'text'; input.value = o.input.value || ''; if (o.input.placeholder) input.placeholder = o.input.placeholder; box.appendChild(input); }
            const row = h('div', 'sk-drow');
            const done = (v) => { document.removeEventListener('keydown', key, true); back.remove(); try { prev && prev.focus(); } catch (e) {} resolve(v); };
            const cancel = o.cancel === false ? null : button(o.cancel || 'Cancel', 'sec', () => done(input ? null : false));
            const ok = button(o.ok || 'OK', o.danger ? 'danger' : 'pri', () => done(input ? input.value : true));
            if (cancel) row.appendChild(cancel);
            row.appendChild(ok); box.appendChild(row); back.appendChild(box);
            const key = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(input ? null : false); }
                else if (e.key === 'Enter' && input && document.activeElement === input) { e.preventDefault(); done(input.value); }
                else if (e.key === 'Tab') {
                    const f = [...box.querySelectorAll('button,input')].filter(x => !x.disabled);
                    if (!f.length) return;
                    const i = f.indexOf(document.activeElement);
                    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
                    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
                }
            };
            document.addEventListener('keydown', key, true);
            back.addEventListener('mousedown', (e) => { if (e.target === back) done(input ? null : false); });
            document.body.appendChild(back);
            (input || ok).focus();
        });
    }
    const confirmDialog = (title, body, o) => dialog(Object.assign({title, body}, o));

    // ---- Empty state ----
    function empty(o) {
        const e = h('div', 'sk-empty');
        if (o.icon) e.appendChild(h('div', 'sk-eicon', o.icon));
        e.appendChild(h('div', 'sk-etitle', o.title || ''));
        if (o.help) e.appendChild(h('div', 'sk-ehelp', o.help));
        if (o.action) e.appendChild(button(o.action.label, 'sec', o.action.run));
        return e;
    }

    // ---- Small ring loader ----
    const ring = () => { const e = h('span', 'sk-ring'); e.setAttribute('role', 'progressbar'); e.setAttribute('aria-label', 'Loading'); return e; };

    // ---- Tooltip: replaces native title on our controls (glass, 150 ms delay, focus-aware) ----
    let tip = null, tipT = null;
    function showTip(el) {
        if (window.matchMedia('(hover: none)').matches) return;      // no tooltips on touch
        const txt = el.getAttribute('data-tip'); if (!txt) return;
        hideTip();
        tip = h('div', 'sk-tip', txt); tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
        const r = el.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
        let x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8), y = r.top - hh - 8;
        if (y < 8) y = r.bottom + 8;
        tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }
    function hideTip() { clearTimeout(tipT); if (tip) { tip.remove(); tip = null; } }
    function initTooltips() {
        // move title -> data-tip on our controls once, so the browser's native tooltip never shows
        const conv = (el) => { const t = el.getAttribute && el.getAttribute('title'); if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t); } };
        document.querySelectorAll('[title]').forEach(conv);
        new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') conv(m.target); else m.addedNodes.forEach(n => { if (n.nodeType === 1) { conv(n); n.querySelectorAll && n.querySelectorAll('[title]').forEach(conv); } }); } })
            .observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['title']});
        const over = (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (!el) return; clearTimeout(tipT); tipT = setTimeout(() => showTip(el), 150); };
        document.addEventListener('mouseover', over); document.addEventListener('focusin', over);
        document.addEventListener('mouseout', hideTip); document.addEventListener('focusout', hideTip); document.addEventListener('scroll', hideTip, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
    }

    // ---- Connection banner driven by the pure state machine ----
    const conn = {m: null, timer: null, retryNow: null,
        init() {
            if (this.m || typeof BANNERSTATE == 'undefined') return;
            this.m = BANNERSTATE.create();
            this.timer = setInterval(() => this.render(this.m.tick(Date.now())), 1000);
        },
        ok(advanced) { this.init(); if (this.m) this.render(this.m.ok(Date.now(), advanced)); },
        fail(detail) { this.init(); if (this.m) this.render(this.m.fail(Date.now(), detail)); },
        render(v) {
            if (!v.visible) { banner('conn'); return; }
            const clock = (ms) => ms ? new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'}) : '';
            if (v.state === 'retrying')
                banner('conn', {kind: 'error', title: "Can't reach the receiver. Retrying in " + v.retryIn + ' s', detail: v.lastGood ? 'Last update ' + clock(v.lastGood) : '',
                    action: {label: 'Retry now', run: () => { try { if (typeof fetchData == 'function') fetchData({force: true}); } catch (e) {} }}});
            else if (v.state === 'stale') {
                const a = v.ageSec, age = a >= 120 ? Math.floor(a / 60) + ' min' : a + ' s';
                banner('conn', {kind: 'warn', title: 'Data is ' + age + ' old', detail: 'The receiver is answering but nothing new is arriving. Last update ' + clock(v.lastGood)});
            } else banner('conn', {kind: 'success', title: 'Back online'});
        }};

    function init() { root(); initTooltips(); conn.init(); }
    return {toast, banner, dialog, confirm: confirmDialog, empty, ring, conn, init, button};
})();
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SKYUI.init()); else SKYUI.init();
}
