# Changelog

## Unreleased

- **Airport click reliability.** Cause: opening an airport from a map marker while an aircraft panel was open closed that panel, and the close scheduled `MLR.clearFocus()` (a `jumpTo`) in a `setTimeout(0)` that cancelled the airport `easeTo` that had just started; follow mode also re-centred over the move, and the camera padding left by the aircraft focus doubled the airport offset. Fix: ONE `AIRPT.open(rowOrCode, from, source)` for the marker, the route block, search, the palette and `?airport=ICAO`, with ONE fly policy (`AIRPT.fly`: target zoom by tier, panel padding, camera stopped first, follow ended and restored by the Back chip, camera resets blocked while it runs). Markers are also hit-tested from the airport DATA, so a label-hidden marker still opens, and an airport marker wins over the (wider) aircraft hit radius. New test `airport-click` (both entry points, 20+ states).
- **3D performance.** Device-independent counters (`ui/perf-counters.js`: draw calls, triangles, texture uploads, tiles in flight, symbol layers/instances, query rates, canvas size) in the `?perf=1` overlay and its JSON report, with the GPU renderer string and a software-renderer notice that forces the Low tier. Settings > Map "3D quality": Auto / High / Balanced / Low, an Auto controller (p95 over 3 s, hysteresis, no flapping) over an 8-step ladder (`ui/quality-calc.js`, `ui/maplibre-quality.js`). Pixel ratio capped for 3D and big canvases; hover work throttled to one pass per frame and skipped while the camera moves; terrain elevation cached per ground cell; empty GeoJSON overlay sources no longer cost tile clipping-mask draws (884 to 650 mask draws per frame at zoom 13, pitch 55); basemap labels useless at pitch hidden in 3D. New tests `perf-counters`, `quality-calc`, extended `perf-stats`.
- **3D visuals.** Dark sky with a faint neutral-grey horizon band and distance haze in 3D (setSky), one hemisphere plus one directional light on the aircraft, "Aircraft colour" Realistic (default, neutral light grey with an optional airline tail tint) or Altitude, optional contrails (off by default), and a real glTF model pipeline: `ui/maplibre-gltf.js` + `ui/models-norm.js` (lazy, per archetype, cached, real model at 90 px and above, archetype geometry below, instancing kept), `tools/models/` (manifest, licence and budget validation, gltf-transform optimiser, README). No model files are bundled; missing models fall back to the procedural archetypes silently. New tests `models-gltf`, `contrails-sky`, `models-norm`, `models-pipeline`.
- `tools/cdp-run.js` answers the adsb.im route service with an empty CORS-open reply (like the planespotters photo stub), so snippets do not depend on the network.

- Airport card headers (METAR, TAF, runways, instrument cards) share ONE header component (`.cardHead` in `ui/components.css`): the chip and the "20:50Z · 31 min ago" timestamp wrap under the title instead of overlapping, and the flight-category chip never shrinks. Also fixed by the new intra-panel test: both aircraft-header buttons now have room beside the subtitle, 5-digit altitudes fit the 320 px instrument card, replay bar rows wrap in a narrow bar, chart link rows are real 44 px rows, truncated names carry the full text as a tooltip.
- Route block: the origin and destination airports are buttons that open that airport's panel (as its marker does) with a Back chip ("‹ CALLSIGN") that returns to the aircraft, which stays selected. Airports that are not in the database stay plain text.
- Performance overlay (`?perf=1` or Settings > Advanced > Performance overlay): fps, frame ms p50/p95 over 120 frames, 3D layer CPU ms, model instances, zoom, pitch, terrain, JS heap, and a Copy report button. Off by default and zero cost when off.
- New checks: intra-panel overlap/clip test (11 viewports), route-link test, performance-overlay test and stats unit test. Found while writing them: the `window.MLR` / `window.PHONE` / `window.AIRPT` guards in older snippets never matched (these are top-level `const`, not window properties), so some waits ran to their timeout and the phone full-snap states were never entered; fixed.
- 3D models are placed at their true longitude/latitude with real height (geometric altitude, else barometric; terrain added; shadow at the true ground point; belly pivot). Settings > Map "Aircraft height": Compressed (default) or Realistic. Hit-testing, hover, label and follow use the projected 3D point. Fixes the plane sinking as you zoom in.
- Replay button is back in the top bar on desktop (and in the phone cluster); one element, one handler.
- Route lookup (origin/destination, great-circle line with the flown part marked) is on by default and shown in the aircraft panel on desktop and phone; failures show "Route unavailable" and are cached for five minutes.
- Airport cards, tiles and buttons use the aircraft panel's components; airport flags are smaller with tighter padding at far zoom (UK zoom-5 count 56 to 71).
- `tools/run-checks.sh` runs every check; new tests for hotkeys, controls, route fixture, 3D height, budget, zoom soak and airport proxy.
- 3D aircraft models in the 3D view (three.js custom layer, one InstancedMesh per archetype, nearest 300, lazy-loaded, disposed on leaving 3D; Settings toggle, on by default). 2D keeps the stock icons.
- Airport marker restored to the flag-in-a-circle with a flight-category ring and the code beneath, keeping the per-tier zoom thresholds and the Fewer / Normal / More setting.
- One floating control stack on every screen (desktop column, phone cluster above the open bottom surface via `--bottom-inset`); the view-mode button shows the current mode.
- Phone fixes: the cluster no longer covers the replay panel; label pills draw above aircraft icons; one chip and one close control; the search warning is a toast.
- The planespotters photo lookup fails quietly and is not retried for the session.
- Own base map style on OpenFreeMap tiles with VersaTiles fallback and a banner; CARTO opt-in; no OpenStreetMap raster tiles.
- Shared components (toast, banner, dialog, empty state, tooltip) and a connection banner.
- Airport night look, weather rings on airport pins with hover card, command palette (Ctrl/Cmd-K).
- Alerts: browser watchlist (Settings > Alerts) and an optional ntfy sender in the recorder.
- Real terrain in 3D (AWS Open Data elevation tiles) with terrain-aware altitude lift.
- Coverage plot, inferred recent movements, rain radar playback (off by default).
- Neutral grey palette, white aircraft icons by default (Settings > Aircraft colour), selection glow, dark glass label pills, optional map lift on selection.
- Phone layout (coarse pointer or width up to 768 px): three-snap bottom sheet with tabs, floating glass controls, settings that drill into pages, base map radio rows, flight status sentence, airport sheet with inferred arriving and departing traffic within 30 nm. Desktop is unchanged.
- README rewritten: install, migration, FAQ, privacy and provider tables.

## 0.1.0

First public release of Skywatch ADS-B, a fork of tar1090 by wiedehopf.

- New floating glass interface, aircraft list, settings, phone layout.
- MapLibre GL JS map: 2D, 3D with altitude lift, Globe; select to zoom and follow; altitude-gradient tracks.
- Instrument panel with wind compass; airport detail overlay; replay bar; live receiver graphs with an optional recorder.
- Per-service switches for airline logos, aircraft photos, route lookup and airport detail.
- Output escaping and URL checks for aircraft-derived strings; distance column hidden unless the receiver position is shown.
