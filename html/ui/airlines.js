"use strict";
// Skywatch ADS-B: airline logos.
//
// tar1090 only knows the ICAO airline prefix of a callsign (BAW for BAW123). The prefix is mapped to an
// IATA code with ui/airline-codes.js (Wikidata, CC0), and the logo is loaded by IATA code from a keyless
// public host (airlineLogoUrl in defaults.js; pics.avs.io by default). The logos belong to their owners
// and loading them shares the visitor's IP address with that host, so there is a setting to turn them off.
//
// - Only callsigns that look like airline flights (3 letters, then a digit) get a logo; registrations
//   such as G-OSNA do not.
// - No logo files are stored in the repository: one request per airline per session, results are cached.
// - Always a fallback: a neutral circle with the 3-letter airline code, never a broken image.

const AIRLOGO = {
    cache: new Map(),     // icao -> {state: 'loading' | 'ok' | 'none', url, bitmap}
    placeholder: null,    // promise: byte size of the provider's "unknown airline" image
    mapImages: new Map(), // icao -> ImageData for map labels
};

function airlineLogosOn() {
    if (typeof airlineLogos == 'undefined' || !airlineLogos || !airlineLogoUrl) return false;
    if (airlineLogoUrl.includes('{key}') && !airlineLogoKey) return false;   // needs a key that isn't set: fall back
    return true;
}

// {icao, iata} for an airline flight, otherwise null
function airlineFlight(p) {
    if (!p || !p.flight) return null;
    const cs = p.flight.trim().toUpperCase();
    const m = /^([A-Z]{3})\d[A-Z0-9]{0,3}$/.exec(cs);
    if (!m) return null;
    let icao = m[1];
    // the route API knows the airline code of the flight
    const r = (typeof useRouteAPI != 'undefined' && useRouteAPI && g.route_cache) ? g.route_cache[normalized_callsign(p.name)] : null;
    if (r && typeof r.airline_code == 'string' && /^[A-Za-z]{3}$/.test(r.airline_code)) icao = r.airline_code.toUpperCase();
    // airlines without a logo at the provider get the monogram and no request (list probed by scripts/gen-airline-codes.py)
    const hasLogo = typeof AIRLINE_HAS_LOGO == 'undefined' || AIRLINE_HAS_LOGO.has(icao);
    return {icao, iata: (hasLogo && typeof AIRLINE_IATA != 'undefined' && AIRLINE_IATA[icao]) || null};
}

function airlineLogoUrlFor(iata, size) {
    return airlineLogoUrl.replace(/\{size\}/g, size).replace('{iata}', encodeURIComponent(iata)).replace('{key}', encodeURIComponent(airlineLogoKey || ''));
}

// byte size of the provider's image for an unknown airline ('XX'), so it can be shown as a monogram instead
AIRLOGO.getPlaceholder = function () {
    if (!this.placeholder) {
        this.placeholder = fetch(airlineLogoUrlFor('XX', 128), {credentials: 'omit', referrerPolicy: 'no-referrer'})
            .then(r => r.ok ? r.blob() : null).then(b => b ? b.size : -1).catch(() => -1);
    }
    return this.placeholder;
};

// Airlines the provider has no logo for are remembered for 3 days, so each is requested once at most
// (the browser logs a failed request in its console, which can't be suppressed).
const AIRLOGO_NONE_MS = 3 * 24 * 3600 * 1000;
AIRLOGO.noneRead = function () {
    try { return JSON.parse(localStorage.getItem('airlogoNone') || '{}'); } catch (e) { return {}; }
};
AIRLOGO.noneAdd = function (icao) {
    try {
        const m = this.noneRead(), now = Date.now();
        for (const k in m) if (m[k] < now) delete m[k];
        m[icao] = now + AIRLOGO_NONE_MS;
        localStorage.setItem('airlogoNone', JSON.stringify(m));
    } catch (e) { /* storage unavailable: just ask again next time */ }
};

// state of a logo, starting the (single) request for it when needed
AIRLOGO.get = function (info) {
    if (!info || !info.iata || !airlineLogosOn()) return null;
    let e = this.cache.get(info.icao);
    if (!e) {
        e = {state: 'loading', url: null, bitmap: null};
        this.cache.set(info.icao, e);
        const known = this.noneRead()[info.icao];
        if (known && known > Date.now()) e.state = 'none';
        else this.load(info, e);
    }
    return e;
};

