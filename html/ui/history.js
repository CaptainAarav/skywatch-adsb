"use strict";
// Skywatch ADS-B: history bar (design/mockups/03-aircraft-details-history.html).
// Replay (Shift+Y, heatmap data) uses #replayBar; per-aircraft traces use #historyBar.
// Replay state and loading stay in script.js (replay, replayJump, playReplay...).

const HIST_DAY_MIN = 1440;

function histDateLabel(ymd) {
    // ymd = "yyyy-mm-dd" (UTC day) -> "Sun 8 Nov 2026"
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).replace(/,/g, '');
}

function setReplayPlaying(playing) {
    const b = document.getElementById('replayPlay');
    if (!b) return;
    b.classList.toggle('playing', !!playing);
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    b.querySelector('.histPlayLabel').textContent = playing ? 'Pause' : 'Play';
}

function histMarkSpeed() {
    if (!replay) return;
    const sp = Number(replay.speed);
    for (const b of document.querySelectorAll('#replaySpeeds [data-speed]'))
        b.classList.toggle('on', Number(b.dataset.speed) == sp);
}

// update the time readout, playhead, date button and selected-aircraft line
let histT0 = null;       // replay clock when the bar opened / was last scrubbed
function histUpdateReplay(date) {
    if (!date || isNaN(date.getTime())) return;
    const mins = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    const frac = Math.min(1, Math.max(0, mins / HIST_DAY_MIN));
    const head = document.getElementById('replayHead');
    if (head) head.style.left = (frac * 100) + '%';
    // time bubble: UTC clock and how far into the replay we are (since it opened or was last scrubbed)
    const bub = document.getElementById('replayBubble');
    if (bub) {
        if (histT0 == null) histT0 = date.getTime();
        const el = Math.max(0, Math.round((date.getTime() - histT0) / 1000));
        const mm = Math.floor(el / 60), ss = el % 60;
        bub.textContent = '';
        bub.append(zuluTime(date) + ' UTC ');
        const sp = document.createElement('span');
        sp.textContent = '· ' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + ' into replay';
        bub.appendChild(sp);
        bub.style.left = 'clamp(110px, ' + (frac * 100) + '%, calc(100% - 110px))';
    }
    const fill = document.getElementById('replayFill');
    if (fill) fill.style.width = (frac * 100) + '%';
    const track = document.getElementById('replayTrack');
    if (track) track.setAttribute('aria-valuenow', String(Math.round(mins)));

    jQuery('#replayTimeHint').text(zuluTime(date) + ' UTC');
    const tz = TIMEZONE && TIMEZONE != 'UTC' ? ` · ${localTime(date).slice(0, 5)} ${TIMEZONE}` : '';
    jQuery('#replayDateHintLocal').text(tz);

    const ymd = zDateString(date);
    const dp = document.getElementById('replayDatepicker');
    if (dp && dp.dataset.ymd != ymd) {
        dp.dataset.ymd = ymd;
        histProbeGaps(ymd);
        dp.value = histDateLabel(ymd);
    }
    histSelInfo();
}

// "BAW23K · FL214 · 412 kt · 056°" for the selected aircraft, if any
function histSelInfo() {
    const p = SelectedPlane;
    let s = '';
    if (p) {
        const parts = [p.name && p.flight ? p.name : (p.registration || p.icao.toUpperCase())];
        if (p.altitude === 'ground') parts.push('ground');
        else if (p.altitude != null) parts.push(DisplayUnits == 'metric' ? ibNum(convert_altitude(p.altitude, DisplayUnits)) + ' m' : 'FL' + String(Math.round(p.altitude / 100)).padStart(3, '0'));
        if (p.gs != null) parts.push(ibNum(convert_speed(p.gs, DisplayUnits)) + ' ' + get_unit_label('speed', DisplayUnits));
        if (p.track != null) parts.push(ibDeg(p.track));
        s = parts.join(' · ');
    }
    jQuery('#replaySelInfo').text(s);
}

