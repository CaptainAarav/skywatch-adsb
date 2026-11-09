# Skywatch ADS-B

**A map-first web interface for your own ADS-B receiver: airports with live weather, a command palette, alerts, 3D with real terrain, and nothing that leaves your receiver you did not choose.**

<!-- demo: short GIF/MP4 goes here (not recorded yet) -->

> **Built on [tar1090](https://github.com/wiedehopf/tar1090) by [wiedehopf](https://github.com/wiedehopf).** Skywatch ADS-B is a fork:
> the decoder integration, history, traces and data handling are wiedehopf's and the tar1090 contributors' work, and the
> upstream licence (GPL v2 or later) is kept. Please support upstream first. Created by Aarav Sahni.

## What it looks like

Each item names what to look for; screenshots will be added.

- **Airport panel** (click an airport, or press Ctrl/Cmd-K and type a code): METAR and TAF with flight category, runways with wind components and the best end, local traffic, frequencies, sun times, recent movements. <!-- screenshot: airport panel -->
- **Airports at night**: a dark airfield with runway markings, taxiways, stop bars, runway, approach and taxiway lights and PAPI, drawn on the GPU from OpenStreetMap and OurAirports data. <!-- screenshot: airport at night -->
- **Pins with weather**: airport pins ringed by flight category (green VFR, amber MVFR, red IFR and LIFR); hover or long-press for a mini METAR. <!-- screenshot: pins with weather -->
- **Instrument panel** for the selected aircraft: altitude and speed gauges, wind compass, attitude and autopilot cards when broadcast, altitude profile. <!-- screenshot: instrument panel -->
- **3D view** with altitude lift and optional real terrain (elevation tiles, hillshade). <!-- screenshot: 3D with terrain -->
- **Command palette** (Ctrl/Cmd-K): aircraft by callsign, registration, hex or type; airports by code or name, nearest first; actions such as 3D, north up, settings. <!-- screenshot: command palette -->
- **Alerts** (Settings > Alerts): watch a registration, hex, callsign prefix, type, military, emergency squawks. <!-- screenshot: alerts -->
- **Graphs** with a Coverage plot (range by bearing), and a two-hour **rain radar** playback (off by default). <!-- screenshot: graphs -->
- Replay bar, smooth movement, phone layout, selecting an aircraft zooms to its flight path and follows it.

## Works with

Anything that produces the tar1090 data format: [readsb](https://github.com/wiedehopf/readsb),
[ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder), dump1090-fa. Developed and tested
against ultrafeeder (readsb 3.16) and headless Chromium only.

## Install with ultrafeeder

1. Clone this repository on the host that runs ultrafeeder:

   ```
   git clone https://github.com/CaptainAarav/skywatch-adsb.git
   ```
2. In your ultrafeeder service, mount the clone **read-only** at `/var/tar1090_git_source` and keep `UPDATE_TAR1090=true`.
   Leave the rest of your configuration (decoder, location, feeders) as it is:

   ```yaml
   services:
     ultrafeeder:
       image: ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder
       volumes:
         - /path/to/skywatch-adsb:/var/tar1090_git_source:ro
       environment:
         - UPDATE_TAR1090=true
         - TAR1090_PAGETITLE=Skywatch ADS-B      # optional: browser tab title
         - TAR1090_SITESHOW=false                # keep your receiver marker off for a public site
   ```
   The usual `TAR1090_*` variables (`TAR1090_DEFAULTCENTERLAT`, `TAR1090_DEFAULTCENTERLON`, `TAR1090_DEFAULTZOOMLVL`, ...) keep working.
3. Recreate the container: `docker compose up -d`.
4. Hard-refresh the browser (Ctrl+Shift+R).
5. **Confirm it is this interface**: the page shows the floating glass toolbar, `curl -s http://HOST:PORT/ | grep -c ui/palette-rank` prints `1`, and `curl -s http://HOST:PORT/version.json` shows a version ending in `_dirty` (that is how a mounted source tree is reported; stock tar1090 shows no suffix).

**Roll back to stock tar1090:** remove the `/var/tar1090_git_source` volume line and run `docker compose up -d --force-recreate ultrafeeder`. The container then installs upstream tar1090 again. Your `TAR1090_*` variables and the receiver data are untouched.

To deploy later changes to this clone without recreating the container: `scripts/deploy-local.sh` (variables `CONTAINER`, default `ultrafeeder`, and `SITE_URL`, default `http://127.0.0.1:8096`).

## Already running tar1090?

| Scenario | Tested here? |
|---|---|
| a) ultrafeeder | **Yes**, this is how the author runs it (and the steps above were repeated from a clean clone of this repository in a separate container and port) |
| b) tar1090 installed with wiedehopf's `install.sh` | **No** |
| c) the sdr-enthusiasts `docker-tar1090` container | **No** |

