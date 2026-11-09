// The ONE floating-control component: #controlStack (round glass buttons: north/compass, locate, follow, filters, layers, view mode, history, credits).
// Desktop lays it out as a vertical column at the top right; phones as the floating cluster above the open bottom surface (phone.css).
// The view-mode button shows the CURRENT mode on every screen; tap cycles, long-press / right-click lists the three.
// --bottom-inset is the ONE number the cluster (and the attribution card and filter popover) anchor to: the height of whichever bottom
// surface is open (sheet at its snap, replay panel, history bar). BOTTOMINSET.update() is the only writer.
const CONTROLS = (function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const MODES = {'2d': '2D', '3d': '3D', 'globe': 'Globe'};
    const NEXT = {'2d': 'view3d', '3d': 'viewGlobe', 'globe': 'view2d'};

    function mode() { return (typeof MLR != 'undefined' && MLR.viewMode) || '2d'; }
    function syncView() {
        const b = $('view_cycle'); if (!b) return;
        const m = mode(), l = MODES[m] || '2D';
        b.querySelector('.ctlViewLabel').textContent = l;
        b.setAttribute('aria-label', 'Map view: ' + l + '. Tap to change, press and hold for the list');
    }
    function syncFollow() {
        const b = $('follow_button'); if (!b) return;
        const open = document.body.classList.contains('infoOpen');
        b.hidden = !open;
        const on = typeof FollowSelected != 'undefined' && !!FollowSelected;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function surfaceTop() {
        let top = window.innerHeight;
        for (const id of ['phoneSheet', 'replayBar', 'historyBar']) {
            const e = $(id); if (!e) continue;
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = e.getBoundingClientRect();
            if (r.height > 0 && r.top < top) top = r.top;
        }
        return top;
    }
    const BOTTOMINSET = {
        last: -1,
        update() {
            const v = Math.max(0, Math.round(window.innerHeight - surfaceTop()));
            if (v !== this.last) { this.last = v; document.documentElement.style.setProperty('--bottom-inset', v + 'px'); }
            return v;
        },
    };
    // the replay button is ONE element: a text tab in the top view pill on desktop (where it always was), and on phones the same element sits in the
    // floating cluster (where the phone column had it). Same id, same handler; only its parent and its look (tab or round glass) follow the surface.
    function placeReplay() {
        const rp = $('RP'), stack = $('controlStack'), pill = $('viewPill');
        if (!rp || !stack || !pill) return;
        const phone = document.body.classList.contains('phone');
        const want = phone ? stack : pill;
        if (rp.parentNode !== want) { if (phone) stack.insertBefore(rp, $('follow_button') || stack.firstChild); else pill.appendChild(rp); }
        rp.classList.toggle('btn', phone); rp.classList.toggle('tb', !phone);
    }
    function init() {
        const cycle = $('view_cycle'), menu = $('viewMenu');
        if (cycle && menu) {
            let lp = null, long = false;
            const open = (on) => { menu.hidden = !on; cycle.setAttribute('aria-expanded', on ? 'true' : 'false'); };
            cycle.addEventListener('pointerdown', () => { long = false; lp = setTimeout(() => { long = true; open(true); }, 500); });
            const end = () => clearTimeout(lp);
            cycle.addEventListener('pointerup', end); cycle.addEventListener('pointerleave', end); cycle.addEventListener('pointercancel', end);
            cycle.addEventListener('click', () => {
                if (long) { long = false; return; }
                if (!menu.hidden) { open(false); return; }
                const b = $(NEXT[mode()] || 'view2d'); if (b) b.click();
            });
            cycle.addEventListener('contextmenu', (e) => { e.preventDefault(); open(true); });
            menu.addEventListener('click', (e) => { if (e.target.closest('button')) open(false); });
            document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('.ctlViewWrap')) open(false); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) open(false); });
        }
        const f = $('follow_button');
        if (f) f.addEventListener('click', () => { if (typeof toggleFollow == 'function') toggleFollow(); setTimeout(syncFollow, 30); });
        const a = $('attr_button');
        if (a) a.addEventListener('click', () => { const on = !document.body.classList.contains('attrOpen'); document.body.classList.toggle('attrOpen', on); a.setAttribute('aria-expanded', on ? 'true' : 'false'); });
        const upd = () => { placeReplay(); syncView(); syncFollow(); BOTTOMINSET.update(); };
        new MutationObserver(upd).observe(document.body, {attributes: true, attributeFilter: ['class']});
        window.addEventListener('tar:viewmode', syncView);
        window.addEventListener('resize', upd);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', upd);
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => BOTTOMINSET.update());
            for (const id of ['phoneSheet', 'replayBar', 'historyBar']) { const e = $(id); if (e) ro.observe(e); }
            // the sheet is built later on phones
            const t = setInterval(() => { const e = $('phoneSheet'); if (e) { ro.observe(e); clearInterval(t); } }, 300);
            setTimeout(() => clearInterval(t), 8000);
        }
        for (const id of ['replayBar', 'historyBar']) { const e = $(id); if (e) new MutationObserver(() => BOTTOMINSET.update()).observe(e, {attributes: true, attributeFilter: ['style', 'class', 'hidden']}); }
        setInterval(syncFollow, 1500);
        upd();
    }
    jQuery(init);
    return {syncView, syncFollow, placeReplay, BOTTOMINSET};
})();
