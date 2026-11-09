# Changelog

## Unreleased

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
