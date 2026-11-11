"use strict";
// Skywatch ADS-B: connection banner state machine (pure, unit tested in tools/test/banner-state.test.js).
// States: connected -> retrying (a fetch failed) -> connected ("recovered" for a short while) ; connected -> stale (data not advancing).
const BANNERSTATE = (function () {
    const RETRY_MS = 8000, STALE_MS = 30000, RECOVERED_MS = 4000, SILENT_MS = 10000;
    function create() {
        const s = {state: 'connected', failedAt: 0, nextRetryAt: 0, lastGood: 0, lastAdvance: 0, recoveredAt: 0, detail: '', mapOk: true};
        const api = {
            get: () => s,
            // a fetch succeeded; `advanced` is false when the receiver timestamp did not change
            ok(now, advanced) {
                const was = s.state;
                s.lastGood = now;
                if (advanced !== false) s.lastAdvance = now;
                if (!s.lastAdvance) s.lastAdvance = now;
                if (was === 'retrying') { s.state = 'recovered'; s.recoveredAt = now; }
                else if (was === 'stale' && advanced !== false) { s.state = 'recovered'; s.recoveredAt = now; }
                return api.view(now);
            },
            fail(now, detail) {
                if (s.state !== 'retrying') { s.failedAt = now; s.nextRetryAt = now + RETRY_MS; }
                s.state = 'retrying'; s.detail = detail || '';
                return api.view(now);
            },
            // the map cannot draw (no WebGL): not a data problem, but the banner says so when data is also late
            setMap(ok) { s.mapOk = ok !== false; },
            // call about once a second
            tick(now) {
                if (s.state === 'recovered' && now - s.recoveredAt > RECOVERED_MS) s.state = 'connected';
                if (s.state === 'retrying' && now >= s.nextRetryAt) s.nextRetryAt = now + RETRY_MS;
                if (s.state === 'connected' && s.lastAdvance && now - s.lastAdvance > STALE_MS) s.state = 'stale';
                return api.view(now);
            },
            view(now) {
                return {
                    state: s.state, detail: s.detail,
                    retryIn: s.state === 'retrying' ? Math.max(0, Math.ceil((s.nextRetryAt - now) / 1000)) : 0,
                    ageSec: s.lastAdvance ? Math.floor((now - s.lastAdvance) / 1000) : 0,
                    lastGood: s.lastGood,
                    // WHY data is late: 'receiver' = this page IS getting answers but the receiver time does not advance;
                    // 'page' = this page has not completed a fetch for SILENT_MS, so nothing is known about the receiver.
                    cause: s.state === 'stale' ? (now - s.lastGood > SILENT_MS ? 'page' : 'receiver') : (s.state === 'retrying' ? 'unreachable' : ''),
                    mapOk: s.mapOk,
                    visible: s.state !== 'connected',
                };
            },
        };
        return api;
    }
    return {create, RETRY_MS, STALE_MS, RECOVERED_MS, SILENT_MS};
})();
if (typeof module !== 'undefined') module.exports = BANNERSTATE;