**a) ultrafeeder.** Exactly the install above. Tested on 2026-11-09 from a fresh clone of this repository in a separate container on another port (page title and files served; then rollback by recreating without the mount returned stock tar1090 3.14.1825). What changes: the web files served at `/`. What stays: the decoder, `TAR1090_*` settings, `globe_history` traces and your feeders. Rollback: remove the volume line and recreate (above).

**b) Standalone tar1090 (untested).** `install.sh` takes an optional fourth argument, a local source tree to install instead of pulling upstream:

```
git clone https://github.com/CaptainAarav/skywatch-adsb.git
cd skywatch-adsb
sudo bash install.sh /run/readsb tar1090 /usr/local/share/tar1090 "$PWD"
```
(use the same data directory, web path and install path your current install has; the three values shown are the script's defaults). The script rewrites the web files under the install path and leaves `/etc/default/tar1090` (your settings), the decoder and the history data alone. **Check before you rely on it:** if you also have the periodic update enabled, it fetches upstream again and replaces this interface; look at `systemctl list-timers | grep tar1090` and disable it if you want to stay on this fork. To go back to upstream, run the stock command from [wiedehopf's README](https://github.com/wiedehopf/tar1090#installation) (`sudo bash -c "$(wget -nv -O - https://github.com/wiedehopf/tar1090/raw/master/install.sh)"`).

**c) `docker-tar1090` (untested).** That image is built on the same install script, but I have not tried it with this repository. If it supports a bind-mounted source directory in the same way ultrafeeder does, mount this clone there; otherwise copy the `html/` directory over the web root inside the container. Check that image's documentation first.

## Keeping up with upstream

The history contains tar1090's own commits, so upstream can be merged:

```
git remote add upstream https://github.com/wiedehopf/tar1090.git
git fetch upstream
git merge upstream/master
```

Expect conflicts in `html/index.html`, `html/script.js` and `html/style.css`, which this fork changed heavily. Resolve them, then run `scripts/deploy-local.sh` and test.

## Differences from stock tar1090

- A different interface (floating glass panels, new settings dialog, instrument panel, phone layout) and a MapLibre GL map instead of OpenLayers. Settings are stored per browser under new keys, so your old browser settings do not carry over.
- Map tiles come from OpenFreeMap through our own style (VersaTiles as automatic fallback; CARTO opt-in). The old OpenStreetMap raster tiles are gone. The stock overlays remain.
- Extra features: airport panel and night-airfield detail, weather pins, command palette, alerts, terrain, coverage plot, recent movements. The recorder (below) is optional and powers graphs, weather, movements and server alerts.
- Aircraft icons are the stock shapes. Decoder, history, traces, filters and URL options behave as upstream.

## FAQ

- **The map is blank.** The tile provider may be unreachable or blocking you; a banner says when the map switched provider. Try another base map in Settings > Map. Airport detail needs `tiles.openfreemap.org`. WebGL must be enabled in the browser.
- **Graphs say "classic graphs1090 images" or nothing.** The recorder is not running. Set it up below, or keep using graphs1090.
- **The airport panel has no weather.** Weather comes from the recorder's `wx.json`; it is missing, older than 3 hours, or `airportWeather = false`. Check `docker logs skywatch-recorder`.
- **Recent movements are missing.** The recorder needs the airport list mounted (see below) and movements only appear for aircraft your receiver heard landing or taking off.
- **Alerts do not fire.** Browser alerts need the page open, the main Alerts switch on, a rule that matches, and are limited to 5 a minute and one per aircraft and rule every 30 minutes. Server alerts need `skywatch-alerts.json` mounted, valid JSON, a topic and an ntfy server that answers; see [docs/ALERTS.md](docs/ALERTS.md).
- **3D terrain is off or slow.** It defaults to off on phones and software rendering; turn it on in Settings > Appearance. Measure it on your hardware.

## Recorder (optional)

`scripts/skywatch-recorder.py` (Python standard library only) runs as a second compose service using the ultrafeeder image. It does four jobs:

