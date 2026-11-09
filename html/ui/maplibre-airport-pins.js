"use strict";
// Skywatch ADS-B: airport dots and labels at every zoom, by importance (ui/airport-tiers.js). One GeoJSON source holds every airport of
// html/airport-db/airports.json (built once when the database has loaded); one symbol layer per tier carries the dot and a label whose text
// steps with the zoom (nothing, then the code, then "CODE  Name"). A tier's zoom range comes from AIRTIERS, so changing the density or the
// phone/desktop shift only restates 5 layers' zoom range and text expression. Nothing is rebuilt per frame.
// Appearance: a 4 px grey dot; a ring in the flight-category colour while a METAR under 3 hours old is known; labels 11 px #cfcfcf with a
// 1 px dark halo. The layers sit under the aircraft layers, so a dot or a label never covers an aircraft icon or a callsign pill.
(function () {
    const KEY = 'airportLabels';
    const MQ = '(max-width: 768px), (pointer: coarse)';
    const LAYER = (t) => 'tar-apt-' + t;
    let density = 'normal';
    try { density = AIRTIERS.densityFrom(localStorage.getItem(KEY)); } catch (e) { /* private mode: default */ }

    MLR.airportDensity = function () { return density; };
    MLR.airportTierLayers = function () { return AIRTIERS.ORDER.map(LAYER); };
    MLR.airportOpts = function () { return {density, phone: !!(window.matchMedia && window.matchMedia(MQ).matches)}; };

    // round dot sprite: grey dot, optionally with a flight-category ring (drawn at 2x)
    function dotImage(ring) {
        const s = ring ? 12 : 8, d = 2, c = document.createElement('canvas');
        c.width = c.height = s * d;
        const x = c.getContext('2d');
        x.scale(d, d);
        if (ring) { x.beginPath(); x.arc(s / 2, s / 2, 4.5, 0, Math.PI * 2); x.lineWidth = 1.5; x.strokeStyle = ring; x.stroke(); }
        x.beginPath(); x.arc(s / 2, s / 2, 2, 0, Math.PI * 2); x.fillStyle = '#8f8f8f'; x.fill();
        return x.getImageData(0, 0, c.width, c.height);
    }

    // zoom range and label steps of every tier layer, from the density and the device
    MLR.applyAirportTiers = function () {
        const m = this.map;
        if (!m) return;
        const o = this.airportOpts();
        for (const t of AIRTIERS.ORDER) {
            const id = LAYER(t);
            if (!m.getLayer(id)) continue;
            const z = AIRTIERS.tierZooms(t, o);
            m.setLayerZoomRange(id, z.dot, 24);
            const field = z.code >= z.name ? ['step', ['zoom'], '', z.name, ['get', 'n']] : ['step', ['zoom'], '', z.code, ['get', 'c'], z.name, ['get', 'n']];
            m.setLayoutProperty(id, 'text-field', field);
        }
    };
    MLR.setAirportDensity = function (v) {
        density = AIRTIERS.densityFrom(v);
        try { localStorage.setItem(KEY, density); } catch (e) { /* private mode: not persisted */ }
        this.applyAirportTiers();
    };

    MLR.installAirportPins = function () {
        const m = this.map;
        if (!m || m.getSource('tar-apts')) return;
        const gs = (typeof globalScale == 'number' && globalScale) || 1;
        m.addImage('ap-dot', dotImage(null), {pixelRatio: 2});
        for (const k of Object.keys(AIRPORT_CAT_COLOR)) m.addImage('ap-dot-' + k, dotImage(AIRPORT_CAT_COLOR[k]), {pixelRatio: 2});
        m.addSource('tar-apts', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
        const before = ['tar-plane-glow', 'tar-plane-labels', 'tar-planes'].find(id => m.getLayer(id));
        for (const t of AIRTIERS.ORDER) {
            m.addLayer({id: LAYER(t), type: 'symbol', source: 'tar-apts', filter: ['==', ['get', 't'], t],
                layout: {
                    'icon-image': 'ap-dot', 'icon-allow-overlap': false, 'icon-padding': 1,
                    'text-field': '', 'text-font': ML_FONT, 'text-size': 11 * gs, 'text-anchor': 'left', 'text-justify': 'left',
                    'text-offset': [0.85, 0], 'text-optional': true, 'text-allow-overlap': false, 'text-padding': 2, 'text-max-width': 14,
                    'symbol-sort-key': ['get', 's'],
                },
                paint: {'text-color': '#cfcfcf', 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 1}}, before);
        }
        this.applyAirportTiers();
        this._pinWxKey = null;
        this.applyPinWeather();
        this.installPinCard();
        if (typeof AIRPT != 'undefined' && AIRPT.load) AIRPT.load().then(db => { if (db) MLR.setAirportPinData(db); });
        if (!this._tierMq && window.matchMedia) { this._tierMq = window.matchMedia(MQ); const f = () => MLR.applyAirportTiers(); this._tierMq.addEventListener ? this._tierMq.addEventListener('change', f) : this._tierMq.addListener(f); }
    };

    // one feature per airport; properties are what the layers need (t tier, c code, n "CODE  Name", s importance, icao)
    MLR.airportFeatures = function (db) {
        const feats = new Array(db.a.length);
        for (let i = 0; i < db.a.length; i++) {
            const r = db.a[i];
            feats[i] = {type: 'Feature', id: i, geometry: {type: 'Point', coordinates: [r[5], r[4]]},
                properties: {t: AIRTIERS.tierOf(r), c: AIRTIERS.code(r), n: AIRTIERS.nameText(r), s: AIRTIERS.sortKey(r), icao: r[0]}};
        }
        return feats;
    };
    MLR.setAirportPinData = function (db) {
        const src = this.map && this.map.getSource('tar-apts');
        if (!src) return;
        this._aptDb = db;
        src.setData({type: 'FeatureCollection', features: this.airportFeatures(db)});
    };

    // ----- weather rings on the dots -----
    // One data-driven expression per wx.json refresh (never per frame): the dot image is 'ap-dot' plus a category suffix looked up by ICAO.
    MLR.applyPinWeather = function () {
        const m = this.map;
        if (!m || !m.getLayer(LAYER('large'))) return;
        const on = typeof airportPinWx == 'undefined' || airportPinWx;
        const cats = on && typeof AIRPT != 'undefined' && typeof AIRPT.weatherCats == 'function' ? AIRPT.weatherCats() : {};
        const keys = Object.keys(cats).sort();
        const key = keys.map(k => k + cats[k]).join(',');
        if (key === this._pinWxKey) return;
        this._pinWxKey = key;
        let expr = 'ap-dot';
        if (keys.length) {
            const match = ['match', ['get', 'icao']];
            for (const k of keys) match.push(k, '-' + cats[k]);
            match.push('');
            expr = ['concat', 'ap-dot', match];
        }
        for (const id of this.airportTierLayers()) if (m.getLayer(id)) m.setLayoutProperty(id, 'icon-image', expr);
    };

    // Hover (long-press on touch) card on a dot: code, name and, when a METAR is known, the weather. textContent only.
    MLR.installPinCard = function () {
        const m = this.map;
        if (this._pinCard) return;
        this._pinCard = true;
        let card = null, lp = null;
        const close = () => { if (card) { card.remove(); card = null; } };
        const row = (el, k, v) => { if (!v) return; const d = document.createElement('div'); d.className = 'apPinRow'; const a = document.createElement('span'); a.textContent = k; const b = document.createElement('span'); b.textContent = v; d.append(a, b); el.appendChild(d); };
        const show = (f, pt) => {
            close();
            const pr = f.properties || {}, icao = pr.icao && String(pr.icao).toUpperCase();
            if (!icao) return;
            const db = MLR._aptDb, rec = db && db.a[f.id];
            const wxOn = !(typeof airportPinWx != 'undefined' && !airportPinWx);
            const wx = wxOn && typeof AIRPT != 'undefined' && AIRPT.wxFor ? AIRPT.wxFor(icao) : null, met = wx && wx.m;
            const el = document.createElement('div'); el.className = 'apPinCard';
            const top = document.createElement('div'); top.className = 'apPinTop';
            const code = document.createElement('b'); code.textContent = pr.c || icao; top.appendChild(code);
            const cat = met && AIRCALC.metarCategory(met);
            if (cat) top.appendChild(AIRPT.catChip(cat));
            el.appendChild(top);
            if (rec && rec[3]) row(el, 'Airport', rec[3]);
            if (met) {
                if (typeof met.wspd === 'number') row(el, 'Wind', met.wspd === 0 ? 'Calm' : (typeof met.wdir === 'number' ? String(met.wdir).padStart(3, '0') + '°' : 'VRB') + ' / ' + met.wspd + (typeof met.wgst === 'number' ? 'G' + met.wgst : '') + ' kt');
                row(el, 'Visibility', AIRPT.visText(met.vis)); row(el, 'Cloud', AIRPT.cloudText(met.clouds));
                row(el, 'Temp / QNH', [typeof met.temp === 'number' ? met.temp + '°C' : null, typeof met.qnh === 'number' ? 'QNH ' + met.qnh : null].filter(Boolean).join(' · '));
                if (typeof met.obs === 'number') row(el, 'Observed', AIRPT.ageText(Date.now() / 1000 - met.obs));
            } else row(el, 'Weather', '–');
            const hint = document.createElement('div'); hint.className = 'apPinHint'; hint.textContent = 'Click for the full airport panel'; el.appendChild(hint);
            m.getContainer().appendChild(el);
            const w = el.offsetWidth, hh = el.offsetHeight, cw = m.getContainer().clientWidth;
            el.style.left = Math.min(Math.max(8, pt.x + 14), cw - w - 8) + 'px';
            el.style.top = Math.max(8, pt.y - hh - 14) + 'px';
            card = el;
        };
        MLR._pinCardShow = show; MLR._pinCardClose = close;
        for (const id of this.airportTierLayers()) {
            m.on('mousemove', id, (e) => { m.getCanvas().style.cursor = 'pointer'; if (e.features && e.features[0]) show(e.features[0], e.point); });
            m.on('mouseleave', id, () => { m.getCanvas().style.cursor = ''; close(); });
            m.on('touchstart', id, (e) => { clearTimeout(lp); const f = e.features && e.features[0], pt = e.point; lp = setTimeout(() => f && show(f, pt), 500); });
        }
        m.on('touchend', () => clearTimeout(lp)); m.on('touchmove', () => clearTimeout(lp));
        m.on('click', () => { if (card) setTimeout(close, 0); });
        m.on('movestart', close);
        document.addEventListener('touchstart', (e) => { if (card && !card.contains(e.target) && !(e.target.closest && e.target.closest('.maplibregl-canvas'))) close(); }, true);
        if (typeof AIRPT != 'undefined' && AIRPT.onWx) AIRPT.onWx(() => MLR.applyPinWeather());
    };

    // Settings > Map & layers: Airport labels Fewer / Normal / More
    jQuery(function () {
        const list = document.getElementById('set_appearance');
        if (!list) return;
        const row = document.createElement('div'); row.className = 'setSlider';
        const lab = document.createElement('label'); lab.htmlFor = 'airportLabelsSel';
        const t = document.createElement('span'); t.textContent = 'Airport labels'; lab.appendChild(t);
        const sel = document.createElement('select'); sel.id = 'airportLabelsSel'; sel.className = 'searchInput';
        for (const [v, n] of [['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); }
        sel.value = density;
        sel.addEventListener('change', () => MLR.setAirportDensity(sel.value));
        row.append(lab, sel);
        const first = list.querySelector('.setSlider');
        list.insertBefore(row, first ? first.nextSibling : list.firstChild);
    });
})();