function histShiftDay(days) {
    if (!replay) return;
    const d = new Date(replay.dateText + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    const max = new Date(Date.now() + 86400e3);
    if (d > max) return;
    replay.dateText = zDateString(d);
    replayJump();
}

function histTrackMinutes(ev) {
    const r = document.getElementById('replayBody').getBoundingClientRect();
    const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    return Math.round(Math.min(1, Math.max(0, x / r.width)) * (HIST_DAY_MIN - 1));
}
function histSetMinutes(m, jump) {
    if (!replay) return;
    // no replay data exists for the future: clamp to the last full minute
    const dayStart = new Date(replay.dateText + 'T00:00:00Z').getTime();
    const nowMin = Math.floor((Date.now() - dayStart) / 60000) - 1;
    if (nowMin >= 0 && m > nowMin) m = nowMin;
    replay.hours = Math.floor(m / 60);
    replay.minutes = m % 60;
    replayOnSliderMove();
    const d = new Date(replay.dateText + 'T00:00:00Z');
    d.setUTCMinutes(m);
    histUpdateReplay(d);
    if (jump) replayJump();
}

let histBound = false;
function histInitReplay() {
    histT0 = null;
    if (histBound) {
        histMarkSpeed();
        return;
    }
    histBound = true;

    // hour ticks, labels every 3 hours (UTC)
    const tg = document.getElementById('replayTicks');
    if (tg) {
        for (let h = 0; h <= 24; h++) {
            const i = document.createElement('i');
            i.style.left = (h / 24 * 100) + '%';
            if (h % 3 == 0) {
                i.className = 'maj';
                const b = document.createElement('b');
                b.style.left = (h / 24 * 100) + '%';
                b.textContent = String(h).padStart(2, '0');
                tg.appendChild(b);
            }
            tg.appendChild(i);
        }
    }

    jQuery('#replayDatepicker').datepicker({
        maxDate: '+1d',
        dateFormat: 'yy-mm-dd',
        onSelect: function (dateText) {
            replay.dateText = dateText;
            this.dataset.ymd = '';
            replayJump();
            histUpdateReplay(new Date(dateText + 'T' + String(replay.hours).padStart(2, '0') + ':' + String(replay.minutes).padStart(2, '0') + ':00Z'));
        },
        beforeShow: function (input) {
            jQuery(input).datepicker('setDate', replay ? replay.dateText : null);
        },
        onClose: function () {
            const d = this.dataset.ymd;
            if (d) this.value = histDateLabel(d);
        },
    });
    jQuery('#replayPrevDay').on('click', () => histShiftDay(-1));
    jQuery('#replayNextDay').on('click', () => histShiftDay(1));
    jQuery('#replaySpeeds [data-speed]').on('click', function () {
        if (!replay) return;
        replay.speed = Number(this.dataset.speed);
        histMarkSpeed();
        if (!replay.playing) playReplay(true);
        else replayStep();
        updateAddressBar();
    });
    jQuery('#replayStop').on('click', () => showReplayBar());
    jQuery('#replayLive').on('click', () => { histT0 = null; showReplayBar(); });

    const track = document.getElementById('replayTrack');
    const tip = document.getElementById('replayTip');
    let dragging = false;
    const showTip = (ev) => {
        const m = histTrackMinutes(ev);
        tip.hidden = false;
        tip.textContent = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0') + ' UTC';
        tip.style.left = (m / (HIST_DAY_MIN - 1) * 100) + '%';
    };
    const move = (ev) => {
        showTip(ev);
        if (dragging) { histSetMinutes(histTrackMinutes(ev), false); ev.preventDefault(); }
    };
    const up = (ev) => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('histDragging');
        histT0 = null;
        track.classList.remove('dragging');
        histSetMinutes(histTrackMinutes(ev), true);
        if (ev.pointerType != 'mouse') tip.hidden = true;
    };
    track.addEventListener('pointerdown', (ev) => {
        dragging = true;
        document.body.classList.add('histDragging');
        track.classList.add('dragging');
        track.setPointerCapture(ev.pointerId);
        showTip(ev);
        histSetMinutes(histTrackMinutes(ev), false);
    });
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', () => { dragging = false; document.body.classList.remove('histDragging'); track.classList.remove('dragging'); tip.hidden = true; });
    track.addEventListener('pointerleave', () => { if (!dragging) tip.hidden = true; });
    track.addEventListener('keydown', (ev) => {
        if (!replay) return;
        const step = {ArrowLeft: -5, ArrowRight: 5, PageDown: -60, PageUp: 60}[ev.key];
        if (!step) return;
        ev.preventDefault();
        ev.stopPropagation();
        const m = Math.min(HIST_DAY_MIN - 1, Math.max(0, Number(replay.hours) * 60 + Number(replay.minutes) + step));
        histSetMinutes(m, true);
    });
    histMarkSpeed();
}