1. **Graphs**: samples the receiver once a minute into `history.json` and `polar.json`. Only counts, message rate, maximum range, average signal and per-hour bearing and distance bins; **no coordinates, hex codes or callsigns**.
2. **Weather**: METAR and TAF from [aviationweather.gov](https://aviationweather.gov/data/api/) every 5 minutes into `wx.json` (one request each, for a box about 3 degrees around your receiver taken from `receiver.json`; override with `SW_WX_BOX=lat0,lon0,lat1,lon1`). `SW_WX=0` turns it off.
3. **Recent movements**: inferred landings and take-offs near airports into `movements.json` (rolling 24 hours: time, callsign, registration, type, airport, direction, runway; no receiver position). `SW_MOVES=0` turns it off. It needs the airport list mounted at `/opt/skywatch/airports.json`.
4. **Server alerts** (ntfy): off unless `skywatch-alerts.json` is mounted, see [docs/ALERTS.md](docs/ALERTS.md).

```yaml
  skywatch-recorder:
    image: ghcr.io/sdr-enthusiasts/docker-adsb-ultrafeeder
    restart: unless-stopped
    depends_on: [ultrafeeder]
    entrypoint: ["python3", "-u", "/opt/skywatch/skywatch-recorder.py"]
    environment:
      - SW_SRC=http://ultrafeeder/data
      - SW_OUT=/var/globe_history/skywatch
    volumes:
      - /path/to/skywatch-adsb/scripts/skywatch-recorder.py:/opt/skywatch/skywatch-recorder.py:ro
      - /path/to/skywatch-adsb/html/airport-db/airports.json:/opt/skywatch/airports.json:ro   # for movements
      - ./globe_history:/var/globe_history
      - ./graphs1090:/var/lib/collectd:ro   # optional: seeds the first week of graphs from graphs1090 data
```

Other variables: `SW_INTERVAL`, `SW_KEEP_DAYS`, `SW_RRD`, `SW_MOVE_INTERVAL`, `SW_ALERTS`. The polar plot reveals the bearing and range pattern around your receiver, so only publish it if that is acceptable.

## Configuration reference

All tar1090 options still apply (`html/defaults.js`, `html/config.js`, or `TAR1090_*` variables in ultrafeeder).
Options added or changed by this fork:

| Option | Default | Meaning |
|---|---|---|
| `PROJECT_NAME`, `PROJECT_SHORT`, `PROJECT_CREDIT` (`html/project.js`) | Skywatch ADS-B ... | Name and credit line shown in the UI, page title and manifest. |
| `airlineLogos` | `true` | Airline logos (sends airline codes to the logo host). |
| `airlineLogoUrl` | `https://pics.avs.io/al_square/{size}/{size}/{iata}.png` | Logo source. `{iata}` and `{size}` are replaced. |
| `airlineLogoKey` | empty | Key for the logo service if it needs one. Never commit a key. |
| `airportDetail` | `true` | Airport detail overlay (OpenFreeMap tiles). |
| `terrain3d` | `false` in `defaults.js`; the first-run default is on for desktop with a hardware GPU | Real terrain in the 3D view (elevation tiles from AWS Open Data). Settings has an exaggeration slider. |
| `planespottersAPI` | `true` | Aircraft photos from planespotters.net. |
| `useRouteAPI`, `routeApiUrl` | `false`, adsb.im | Route lookup. Off by default; set `routeApiUrl = ""` to forbid it. |
| `airportWeather`, `airportLinks` | `true` | Weather cards and external link buttons in the airport panel. |
| `airportPinWx` | `true` | Flight-category rings on airport pins and the hover card (needs the weather feed). |
| `SiteShow`, `actual_range_show` | `false` | Show the receiver marker and range outline. |

The receiver position drives the distance column, bearings and the instrument panel's receiver distance only when
`SiteShow` is on. Per-visitor settings (base map, map view, smooth movement and the switches above) are in Settings
and stored in the browser.

## Privacy: who sees what

**Each visitor's browser contacts these services directly**, and each sees the visitor's IP address and what is requested:

| Service | For | Can be turned off |
|---|---|---|
| OpenFreeMap / VersaTiles / CARTO | map tiles and styles | choose the base map; there is no map without tiles |
| AWS Open Data (s3.amazonaws.com) | elevation tiles, only in 3D with terrain on | yes (`terrain3d`, Settings) |
| RainViewer | rain radar frames, only while that overlay is on | off by default |
| pics.avs.io | airline logos (sends airline codes) | yes (`airlineLogos`) |
| planespotters.net | aircraft photos | yes (`planespottersAPI`) |
| adsb.im | flight routes (sends callsign and position) | off by default (`useRouteAPI`) |
| SkyVector, NATS AIP, Wikipedia | only when a visitor clicks a link in the airport panel | `airportLinks = false` |

**Your server contacts** aviationweather.gov (the recorder, for weather) and, only if you configure it, your ntfy server (alerts).

**Owner-only features and their risks**
- `receiver.json` and `aircraft.json` are public if your site is. `receiver.json` contains the receiver position unless your decoder hides it. Keep `SiteShow` and the range outline off if you do not want your location known.
- The Coverage plot (graphs) shows range by bearing, which hints at the surroundings of your receiver but contains no coordinates.
- Alert messages and `movements.json` never contain your position or a distance from it. The ntfy topic works like a password on a public ntfy server; keep `skywatch-alerts.json` out of git and the web root.
- Browser alert rules are stored only in the visitor's browser.

Airport data (`html/airport-db/airports.json`) comes from [OurAirports](https://ourairports.com/data/) (public domain), built by `tools/build-airports.py`; it has no ILS data, so none is shown.

## Providers and their terms

The terms found for each service, what was checked and what stayed unverified are in [THIRD_PARTY.md](THIRD_PARTY.md) (read it before running a public site; it also has a starting Content Security Policy). In short:

| Provider | Role | Terms in one line |
|---|---|---|
| OpenFreeMap | default map and airport tiles | free public instance, no key, no SLA, sponsorship requested |
| VersaTiles | fallback map | free, rate-limited per IP, commercial use unverified |
| CARTO | opt-in map | key and fair-use limits; never automatic |
| AWS Open Data Terrain Tiles | 3D terrain | keyless; attribution to the underlying elevation datasets required |
| RainViewer | rain radar | personal, educational and small community use; attribution; not for busy or commercial sites without asking |
| aviationweather.gov | METAR and TAF | rate-limited, fetched by your recorder only |
| pics.avs.io | airline logos | **no terms found** |
| planespotters.net | photos | credit shown; hotlinking volume not addressed |

## Running this publicly

- **Map tiles:** the default is OpenFreeMap (a free public service, donation funded, no SLA) through our own style
  file. If it fails the map switches to VersaTiles and shows a banner. For a busy site, host your own tiles (next section).
- **Visitor privacy:** the table above. Switch off logos, photos and route lookup if that is not acceptable.
- **Receiver position:** see the privacy section.

### Self-hosting your own tiles

Public tile servers are shared and can rate-limit you. When your site has regular visitors, or must survive a provider outage, serve tiles yourself:

1. OpenFreeMap publishes self-hosting instructions and images (https://github.com/hyperknot/openfreemap); it needs a server with a lot of disk (the planet is hundreds of GB).
2. For one region, create a PMTiles extract with the `pmtiles` CLI from a planet build and serve the single file from any static host that supports HTTP range requests.
3. Copy `html/styles/skywatch-dark.json`, change the `openmaptiles` source URL, `glyphs` and `sprite` to your server, then set `MapType_tar1090` to that layer. Not tested here; a starting point.

## Known limitations

- Visual quality was checked by the author by hand on one desktop; automated checks here were DOM and numbers only.
- Terrain has not been measured on a hardware GPU; in software rendering it is unusably slow (see docs/DEVELOPMENT.md).
- Airport detail depends on OpenStreetMap quality (stands, taxiway letters and runway numbers can be missing). Runway-in-use is inferred from a few minutes of traffic and can be wrong; the TAF strip is an approximation; the UK AIP link goes to the NATS landing page.
- Recent movements are inferred from what the receiver hears and can miss or mislabel flights (a low go-around that leaves coverage can look like a landing).
- Browser notifications work only while the page is open.
- The dashed route line has not been checked with a real looked-up route. Phone replay-bar touch scrubbing, long-press on pins and the phone layout were not tried on a real device.
- Only Chromium (headless) has been tested. The standalone `install.sh` path and docker-tar1090 are untested.
- The aircraft icons are the stock tar1090 shapes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md);
development notes: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Licence

GNU GPL v2 or later, as tar1090 (see [LICENSE](LICENSE), identical to upstream).

## Credits and support

- [wiedehopf](https://github.com/wiedehopf) and the tar1090 contributors: this project exists because of that work.
- Services this relies on for free, which you can support: [OpenFreeMap](https://openfreemap.org) (donations through their site and GitHub Sponsors), [VersaTiles](https://versatiles.org), [OpenStreetMap contributors](https://www.openstreetmap.org/fixthemap), [OurAirports](https://ourairports.com), [planespotters.net](https://www.planespotters.net), [RainViewer](https://www.rainviewer.com), AWS Open Data and the elevation sources named in [THIRD_PARTY.md](THIRD_PARTY.md).
- MapLibre GL JS, Inter, JetBrains Mono, Wikidata: see [THIRD_PARTY.md](THIRD_PARTY.md).
