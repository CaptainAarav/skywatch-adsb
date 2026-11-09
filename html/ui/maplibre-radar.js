"use strict";
// Skywatch ADS-B: rain radar playback. The overlay itself (Settings > Overlays > RainViewer Radar, off by default) is tar1090's;
// this file adds the last two hours of frames with a play/pause bar and handles failure with a toast.
// Data: RainViewer public Weather Maps API (free for personal, educational and small community use, attribution required,
// no SLA; see THIRD_PARTY.md). Radar frames are fetched only while the overlay is on. Text is set with textContent.
(function () {
    const API = 'https://api.rainviewer.com/public/weather-maps.json';
    const R = {frames: [], host: '', idx: 0, timer: null, bar: null, warned: false};
    MLR.radar = R;
    const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };

    async function fetchMaps() {
        const r = await fetch(API, {credentials: 'omit', cache: 'no-cache'});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const d = await r.json();
        if (!d || !d.radar || !Array.isArray(d.radar.past) || !d.radar.past.length || typeof d.host != 'string' || !/^https:\/\//.test(d.host)) throw new Error('unexpected response');
        return d;
    }
    const url = (i) => R.host + R.frames[i].path + '/512/{z}/{x}/{y}/6/1_1.png';
    function show(i) {
        R.idx = Math.max(0, Math.min(R.frames.length - 1, i));
        const s = MLR.map && MLR.map.getSource('ov-rainviewer_radar');
        if (s && s.setTiles) s.setTiles([url(R.idx)]);
        label();
    }
    function label() {
        if (!R.bar) return;
        const f = R.frames[R.idx], mins = Math.round((Date.now() / 1000 - f.time) / 60);
        R.bar.querySelector('.rdTime').textContent = new Date(f.time * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) + (mins > 1 ? ' · ' + mins + ' min ago' : ' · now');
        R.bar.querySelector('input').value = R.idx;
    }
    function stop() { clearInterval(R.timer); R.timer = null; if (R.bar) { const b = R.bar.querySelector('button'); b.textContent = 'Play'; b.setAttribute('aria-label', 'Play radar'); } }
    function play() {
        if (R.timer) return stop();
        const b = R.bar.querySelector('button'); b.textContent = 'Pause'; b.setAttribute('aria-label', 'Pause radar');
        if (R.idx >= R.frames.length - 1) show(0);
        R.timer = setInterval(() => { if (R.idx >= R.frames.length - 1) { stop(); return; } show(R.idx + 1); }, 650);
    }
    function ensureBar() {
        if (R.bar) return;
        const b = R.bar = el('div', 'rdBar'); b.setAttribute('role', 'group'); b.setAttribute('aria-label', 'Rain radar playback');
        const pb = el('button', 'rdBtn', 'Play'); pb.type = 'button'; pb.setAttribute('aria-label', 'Play radar'); pb.addEventListener('click', play);
        const rg = el('input'); rg.type = 'range'; rg.min = 0; rg.max = R.frames.length - 1; rg.step = 1; rg.setAttribute('aria-label', 'Radar time, last two hours');
        rg.addEventListener('input', () => { stop(); show(Number(rg.value)); });
        b.append(pb, rg, el('span', 'rdTime mono'));
        const cr = el('span', 'rdCredit'); const a = el('a', null, 'Weather data by RainViewer'); a.href = 'https://www.rainviewer.com/'; a.target = '_blank'; a.rel = 'noopener'; cr.appendChild(a);
        b.appendChild(cr);
        document.body.appendChild(b);
    }
    function dropBar() { stop(); if (R.bar) { R.bar.remove(); R.bar = null; } }

    MLR.addRainviewer = async function (l) {
        const name = l.get('name'), id = 'ov-' + name;
        try {
            const d = await fetchMaps();
            if (!l.visible || this.map.getSource(id)) return;
            const wasLatest = !R.frames.length || R.idx >= R.frames.length - 1;
            R.host = d.host; R.frames = d.radar.past; R.warned = false;
            const m = this.map;
            m.addSource(id, {type: 'raster', tileSize: 512, maxzoom: 7, tiles: [R.host + R.frames[R.frames.length - 1].path + '/512/{z}/{x}/{y}/6/1_1.png']});
            m.addLayer({id, type: 'raster', source: id, paint: {'raster-opacity': l.opacity}}, m.getLayer('tar-circles') ? 'tar-circles' : undefined);
            R.idx = R.frames.length - 1;
            if (R.bar) { R.bar.remove(); R.bar = null; }
            ensureBar(); label();
            clearInterval(this.overlayTimers[name]);
            this.overlayTimers[name] = setInterval(() => { if (l.visible && !R.timer) this.syncOverlay(l); }, l.get('refresh'));
            if (!R.errHook) m.on('error', R.errHook = (e) => { if (e.sourceId === id && !R.warned) { R.warned = true; if (typeof SKYUI != 'undefined') SKYUI.toast('Rain radar tiles are not loading right now.', {kind: 'warn'}); } });
        } catch (err) {
            console.warn('RainViewer unavailable:', err);
            if (!R.warned && typeof SKYUI != 'undefined') { R.warned = true; SKYUI.toast('Rain radar is unavailable right now.', {kind: 'warn'}); }
        }
    };
    const rm = MLR.removeOverlay;
    MLR.removeOverlay = function (l) {
        rm.call(this, l);
        if (l.get('name') === 'rainviewer_radar' && !l.visible) dropBar();
    };
})();
