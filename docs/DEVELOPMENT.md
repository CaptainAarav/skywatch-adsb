# Skywatch ADS-B: development notes

Historical log of the redesign phases (decisions, measurements, what was and was not verified). Paths and host names are placeholders.


Running log for the v2 "floating glass" redesign (`design/DESIGN.md`).
Each decision taken during the autonomous run (phases 3-10) is recorded here.

## Status

| Phase | State | Tag |
|---|---|---|
| 1 Theme (v1) | done, superseded | `pre-v2-phase1-final` |
| 2 v2 tokens, dark only | done | `phase-2-done` |
| 3 Black map | done | `phase-3-done` |
| 4 Shell | done | `phase-4-done` |
| 5 Aircraft list | done | `phase-5-done` |
| 6 Infoblock | done | `phase-6-done` |
| 7 History bar | done | `phase-7-done` |
| 8 Settings | done | `phase-8-done` |
| 9 Phone | done | `phase-9-done` |
| 10 Cleanup | done | `phase-10-done` |
| 11 MapLibre renderer, map style, logos, audit | done | `phase-11-done` |

## Decisions

### Environment
- "~/tar1090" in the instructions is taken to mean this repo,
  `<path-to-this-repo>` (the one mounted into ultrafeeder).
- Screenshots are taken with headless Chromium driven over CDP from a scratch
  directory outside the repo; a local dev proxy serves `html/` and proxies data
  from the live container. Nothing test-related is committed.

### Compose (`<your-compose-dir>/docker-compose.yml`)
- 2026-11-08: removed `TAR1090_ROUTEAPIURL=...` (backup
  `docker-compose.yml.bak-2026-11-08-2`). The value was written unquoted into
  config.js, which made the whole file a SyntaxError, so **none** of the
  `TAR1090_*` settings were applying before. They now apply (zoom 8, page title
  "ADSB Tracking", marker sizes, label zoom, site/range off). Routes stay
  opt-in (off), so the route card is hidden on this receiver.
- **Traces: not enabled.** `READSB_ENABLE_TRACES=true` adds
  `--write-globe-history=/var/globe_history`. RAM cost is negligible (readsb
  keeps the traces in memory anyway), but disk is roughly 10-50 MB/day for a
  receiver like this one with no expiry. The only retention control is
  `MAX_GLOBE_HISTORY=<days>`, and its cleanup deletes whole day folders,
  including the existing heatmap data that Replay uses (about 190 MB going back
  to May 2026). Keeping under ~500 MB would need a 10-30 day retention, which
  deletes that existing data; that breaks the "no data deletion" limit, and no
  retention at all is not sensible. So traces stay off.
  - Effect: per-aircraft history (`#show_trace`, legs, altitude-profile
    scrubber) is hidden, exactly as tar1090 already does without traces. The
    history bar is still built and is used for **Replay** (`Shift+Y`), which
    works from the heatmap. Trace-only parts (legs, profile) appear
    automatically if traces are enabled later.
  - To enable later: add `READSB_ENABLE_TRACES=true` and
    `MAX_GLOBE_HISTORY=<days>` to ultrafeeder, accepting that heatmap days
    older than that are purged.

- 2026-11-08 (Phase 8): `TAR1090_SITESHOW=false` -> `true` (backup
  `docker-compose.yml.bak-2026-11-08-3`; `docker compose config` OK;
  ultrafeeder recreated and healthy). This shows the white receiver dot from
  the mockups and makes "Site distance circles" work (off by default, because
  `TAR1090_RANGERINGS=false` stays as you set it). `TAR1090_ENABLE_ACTUALRANGE`
  was **not** changed: the actual-range layer already exists (readsb serves
  `outline.json`); that variable only hides it on first visit, which matches
  the mockup (off by default) and it can be switched on in Settings.

### Phase 3: black map
- `html/ui/mapstyle.js` rewrites OpenFreeMap Dark at load: background, land
  and water to black/near-black, roads and borders to translucent white
  greys, place labels in Inter (title case, mid grey). Falls back to the stock
  style if the fetch fails. Using Inter for labels also stops ol-mapbox-style
  loading Noto Sans from jsDelivr.
- Defaults: `MapType_tar1090 = "OpenFreeMapDark"`, `MapDim = false`. Users
  who already picked a map keep it (stored in localStorage).
- Range outline, actual-range outline and distance rings default to
  translucent white (rings dotted, ring labels in JetBrains Mono); the site
  marker is a small white dot.
- Selected aircraft (single selection) is white, with a white track, a white
  dashed heading line and a white label pill with black text. The pill is
  shown even with labels off (mockup 01). In trace view and "select all" the
  normal altitude colours stay, since there the colour carries information.
  Changes in `planeObject.js` are small and commented "Improved tar1090".
- Pre-existing console noise not caused by this work: `upintheair.json` 404
  (no heywhatsthat panorama configured) and a planespotters CORS error for
  some photo lookups. Looked at again in Phase 6.

### Phase 4: shell
- Full-bleed map; the aircraft list (`#sidebar_container`) and the selected
  aircraft panel (`#selected_infoblock`) float as glass panels on the left.
  The bottom toolbar and altitude legend follow the open panel's right edge,
  like mockups 01/02. New files: `ui/shell.js`, `ui/shell.css`, `ui/phone.css`.
- Top bar: wordmark, view pill, unified search, settings button.
  - Live map hides the list; Aircraft list deselects and shows it (the
    selected panel takes priority over the list, as in the mockups); Graphs
    links to `/graphs1090/` and only appears if a HEAD request succeeds;
    Replay is the old `#RP` button (same id, still only shown when replay
    data exists) and is highlighted while the replay bar is open.
  - Search merges the old search and jump forms: aircraft first (hex,
    callsign, registration, type, and new: 4-digit squawk); if nothing
    matches, "lat, lon" or a 3-4 letter airport code jumps the map.
  - `/` focuses search (no existing hotkey used it), Escape leaves it.
- Right stack: North up (resets rotation), Home (`#H`), Filters (popover),
  Layers (temporarily opens the old layer switcher until Phase 8), Hide
  sidebar (hides whichever left panel is open).
- Filters popover holds the existing altitude, source, DB-flag and text
  filters (same ids and handlers) plus In view (`#V`). The text filters were
  in the old Filters tab; they are kept as compact rows.
- Toolbar keeps the ids L O K | T P M | U B R with the hotkey shown. Dim (`B`)
  was hidden upstream but is in the design, so it is shown now.
- Follow (`#F`) and Isolate (`#I`) moved into the aircraft panel's action bar
  (with History, shown only when traces exist), as the design says.
- Zoom restyled bottom-right; 2D/3D switch is a placeholder (3D disabled with
  a "later phase" tooltip). Scale line hidden (not in the mockups).
- Removed: header button columns, tabs, sidebar splitter/resize, expand and
  shrink buttons, the separate jump form, the mobile fullscreen button.
- Shift+H now hides every floating control.
- Interface scale applies to the floating UI through CSS `zoom: var(--SCALE)`.
- **Bug fix (also upstream):** base maps were created visible, so the first
  frames queued tiles for every base map. The US chart tiles at z10 stall in
  browsers, filling all 4 tile-loading slots, so the real map often stayed
  black until you panned (the deployed Phase 3 site showed this). Base layers
  now start hidden; script.js shows only the chosen one.
- Phone got a working layout now instead of in Phase 9 (search with layers
  button beside it, small stack Home/Filters/List/Settings, scrollable
  toolbar strip at the bottom, panels as bottom sheets) so the deployed site
  is never broken on phones. Phase 9 refines the sheet contents.
- Hotkeys verified after the change with scripted keydown events, each
  checked against the state variable and the button's active class: l o k t
  p m u b v r f i c Escape e q + - w a s d arrows h, Shift+T G L H Y, `/`.
  All pass.
- Photos: the planespotters request fails with a CORS error only in headless
  desktop Chrome (Cloudflare bot filter); it loads with a normal browser UA.

### Phase 5: aircraft list
- New list markup (mockup 02) with the same ids: header with the decoder
  version only (e3, e.g. "readsb 3.16.15", full string in the tooltip), four
  stat tiles, list filter, chips, `#planesTable`, source legend.