AIRLOGO.load = async function (info, e) {
    try {
        const ph = await this.getPlaceholder();
        const r = await fetch(airlineLogoUrlFor(info.iata, 128), {credentials: 'omit', referrerPolicy: 'no-referrer'});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        if (blob.size === ph || blob.size < 100) throw new Error('placeholder');
        e.url = URL.createObjectURL(blob);
        try { e.bitmap = await createImageBitmap(blob); } catch (err) { /* map labels only */ }
        e.state = 'ok';
    } catch (err) {
        e.state = 'none';
        this.noneAdd(info.icao);
    }
    this.patchDom(info.icao, e);
    if (typeof MLR != 'undefined' && MLR.planes) MLR.touch('planes');
};

// logos that were drawn before their image arrived get it now
AIRLOGO.patchDom = function (icao, e) {
    if (e.state !== 'ok') return;
    for (const el of document.querySelectorAll('.alogo[data-icao="' + icao + '"]:not(.has)')) {
        el.classList.add('has');
        el.insertAdjacentHTML('beforeend', '<img alt="" src="' + e.url + '" decoding="async">');
    }
};

// HTML for a logo circle (monogram until / unless the image is there). size in px, extra = CSS class
function airlineLogoHTML(info, size, cls) {
    if (!info || !airlineLogosOn()) return '';
    const e = AIRLOGO.get(info);
    const ok = e && e.state === 'ok';
    return '<span class="alogo' + (cls ? ' ' + cls : '') + (ok ? ' has' : '') + '" data-icao="' + info.icao + '" style="--s:' + size + 'px" '
        + 'title="' + info.icao + '" aria-hidden="true"><span class="alogoMono">' + info.icao + '</span>'
        + (ok ? '<img alt="" src="' + e.url + '" decoding="async">' : '') + '</span>';
}

// rounded-square logo as ImageData for map labels, or null while there is no real logo (no monogram on the map:
// the callsign next to it already starts with the same three letters)
AIRLOGO.mapImage = function (icao, px, dpr) {
    const e = this.cache.get(icao);
    if (!e || e.state !== 'ok' || !e.bitmap) return null;
    const key = icao + '@' + px + 'x' + dpr;
    let d = this.mapImages.get(key);
    if (d) return d;
    const s = Math.ceil(px * dpr);
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d');
    const rr = (inset) => { ctx.beginPath(); const r = s * 0.24; ctx.roundRect ? ctx.roundRect(inset, inset, s - 2 * inset, s - 2 * inset, r) : ctx.rect(inset, inset, s - 2 * inset, s - 2 * inset); };
    ctx.fillStyle = '#000000'; rr(0); ctx.fill();
    ctx.save(); rr(0.5 * dpr); ctx.clip();
    ctx.drawImage(e.bitmap, 0, 0, s, s);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = dpr; rr(0.5 * dpr); ctx.stroke();
    d = ctx.getImageData(0, 0, s, s);
    this.mapImages.set(key, d);
    return d;
};

// provider host for the settings text
function airlineLogoHost() {
    try { return new URL(airlineLogoUrl.replace(/\{[a-z]+\}/g, 'x')).host; } catch (e) { return ''; }
}

function airlineLogosRefresh() {
    for (const p of g.planesOrdered) { p.trCache = []; p.refreshTR = 0; }
    if (typeof SelectedPlane != 'undefined' && SelectedPlane) ibRender(SelectedPlane);
    if (typeof TAR != 'undefined' && TAR.planeMan) TAR.planeMan.refresh();
    if (typeof MLR != 'undefined' && MLR.planes) MLR.touch('planes');
}

jQuery(function () {
    new Toggle({
        key: 'airlineLogos',
        display: 'Airline logos',
        container: '#settingsRight',
        init: typeof airlineLogos != 'undefined' ? airlineLogos : true,
        setState: function (state) {
            airlineLogos = state;
            if (typeof loadFinished != 'undefined' && loadFinished) airlineLogosRefresh();
        },
    });
    jQuery('.airlineLogoHost').text(airlineLogoHost());
});
