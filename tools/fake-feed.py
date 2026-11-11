#!/usr/bin/env python3
"""Fake receiver for testing: serves html/ plus a synthetic, moving data/aircraft.json on its own port.
It never touches the real receiver, readsb or ultrafeeder. Usage: python3 tools/fake-feed.py [port=8098] [count=30]
Open http://127.0.0.1:8098/ ; the smoke check works against it: SITE_URL=http://127.0.0.1:8098 tools/run-checks.sh --only live-smoke (see run-checks.sh for SITE_URL).
Aircraft fly straight lines (some circle, some climb/descend, a few without position), every field readsb emits that the UI uses."""
import http.server, json, math, os, random, sys, time, urllib.request
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8098
N = int(sys.argv[2]) if len(sys.argv) > 2 else 30
LAT, LON = 51.5, -1.0       # a generic location, deliberately not the real receiver
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'html')
T0 = time.time()
DBDIR = '/db-3.14.1725/'     # the real server rewrites db2/ to a versioned folder when it installs the page; ours is served raw, so map it (read-only GET from the real local site)
try:
    import re
    DBDIR = '/' + re.search(r'(db-[0-9.]+)/', urllib.request.urlopen('http://127.0.0.1:8096/', timeout=5).read().decode()).group(1) + '/'
except Exception: pass
random.seed(42)
TYPES = [('A320', 'A3', 'narrow'), ('B738', 'A3', ''), ('B77W', 'A5', ''), ('E190', 'A3', ''), ('C172', 'A1', ''), ('AT72', 'A3', ''), ('A388', 'A5', ''), ('C56X', 'A2', ''), ('EC35', 'A7', ''), ('PA34', 'A1', ''), ('A359', 'A5', ''), ('B789', 'A5', '')]
CALL = ['BAW', 'EZY', 'RYR', 'VIR', 'DLH', 'AFR', 'KLM', 'UAE', 'TOM', 'WZZ']
PLANES = []
for i in range(N):
    t, cat, _ = TYPES[i % len(TYPES)]
    ang = random.uniform(0, 2 * math.pi); r = random.uniform(5, 140)          # km from the receiver
    PLANES.append(dict(hex='%06x' % (0x400000 + i * 977), flight='%s%d' % (random.choice(CALL), 100 + i * 7), t=t, category=cat,
        lat0=LAT + r * math.cos(ang) / 111.0, lon0=LON + r * math.sin(ang) / (111.0 * math.cos(math.radians(LAT))),
        hdg=random.uniform(0, 360), gs=(90 if cat in ('A1', 'A7') else random.uniform(200, 480)), alt=(1500 if cat in ('A1', 'A7') else random.choice([3000, 8000, 15000, 24000, 33000, 37000, 40000])),
        vr=random.choice([0, 0, 0, 1500, -1800]), circle=(i % 7 == 3), nopos=(i % 11 == 10), squawk='%04d' % random.randint(1000, 7000)))
def aircraft():
    t = time.time() - T0; out = []
    for p in PLANES:
        hdg = p['hdg'] + (t * 3 if p['circle'] else 0)
        d = p['gs'] * 0.514444 * t / 1000.0                                      # km flown
        d = d % 400
        lat = p['lat0'] + d * math.cos(math.radians(hdg)) / 111.0
        lon = p['lon0'] + d * math.sin(math.radians(hdg)) / (111.0 * math.cos(math.radians(lat)))
        alt = max(0, p['alt'] + p['vr'] * t / 60.0 % 4000)
        a = dict(hex=p['hex'], type='adsb_icao', flight=p['flight'].ljust(8), alt_baro=int(alt), alt_geom=int(alt + 100), gs=round(p['gs'], 1), track=round(hdg % 360, 1),
                 baro_rate=p['vr'], squawk=p['squawk'], category=p['category'], t=p['t'], messages=int(t * 3) + 100, seen=round(random.uniform(0, 0.8), 1), rssi=round(random.uniform(-28, -8), 1))
        if not p['nopos']: a.update(lat=round(lat, 5), lon=round(lon, 5), seen_pos=round(random.uniform(0, 0.8), 1), nic=8, rc=186)
        out.append(a)
    return out
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=ROOT, **k)
    _head = False
    def body(s, b):
        if not s._head: s.wfile.write(b)
    def send_json(s, o):
        b = json.dumps(o).encode(); s.send_response(200); s.send_header('Content-Type', 'application/json'); s.send_header('Cache-Control', 'no-cache'); s.send_header('Content-Length', str(len(b))); s.end_headers(); s.body(b)
    def do_GET(s):
        p = s.path.split('?')[0]
        if p == '/data/aircraft.json': return s.send_json({'now': time.time(), 'messages': int((time.time() - T0) * 400), 'aircraft': aircraft()})
        if p == '/data/receiver.json': return s.send_json({'refresh': 1000, 'history': 0, 'lat': LAT, 'lon': LON, 'jaeroTimeout': 720.0, 'readsb': True, 'haveReplay': False, 'binCraft': False, 'zstd': False, 'outlineJson': False, 'version': 'fake-feed'})
        if p == '/chunks/chunks.json': return s.send_json({'chunks': [], 'chunks_all': [], 'pos_stale': False})
        if p.startswith(('/db2/', '/globe_history/', '/graphs1090/')):            # static files the real server provides: read-only GET from the real local site
            try:
                r = urllib.request.urlopen('http://127.0.0.1:8096' + (DBDIR + s.path[5:] if s.path.startswith('/db2/') else s.path), timeout=5); b = r.read(); s.send_response(200); s.send_header('Content-Type', r.headers.get('Content-Type', 'application/octet-stream'))
                if r.headers.get('Content-Encoding'): s.send_header('Content-Encoding', r.headers['Content-Encoding'])
                s.send_header('Content-Length', str(len(b))); s.end_headers(); s.body(b)
            except Exception: s.send_response(404); s.end_headers()
            return
        if p.startswith('/data/'): s.send_response(404); s.end_headers(); return
        return super().do_HEAD() if s._head else super().do_GET()
    def do_HEAD(s):                                                              # same routing as GET; headers go out, the body is dropped after end_headers
        s._head = True
        try: H.do_GET(s)
        finally: s._head = False
    def log_message(s, *a): pass
if __name__ == '__main__':
    print('fake feed: %d aircraft on http://127.0.0.1:%d/ (Ctrl-C stops)' % (N, PORT), flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