- **History tile:** upstream always hid `#dump1090_total_history` ("it only
  shows the number of positions saved"). The design asks for it, and it is
  real data (positions kept in the browser for tracks), so it is shown,
  shortened as "1.8k", with an explanatory tooltip.
- The search field inside the list is a live filter for the table rows
  (callsign, hex, reg, type, squawk, route airports). It does not change the
  map; the top-bar search still selects/jumps.
- Chips: In view (`#V`, moved here from the popover), Altitude / Source /
  Flags open the shared filter popover beside the list showing just that
  filter; the caption shows the active filter. "Columns n of N" opens the
  existing column picker (Toggles and drag to reorder unchanged).
- Columns: N counts the columns that can be used (21 here, 22 when route
  lookups are on); the Route column is left out entirely while route lookups
  are off instead of showing an empty column. New default columns, matching
  the mockup: Callsign, Type, Altitude, Speed (GS), Distance (+ Route when
  routes are on). Flag, squawk and RSSI are now off by default; saved user
  choices are kept.
- Header labels shortened to "Alt ft", "GS kt", "Dist nmi"; list altitudes
  get thousands separators. Rows: 3px altitude-colour bar (same scale as the
  icons), source marker, emergency rows with the `--bad` outline and a squawk
  badge next to the callsign.
- The tar1090/readsb credit line ("tar1090 by wiedehopf · decoder: readsb")
  sits under the legend so upstream credit is always visible.
- Removed the `calc(px * var(--SCALE))` multipliers from theme.css, because
  the floating UI is now scaled with `zoom` (they would double-scale).

### Phase 6: selected aircraft panel
- Rebuilt `#selected_infoblock` as the compact card from mockup 01 and the
  wide "All aircraft details" view from mockup 03. New `ui/infoblock.js`
  renders every field; `refreshSelected()` now only does the side effects
  (photo, registration links, notes) and calls `ibRender()`. New
  `ui/infoblock.css`; the old docked infoblock CSS in theme.css is gone.
- **e10:** rows, tiles, chips and whole cards with no data are hidden (no "n/a"
  anywhere). A sparse Mode S contact shows only its header, Signal and
  Advanced cards.
- **e9 route API (tested from the app itself, adsb.im):** responses include
  IATA/ICAO codes, city and full airport name plus a `plausible` flag. So the
  route card shows IATA codes (30px mono) with the airport name underneath
  ("International Airport" trimmed), "via ..." for multi-leg routes, and an
  amber warning when `plausible` is false. The card exists only when route
  lookups are on and a route came back; routes stay opt-in, so it's hidden on
  this receiver by default.
- Compact tiles: Ground speed (+TAS, else IAS), Altitude (+vertical rate,
  green climb / amber descent / "Level"), Track (+compass point), Squawk
  (+distance from the receiver). Emergency squawks turn the squawk tile red.
- Chips: source, RSSI, message rate, last seen (hidden in trace view, as before).
- **e12 placements:** DB flags (Military/LADD/PIA) as chips beside the
  callsign; type description (e.g. L2J) as a chip next to the type code;
  "Last seen" in Signal; magnetic declination in Direction; the anonymous-MLAT
  and TIS-B explanations as a note at the top; position epoch and receiver id
  in an "Advanced" card (plus links: FlightAware, planespotters, copy link
  when available). The altimeter form stays where Phase 5 put it until the
  Settings "Advanced" section exists (Phase 8).
- **e8:** country shows tar1090's own SVG flag (`flags/3x2/CC.svg`) plus the name.
- **e11:** bearing is the initial great-circle bearing from the receiver.
- NACp/NACv show the raw category numbers like the mockup; the EPU meaning
  is in the tooltip.
- **e1:** export row has the three KML variants that exist (GPS altitude,
  baro + offset, baro); no CSV. Hidden when the aircraft has no position.
- No callsign: the header shows the registration (or hex) and "No callsign"
  in the subtitle instead of "no callsign" in large type.
- Wide view: the action bar (History/Follow/Isolate) is not shown, as in
  mockup 03; F and I hotkeys still work, and the compact card has the
  buttons. The compact card closes with a back chevron, the wide view has
  collapse + close.
- Wide view on 1440px screens: the bottom toolbar has less room and wraps to
  two rows (mockup 03 shows the history bar there instead). The altitude
  legend now sits above the toolbar's measured height, so they never overlap.
- Phones always get the compact card; the "All aircraft details" button is
  hidden there until Phase 9.
- **Photo fixes (also upstream bugs):** the planespotters URL had a double
  slash (`photos//hex/...`), and a failed request left "Loading image..."
  forever; now a failure hides the photo. The larger thumbnail is used so it
  stays sharp in the wider slot, with "(c) photographer · planespotters.net"
  over the image. Headless desktop Chrome still gets a CORS error from
  planespotters' bot filter, so desktop screenshots show no photo; phone
  emulation shows it.

### Phase 7: history bar
- `#replayBar` (Replay, Shift+Y / the Replay pill) is now the floating glass
  history bar from mockup 03: previous/next day around a date button (opens
  the date picker), play/pause, speed presets, stop, a 24-hour UTC timeline
  with a draggable playhead (arrow keys and PageUp/PageDown work too), and the
  replay time in UTC plus local time. When an aircraft is selected, the right
  side shows its callsign, flight level, speed and track, like the mockup's
  "FL214 · 412 kt · 056°" line. New `ui/history.js` and `ui/history.css`; the
  old grid bar and its jQuery UI sliders are gone.
- Replay speed presets are 10x / 30x / 100x / 300x instead of the mockup's
  1x/5x/10x/40x. Replay steps through one-minute heatmap slices, so 1x would
  barely move; tar1090's default replay speed is 30x. Scrubbing past "now"
  is clamped to the last full minute.
- Replay has no per-aircraft history, so instead of an altitude profile the
  timeline shows the played part of the day (soft white fill), 3-hour ticks
  and the playhead in the mockup's style.
- `#historyBar` (per-aircraft traces) uses the same look: day navigation,
  previous/next leg with the leg readout, 1x/5x/10x/20x/40x (e2: 20x kept)
  and stop, plus the position time. It opens with History in the aircraft
  panel and only exists when traces are available, so it is hidden on this
  receiver (traces are off, see Compose above). **The altitude-profile
  scrubber was not built:** it needs trace data, which this receiver doesn't
  have, so it couldn't be tested. It's the one piece of mockup 03 left out.
- While a history bar is open the bottom toolbar steps aside (as in mockup
  03); the zoom buttons, 2D/3D switch and altitude legend move up to sit above
  the bar, using its measured height. The legend stays visible during replay
  because replay colours aircraft by altitude.
- Phone: the bar spans the bottom with the speeds on their own row. It is
  hidden while the aircraft sheet is open.

### Phase 8: settings dialog and base map picker
- Settings is now the 1040x720 dialog from mockup 04, with a dimmed backdrop,
  section nav (Map & layers, Aircraft & labels, Table & sidebar, Units &
  altitude, Photos & routes, Advanced, About), close button, Escape and
  backdrop click to close, and a focus trap. Map hotkeys pause while it's
  open. The cog opens it at the last section; the Layers button opens it at
  Map & layers. On phones it's a full-height bottom sheet with the sections
  as a scrolling tab row.
- The settings are still tar1090's own `Toggle` objects (same keys, same
  saved values); `ui/settings.js` moves each row into its section and gives
  it a plain-English label, and the rows are styled as the mockup's switches.
  Any Toggle not mapped to a section still shows under Advanced, so nothing
  can disappear.
- **Base map picker replaces ol-layerswitcher** (the control is no longer
  added). Seven thumbnails as in the mockup (OpenFreeMap Dark, Positron,
  Fiord, Liberty, Satellite, OpenStreetMap, Bright) plus "More..." listing
  every other base map in layers.js. Thumbnails are colour swatches like
  the mockup, not live map tiles (live tiles would mean extra tile requests
  every time the dialog opens). Picking one uses tar1090's existing
  change:visible handler, so the choice is saved as before.
- Overlays: Site distance circles, Receiver position, Actual range outline,
  then every overlay layer in layers.js (e.g. OpenAIP airspace, RainViewer
  radar, regional airspace layers), and Dim map. **e13:** region-specific
  layers (the US and Europe groups) only appear when the receiver is in that
  region, so US-only layers don't show here. No wind barbs (e4).
- Appearance: aircraft icon size and **Interface scale (e5)** as native
  sliders with the mockup's look (the jQuery UI sliders are gone), plus
  altitude-coloured aircraft/trails and darker colours. The mockup's separate
  "Label size" control doesn't exist in tar1090; Interface scale (which scales
  text and controls) takes its place.
- Units are a segmented control (Aeronautical/Metric/Imperial) driving the
  existing selector. The altimeter form moved from the list panel into
  Advanced (e12); it shows when "Correct baro. altitude for QNH" is on.
- Photos & routes explains what route lookups send and to which host.
- About: name, credit, "tar1090 by wiedehopf" with the GPL licence, and the
  web interface, decoder and database versions.
- "Reset all settings" asks for a second click (4 s) before it clears saved
  settings.
- Removed: old settings panel CSS, jQuery UI slider styles, all
  layer-switcher CSS, and the theme rule that styled every dialog button as
  a pill.

### Phase 9: phone
- The selected aircraft panel on phones is a bottom sheet (mockup 05) with
  two states. Peek shows callsign, route, source chip, the route line and six
  tiles (altitude, speed, vertical speed, track, squawk, distance). Full shows
  everything, including the detail cards in one column. Tap the handle to
  switch, drag it up to expand, drag down to collapse (or close when already
  collapsed). The search box, layers button and control stack hide while the
  sheet is full so nothing overlaps it.
- Vertical speed shows "k" above 1000 fpm (e.g. "+1.8k") and plain fpm
  below that; m/s in metric. Climbing/descending get the mockup colours.
- Action buttons: Follow (shows "Following" when on), Show track, and expand.
  This receiver has no traces, so the middle button falls back to
  Isolate/Show all (the existing "only show selected" feature) rather than a
  button that does nothing.
- The search placeholder shows the live count ("Search 18 aircraft") like
  the mockup.
- Deviation: the phone control stack keeps the List button. The mockup has
  only Home, Filters and Settings, but without it there's no way to open the
  aircraft list on a phone.

### Phase 10: cleanup
- Removed CSS for elements that no longer exist (old sidebar buttons and
  splitter, layer switcher, jQuery UI tabs and sliders, old infoblock tables,
  grey buttons, settings close box) and a malformed empty `@media` rule. The
  remaining `calc(... var(--SCALE))` rules in style.css style elements that
  are still in use (table, legend, inputs) and are how "Interface scale"
  works, so they stay.
- Removed unused JS: `updateSelectedAirline`, `onSearch`/`onSearchClear`,
  `setSelectedIcao` (it wrote to an element that's gone; "Copy link" in the
  Advanced card now shows "Copied" for 2 s instead).
- Removed 11 images that nothing references.
- Fixed: the list's altitude colour bar disappeared when rows were rebuilt
  (e.g. the first time the list opens), because its cache wasn't reset with
  the row.
- Fixed: About showed the database folder name ("2") instead of versions; it
  now reads tar1090's `version.json` for web interface and database versions.
- Phone search placeholder counts every tracked aircraft (search covers all
  of them), not just the ones passing the current filters.

