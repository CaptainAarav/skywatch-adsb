#!/usr/bin/env python3
"""Skywatch ADS-B recorder: samples aircraft.json and stats.json once a minute into a rolling 7-day JSON file
that the web UI draws its Graphs from. Standard library only.

  history.json  {"v":1,"interval":60,"fields":[...],"samples":[[t, with_pos, total, msg_s, range_nm, rssi, pos_s], ...]}
  polar.json    {"v":1,"bins":36,"hours":{"<unix hour>":[max range nm per 10 degree bearing bin, ...]}}

Privacy: only distances and bearings relative to the receiver are stored (readsb's r_dst / r_dir); no coordinates
of the receiver or of any aircraft are written.

Environment: SW_SRC (default http://ultrafeeder/data), SW_OUT (default /var/globe_history/skywatch), SW_INTERVAL (60), SW_KEEP_DAYS (7).
"""
import json, os, shutil, subprocess, sys, time, urllib.request

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


def sample():
    ac = get('aircraft.json')
    lst = ac.get('aircraft', [])
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


def main():
    os.makedirs(OUT, exist_ok=True)
    hp, pp = os.path.join(OUT, 'history.json'), os.path.join(OUT, 'polar.json')
    hist = load(hp, {'v': 1, 'interval': INTERVAL, 'fields': FIELDS, 'samples': []})
    polar = load(pp, {'v': 1, 'bins': BINS, 'hours': {}})
    hist['fields'] = FIELDS
    n = backfill(hist)
    print(f'recorder: {SRC} -> {OUT}, {len(hist["samples"])} samples on disk (+{n} backfilled from graphs1090 rrd)', flush=True)
    nxt = time.time()
    while True:
        try:
            s, bins = sample()
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
