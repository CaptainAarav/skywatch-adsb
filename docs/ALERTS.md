# Alerts

Skywatch has two independent alert paths. Use either or both.

## 1. In the browser (Settings > Alerts)

Rules: registration, hex code, callsign prefix, aircraft type designator, any military aircraft, emergency squawks (7500, 7600, 7700), and aircraft the database marks as interesting.

- Rules and switches are stored only in your browser (`localStorage`). Nothing is sent to the server.
- A matching aircraft shows a message with a **Select** button. The same aircraft and rule alert at most once every 30 minutes; at most five alerts appear per minute; **Snooze for 1 hour** and the main switch silence everything.
- **Browser notifications** are optional and ask for permission only when you turn them on. They work **only while the page is open** (this is a plain web page, not an installed app), so they are no replacement for the server sender below.
- **Soft sound** is off by default.

## 2. Server-side push through ntfy (optional, owner only)

The recorder can send a push message through an [ntfy](https://ntfy.sh) server when an aircraft matches. It is **off unless a config file exists**.

1. Create `~/adsb/skywatch-alerts.json` (the name is in `.gitignore`; never commit it, and never put it in the web root):

```json
{
  "enabled": true,
  "ntfy": { "url": "https://ntfy.example.org", "topic": "pick-a-long-random-topic" },
  "rules": [
    { "type": "emergency" },
    { "type": "military" },
    { "type": "type", "value": "A388" },
    { "type": "callsign_prefix", "value": "RRR" },
    { "type": "reg", "value": "G-ABCD" },
    { "type": "hex", "value": "43C123" },
    { "type": "interesting" }
  ],
  "quiet_hours": { "start": "23:00", "end": "07:00", "tz": "Europe/London" },
  "dedupe_minutes": 30,
  "max_per_hour": 10
}
```

2. Mount it into the `skywatch-recorder` service (back up your compose file first) and restart that service:

```yaml
    volumes:
      - ./skywatch-alerts.json:/etc/skywatch/skywatch-alerts.json:ro
```

The file must exist before you start the container (Docker would otherwise create a directory there). Use `SW_ALERTS=/other/path.json` to change where the recorder looks.

3. If your ntfy topic needs a token, set `SW_NTFY_TOKEN` in the recorder's environment, or put `"token"` under `ntfy` in the file. Keep both out of the repo.

Notes:

- The topic name acts like a password on public ntfy servers: pick a long random one.
- Messages contain the callsign, registration, type, altitude and the rule that matched. They **never contain your receiver position or any distance from it**.
- Quiet hours suppress messages (emergencies included). Alerts are checked once a minute, so a message can lag by up to a minute.
- A failed send is retried after about two minutes. Failures are logged by the recorder, never shown to visitors.
- Requests carry the user agent `skywatch-adsb-recorder/0.1 (+https://github.com/CaptainAarav/skywatch-adsb)`.
- Tests: `python3 tools/test/test_recorder_alerts.py`.
