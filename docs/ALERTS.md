# Optional alerts (ntfy)

Alerts are **off** until you create a file named `skywatch-alerts.json` in the server's data folder (`/data` in the container, or `ALERTS_FILE`).
With no file, an unreadable file, `"enabled": false`, or no ntfy topic, nothing is ever sent. With `PUBLIC_DEMO=1` (or `"publicDemo": true`
in `/data/skywatch-config.json`) alerts stay off even if the file exists.

The server checks the aircraft list once per sample interval (60 s) and sends a push notification through [ntfy](https://ntfy.sh) (the public
service, or your own ntfy server) when an aircraft matches one of your rules. The message carries the callsign, registration, type, altitude and the
reason. It never carries your receiver position or any distance from it.

## `skywatch-alerts.json`

```json
{
  "enabled": true,
  "ntfy": { "topic": "choose-a-long-random-topic-name", "url": "https://ntfy.sh" },
  "rules": [
    { "type": "emergency" },
    { "type": "military" },
    { "type": "interesting" },
    { "type": "hex", "value": "43c6f1" },
    { "type": "reg", "value": "G-EZBA" },
    { "type": "callsign_prefix", "value": "RRR" },
    { "type": "type", "value": "A388" }
  ],
  "dedupe_minutes": 30,
  "max_per_hour": 10,
  "quiet_hours": { "start": "22:00", "end": "06:00", "tz": "Europe/London" }
}
```

| Field | Meaning |
|---|---|
| `ntfy.topic` | Required. Anyone who knows the topic name can read the alerts, so make it long and random. |
| `ntfy.url` | Optional, default `https://ntfy.sh`. Use your own ntfy server's address if you run one. |
| `ntfy.token` | Optional access token for a protected topic. Better: set the `NTFY_TOKEN` environment variable so it is not in a file. It is never logged. |
| `rules[].type` | `emergency` (squawk 7500, 7600, 7700 or an emergency status), `military`, `interesting` (from the aircraft database flags), `hex`, `reg`, `callsign_prefix`, `type` (ICAO type code). The last four need a `value`. |
| `dedupe_minutes` | The same aircraft and reason is not sent again for this long (default 30). |
| `max_per_hour` | Overall limit per hour (default 10). |
| `quiet_hours` | Optional. No alerts between `start` and `end`; `tz` is an IANA zone name, default the server's own zone. |

Edit the file and the next sample picks the change up; no restart is needed. Remove the file to switch alerts off.

## Privacy

- No default topic or server is built in; nothing is sent until you create the file.
- Notifications go to the ntfy address in your file, and nowhere else.
- Run your own ntfy server if you do not want a third party to see the alert text.