// keep --hb-h (history bar height) current so the zoom buttons and legend sit above it
function histObserve() {
    if (!window.ResizeObserver) return;
    const set = () => {
        const bars = [document.getElementById('replayBar'), document.getElementById('historyBar')];
        let h = 0;
        for (const b of bars)
            if (b && b.offsetParent !== null) h = Math.max(h, b.offsetHeight);
        document.documentElement.style.setProperty('--hb-h', h + 'px');
    };
    const ro = new ResizeObserver(set);
    for (const id of ['replayBar', 'historyBar']) {
        const e = document.getElementById(id);
        if (e) ro.observe(e);
    }
    set();
}
jQuery(histObserve);


// Data gaps: the replay data is one heatmap file per half hour; probe which exist for the shown day
const histGapCache = {};
function histProbeGaps(ymd) {
    const box = document.getElementById('replayGaps'), note = document.getElementById('replayGapNote');
    if (!box) return;
    const draw = (have) => {
        if (document.getElementById('replayDatepicker').dataset.ymd != ymd) return;
        box.textContent = '';
        let miss = 0;
        const dayStart = new Date(ymd + 'T00:00:00Z').getTime();
        for (let i = 0; i < 48; i++) {
            const future = dayStart + (i + 1) * 1800e3 > Date.now();
            if (have[i] && !future) continue;
            if (!future) miss++;
            const e = document.createElement('i');
            if (future) e.className = 'future';
            e.style.left = (i / 48 * 100) + '%';
            e.style.width = (100 / 48) + '%';
            e.title = String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00') + ' UTC: ' + (future ? 'not recorded yet (half hour still running)' : 'no replay data');
            box.appendChild(e);
        }
        note.textContent = miss ? '· ' + miss * 30 + ' min without data (hatched)' : '';
    };
    if (histGapCache[ymd] && !histGapCache[ymd].partial) return draw(histGapCache[ymd]);
    const have = new Array(48).fill(false);
    const base = 'globe_history/' + ymd.replace(/-/g, '/') + '/heatmap/';
    let next = 0, running = 0, done = 0;
    const dayStart = new Date(ymd + 'T00:00:00Z').getTime();
    const pump = () => {
        while (running < 6 && next < 48) {
            const i = next++;
            if (dayStart + (i + 1) * 1800e3 > Date.now()) {   // half hour not finished: no request, no console 404
                done++;
                if (done == 48) { have.partial = true; histGapCache[ymd] = have; draw(have); }
                continue;
            }
            running++;
            fetch(base + String(i).padStart(2, '0') + '.bin.ttf', {method: 'HEAD'})
                .then(r => { have[i] = r.ok; }, () => {})
                .finally(() => { running--; done++; if (done == 48) { have.partial = ymd == new Date().toISOString().slice(0, 10); histGapCache[ymd] = have; draw(have); } else pump(); });
        }
    };
    pump();
}
