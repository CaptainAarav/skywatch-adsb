# python3 tools/test/test_recorder_movements.py
import importlib.util, os, json
spec = importlib.util.spec_from_file_location('rec', os.path.join(os.path.dirname(__file__), '../../scripts/skywatch-recorder.py'))
rec = importlib.util.module_from_spec(spec); spec.loader.exec_module(rec)

# synthetic airport: runway 09/27 along the equator-ish line, elevation 100 ft
LAT, LON = 51.0, 0.0
AP = rec.Airports([['TEST', 'TST', 0, 'Test Airport', LAT, LON, 100, 'GB', '', 'Testville', '', [['09', '27', 8000, 150, 'ASP', 1]], []],
                   ['FARX', '', 2, 'Far Field', 52.0, 1.0, 50, 'GB', '', 'Elsewhere', '', [['18', '36', 3000, 30, 'ASP', 0]], []]])
def nm_east(n): return LON + n / (60 * rec.math.cos(rec.math.radians(LAT)))
def ac(hexid, east_nm, alt, gs, trk, rate=0, **kw):
    d = {'hex': hexid, 'flight': 'TST%s' % hexid[-2:], 'r': 'G-' + hexid[:4].upper(), 't': 'A320', 'lat': LAT, 'lon': nm_east(east_nm), 'alt_baro': alt, 'gs': gs, 'track': trk, 'baro_rate': rate, 'seen': 1}
    d.update(kw); return d
def run(tr, frames, dt=10):
    out = []; t = 1_700_000_000
    for f in frames:
        out += tr.update(f, t); t += dt
    return out, t

# airport lookup
assert AP.near(LAT, nm_east(1))['icao'] == 'TEST' and AP.near(LAT, nm_east(5)) is None
assert rec.infer_runway(AP.by['TEST'], 92) == '09' and rec.infer_runway(AP.by['TEST'], 268) == '27' and rec.infer_runway(AP.by['TEST'], 180) is None

# 1. landing seen to touch down (ground report), approach heading west to east on runway 09
tr = rec.MovementTracker(AP)
fr = [[ac('aaa111', -2.8, 1000, 140, 90, -700)], [ac('aaa111', -1.5, 600, 135, 90, -700)], [ac('aaa111', -0.2, 150, 130, 90, -600)], [ac('aaa111', 0.5, 'ground', 90, 90)]]
out, _ = run(tr, fr); assert [(m['dir'], m['rwy'], m['airport']) for m in out] == [('landing', '09', 'TEST')], out

# 2. landing lost low near the runway (no ground report): needs LOST_S of silence
tr = rec.MovementTracker(AP)
out, t = run(tr, [[ac('bbb222', -2.5, 900, 140, 270, -700, lon=nm_east(2.5))], [ac('bbb222', 2.0, 400, 130, 270, -700)]])
assert out == []
assert [m['dir'] for m in tr.update([], t + 100)] == ['landing']

# 3. take-off: on the ground, then airborne climbing near the field
tr = rec.MovementTracker(AP)
out, _ = run(tr, [[ac('ccc333', -1.0, 'ground', 5, 90)], [ac('ccc333', 0.0, 'ground', 120, 90)], [ac('ccc333', 1.2, 700, 160, 90, 2000)]])
assert [(m['dir'], m['rwy']) for m in out] == [('takeoff', '09')], out

# 4. take-off first seen low and climbing
tr = rec.MovementTracker(AP)
out, _ = run(tr, [[ac('ddd444', 1.5, 900, 170, 90, 2200)], [ac('ddd444', 3.5, 2500, 190, 90, 2000)]])
assert [m['dir'] for m in out] == ['takeoff'], out

# 5. go-around: descends to 300 ft AGL, climbs away, stays tracked: nothing
tr = rec.MovementTracker(AP)
out, t = run(tr, [[ac('eee555', -2.0, 900, 140, 90, -700)], [ac('eee555', -0.5, 400, 135, 90, -600)], [ac('eee555', 1.0, 700, 150, 90, 1500)], [ac('eee555', 2.5, 2200, 170, 90, 2500)]])
assert out == []
assert tr.update([], t + 100) == [] and tr.update([], t + 200) == [], 'a go-around that left coverage high is not a landing'

# 6. overflight: 2500 ft over the field and a low fast pass, both tracked throughout: nothing
tr = rec.MovementTracker(AP)
out, t = run(tr, [[ac('fff666', -3, 2500, 250, 90)], [ac('fff666', 0, 2500, 250, 90)], [ac('fff666', 3, 2500, 250, 90)], [ac('ggg777', -2, 800, 250, 90, 0)], [ac('ggg777', 0, 800, 250, 90, 0)], [ac('ggg777', 2, 800, 250, 90, 0)]])
assert out == []
assert tr.update([], t + 120) == [], 'a level fast low pass that drops out of coverage is not a landing'

# 7. taxiing, then silence (switched off) or parked: nothing
tr = rec.MovementTracker(AP)
out, t = run(tr, [[ac('hhh888', 0.2, 'ground', 12, 180)], [ac('hhh888', 0.2, 'ground', 0, 180)]])
assert out == [] and tr.update([], t + 200) == []

# 8. dedupe: the same landing is not repeated within 20 minutes; stale positions and far airports ignored
tr = rec.MovementTracker(AP)
a = [ac('iii999', -1, 300, 130, 90, -600)]; g = [ac('iii999', 0.3, 'ground', 80, 90)]
out, t = run(tr, [a, g]); assert len(out) == 1
tr.st.clear(); out2 = tr.update(a, t + 10) + tr.update(g, t + 20); assert out2 == []
assert rec.MovementTracker(AP).update([ac('jjj000', -1, 'ground', 0, 90, seen_pos=99)], 1_700_000_000) == []
far = ac('kkk111', 0, 300, 100, 90); far['lat'] = 53.5
assert rec.MovementTracker(AP).update([far], 1) == []

# 9. entries never carry position or distance
m = out[0]; assert set(m) == {'t', 'callsign', 'reg', 'type', 'airport', 'dir', 'rwy'}, m
print('recorder movement tests ok')
