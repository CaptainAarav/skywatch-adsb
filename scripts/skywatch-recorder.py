#!/usr/bin/env python3
"""Skywatch ADS-B recorder: samples aircraft.json and stats.json once a minute into a rolling 7-day JSON file
that the web UI draws its Graphs from. Standard library only.

  history.json  {"v":1,"interval":60,"fields":[...],"samples":[[t, with_pos, total, msg_s, range_nm, rssi, pos_s], ...]}
  polar.json    {"v":1,"bins":36,"hours":{"<unix hour>":[max range nm per 10 degree bearing bin, ...]}}

Weather: also writes wx.json (METAR/TAF, no coordinates), see below.
Privacy: only distances and bearings relative to the receiver are stored (readsb's r_dst / r_dir); no coordinates
of the receiver or of any aircraft are written.

Environment: SW_SRC (default http://ultrafeeder/data), SW_OUT (default /var/globe_history/skywatch), SW_INTERVAL (60), SW_KEEP_DAYS (7).
"""
import json, math, os, re, shutil, subprocess, sys, threading, time, urllib.error, urllib.request

SRC = os.environ.get('SW_SRC', 'http://ultrafeeder/data').rstrip('/')
OUT = os.environ.get('SW_OUT', '/var/globe_history/skywatch')
INTERVAL = int(os.environ.get('SW_INTERVAL', '60'))
KEEP = int(os.environ.get('SW_KEEP_DAYS', '7')) * 86400
FIELDS = ['t', 'aircraft_with_pos', 'aircraft_total', 'messages_per_s', 'max_range_nm', 'avg_rssi', 'positions_per_s']
BINS = 36


def get(name):
    with urllib.request.urlopen(f'{SRC}/{name}', timeout=10) as r:
        return json.load(r)


