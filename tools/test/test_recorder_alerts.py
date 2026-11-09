# python3 tools/test/test_recorder_alerts.py
import importlib.util, json, os, sys, tempfile
spec = importlib.util.spec_from_file_location('rec', os.path.join(os.path.dirname(__file__), '../../scripts/skywatch-recorder.py'))
rec = importlib.util.module_from_spec(spec); spec.loader.exec_module(rec)

RULES = [{'type': 'emergency'}, {'type': 'type', 'value': 'a388'}, {'type': 'military'}, {'type': 'callsign_prefix', 'value': 'rrr'},
         {'type': 'reg', 'value': 'g-ABCD'}, {'type': 'hex', 'value': '43C123'}]
cfg = {'enabled': True, 'ntfy': {'url': 'https://ntfy.example', 'topic': 'secret-topic'}, 'rules': RULES, 'dedupe_minutes': 30, 'max_per_hour': 3}

# rule matching
assert rec.alert_reason({'hex': 'abc', 'squawk': '7700'}, RULES).startswith('emergency squawk 7700')
assert rec.alert_reason({'hex': 'abc', 'squawk': '1200', 't': 'A388'}, RULES) == 'type A388'
assert rec.alert_reason({'hex': 'abc', 'dbFlags': 1}, RULES) == 'military aircraft'
assert rec.alert_reason({'hex': 'abc', 'flight': 'RRR1234 '}, RULES) == 'callsign RRR*'
assert rec.alert_reason({'hex': 'abc', 'r': 'G-ABCD'}, RULES) == 'registration G-ABCD'
assert rec.alert_reason({'hex': '43c123'}, RULES) == 'hex 43C123'
assert rec.alert_reason({'hex': 'abc', 'squawk': '1200', 't': 'A320', 'flight': 'BAW1'}, RULES) is None
assert rec.alert_reason({'hex': 'abc', 'dbFlags': 2}, [{'type': 'interesting'}]) == 'interesting aircraft'
assert rec.alert_reason({'hex': 'abc', 'dbFlags': 2}, [{'type': 'hex', 'value': ''}]) is None   # empty value never matches

# message never carries position or distance
t, b = rec.alert_message({'hex': 'abc', 'flight': 'BAW1', 'r': 'G-X', 't': 'A320', 'alt_baro': 12000, 'lat': 52.0, 'lon': -0.7, 'r_dst': 12.3}, 'type A320')
assert t == 'BAW1: type A320' and b == 'BAW1 | G-X A320 | 12000 ft', (t, b)
assert '52.0' not in b and '12.3' not in b and 'nm' not in b

# synthetic 7700 + type rule, dedupe, rate limit
sent = []
send = lambda c, title, body, pr: sent.append((title, body, pr))
st = rec.AlertState()
ac7700 = {'hex': 'aaa111', 'flight': 'EMG1', 'squawk': '7700', 'alt_baro': 5000}
acA388 = {'hex': 'bbb222', 'flight': 'UAE9', 't': 'A388', 'alt_baro': 'ground'}
T0 = 1_700_000_000
assert len(rec.alerts_tick(cfg, st, [ac7700, acA388], T0, send)) == 2
assert sent[0][2] == 5 and sent[1][2] == 3 and 'on the ground' in sent[1][1]
assert rec.alerts_tick(cfg, st, [ac7700], T0 + 600, send) == []               # deduped within 30 min
assert len(rec.alerts_tick(cfg, st, [ac7700], T0 + 31 * 60, send)) == 1       # after dedupe window
assert rec.alerts_tick(cfg, st, [{'hex': 'ccc333', 'squawk': '7600'}], T0 + 32 * 60, send) == []   # 3/hour cap reached
assert len(rec.alerts_tick(cfg, st, [{'hex': 'ccc333', 'squawk': '7600'}], T0 + 3700, send)) == 1  # window rolled

# a failing sender retries later and does not raise
def boom(*a): raise OSError('down')
st2 = rec.AlertState()
assert rec.alerts_tick(cfg, st2, [ac7700], T0, boom) == []
assert rec.alerts_tick(cfg, st2, [ac7700], T0 + 30, boom) == []               # still inside the 2 min back-off
assert len(rec.alerts_tick(cfg, st2, [ac7700], T0 + 150, send)) == 1

# quiet hours (overnight window, fixed zone)
q = dict(cfg, quiet_hours={'start': '23:00', 'end': '07:00', 'tz': 'UTC'})
assert rec.in_quiet_hours(q, 1_700_000_000 - 1_700_000_000 % 86400 + 23 * 3600 + 60)
assert rec.in_quiet_hours(q, 1_700_000_000 - 1_700_000_000 % 86400 + 3 * 3600)
assert not rec.in_quiet_hours(q, 1_700_000_000 - 1_700_000_000 % 86400 + 12 * 3600)
st3 = rec.AlertState(); day = 1_700_000_000 - 1_700_000_000 % 86400
assert rec.alerts_tick(q, st3, [ac7700], day + 2 * 3600, send) == []
assert len(rec.alerts_tick(q, st3, [ac7700], day + 12 * 3600, send)) == 1
assert not rec.in_quiet_hours(dict(cfg, quiet_hours={'start': 'x', 'end': 'y'}), T0)   # bad config does not crash

# config loading: missing / disabled / no topic / ok
d = tempfile.mkdtemp(); p = os.path.join(d, 'a.json')
assert rec.alerts_config(p) is None
json.dump(dict(cfg, enabled=False), open(p, 'w')); assert rec.alerts_config(p) is None
json.dump({'enabled': True, 'ntfy': {}}, open(p, 'w')); assert rec.alerts_config(p) is None
open(p, 'w').write('{nope'); assert rec.alerts_config(p) is None
json.dump(cfg, open(p, 'w')); assert rec.alerts_config(p)['ntfy']['topic'] == 'secret-topic'

# header hygiene and request shape
seen = {}
class FakeResp:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *a): pass
rec.urllib.request.urlopen = lambda req, timeout=0: (seen.update(url=req.full_url, h=dict(req.header_items()), data=req.data), FakeResp())[1]
rec.ntfy_send(cfg, 'Tést', 'body', 4)
assert seen['url'] == 'https://ntfy.example/secret-topic' and seen['h']['User-agent'].startswith('skywatch-adsb-recorder/') and seen['data'] == b'body'
assert 'Authorization' not in seen['h']
os.environ['SW_NTFY_TOKEN'] = 'tk'; rec.ntfy_send(cfg, 'T', 'b'); assert seen['h']['Authorization'] == 'Bearer tk'
print('recorder alerts tests ok')