### Phase 11: MapLibre GL JS renderer, calm map style, altitude-coloured tracks, airline logos
Decisions (second autonomous run):
- **MapLibre GL JS 5.24.0** is vendored in `html/libs/` (the repo's existing folder is `libs/`, not `lib/`) with its
  BSD-3 licence file. I pinned 5.24.0 (the last 5.x, released April 2026) because I know its API; 6.x
  was out but newer. No CDN: offline installs keep working.
- **Adapter, not a rewrite of the data layer.** `ui/mapgeo.js` (Web Mercator, distance, LineString/Point)
  and `ui/map-adapter.js` (`mapa`: centre, zoom, extent, pixels, layer iteration) replace direct
  OpenLayers calls in `script.js`/`planeObject.js`. The plane state, history loading, filters, URL params
  and config options are untouched. Zoom keeps OpenLayers numbering (MapLibre zoom + 1) so
  `DefaultZoomLvl`, label zoom levels etc. mean the same thing.
- **Renderer switch:** `?renderer=maplibre|ol`, saved choice in Settings > Advanced > Map renderer, default
  MapLibre. Without WebGL the page says so and uses the classic map.
- Layers: `ui/maplibre-layers.js` gives MapLibre layers the small OpenLayers-style interface that `script.js`
  and `settings.js` already use (`get`, `getVisible`, `setVisible`, `on('change:visible')`), so the settings
  dialog and saved overlay choices work unchanged.
- Drawing (`ui/maplibre.js`): aircraft = one symbol layer (icon, rotation, scale, label all data-driven, icons
  rasterised once per colour/shape and added as map images); trails = one line source with a dark casing,
  altitude-coloured line, dashes for estimated positions and dots for Mode S; range rings, receiver dot
  and range outline are GeoJSON layers. The selected aircraft's label is a DOM marker (white pill),
  because symbol labels have no background box.
- Events: MapLibre fires `moveend` synchronously inside `jumpTo()` and even for no-op moves, which broke
  Follow (compared the new centre with the plane's old position) and caused endless recursion. The
  adapter skips no-op moves and the `moveend` handler is deferred and coalesced.
- **Map style:** OpenFreeMap Dark (default) and CARTO Dark Matter (keyless, 200 OK without a key) both go through
  `mlBlackStyle()`: black background, near-black water, no land-use fills, no rail/paths/POIs/outlines/county
  boundaries, five road grey levels (casings hidden, widths x0.8, small roads only from zoom 10-12),
  place labels 10-12 px in three greys. Side by side at UK zoom 8 and London zoom 11 OpenFreeMap keeps a
  visible but faint road hierarchy; CARTO is even calmer but has almost no roads until zoom 10. **I chose
  OpenFreeMap Dark as default** (better hierarchy, still calm) and kept CARTO in the picker (replacing the
  blue-tinted Fiord pick; Fiord is still under "More...").
- **Fallback:** if the style request fails, or 4+ tile errors arrive with no tile loaded (429, network error), or no tile
  arrives within 10 s, the map switches to the other provider (OpenFreeMap <-> CARTO, then OSM raster), logs
  `console.warn`, and does not change the saved choice. Attribution (including OpenStreetMap) is shown for the active
  provider and visible overlays. Code comment: keyless providers because the site is public (no billing risk); CARTO may
  require a key for vector styles in future.
- Not ported (dropped in the MapLibre renderer): `?heatmap` / realHeat canvas modes, AIS Catcher overlay, the
  WebGL-rendering switch (MapLibre is GPU-based), Mapbox/CARTO-key raster layers, `english_map`/`vtlayer` test layers,
  ChartBundle WMS (already commented out upstream), the scale line (hidden by the design anyway).
- **Tracks are altitude-coloured** in both renderers (white override removed), selected track 1.35x wider, dark
  casing. Colour changes between segments are stepped (tar1090 already splits a track where the colour bucket changes);
  smooth gradients would need a feature per point, so I left it stepped. "Altitude-coloured trails" off now gives light
  grey instead of black (black vanished on the black map).
- **Airline logos:** tested `pics.avs.io` (200, CORS `*`, wordmarks on `/200/200/`, square brand marks on `/al_square/`,
  generic plane image for unknown codes), `images.kiwi.com` (200, no CORS, so unusable on map labels),
  gstatic flights and Skyscanner (undocumented), Logokit-style hosts (403, key needed; Logostream not tested without a key).
  **Chosen: `pics.avs.io/al_square`** (keyless, CORS enabled, squares suit a circle). ICAO->IATA from **Wikidata (CC0)**, generated
  by `scripts/gen-airline-codes.py` (1,181 airlines; 16 ICAO codes with conflicting IATA codes dropped except THY, KQA).
  Only `^[A-Z]{3}\d[A-Z0-9]{0,3}$` callsigns get a logo. One request per airline (cache), the provider's "unknown" image
  is detected by byte size and shown as a monogram, failures are remembered for 3 days to avoid repeated console noise.
  Key support: `airlineLogoKey` in config (empty by default; a URL containing `{key}` without a key falls back to monograms).
  Shown in list rows, panel header, hover card, selected pill and map labels (real logos only on the map, no monogram there).
  Settings > Photos & routes has the on/off switch and the IP-sharing disclosure; About repeats it. `THIRD_PARTY.md` lists
  licences. No logo images are in the repo.
- **Audit fixes:** wordmark has a glass backing; the selected panel fits its content (max-height, scrolls) with
  Follow/Isolate right under the cards; status chips are a tidy 2-column grid; Country/Registration/Messages never
  show an ellipsis (they wrap).
- Performance (headless Chromium with software GL, so frame rates are not representative): 184 aircraft with labels
  and all tracks for 10 minutes: JS heap oscillates 72-140 MB with no upward trend, DOM nodes constant.

### Traces: cost report (not enabled; your decision)
Measured on this receiver, 2026-11-08 (2 h of data, `stats.json`): 559 tracks in 2 h (about 230 are single-message noise), about 39 aircraft
with a position at any moment, max range 317 km. That is roughly 3,500-5,000 real aircraft a day. `readsb` already runs with
`--json-trace-interval=15`; it does not write per-aircraft trace files today (`haveTraces` is false). `<compose-dir>/globe_history`
holds 190 MB now (173 MB heatmap data since 24 May, about 1 MB/day, plus the saved state), so history storage is already in use.
**Estimates (not measured; I did not enable traces or run anything extra in the container):**
- **Disk:** one trace point per 15 s while an aircraft is in coverage, so a typical pass is 100-150 points, about 1.5-3 KB
  compressed per aircraft per day. About 4,000 aircraft a day gives roughly **7-15 MB/day**, up to about 25 MB on a busy day.
  14 days of retention is about **100-350 MB**, 30 days about 200-750 MB.
- **RAM:** readsb keeps the trace of each currently tracked aircraft (about 60 at a time here) in memory until it is written:
  **under about 50 MB** extra on top of today's 71 MB for the whole container.
- **Verdict:** **under about 500 MB** with up to 14 days of retention (about 350 MB worst case). 30 days could pass 500 MB on busy days.
  Retention is not automatic: old day folders under `globe_history/YYYY/MM/DD` need a cleanup job (for example `find ... -mtime +14`),
  which I did not set up.
- To switch it on I would add the readsb trace-writing options to the ultrafeeder service (verify the exact variable names in the
  ultrafeeder README first), back up the compose file, run `docker compose config`, and watch the container health.
- If you enable it: the History button, Leg buttons and the altitude scrubber from mockup 03 still need building (the bar with the date,
  speeds and trace controls already exists).

### OpenLayers removed (separate final commit)
`?renderer=ol` worked for the whole verification run (both renderers passed the 36-check hotkey suite), then OpenLayers was deleted:
`libs/ol-custom-10.9.0.js`, `ol-8.2.0.css`, `ol-layerswitcher-4.1.1.css`, `layers.js`, the OpenLayers branches in `script.js` and
`planeObject.js` (markers, trails, WebGL points, hover/click handlers, style objects), the OpenLayers half of `ui/mapstyle.js` and
`ui/map-adapter.js`, the renderer switch in Settings, and OpenLayers-only CSS. The `?heatmap` / `?realHeat` canvas modes, the WebGL
rendering switch, AIS Catcher and the `add_kml_overlay` helper went with it. **Rollback:** tag `phase-11-done` is the last commit that still
has OpenLayers (`git checkout phase-11-done -- html cachebust.list && scripts/deploy-local.sh`).
Without WebGL the map area can't be drawn: the page shows "This map needs WebGL..." and the list, filters and panels keep working.
Found on the way: `early.js` can run `get_history()` before `defaults.js` has executed (the browser may run a finished request between two
script tags), so new flags used there need a `typeof` guard (done for `enableUpintheair`).

## Saved-settings migration (uiVersion v2)
- Cause: a pre-redesign `MapType_tar1090` (e.g. `osm`) and `MapDim=true` in localStorage overrode the new defaults.
- `initMapEarly` runs a one-time migration keyed by `loStore.uiVersion !== 'v2'`: drop the saved base map, set Dim off, set the flag. Later choices are respected.
- Unknown/legacy base ids now fall back to `OpenFreeMapDark` (and the stale saved id is removed) instead of `osm`.
- Fixed: a saved "Dim map = on" was not applied until the first render; `MLR.install` now applies it.
- Tested headless with seeded localStorage: osm+dim and esri+dim -> OpenFreeMap Dark, dim off; Carto choice with v2 kept; bogus id with v2 -> default.

## Default map: CARTO Dark Matter (uiVersion v3)
- Default base map is now `CartoDarkMatterVector`; `OpenFreeMapDark` stays in the picker and is its automatic fallback (error, 429, no tiles, or 10 s timeout). The saved choice is never overwritten by a fallback (tested by blocking the CARTO hosts).
- Same black override and decluttering as before. Dark Matter only draws road fills from zoom 10, so its road *casings* (which start at 5-8) are used as the faint network instead; fills for motorway..secondary are hidden. Road class min zooms (MapLibre zoom, = tar1090 zoom - 1): motorway 5, trunk 6, primary 8, secondary 9, minor 12. Applied to all providers.
- Attribution follows the active provider (CARTO + OpenStreetMap contributors; OpenFreeMap fallback shows its own).
- Migration key bumped `uiVersion` v2 -> v3: everyone is reset once to the new default and Dim off; later choices are kept.
- VersaTiles: styles v9.0.0 (2026-11-08). `eclipse` now redirects to `colorful-dark` (`https://tiles.versatiles.org/assets/styles/colorful-dark/style.json`), keyless, CORS `*`, tiles and glyphs 200 from this server. Added as "VersaTiles Dark" (warm dark grey in its stock form; black override applied, Shortbread layer ids handled). Its sprite is an array, now supported.
- Regression caught and fixed during deploy: `ML_FONT` referenced before definition made every base map fail for ~1 minute on the live site before the fix was redeployed.
- Screenshots: `~/snap/chromium/common/shots/v3/{before,after}-{uk8,lon11}.png`.

## Reference restyle + Globe view (phase 15)
**Style** (`ui/mapstyle.js`, all three dark providers): land `#171717` charcoal, ocean `#000`, no land-use/park fills, country borders `#262626`, roads dim as before (colours lifted slightly so they read on charcoal).
Labels by role: country larger/semi-bold/`#9a9a9a`; region UPPERCASE letter-spaced dim from zoom 4; city small dim from zoom 5; oceans/seas/gulfs italic very dim; lakes/rivers hidden. Fonts per provider from what its glyph server serves (checked with curl). Aircraft layers now take part in label collision, so map labels give way to aircraft/aircraft labels.
Known limit: CARTO's tiles carry no ocean names at world zoom (name is null), so ocean names only appear from sea level (e.g. "Irish Sea" at UK zoom). 

**Globe**: 2D / 3D / Globe control (`#view2d/#view3d/#viewGlobe`), MapLibre globe projection, mode persisted in `loStore.viewMode` (old `view3d` still read). Hidden without WebGL2 (`MAP_GLOBE`). Projection re-applied after every style change. Far-side aircraft are skipped for hover/click (`MLR.occluded`); `mapa.calcExtent` samples a pixel grid on the globe and returns the whole world if any sample misses the sphere. Atmosphere glow only below zoom 6 (it is a full-screen pass). Phone: view switch is a compact pill above the toolbar (it was hidden on phones before).
Verified in globe: click select, hover, follow (centre distance 0), home, far-side pick rejected, in-view extent, labels, tracks, replay, base switching (scripts/parity run), console clean.
Also fixed: `lopaStore` proxy `set` returned the assigned value, so a centre longitude of exactly 0 threw in strict mode (pre-existing upstream bug).

**Performance** (headless SwiftShader software GL, so absolute fps is far below a real GPU):
| case | 2D | Globe |
|---|---|---|
| ~200 aircraft, UK zoom 6 | 33-44 fps | 3-5 fps |
| 3000 aircraft, world zoom 3 | 25-30 fps | ~5 fps (22 fps with aircraft hidden) |
In software GL the globe base map alone costs ~5 fps; aircraft add little at 200 and ~3x at 3000. Mitigations kept: icons half size and labels hidden below zoom 3.5; atmosphere off above zoom 6. Not measured on a real GPU.

## Receiver position and actual range outline off by default (uiVersion v4)
- `defaults.js`: `SiteShow = false`, `actual_range_show = false`. The live config.js is generated from compose env, which had `TAR1090_SITESHOW=true` and overrode the default, so that one line in `<your-compose-dir>/docker-compose.yml` was changed to `false` (backup `docker-compose.yml.bak-2026-11-08-4`, `docker compose config` OK, only ultrafeeder recreated, healthy afterwards; piaware untouched). `TAR1090_ENABLE_ACTUALRANGE` was already `false`.
- Migration key bumped to `v4`: clears saved `layer_locationDot`, `layer_site_pos`, `layer_actualRangeOutline` once (plus the map reset of v3). Choices made afterwards are kept.
- Tested: legacy saved "on" -> off, fresh -> off, turned on after v4 -> stays on. Rollback of compose: copy the `.bak-2026-11-08-4` file back and `docker compose up -d ultrafeeder`.

## Phase 17: list/map polish, smooth movement (Jobs A and B)
Decisions (autonomous run):
- List: panel widens (`--list-w`, up to 62% of window) or switches to dense columns so nothing is clipped; no horizontal scroll. Chips, search field and stat tiles now have real borders/backgrounds.
- Labels: collision-managed symbol layer (selected/hovered wins via `tar-plane-labels-top`); callsign-only when more than 40 labels in view below zoom 8.5. Labels default on, callsign + airline logo only (one-time `labelsDefaultV` reset of saved label settings).
- UI is pure black/white (`--glass-solid #000`); wordmark is plain text; gear icon; +/- right of the 2D/3D/Globe switch; control bar fits its icons.
- Selecting an aircraft eases the camera to frame its trail (`MLR.fitPath`, 1.1 s, max zoom 10.5).
- Smooth movement (`ui/maplibre-motion.js`, setting "Smooth movement", default on): dead reckoning from gs/track, ~0.5 s eased blend to each fix, monotonic along track, shortest-angle heading, no extrapolation on ground/slow/stale (8 s, longer for MLAT/TIS-B). Only icon/label use the drawn position (and hit-testing, follow); table, trails, distance use real data. Off in replay/trace playback and with prefers-reduced-motion (replay shows real fixes as before). Selected/followed every frame; others 12 fps adapting down to 4; paused while the tab is hidden.
- Measured (headless Chromium, SwiftShader software GL, so frame times are raster-bound): motion tick cost 0.66 ms at 312 aircraft, 2.5 ms at 1110. Continuous repaint costs ~5 fps in software GL (no GPU) vs idle map; on real GPUs it is not raster-bound.
- Evidence (synthetic feed, 310 kt aircraft, ~270 m between fixes): drawn position moved on 17/18, 22/24 and 18/18 frames (selected / other / follow), 0 backward frames, follow-centre distance 0 px.

## Phase 18: publishing prep (Job C), nothing pushed
- README rewritten for the fork (old one kept as `README-tar1090.md`), screenshots in `docs/screenshots/` from a synthetic feed (SYN callsigns only).
- THIRD_PARTY.md now lists flags, VersaTiles, route API; About credits list VersaTiles. LICENSE unchanged (GPL v2 or later, upstream).
- `scripts/deploy-local.sh`: no personal paths; `CONTAINER` and `SITE_URL` variables. `.gitignore` extended.

### Suggested GitHub description and topics
Description: "Redesigned tar1090 ADS-B web interface: black UI, MapLibre 2D/3D/Globe, smooth aircraft movement, airline logos. Fork of wiedehopf/tar1090."
Topics: `adsb`, `tar1090`, `readsb`, `ultrafeeder`, `dump1090`, `maplibre`, `aircraft-tracking`, `flight-tracker`, `dark-mode`, `globe`

## Phase 19: airport detail, elevation, label fix
**Airport data survey** (Luton z14 tiles, `querySourceFeatures`):
- OpenFreeMap (OpenMapTiles `aeroway`, `aerodrome_label`): apron polygons, taxiway lines with `ref` (A, B, K), runway polygons and lines with `ref` (07/25), gate points with `ref` (1, 5, 10, 11/12), helipad, airport labels with iata/icao. **Best.**
- CARTO Dark Matter (actually a Protomaps-schema source): runway and taxiway lines with ref, runway and aerodrome landuse polygons, "apron" only as named points. No gates, no apron polygons.
- VersaTiles: runway polygons and taxiway lines, no refs, no gates, no aerodrome labels.
- Decision: overlay OpenFreeMap's aeroway layers on every base map (`ui/maplibre-airports.js`), attribution added to the map footer, THIRD_PARTY.md and Settings > About (OSM/ODbL). Layers have minzoom (MapLibre): apron/taxi/runway 13, runway numbers 13.5, taxiway letters 14.5, gates 15, airport chip 8 (code) and 10 (code + name). Below zoom 8 no tile of that source is requested (only the TileJSON).
- Runway numbers are computed from the runway geometry (one number per end, at the matching end, rotated to the landing heading). Runway-edge dotted line is decorative (no lighting data); hold-short bars and centreline lights skipped.
- Airport chip uses the OpenFreeMap airport label (needs iata or icao) with a flag from the ICAO prefix; this fork has no airport list of its own ("Jump to airport" does not exist in tar1090), so the tiles are the data source. Classes shown: international, public, regional, military.
- Aircraft layers are added after the airport layers, so planes and labels draw on top (smoothing and rotation unchanged).
- Still missing: gate refs at airports where OSM has none (e.g. most of Heathrow's stands in the tiles), runway numbers when a runway is not mapped with a ref, apron fill precision (OSM apron polygons), airports without iata/icao, flags for rare ICAO prefixes (fall back to no flag).

**Elevation** (theme.css tokens): `--glass` rgba(0,0,0,.82) -> rgba(36,38,43,.80); `--glass-solid` and `--panel` #000 -> #1c1d21; `--tile` .06 -> .07; `--tile-hover` .09 -> .11; `--line` .09 -> .12; `--line-strong` .18 -> .20; `--accent-bg` .14 -> .16; `--shadow` -> 0 8px 32px rgba(0,0,0,.5); new `--map-land` #0d0d0f (read by `ui/mapstyle.js` at load; was #171717). Panels, pills, toolbar, control stack, 2D/3D/Globe, zoom, legend and the wordmark (now a glass chip) all have the glass surface, border and shadow. List: lighter header row, row separators, zebra, hover. `prefers-reduced-transparency` gives solid #1c1d21 panels.
**Also**: zoom bar and 2D/3D/Globe switch hug their contents (no blank space on the right). Labels default to logo + callsign: the route line was being added to the label (and was what the callsign-only mode showed); the route is now only part of the label in the extended label modes.

## Phase 20: calmer map (part 1) and airport polish (part 2)
**Part 1 values (tweak here):**
- Icon size: `icon-size` ramp in `ui/maplibre.js` (factor of each shape's own size): zoom 1 0.3, 5 0.5, 7 0.58, 12 0.95, 16 1.15 (about 16 px at UK zoom, about 28 px at zoom 12; MapLibre zoom = tar1090 zoom - 1). Selected aircraft x1.3 (white, dark casing as before). Altitude colours: `markerSaturation = 0.78` in `defaults.js`.
- Labels: 10 px (`10 * globalScale` in `ui/maplibre.js`), semi-bold from the style's glyph server (`ML_FONTS[kind].semi`), logo 10 px rounded square (`ui/airlines.js`), hidden below MapLibre zoom 5.5 (tar1090 6.5) except the hovered/selected one; label offsets follow the icon size. Route text only in the extended label modes.
- Roads (`ui/mapstyle.js`, `ML_STYLE.road`): motorway .17, trunk .15, primary .10, secondary .07, minor .05 white alpha; widths (zoom 5 / 9 / 14) motorway .7/1/3, trunk .6/.9/2.6, primary .5/.8/2.2, secondary .5/.7/1.8, minor .5/.6/1.4; min zoom motorway 4, trunk 5, primary 6.5, secondary 8, minor 12. Urban (residential landuse) = `--map-land` + 4 % (`ML_STYLE.urbanLift`). Country names 35 % opacity, 9-11 px, regular weight; city labels 10.5 px, dimmer.
- Selected aircraft: track is one gradient line (`ui/maplibre-route.js`, colour interpolated between segment midpoints along the line); dashed white 50 % great-circle line to the destination when the route lookup has its coordinates (`lat`/`lon` of the last airport).
- Contrast: `--muted` raised to #B8B8B8 so muted text is at least 4.5:1 on the glass panel, tiles and selected rows over the map (panel over black map: #FFF 16.7, #CCC 10.4, muted 7.3+).
- Frame time (300 synthetic aircraft, software GL, UK zoom, 4-5 fps either way, run-to-run noise about 15 %): before median 189/210 ms, after 199/260 ms; JS motion tick 0.5-1 ms in both. No reliable difference could be measured.
**Part 2:** apron `#8f8c88` at 85 %, buildings pure black (own layer from the OpenFreeMap `building` layer above the apron, the base-map buildings are under it). Stand chips were hidden only because the layer started at MapLibre 15 (tar1090 16); OpenFreeMap has `gate` points with refs (Luton 26, Heathrow 153, none at Cranfield, no `parking_position` class), now from MapLibre 14 as amber chips. Taxiway letters from 14 ("Taxiway " prefix stripped). Decorative effects (zoom >= 14 MapLibre = 15 tar1090, fade over half a zoom level): taxiway centreline green dots, blue edge dots both sides, runway edge dots, centreline dashes, threshold stripes, red hold-short bars where a taxiway crosses 22 m outside the runway edge; all line layers with round caps/dasharray, marks computed at most once per map move for loaded tiles. Toggle "Airport detail effects (decorative)" (default on) in Settings > Appearance. Airport pin: round flag + code at medium zoom, code + name below from MapLibre 11. Frame time at Luton zoom 15.5 with forced repaint (software GL): before lights 113 ms median, lights on 138 ms, lights off 127 ms (the building layer is in both of the latter two), so effects cost roughly 10 % in software rendering; not measured on a GPU.
Depends on OSM data quality: stands (missing at Cranfield, some refs absent), apron shapes, taxiway letters, runway numbers, and whether a taxiway is mapped as a line at all (hold bars and lights follow those lines). Not verified: ground-aircraft rendering over the lights was checked only by layer order (planes above all airport layers), not by a screenshot with a ground aircraft.

## Phase 22: round of fixes
Values changed (tweak here):
1. Ground: `--map-land` #0d0d0f -> #1a1a1c (theme.css); sea #000; built-up +4 %. Landcover tones (`ML_GROUND` in ui/mapstyle.js): woods -3 %, grass/parks/scrub +2.5 %, farmland +1.2 % around the land value (CARTO uses one data-driven `landcover` fill). Roads re-tuned for the lighter land: motorway .15, trunk .13, primary .09, secondary .06, minor .045 white alpha. Map label colours up a step (city #707070, town #646464, small #585858).
2. Wordmark: plain text, no chip/border/background/box-shadow, text-shadow halo only.
3. Selected panel (compact): 16 px padding / 8 px gaps; round 36 px logo; round buttons; route card with dashed arc and plane glyph (hidden without a route); 2x2 equal tiles with borders; one wrapping chip row incl. message count (or receivers); aircraft card with Registration / Country / Operator in three columns (empty ones hidden), photo credit as a rounded pill; action bar Replay (when traces) / 3D / Follow / Isolate, active state white. Data layer untouched.
4. Trail head: new `tar-sel-head` line from the last real fix to the DRAWN position, updated every animation frame (and on each flush), the per-segment elastic line is hidden for the selected aircraft. Test (`headtest.js`, synthetic feed, 12 s, ~45-70 frames per run, Follow off and on, zoom 7 and 11): distance icon to head end 0 px mean and max, head start to the trail's last point 0 px. This compares the source data with the drawn position, it is not a pixel readback of the WebGL canvas.
5. List: the Columns control is now a small icon button at the right end of the chip row (count in its tooltip); one row, no more floating chip.
6. Labels: no "reg:"/"hex:" prefix; airline flights without a logo get a monogram tile (first three letters of the airline code) so labels line up; non-airline callsigns have no tile.
7. Airports: stand chips 1.6x (text 14.4-20.8 px) with a baked soft shadow; taxiway centreline lights `[0,8]` dasharray, #63ff8f, 2.2-3.6 px; edge lights `[0,9]`, #7db2ff, 2-3.2 px; runway edge `[0,5]`. Aprons within 100 m of a stand (or containing one) full brightness (.85), other aprons .425 (`updateMainAprons` in ui/maplibre-airports.js; tile-clipped pieces are classified individually, so a seam can show on very large aprons).

## Phase 23-f: selected-aircraft panel (instruments)
Live-feed coverage (61 aircraft, the local test site): alt_baro 95%, gs 95%, track 95%, baro_rate 93%, ias/tas/mach 84%, true_heading 84%, roll 84%, track_rate 77%, ws/wd 71%, nav_altitude_mcp 92%, nav_qnh 92%, nav_heading 61%, nic/nac_p/sil 92%, squawk 92%, rssi 100%, nav_altitude_fms 23%, **nav_modes 10%** (under 15%: autopilot mode pills live only in the wide Details view), calc_track 2%.
Every instrument is hidden when its inputs are missing (no fake zeros). Receiver view/distance hidden unless receiver location is set and shown. Wide panel width: clamp(680px, 62vw, 1040px). 3D button removed from the panel action bar.
Verified on live page at 1440x900: compact and wide render with real data, no console errors. NOT yet verified: phone sheet, ground / minimal-data / emergency cases, emergency map-label halo (not implemented).

## Phase 23-g: Graphs
graphs1090 is present in the ultrafeeder container. Its `colorscheme=dark` option exists, so it was switched on with `sed -i` on `/etc/default/graphs1090` inside the container (backup: `/etc/default/graphs1090.bak`), then the 2h/8h/24h/48h/7d PNGs were regenerated. This is **not in the compose file and is lost if the container is recreated** (a restart keeps it). Rollback: `docker exec ultrafeeder sh -c 'cp /etc/default/graphs1090.bak /etc/default/graphs1090'`. The compose file was not changed (copy kept in <backups>/docker-compose.yml.pre-phase23g).
New Graphs overlay (glass, period tabs 8 h / 24 h / 48 h / 7 days, six rounded cards from graphs1090's PNGs, refreshed every 60 s, link to full graphs1090). graphs1090 has no 6 h period, so 8 h is offered. Hidden when /graphs1090/ does not answer. The PNGs keep rrdtool's own fonts (not Inter); live canvas charts were not built because /data/stats.json only has 1/5/15 min windows, no history.

## Phase 23-h: 3D altitude lift
New `ui/maplibre-lift.js`. lift_px = alt_m·k / metres_per_pixel · sin(pitch), soft-compressed with tanh (max min(190 px, 30% of map height)), icon and label drawn at `unproject(project(ground) − [0, lift])`. Thin stem + ground shadow dot (layers under the icons). `MLR.drawnLL` returns the lifted position, so hit-testing, selection pill, hover, Follow (camera centres on the lifted icon; measured icon at 922,450 = free-area centre 922,450) and the selected trail head use it. Settings → Appearance → "Altitude exaggeration (3D)" slider 0–10× (default 2×, 0 = off, stored in localStorage `altExag`). 2D and Globe: lift is 0 and the stem layers are empty.
Cost (headless, software GL): camera-move refresh of 54 aircraft = 0.50 ms JS; single plane lift 0.008 ms, so ≈ 2.3 ms for 300 aircraft of JS work per camera frame. GPU upload cost not measured with 300 real aircraft (only ~60 are live here).

## Phase 23-i: finish
- Hotkey suite (hkrun.sh, 36 checks): 36 keys, 0 exceptions; 2 "NOCHANGE" results (`click #view_list` when the list is already open, `click #north_up` at bearing 0) identical to the previous baseline, i.e. expected no-ops.
- Console at 1440×900 and 390×844 with an aircraft selected: no errors (only the benign "sprites preloaded but not used" warning).
- Instrument perf: panel instruments render at most 4 Hz per aircraft/mode (`IBI.due`); transitions off under prefers-reduced-motion. Lift perf: see 23-h.
- Screenshots in docs/screenshots/p23-*.png (live data except the emergency one, which uses a synthetic squawk).
- Changed values: wide panel width 640px → clamp(680px, 62vw, 1040px); `--edge` follows; nav_altitude prefers MCP over FMS; Graphs link → overlay; new setting altExag (default 2×).
- NOT verified: on-ground aircraft (none on ground in the live feed), real route card/photo (route API and planespotters unreachable from headless Chromium), emergency map-label red halo (not implemented), phone sheet expanded "all details" state, 3D lift with 300 real aircraft, replay data-gap hatching on real gaps.

## Phase 24
- **24-a Rename**: `html/project.js` holds PROJECT_NAME "Skywatch ADS-B", PROJECT_SHORT "Skywatch", the credit and About text; wordmark, About, <title> (page and document.title), generated PWA manifest (name/short_name) and README read it. Old name strings replaced everywhere except PROGRESS history, `design/` mockups and the directory path / remote URLs. `TAR1090_PAGETITLE` (compose) no longer sets the title. Credit line exactly "Created by Aarav Sahni · Based on tar1090 by wiedehopf"; GPL, upstream notices and the wiedehopf/tar1090 link kept; README has "About this fork".
- **24-b Selected lines**: track head and dashed route are redrawn every frame from the same drawn icon position; in 3D every track vertex is lifted by its own altitude (ribbon rises/falls), the head starts at the last fix at its altitude and ends at the lifted icon, the route starts at the lifted icon and descends to the destination airport at ground level (about 500 vertices max). Checked pitch 0/45/60 × bearing 0/90 × exaggeration 0/2/10: at slider 0 or pitch 0 the drawn track equals the 2D one exactly (deviation 0). Climbing and descending real aircraft screenshotted. The dashed route was only checked with a SYNTHETIC destination (the route API is unreachable from headless Chromium), first vertex = icon, last = airport.
- **24-c Replay**: 8 px rail, 24 px playhead with 2 px dark ring + glow + 3 px vertical line, always-on time bubble "HH:MM:SS UTC · MM:SS into replay" (counts from when the bar opened or was last scrubbed), LIVE button, 44 px hit area, grab/grabbing cursor. Mouse drag and touch drag both moved the playhead (CDP input events); paused and playing screenshots.
- **24-d Graphs**: the optional Skywatch server (`server/src/history.ts`; until V1 a Python script) writes `globe_history/skywatch/history.json` + `polar.json` every minute (7 days; stores only counts, distances, bearings; range from readsb's r_dst/r_dir, no coordinates). (The Python recorder could backfill from graphs1090's rrd files on first start; the Node server does not: charts start empty.) `ui/graphs.js` draws canvas charts (6 h/24 h/48 h/7 d, smooth monotone curve + gradient area, hover crosshair, 24 h min/avg/max, Inter + JetBrains Mono; accents white/#4FD1D9/#B07BFF/#3DDC97) and a range-by-bearing polar plot; falls back to graphs1090 images with a note when the recorder file is missing. "Classic graphs" link kept. Caveats: polar data starts at install time (no backfill), the live signal value is stats.json's mean signal, the same quantity graphs1090 plots.
- Not verified: dashed route with a real looked-up route; phone layout of replay bar / lines; polar plot with more than minutes of data; touch scrubbing on a real device.


## Phase 26: airport panel
- `tools/build-airports.py` -> `html/airport-db/airports.json` (OurAirports: large and medium airports, anything with an IATA code, small fields with a 4-letter code; closed airports and heliports dropped; about 19k rows, about 1 MB gzipped). Loaded lazily on the first click or search. OurAirports has no ILS data, so the spec's ILS text is not shown.
- `server/src/weather.ts` -> `wx.json` (METAR/TAF for a whole-degree box around the receiver, no coordinates written).
- `html/ui/airport-calc.js` (pure functions: wind components, BEST end, flight category, density altitude, NOAA sun times, runway-in-use inference, TAF slots) with unit tests in `tools/test/airport-calc.test.js` (`node tools/test/airport-calc.test.js`).
- `html/ui/airport-panel.js` / `airport.css`: the panel (left slot, bottom sheet on phones), DOM built with createElement and textContent only. Opens from a click on an airport pin or runway/apron at high zoom (`MLR.onClick`), or from the search box. Opening it closes the aircraft panel and the other way round.
- Not verified: touch interaction on a real phone; behaviour with the server's weather box far from the viewed airport (no weather card, by design).

## Phase 27: white-only chrome, airport camera, progressive airport detail
- Accent: `--accent #fff`, `--accent-contrast #0b0b0d`, `--accent-soft rgba(255,255,255,.18)`; native controls `accent-color: #fff`. The stock jQuery UI theme (blue `#007fff` active state, blue visual-focus ring) is re-skinned at the end of `theme.css`. Kept blue on purpose: MVFR category colour and TAF strip (status), `--src-mlat` (data source colour), OpenAIP restricted-area overlay, taxiway edge lights and the altitude/track gradients (data and map content), country flags.
- Clicking or searching an airport eases the camera (`fitAirport` in `ui/airport-panel.js`): bounds from the runway end points (or a runway of the stated length through the reference point), plus loaded OpenFreeMap aeroway features; padded for the panel and top bar; never zooms out when already closer; reduced-motion jumps.
- Airport detail stages (MapLibre zoom, each fades in over one zoom level): runway shapes from the OurAirports data 9.3 (large/medium) and 11 (small); OpenFreeMap runway/taxiway lines 10.5; aprons 11, runway polygons 11.5; runway numbers 12.5; stands, buildings and decorative lights 13; taxiway letters 13.5. OpenFreeMap has no building data below zoom 13, so terminals cannot appear earlier.
- Runway end points are in `airports.json` as integers (degrees x 10000).

## Phase 28: night-airfield look
- **Geometry** is pure and unit tested: `html/ui/airport-geom.js` (`AIRGEOM`, `tools/test/airport-geom.test.js`): a runway is two thresholds plus a width, positions are `(end, s, lat)` (s from that end's threshold, lat to the left of the landing direction). Runway lights (15 m centre row, 60 m edge rows exactly on the edge lines, red end bar, green threshold dots; rows run threshold to threshold and are generated symmetric), zebra and touchdown-zone bars, approach lights (>= 1800 m only, 30 m dots for 900 m, bars at 300/600 m, bigger dots in the last 300 m), PAPI (left of each approach, 300 m in, 15 m off the edge line, 4 lights), hold-short positions (taxiway centre line 45 m back from the runway edge, only taxiways that reach the runway), taxiway lights (green centre / blue edges every 20 m), screen-spacing thinning, convex-hull ground buffer.
- **Where the geometry comes from**: runway ends and width from the OurAirports data (`dbRunways`); a tile runway is used only when the data has no runway with those idents nearby AND both its ends are loaded (queried tile features are cut at the tile buffer, so ends of a runway that leaves the loaded tiles are artificial; such a runway is skipped). Taxiway centre lines come from the tiles, cut to their own tile (`airportClip`) so neighbouring tiles do not double the rows. No usable geometry means nothing is drawn.
- **Ground**: inside the tiles' aerodrome polygon (`tar-ap-ground`), else a rounded 150 m buffer of the airport's pavement (`tar-ap-ground-fb`, built in `buildAirport`). The edge is feathered over 100 m with three stacked lines of rising width and falling opacity (a blurred line breaks into spikes on a detailed outline). Approach lights stop where the ground ends (`approachLimit`).
- **Layers** (all GL, no DOM): `tar-mk-*` pavement, edge lines, dashed centre line, zebra, touchdown bars, stop bars (these stay when the decorative lights are off); `tar-fx-*` lights (`tar-fx-core` circle layer, `tar-fx-halo` from zoom 15 and `tar-fx-halo-t` from 16 as glow layers with `circle-blur`, `tar-fx-bar*` for the end and approach bars, `tar-fx-join`). Widths in metres are restated per latitude (`applyAirportMetres`). Per airport the geometry is built once (`buildAirport`, cached by signature) and only for airports in view above the zoom thresholds; dot rows are re-thinned per zoom level so neighbours stay >= 8 px apart.
- Fades (MapLibre zoom): ground and runway pavement/edges from 11 / 11.5, runway/approach/end lights, PAPI, centre line and markings, taxiway edge/centre lines from 13.5, taxiway lights and stop bars from 14.5, halos from 15 (taxiway halos from 16). Settings "Airport detail effects" off: `tar-fx-*` hidden and not generated. "Airport detail" off: no airport layer or source exists (reload).
- Known: the aerodrome polygon of some airports carries narrow spikes in the tile data (seen at EGGW); they show as faint dark spikes in the ground. In 3D a hairline can appear at tile seams of the ground fill (the fill is antialiased to hide it).

## Phase 29-31 notes
### Part B: basemap
- Default base map is `html/styles/skywatch-dark.json`: the OpenFreeMap Dark style after the restyle in `ui/mapstyle.js`, dumped once from the running page (so it is ours; tiles, glyphs and sprites still come from OpenFreeMap). To regenerate: load the page and dump `JSON.stringify(await mlBuildStyle(MLR.findLayer('OpenFreeMapDark').p))`.
- Chain: Skywatch Dark -> VersaTiles Dark, with a Banner ("Map provider switched"). CARTO is opt-in; OpenStreetMap raster tiles are removed.
- CORS investigation: I could NOT reproduce the earlier `tiles.openfreemap.org` CORS errors. On 2026-11-09 every tile, TileJSON, font and sprite response I probed (including missing tiles, tiles beyond zoom 14, bogus versions and a raster beyond its maxzoom 6) carried `access-control-allow-origin: *`; unknown tiles answer 200 with an empty body or a plain 404 with CORS. The most likely cause of a browser "CORS" message is an edge error (429 or 5xx from the CDN under a burst) that arrives without CORS headers, which the browser reports as a CORS failure. Mitigation: the provider chain switches after 4 tile errors with no good tile, and the airport source respects maxzoom 14. Unconfirmed.

### Part E: terrain
- `html/ui/maplibre-terrain.js`: Terrarium elevation tiles (AWS Open Data, keyless, CORS open) as a raster-dem source (`tar-dem`, maxzoom 12), a separate source (`tar-dem-hs`) for a subtle dark hillshade placed under the first symbol layer, and `map.setTerrain` with the exaggeration setting (0 to 3, default 1.5). Terrain exists only in 3D (never 2D or Globe) and is removed when leaving 3D. Default: on for desktop with a hardware GPU (`MLR.terrainDefault`: not a coarse pointer, no mobile user agent, renderer string not SwiftShader/llvmpipe/software), off otherwise. A saved choice always wins.
- Aircraft: `MLR.liftPxAlt` is wrapped so lift is measured from the terrain under the aircraft (`map.queryTerrainElevation` divided by the exaggeration, converted to feet and subtracted). A low aircraft over a hill is not buried; the stem, ground shadow, selection, Follow target, trail ribbon and route line all go through the same function. Vector layers (airport layers, the dashed route, buildings) drape automatically in MapLibre. If the elevation tile is not loaded yet the plain altitude is used and positions are refreshed when the source finishes loading.
- Cost: one DEM tile fetch per visible tile (256 px PNG, about 60 KB), cached by the browser; nothing is requested while terrain is off.

### Part F: coverage
- Graphs has a "Coverage" card (polar plot of the longest range heard in each 10 degree bearing over the selected period: 6 h, 24 h, 48 h, 7 days). It is drawn from `globe_history/skywatch/polar.json`, which the server fills from `r_dst` and `r_dir` (distance and bearing relative to the receiver). **No coordinates are stored, requested or drawn**; the card says so, and gives a text summary (longest direction, shortest sector) as the accessible description.
- There is deliberately **no map outline**. A coverage outline on the map would need the receiver position in the browser; tar1090's own range outline (`actual_range_show`, with `SiteShow` for the marker) already does that for owners who choose to show them, and both default to off. No extra code path or request exists for it in this fork.
- Frame times (2026-11-09, headless Chromium with SwiftShader software GL at 640x400, 3D pitch 55, zoom 11, continuous rotation for 4 s): Peak District, terrain off 85 ms per frame (p95 150); terrain **on 1361 ms per frame** (3 frames, p95 1967). London, terrain off 109 ms (p95 217); London with terrain on timed out. Software rendering is not representative of a real GPU (so the default is off there) and these numbers are noisy; **no hardware-GPU measurement was possible**. Treat terrain as unmeasured on real hardware.
- Lift consistency was checked numerically only (elevation 256 m found at 53.36N 1.82W, lift for 3000 ft drops from 63 px flat to 46 px over that terrain); stems, shadows and ribbons were not inspected visually.

### Part H: recent movements
- The server (`server/src/movements.ts`, `MovementTracker`) polls aircraft.json every 10 s (`MOVE_INTERVAL`) and writes `globe_history/skywatch/movements.json` (rolling 24 h, at most 500). Entry: `t, callsign, reg, type, airport, dir (landing|takeoff), rwy`. No receiver coordinates, no hex, no distance. `MOVEMENTS=0` turns it off. It reads the airport list from the served `html/airport-db/airports.json`.
- Rules: landing = seen airborne and descending within 3 nm of an airport, then reported on the ground there; or gone quiet for 90 s while below 800 ft above the field, slow, descending and lined up with a runway. Take-off = reported on the ground at an airport then airborne, still near it and climbing/level above 100 ft at 80 kt or more; or first heard low (below 1500 ft AGL), fast and climbing near an airport. Go-arounds that stay tracked, overflights (including low fast level passes), and taxi-then-silence produce nothing; the same aircraft, airport and direction is not repeated within 20 minutes. Runway is the one whose heading is within 30 degrees of the track.
- Limits: it only sees what the receiver hears (low aircraft near an airport behind terrain are missed), and a go-around that drops out of coverage low, slow and descending could be mis-counted as a landing. The card says "Inferred from receiver data". Tests: `server/test/movements.test.ts`.

### Part G: rain radar
- Terms read on 2026-11-09 (see THIRD_PARTY.md): free for personal, educational and small community use with attribution. Built because that fits a personal site; the overlay is off by default and nothing is requested while off.
- `html/ui/maplibre-radar.js` replaces tar1090's `MLR.addRainviewer`: last two hours of frames (13 at 10 minute steps), a glass play/pause bar with a time slider and a credit link, `source.setTiles` per frame, refresh every 2 minutes unless playing, a toast if the API or tiles fail. Playback never starts by itself. Radar tiles stop at zoom 7 (the API's limit for this tile size); the layer overzooms.
- Nowcast frames are not used (the API returned none on the day it was checked).

## Phase 34: pixel-match pass, palette tokens, logo

### Palette tokens (html/theme.css, applied in html/ui/elevation.css)
| Token | Desktop | Phone |
|---|---|---|
| `--bg-panel` (floating panels) | #0d0d0d | #000000 |
| `--bg-card` | #1e1e1e | #161616 |
| `--bg-row` (secondary rows) | #161616 | #161616 |
| `--bg-control` (control column, round buttons, gear) | #131313 | #131313 |
| `--bg-input` (search, inputs) | #111111, 1px `--border-ctl` (white .08) | same |
| `--bg-segment` / `--bg-segment-on` | #151515 / #2c2c2c, white text | same |
| `--bg-action` / hover | #1e1e1e / #292929 | same |
| `--text`, `--text-2`, `--text-3`, `--text-input`, `--icon` | #fff, #939393, #7a7a7a, #cfcfcf, #d2d2d2 | same |

`--text-3` is for inactive nav, hints and credits over the header scrim only (4.5:1 on #0d0d0d, under 4.5 on cards, so never used for content on a card). Map: land #181818, sea #020202, airport ground #000, minor roads #242424, major #363636, motorways and country borders #3f3f3f, labels #7e7e7e / #747474 / #6a6a6a with a 0.6 black halo. `ui/elevation.css` is the desktop layer (`@media (min-width: 769px) and (not (pointer: coarse))`: note that headless Chromium reports `pointer: none`, so do not use `(pointer: fine)` for desktop).

### Colour checks
- `tools/test/neutral-greys.test.js`: static lint over hex, rgb(a), hsl(a), gradients, url-encoded SVG fills and the style JSON. Effective colour = alpha over #0d0d0d and #1e1e1e; fails on any low-saturation colour whose channels differ by more than 2.
- `tools/audit-colours.js`: runtime audit. Start Chromium with `--remote-debugging-port=9222`, then `docker run --rm --network host -v "$PWD":/w -w /w node:22-slim node tools/audit-colours.js --cdp http://127.0.0.1:9222 --url http://127.0.0.1:8096/` (add `--phone` for 390x844). It walks every visible element in 20 states and writes `.private/colour-audit.md` (not committed).
- `tools/cdp-snippets/selected-sprite.js`: in-page assertions on the selected aircraft's sprite ImageData (no images).

### Map provider failures
`MLR.onError` keeps the last 30 tile failures (`MLR.tileFailures`: status, URL) and logs one `console.warn` per 15 s. Errors whose URL belongs to a different provider than the current style (requests still in flight after a switch) are ignored, which stops one provider's failure being charged to the next. If every provider fails the first is retried after 45 s.


## UI components: one implementation each

Desktop and phone render the same components; only layout and density change (CSS container queries and `body[data-snap]`). Lines removed are from `git diff --stat` of the working tree against the previous commit (net deletions per file).

| File | What was merged or deleted | Lines removed |
| --- | --- | --- |
| `html/ui/infoblock.css` | phone-only instrument tiles (`ibT6`, `ibPhoneInst`, `ibRow2`), old phone selected-sheet block | 125 |
| `html/ui/instruments.css` | one `.ibInstGrid` with `data-component` altitude/speed/direction and summary/detail parts replaces the separate phone grid | net -78 +… (rewritten) |
| `html/ui/maplibre-airports.js` | vector-tile airport pins, flag-image hook, `airportFlagExpr`, `chipZoom`, duplicate pin card, replaced by `maplibre-airport-pins.js` (tiered layers) | 137 |
| `html/ui/maplibre.js` | DOM label pills (`updatePills`, `pills`); labels are now sprites from `label-sprite.js` | 208 (net) |
| `html/ui/maplibre-motion.js`, `maplibre-lift.js` | pill marker code | 6 |
| `html/ui/maplibre.css`, `airlines.css` | `.mlPill`, `.mlPill .alogo` | 17 |
| close controls | `.setClose`, `.apX`, `.gClose`, `.popoverClose`, per-surface close buttons: all use the one `.sk-x` | ~40 across `settings.css`, `airport.css`, `shell.css`, `phone.css`, `elevation.css` |
| `html/script.js`, `index.html`, `shell.css`, `elevation.css`, `phone.css` | `#search_warning` banner and its jQuery show/hide: `showSearchWarning` now calls `SKYUI.toast` | ~25 |
| `html/ui/palette.css`, `palette.js` | `.palEmpty` replaced by `.sk-empty` | 1 |

Phase 38 additions (same rule, one implementation each):

| File | What was merged or deleted |
| --- | --- |
| `html/index.html`, `html/ui/control-stack.js` (new), `html/ui/shell.css`, `html/ui/phone.css` | The phone map buttons (`.pcBtn`, `#phoneCtl`, `#phoneView`, `#phoneInfo`, the `.pcCycle` view button and its menu) and the desktop `#controlStack` are ONE component, `#controlStack`, with the same element ids and handlers: a glass column at the top right on desktop; on phones the same element becomes the floating cluster, anchored above the open bottom surface by `--bottom-inset` (written only by `CONTROLS.BOTTOMINSET.update()`). The old `#dimSwitch` 2D/3D/Globe pill is the `#viewMenu` of the single `#view_cycle` button, which shows the current mode on every screen. The `#RP` history button moved from the view pill into the stack. `phone_list_button` and `initPhoneLayout()` (dead since the bottom sheet) are gone. |
| `html/ui/phone.js` | `buildCtl()`, `syncCtl` bodies, `clickId`, `rbtn` and seven icon paths: replaced by the shared stack. |
| `html/ui/shell.css`, `airport.css`, `airport-panel.js`, `palette.css`, `palette.js` | Chips: `.apChip`, `.apPill`, `.apCat` and `.palChip` are the one `.chip` (with `.k` muted, `.cat` and the flight-category variants `.VFR .MVFR .IFR .LIFR`). Side effect: the airport panel's MVFR and LIFR chips now use the same colours as the airport marker rings (they were blue and a different violet). |
| `html/ui/maplibre-airport-pins.js`, `airport-pin-style.js` | The tier dot sprites `ap-dot*` are gone; the restored flag-in-circle marker is the only airport marker. |

Merged in Phase 40: `.apCard`/`.apTile` are `.ibCard`/`.ibTile`, `.apBtn` and `.rdBtn` are the shared `.act` pill (`.act.on` for the active state). Nothing is left in a second form. The `#RP` replay button is authored once, in the top-bar `#viewPill` on desktop; on phones `CONTROLS.placeReplay()` moves that same element into `#controlStack` (one id, one `showReplayBar` handler).

`tools/test/one-component-set.test.js` fails if any retired class, function or file name above reappears, or if a `data-component` set is duplicated in `index.html`.

## Running every check: `tools/run-checks.sh`

```
tools/run-checks.sh                 # everything (long: run it in a terminal, not under a short timeout)
tools/run-checks.sh --only REGEX    # a subset, by check name
tools/run-checks.sh --device-only   # ONLY the checks that need a real GPU (models3d-budget)
SITE_URL=http://127.0.0.1:8098 tools/run-checks.sh --only icon-colour   # against the fake feed instead of your receiver
```

What it does, in order: deploys the tree into the local container with `scripts/deploy-local.sh` (this step redeploys into your running container; to avoid that, serve a copy with `tools/fake-feed.py` and use `--only` with a regex that does not match `deploy`, so `deploy+exact-tree` is then simply not run) and verifies the served files are the tree's files (md5 against `cachebust.list`); then
- **syntax**: `node --check` over `html/`, `tools/cdp-snippets/`, `tools/models/` (node:22-slim container);
- **unit tests** in `tools/test/*.test.js` (flight status, palette rank, quality calc, static mode, models, and others);
- **server-tests**: `docker build --target test` of `server/Dockerfile` (compiles the TypeScript and runs the 45 `node:test` tests: Python-parity fixtures, proxy allow list, static serving, rate limits, movements, integration). It parses the `# pass` / `# fail` lines and fails on any failure or on zero tests;
- **browser checks** (headless Chromium, software GL, via `tools/cdp-run.js` and `tools/cdp-snippets/*.js`): hotkeys, neutral-greys, audit-colours, console-flow, layout-collision, phone-sheet, intra-panel overlap/clip, controls-regression, route fixtures, one-component-set, label-sprite, airport-pins/proxy/click, perf-counters, perf-overlay, models3d, models3d-height, models3d-zoom-soak, models-gltf, contrails-sky;
- **live-smoke**: the real `aircraft.json` against the page's counter and the map's aircraft source; fails with "SOURCE EMPTY" if the feed is empty;
- **icon-colour**: the bitmap behind every 2D aircraft icon under every combination of 2D and 3D colour settings, plus drawn pixels;
- **models3d-budget**: the GPU frame-time budget. Software GL cannot finish it, so a normal run records **NOT RUN** (never PASS); `--device-only` runs only this check and needs a machine with a real GPU.

It exits non-zero on any failure and prints a summary; logs are in `.private/checks` (wiped each run). `tools/cdp-snippets/models3d-profile.js` is a non-gating profiling harness. Browser checks use SwiftShader, so frame times are relative only. A push needs the full run.

## Layout-collision test (phone and desktop)

`tools/cdp-snippets/layout-collision.js` drives one browser page through every UI state (default, list at each snap, aircraft selected at each snap, airport open at each snap, replay open, Settings root and every drill-in page, search focused) and asserts from DOM bounding boxes only: no two visible floating controls overlap; no floating control covers the content box of any text node or interactive element inside an open panel; no label or button is clipped (`scrollWidth > clientWidth` under `overflow: hidden`); and for the replay panel: the LIVE pill reads LIVE and is unclipped, every speed option is inside the panel, the time text is present and the cluster sits above the panel. Run it at 320x640, 360x640, 375x667, 390x844, 412x915 and 430x932 in phone emulation and once at 1440x900:

```
grep -v '^\s*//' tools/cdp-snippets/layout-collision.js > /tmp/lc.js   # the harness flattens newlines, so line comments must go
# evaluate /tmp/lc.js with Runtime.evaluate (awaitPromise) in a page loaded from the deployed site; it returns {viewport, states, failures}
```

## 3D aircraft models

`html/ui/maplibre-models.js` is a MapLibre custom layer (`type: 'custom'`, `renderingMode: '3d'`) that draws with three.js (core only, `html/libs/three-0.170.0.module.min.js`, MIT). It is lazy-loaded with `import()` the first time 3D is entered with the setting on, and removed (with every geometry, material and the renderer disposed) when leaving 3D or switching the setting off. Any failure (no WebGL2, load error, shader error) falls back to icons with one `console.debug` line.

- **Pure maths** is in `html/ui/models-calc.js` (unit tests: `tools/test/models-calc.test.js`): type to archetype, real dimensions, scale, crossfade, orientation, pitch and roll from data, smoothing, nearest-N.
- **Add an archetype:** add its name to `MODELS.ARCHETYPES` and a default `[span, length]` to `MODELS.DEFAULT`; add types to `MODELS.TYPE_TABLE` (`CODE: [archetype, wingspan m, length m]`); add a branch or a parameter row to `buildGeometry()` in `maplibre-models.js` (geometry is authored in unit span x unit length, +Y nose, +X right wing, +Z up; parts are primitives flagged body 0 or trim 1); extend the tests. Unknown types fall back to engine data (`typeDescription` such as `L2J`, `wtc`, ADS-B category) and then to `generic`.
- **Scale:** `scaleFactor = max(real length, 28 px x metres per pixel) / real length`. A model is never under 28 px on screen and is true size once the real length exceeds that. Icons and models crossfade over half a zoom level from zoom 9. Only the nearest 300 aircraft to the screen centre are models (`MLR.modelsSelect`, run from `flush`); the others keep their icons.
- **Position:** the same `MLR.drawnLL(entry)` as the icon (interpolated position plus the 3D altitude lift), on the terrain surface when terrain is on (`map.queryTerrainElevation`, already exaggerated); the shadow is a flat ellipse under the real ground position. Positions are made relative to the map centre in double precision and the centre is folded into the projection matrix, because float32 world coordinates jitter by metres at high zoom.
- **Orientation:** ENU frame (x east, y north, z up); yaw is true heading else track, clockwise from north; pitch from vertical rate and ground speed (+-15 degrees); roll from the reported roll else the turn rate (+-35 degrees, right wing down positive). MapLibre's world is the ENU frame with y mirrored (north is -y), so the instance matrix is `T * diag(1,-1,1) * Rz(-yaw) * Rx(pitch) * Ry(roll) * S`; the tests pin every sign.
- **Hit-testing and labels:** the icon is kept as the invisible hit target (`icon-opacity` 0 for model-drawn aircraft) and `MLR.closestPlane` widens its radius to the model's on-screen size, so click, hover, selection, follow and trails are unchanged; the label pill moves to sit above the model.


## Phase 40 wrap-up notes

- **Performance overlay.** `?perf=1` or Settings > Advanced. `ui/perf-stats.js` (pure maths, `tools/test/perf-stats.test.js`) and `ui/perf-overlay.js` (DOM, created only while on; no rAF loop, timer or listener when off). While on it switches the 3D layer's timing ring on and restores it when turned off. Copy report copies JSON (no coordinates).
- **Card headers.** One `.cardHead` rule in `ui/components.css` (title left, `.cardHeadMeta` right; wraps instead of overlapping; chips are `flex: none`). Use it for any new card with a chip or timestamp.
- **Route links.** `ibRouteLink` in `ui/infoblock.js` turns a route end into a `role=button` when `AIRPT.find` knows the airport; `AIRPT.openFromAircraft` opens the panel with `body.airportFromAircraft` (the aircraft panel is hidden by CSS, the aircraft stays selected) and the panel renders an `.apBack` chip. `tools/cdp-snippets/route-link.js` injects a fixed aircraft through `processAircraft()` and stubs the route service.
- **Intra-panel test** (`tools/cdp-snippets/intra-panel.js`): no two visible sibling text/interactive elements overlap, nothing leaves its container, no clipped text, no boxed element flush against plain text. Disclosed exemptions: `.psHandle`, `.hBubble`, sticky/fixed elements, sr-only, joined `.segmented` buttons, the peek sheet's deliberate clip window (it checks the header instead), elements whose full text is in `title` / `data-tip` / `aria-label`. Text blocks are compared by their text rects clipped to scrolling ancestors; interactive elements by their box. The older `layout-collision` test only compared the floating controls with panel content, which is why it never saw overlaps inside a panel.
- **Snippet gotcha.** `MLR`, `AIRPT`, `PHONE`, `PERF` are top-level `const`s: they are NOT `window` properties. Use `typeof X != 'undefined'`.
- **Fixed fixtures.** `models3d-height` and `route-link` inject one aircraft (`abc123`) via `processAircraft()` every 300 ms; they never use live traffic.

## Phase 42 (airport open, 3D quality, glTF pipeline) and V1 defaults

- **Airport open:** one `AIRPT.open(rowOrCode, from, source)` for the marker, route link, search, palette and `?airport=ICAO`, with one fly policy (`AIRPT.fly`). Test: `airport-click-desktop`.
- **3D is EXPERIMENTAL and OFF by default in V1.** The 2D map is the default experience and the tested one. The 3D view, aircraft models, 3D quality (Auto / High / Balanced / Low), 3D aircraft colour and the contrail option are all labelled experimental in the UI. 3D is not tuned for weak GPUs.
- `?perf=1` shows device-independent counters (draw calls, triangles, texture uploads, tiles in flight, symbol layers, queries per second, canvas size, GPU renderer); `?fps=N` caps the frame rate; `?airport=ICAO` opens an airport. Checks: `perf-counters`, `perf-overlay`, `quality-calc` (unit), `models-gltf`, `contrails-sky`.
- **2D icon colour:** `icon-colour` reads the bitmap MapLibre holds for every aircraft icon (and the drawn pixels) under every combination of the 2D "Aircraft colour" and the 3D-only settings, and asserts that 3D settings never change a 2D icon. A grey icon in 2D is the stale-position rule (no position for more than 15 s draws `#8f8f8f`).
- **Live smoke:** `live-smoke` loads the page against the real `aircraft.json` and asserts the aircraft counter and the map's aircraft source are above 0 and match the JSON, and that the data is fresh. A feed with no aircraft FAILS it with "SOURCE EMPTY" (that is the receiver, not the page).
- **Fake feed for testing without a receiver:** `python3 tools/fake-feed.py [port=8098] [count=30]` serves `html/` plus synthetic moving aircraft; point any check at it with `SITE_URL=http://127.0.0.1:8098 tools/run-checks.sh --only <name>`.

## The Skywatch server (`server/`)

Optional Node.js + TypeScript server (Node built-ins only; `tsc` is the only dev dependency). It replaces the old Python recorder. Layout: `src/main.ts` (start-up), `config.ts` (env + `skywatch-config.json`), `http.ts` (routing), `static.ts`, `proxy.ts` (GET-only allow list; the upstream is fixed by `READSB_URL`), `ratelimit.ts`, `recorder.ts` + `history.ts` / `weather.ts` / `movements.ts` / `alerts.ts` (one module each), `util.ts` (atomic writes, Python-compatible rounding/JSON). Tests are in `server/test/` (fixtures in `server/test/fixtures/` were generated by running the old Python recorder). Run them with `docker build -f server/Dockerfile --target test .` (this is also the `server-tests` check). Build and run: `docker compose -f docker-compose.example.yml up -d --build`. No default feeds or endpoints point at any particular server, and with `PUBLIC_DEMO=1` alerts stay off.

## Known issues / roadmap

3D performance work is parked for V1. Known and not done:
- 3D label collision handling (only collision freezing while the camera moves exists).
- Tile and DEM churn in 3D with terrain.
- Repaint only on change, and proof of zero per-frame allocation.
- Draw-call reduction beyond hiding empty overlay sources.
- Aircraft model engine and light accents, crisp 3D labels.
- No real aircraft model files are bundled (see `tools/models/README.md`); the 3D view uses procedural shapes.
- 3D was measured only in software GL; real GPU timing is unmeasured.
- ACARS and ATC voice are not in V1.