def load(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    os.replace(tmp, path)
    os.chmod(path, 0o644)


LAST_AC = []           # latest aircraft list, shared with the alert sender and the movement detector


def sample():
    global LAST_AC
    ac = get('aircraft.json')
    lst = ac.get('aircraft', [])
    LAST_AC = lst
    with_pos = [a for a in lst if 'lat' in a or 'lastPosition' in a]
    rng = [a['r_dst'] for a in lst if 'lat' in a and isinstance(a.get('r_dst'), (int, float))]
    rssi = [a['rssi'] for a in lst if isinstance(a.get('rssi'), (int, float)) and a.get('seen', 99) < 15]
    msg = pos = sig = None
    try:
        st = get('stats.json')['last1min']
        msg = round(st['local']['accepted'][0] / 60.0, 1)
        pos = round(st['position_count_total'] / 60.0, 2)
        sig = st['local'].get('signal')          # mean signal power in dBFS, the same quantity graphs1090 plots
    except Exception:
        pass
    # per-bearing maxima for the polar plot
    bins = [0.0] * BINS
    for a in lst:
        if 'lat' in a and isinstance(a.get('r_dst'), (int, float)) and isinstance(a.get('r_dir'), (int, float)):
            i = int((a['r_dir'] % 360) // (360 / BINS))
            bins[i] = max(bins[i], a['r_dst'])
    return [int(time.time()), len(with_pos), len(lst), msg, round(max(rng), 1) if rng else None,
            round(sig, 1) if sig is not None else (round(sum(rssi) / len(rssi), 1) if rssi else None), pos], bins


RRD = os.environ.get('SW_RRD', '/var/lib/collectd/rrd/localhost/dump1090-localhost')


def rrd_rows(name, cf, start, end):
    """-> {timestamp: [values]} from a graphs1090 rrd at 5 minute resolution (empty when rrdtool / the file is missing)."""
    path = os.path.join(RRD, name + '.rrd')
    if not shutil.which('rrdtool') or not os.path.exists(path):
        return {}
    out = subprocess.run(['rrdtool', 'fetch', path, cf, '-s', str(start), '-e', str(end), '-r', '300'],
                         capture_output=True, text=True, timeout=60).stdout
    rows = {}
    for line in out.splitlines():
        if ':' not in line:
            continue
        t, v = line.split(':', 1)
        try:
            rows[int(t)] = [None if x.strip() in ('-nan', 'nan') else float(x) for x in v.split()]
        except ValueError:
            pass
    return rows


def backfill(hist):
    """Seed an empty / short history from graphs1090's own rrd data (5 min steps), so the charts are not empty on day one."""
    first = hist['samples'][0][0] if hist['samples'] else int(time.time())
    if first < time.time() - 6 * 86400:
        return 0
    start, end = int(time.time()) - KEEP, first - 1
    ac = rrd_rows('dump1090_aircraft-recent', 'AVERAGE', start, end)
    if not ac:
        return 0
    msg = rrd_rows('dump1090_messages-local_accepted', 'AVERAGE', start, end)
    pos = rrd_rows('dump1090_messages-positions', 'AVERAGE', start, end)
    rng = rrd_rows('dump1090_range-max_range', 'MAX', start, end)
    sig = rrd_rows('dump1090_dbfs-signal', 'AVERAGE', start, end)
    g = lambda d, t: (d.get(t) or [None])[0]
    rnd = lambda v, n: None if v is None else round(v, n)
    new = []
    for t in sorted(ac):
        a = ac[t]
        if a[0] is None:
            continue
        new.append([t, rnd(a[1], 0) if len(a) > 1 else None, rnd(a[0], 0), rnd(g(msg, t), 1),
                    rnd(None if g(rng, t) is None else g(rng, t) / 1852.0, 1), rnd(g(sig, t), 1), rnd(g(pos, t), 2)])
    hist['samples'] = new + hist['samples']
    return len(new)


# ---- weather feed -----------------------------------------------------------------------------------------------
# aviationweather.gov sends no CORS headers, so browsers cannot call it. Every WX_INTERVAL seconds this thread fetches
# METAR and TAF for ONE bounding box (whole degrees, about +-3 around the receiver; never written to any file) and
# writes OUT/wx.json: {v, fetched_at, stations: {ICAO: {m: metar, t: taf}}}. Switch off with SW_WX=0.
WX = os.environ.get('SW_WX', '1') != '0'
WX_INTERVAL = max(300, int(os.environ.get('SW_WX_INTERVAL', '300')))
WX_PAD = int(os.environ.get('SW_WX_PAD', '3'))
WX_URL = 'https://aviationweather.gov/api/data'
UA = 'skywatch-adsb-recorder/0.1 (+https://github.com/CaptainAarav/skywatch-adsb)'


def wx_box():
    """-> (lat0, lon0, lat1, lon1) in whole degrees. SW_WX_BOX overrides; otherwise derived from receiver.json."""
    o = os.environ.get('SW_WX_BOX')
    if o:
        return [int(float(x)) for x in o.split(',')]
    r = get('receiver.json')
    lat, lon = float(r['lat']), float(r['lon'])
    return [max(-90, math.floor(lat) - WX_PAD), max(-180, math.floor(lon) - WX_PAD),
            min(90, math.ceil(lat) + WX_PAD), min(180, math.ceil(lon) + WX_PAD)]


def wx_fetch(kind, box):
    url = f'{WX_URL}/{kind}?bbox={",".join(str(x) for x in box)}&format=json'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
        if r.status == 204:
            return []
        return json.loads(r.read().decode())


def wx_clouds(cl):
    return [[c.get('cover'), c.get('base')] for c in (cl or []) if isinstance(c, dict)]


def wx_pack(metars, tafs):
    st = {}
    for m in sorted(metars, key=lambda x: x.get('obsTime') or 0):          # latest observation per station wins
        k = m.get('icaoId')
        if not k:
            continue
        st.setdefault(k, {})['m'] = {
            'raw': m.get('rawOb'), 'obs': m.get('obsTime'), 'wdir': m.get('wdir'), 'wspd': m.get('wspd'),
            'wgst': m.get('wgst'), 'vis': m.get('visib'), 'qnh': m.get('altim'), 'temp': m.get('temp'),
            'dew': m.get('dewp'), 'clouds': wx_clouds(m.get('clouds')), 'cat': m.get('fltCat'), 'wx': m.get('wxString')}
    for t in sorted(tafs, key=lambda x: x.get('issueTime') or ''):
        k = t.get('icaoId')
        if not k:
            continue
        st.setdefault(k, {})['t'] = {
            'raw': t.get('rawTAF'), 'issue': t.get('issueTime'), 'from': t.get('validTimeFrom'), 'to': t.get('validTimeTo'),
            'f': [{'from': f.get('timeFrom'), 'to': f.get('timeTo'), 'chg': f.get('fcstChange'), 'prob': f.get('probability'),
                   'wdir': f.get('wdir'), 'wspd': f.get('wspd'), 'wgst': f.get('wgst'), 'vis': f.get('visib'),
                   'clouds': wx_clouds(f.get('clouds')), 'vv': f.get('vertVis')} for f in (t.get('fcsts') or [])]}
    return st


def wx_loop():
    path = os.path.join(OUT, 'wx.json')
    backoff = 0
    while True:
        wait = WX_INTERVAL
        try:
            box = wx_box()
            m = wx_fetch('metar', box)
            time.sleep(3)                                  # the API allows 100 requests a minute; we make 2 every 5
            t = wx_fetch('taf', box)
            save(path, {'v': 1, 'fetched_at': int(time.time()), 'stations': wx_pack(m, t)})
            backoff = 0
        except urllib.error.HTTPError as e:
            if e.code == 429:
                backoff = min(3600, max(600, backoff * 2))
                wait = backoff
            print('recorder: weather fetch failed:', e, file=sys.stderr, flush=True)
        except Exception as e:
            print('recorder: weather fetch failed:', e, file=sys.stderr, flush=True)
        time.sleep(wait)


# ---------------------------------------------------------------------------------------------
# Optional alert sender (ntfy). Off unless the config file exists. See docs/ALERTS.md.
# The message carries callsign, registration, type, altitude and the reason. It never carries
# the receiver position or any distance from it.
# ---------------------------------------------------------------------------------------------
ALERT_CFG = os.environ.get('SW_ALERTS', '/etc/skywatch/skywatch-alerts.json')
EMERGENCY_SQ = {'7500': 'hijack', '7600': 'radio failure', '7700': 'general emergency'}


def alerts_config(path=None):
    """Return the parsed config, or None when alerts are off (missing, unreadable or enabled:false)."""
    path = path or ALERT_CFG
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            cfg = json.load(f)
    except Exception as e:
        print('recorder: alerts config unreadable:', e, file=sys.stderr, flush=True)
        return None
    if not isinstance(cfg, dict) or cfg.get('enabled', True) is False or not isinstance(cfg.get('ntfy'), dict):
        return None
    if not cfg['ntfy'].get('topic'):
        return None
    return cfg


def alert_reason(ac, rules):
    """Why this aircraft matches one of the rules, or None. Rule types: emergency, military, interesting,
    hex, reg, callsign_prefix, type."""
    hexid = str(ac.get('hex', '')).lower().lstrip('~')
    flight = str(ac.get('flight', '')).strip().upper()
    reg = str(ac.get('r', '')).strip().upper()
    typ = str(ac.get('t', '')).strip().upper()
    sq = str(ac.get('squawk', ''))
    flags = ac.get('dbFlags') or 0
    for r in rules:
        k, v = r.get('type'), str(r.get('value', '')).strip()
        if k == 'emergency' and (sq in EMERGENCY_SQ or ac.get('emergency') not in (None, 'none')):
            return 'emergency squawk ' + sq + (' (' + EMERGENCY_SQ[sq] + ')' if sq in EMERGENCY_SQ else '')
        if k == 'military' and flags & 1:
            return 'military aircraft'
        if k == 'interesting' and flags & 2:
            return 'interesting aircraft'
        if not v:
            continue
        if k == 'hex' and hexid == v.lower():
            return 'hex ' + v.upper()
        if k == 'reg' and reg == v.upper():
            return 'registration ' + reg
        if k == 'callsign_prefix' and flight.startswith(v.upper()):
            return 'callsign ' + v.upper() + '*'
        if k == 'type' and typ == v.upper():
            return 'type ' + typ
    return None


def in_quiet_hours(cfg, now=None):
    q = cfg.get('quiet_hours')
    if not isinstance(q, dict):
        return False
    try:
        from datetime import datetime
        tz = None
        if q.get('tz'):
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(q['tz'])
        t = datetime.fromtimestamp(now if now is not None else time.time(), tz)
        cur = t.hour * 60 + t.minute
        sh, sm = map(int, str(q['start']).split(':'))
        eh, em = map(int, str(q['end']).split(':'))
        a, b = sh * 60 + sm, eh * 60 + em
        return (a <= cur < b) if a <= b else (cur >= a or cur < b)
    except Exception as e:
        print('recorder: bad quiet_hours, ignoring:', e, file=sys.stderr, flush=True)
        return False


def ascii_header(s):
    return re.sub(r'[^\x20-\x7e]', '?', str(s))[:200]


def alert_message(ac, reason):
    flight = str(ac.get('flight', '')).strip() or str(ac.get('hex', '')).upper()
    parts = [flight]
    reg, typ = ac.get('r'), ac.get('t')
    if reg or typ:
        parts.append(' '.join(x for x in (reg, typ) if x))
    alt = ac.get('alt_baro')
    parts.append('on the ground' if alt == 'ground' else (str(int(alt)) + ' ft' if isinstance(alt, (int, float)) else 'altitude unknown'))
    return flight + ': ' + reason, ' | '.join(parts)


class AlertState:
    def __init__(self):
        self.seen = {}        # (hex, reason) -> last sent
        self.sent = []        # timestamps for the hourly limit

    def due(self, cfg, hexid, reason, now):
        if in_quiet_hours(cfg, now):
            return False
        ded = max(1, int(cfg.get('dedupe_minutes', 30))) * 60
        if now - self.seen.get((hexid, reason), 0) < ded:
            return False
        self.sent = [t for t in self.sent if now - t < 3600]
        if len(self.sent) >= int(cfg.get('max_per_hour', 10)):
            return False
        return True

    def mark(self, hexid, reason, now):
        self.seen[(hexid, reason)] = now
        self.sent.append(now)
        if len(self.seen) > 2000:
            self.seen = {k: t for k, t in self.seen.items() if now - t < 7200}


def ntfy_send(cfg, title, body, priority=3):
    n = cfg['ntfy']
    url = n.get('url', 'https://ntfy.sh').rstrip('/') + '/' + n['topic']
    h = {'User-Agent': UA, 'Title': ascii_header(title), 'Priority': str(priority), 'Tags': 'airplane'}
    tok = os.environ.get('SW_NTFY_TOKEN') or n.get('token')
    if tok:
        h['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url, data=body.encode('utf-8'), headers=h, method='POST')
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status


def alerts_tick(cfg, st, aircraft, now=None, send=ntfy_send):
    """One pass over the current aircraft; returns the list of (title, body) actually sent."""
    now = time.time() if now is None else now
    out = []
    for ac in aircraft:
        reason = alert_reason(ac, cfg.get('rules', []))
        if not reason:
            continue
        hexid = str(ac.get('hex', ''))
        if not st.due(cfg, hexid, reason, now):
            continue
        title, body = alert_message(ac, reason)
        try:
            send(cfg, title, body, 5 if reason.startswith('emergency') else 3)
        except Exception as e:
            print('recorder: alert send failed:', e, file=sys.stderr, flush=True)
            st.seen[(hexid, reason)] = now - max(1, int(cfg.get('dedupe_minutes', 30))) * 60 + 120   # retry in 2 min
            continue
        st.mark(hexid, reason, now)
        out.append((title, body))
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    hp, pp = os.path.join(OUT, 'history.json'), os.path.join(OUT, 'polar.json')
    hist = load(hp, {'v': 1, 'interval': INTERVAL, 'fields': FIELDS, 'samples': []})
    polar = load(pp, {'v': 1, 'bins': BINS, 'hours': {}})
    hist['fields'] = FIELDS
    n = backfill(hist)
    print(f'recorder: {SRC} -> {OUT}, {len(hist["samples"])} samples on disk (+{n} backfilled from graphs1090 rrd)', flush=True)
    if WX:
        threading.Thread(target=wx_loop, daemon=True).start()
    alert_state = AlertState()
    nxt = time.time()
    while True:
        try:
            cfg = alerts_config()
        except Exception:
            cfg = None
        try:
            s, bins = sample()
            if cfg:
                alerts_tick(cfg, alert_state, LAST_AC)
            now = s[0]
            hist['samples'].append(s)
            hist['samples'] = [x for x in hist['samples'] if x[0] > now - KEEP]
            hist['interval'] = INTERVAL
            save(hp, hist)
            hr = str(now // 3600)
            cur = polar['hours'].setdefault(hr, [0.0] * BINS)
            polar['hours'][hr] = [max(a, b) for a, b in zip(cur, bins)]
            polar['hours'] = {k: v for k, v in polar['hours'].items() if int(k) * 3600 > now - KEEP}
            save(pp, polar)
        except Exception as e:
            print('recorder: sample failed:', e, file=sys.stderr, flush=True)
        nxt += INTERVAL
        time.sleep(max(1, nxt - time.time()))


if __name__ == '__main__':
    main()
