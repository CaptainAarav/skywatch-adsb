"use strict";
// Skywatch ADS-B: airport dots and labels at every zoom, by importance (ui/airport-tiers.js). One GeoJSON source holds every airport of
// html/airport-db/airports.json (built once when the database has loaded); one symbol layer per tier carries the dot and a label whose text
// steps with the zoom (nothing, then the code, then "CODE  Name"). A tier's zoom range comes from AIRTIERS, so changing the density or the
// phone/desktop shift only restates 5 layers' zoom range and text expression. Nothing is rebuilt per frame.
// Appearance: the restored marker (ui/airport-pin-style.js): a flag in a circle, the ring in the flight-category colour while a METAR under 3 hours
// old is known (neutral grey otherwise), the code below. The layers sit under the aircraft layers.
(function () {
    const KEY = 'airportLabels';
    const MQ = '(max-width: 768px), (pointer: coarse)';
    const LAYER = (t) => 'tar-apt-' + t;
    let density = 'normal';
    try { density = AIRTIERS.densityFrom(localStorage.getItem(KEY)); } catch (e) { /* private mode: default */ }

    MLR.airportDensity = function () { return density; };
    MLR.airportTierLayers = function () { return AIRTIERS.ORDER.map(LAYER); };
    MLR.airportOpts = function () { return {density, phone: !!(window.matchMedia && window.matchMedia(MQ).matches)}; };

    // flag-in-circle sprites are made on demand from the bundled SVGs (html/flags/3x2) when a layer first asks for an id (styleimagemissing)
    function installFlagHook(m) {
        if (MLR._flagHook) return;
        MLR._flagHook = true;
        const S = AIRPIN.SPRITE;
        m.on('styleimagemissing', (e) => {
            const mm = AIRPIN.ID_RE.exec(e.id);
            if (!mm || m.hasImage(e.id)) return;
            m.addImage(e.id, {width: 1, height: 1, data: new Uint8Array(4)});
            const ring = mm[2] === 'N' ? S.neutralRing : AIRPIN.CAT_COLOR[mm[2]];
            const img = new Image();
            const draw = (withFlag) => {
                const W = S.size, H = S.size, c = document.createElement('canvas'); c.width = W; c.height = H;
                const x = c.getContext('2d');
                x.save(); x.beginPath(); x.arc(W / 2, H / 2, W / 2 - S.clipInset, 0, Math.PI * 2);
                x.fillStyle = S.fill; x.fill(); x.clip();
                if (withFlag) { const r = img.width / img.height, w = H * r; x.drawImage(img, (W - w) / 2, 0, w, H); }
                x.restore();
                x.beginPath(); x.arc(W / 2, H / 2, W / 2 - S.ringInset, 0, Math.PI * 2); x.lineWidth = S.ringWidth; x.strokeStyle = ring; x.stroke();
                try { m.removeImage(e.id); m.addImage(e.id, x.getImageData(0, 0, W, H), {pixelRatio: S.pixelRatio}); } catch (er) { /* style changing */ }
            };
            if (mm[1] === 'XX') { draw(false); return; }          // no country: a neutral circle
            img.onload = () => draw(true);
            img.onerror = () => draw(false);                       // country without a flag asset: neutral circle, never a broken icon
            img.src = 'flags/3x2/' + mm[1] + '.svg';
        });
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
            m.setLayoutProperty(id, 'text-field', AIRPIN.labelField(z.dot, z.name));
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
        installFlagHook(m);
        m.addSource('tar-apts', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
        const before = ['tar-plane-glow', 'tar-plane-labels', 'tar-planes'].find(id => m.getLayer(id));
        for (const t of AIRTIERS.ORDER) {
            m.addLayer({id: LAYER(t), type: 'symbol', source: 'tar-apts', filter: ['==', ['get', 't'], t],
                layout: AIRPIN.layout(ML_FONT, gs, AIRPIN.labelField(0, 99)), paint: Object.assign({}, AIRPIN.PAINT)}, before);
        }
        this.applyAirportTiers();
        this.applyPinWeather();
        this.installPinCard();
        if (typeof AIRPT != 'undefined' && AIRPT.load) AIRPT.load().then(db => { if (db) MLR.setAirportPinData(db); });
        if (!this._tierMq && window.matchMedia) { this._tierMq = window.matchMedia(MQ); const f = () => MLR.applyAirportTiers(); this._tierMq.addEventListener ? this._tierMq.addEventListener('change', f) : this._tierMq.addListener(f); }
    };

    // one feature per airport; properties are what the layers need (t tier, c code, nm short name, s importance, icao, f flag country, w category or N)
    MLR.airportFeatures = function (db) {
        const feats = new Array(db.a.length);
        for (let i = 0; i < db.a.length; i++) {
            const r = db.a[i];
            feats[i] = {type: 'Feature', id: i, geometry: {type: 'Point', coordinates: [r[5], r[4]]},
                properties: {t: AIRTIERS.tierOf(r), c: AIRTIERS.code(r), nm: AIRTIERS.shortName(r), s: AIRTIERS.sortKey(r), icao: r[0],
                    f: /^[A-Z]{2}$/.test(r[7] || '') ? r[7] : 'XX', w: (this._pinCats && AIRPIN.CAT_COLOR[this._pinCats[r[0]]]) ? this._pinCats[r[0]] : 'N'}};
        }
        return feats;
    };
    MLR.setAirportPinData = function (db) {
        const src = this.map && this.map.getSource('tar-apts');
        if (!src) return;
        this._aptDb = db;
        this._aptIdx = new Map(db.a.map((r, i) => [r[0], i]));
        src.setData({type: 'FeatureCollection', features: this.airportFeatures(db)});
    };

    // ----- weather rings -----
    // The ring colour is the feature's 'w' property. It changes ONLY when wx.json is refreshed: the airports whose category changed are updated in
    // place (updateData, a few features) - never per frame, never a per-feature paint expression over the whole source.
    MLR.applyPinWeather = function () {
        const m = this.map, src = m && m.getSource('tar-apts');
        if (!src) return;
        const on = typeof airportPinWx == 'undefined' || airportPinWx;
        const cats = on && typeof AIRPT != 'undefined' && typeof AIRPT.weatherCats == 'function' ? AIRPT.weatherCats() : {};
        const prev = this._pinCats || {};
        this._pinCats = cats;
        if (!this._aptIdx) return;                       // the database is not loaded yet: the first setData carries the categories
        const update = [];
        for (const k of new Set(Object.keys(prev).concat(Object.keys(cats)))) {
            if (prev[k] === cats[k]) continue;
            const id = this._aptIdx.get(k);
            if (id !== undefined) update.push({id, addOrUpdateProperties: [{key: 'w', value: AIRPIN.CAT_COLOR[cats[k]] ? cats[k] : 'N'}]});
        }
        if (update.length) src.updateData({update});
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
        // hover: ONE map-level handler (not one per tier layer, which ran a query per layer per mouse event), once per animation frame, a small box, pin layers only,
        // and nothing while the camera is moving
        let over = false;
        const hover = MLR.throttleHover((e) => {
            const ids = this.airportTierLayers().filter(id => m.getLayer(id));
            const f = ids.length ? m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], {layers: ids}) : [];
            if (f.length) { over = true; m.getCanvas().style.cursor = 'pointer'; show(f[0], e.point); }
            else if (over) { over = false; m.getCanvas().style.cursor = ''; close(); }
        });
        m.on('mousemove', hover);
        m.getCanvas().addEventListener('mouseleave', () => { over = false; m.getCanvas().style.cursor = ''; close(); });
        for (const id of this.airportTierLayers()) {
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
