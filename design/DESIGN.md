# Skywatch ADS-B: UI redesign spec (v2, "floating glass")

This folder is the design target for this fork. `mockups/` holds five static
HTML mockups. They were exported from a design canvas, so they contain some
template wrappers (`<x-dc>`, `<helmet>`, a `data-dc-script` block). Ignore
those. Read them for **layout, spacing, colour, type and hierarchy**. Numbers
and text are sample data. Open them in a browser to see them.

| File | Screen |
|---|---|
| `mockups/01-live-map.html` | Full-bleed black map, floating glass aircraft panel (selected state), top bar, right control stack, bottom toolbar, altitude legend, 2D/3D switch |
| `mockups/02-aircraft-list.html` | Same shell, nothing selected: the sidebar becomes the aircraft list (stats, search, filter chips, table, source legend) |
| `mockups/03-aircraft-details-history.html` | Wide details panel (all `#selected_*` fields as cards) + history/replay bar over the map |
| `mockups/04-settings-basemaps.html` | Settings dialog with section nav, base map thumbnail picker, overlays, sliders, toggles |
| `mockups/05-phone.html` | Phone: map + bottom sheet |

## Principle

**Data-honest rebuild of the UI layer.** You may change HTML, CSS and JS as
much as needed to reach this design: restructure `index.html`, rewrite the
sidebar/infoblock/settings markup, replace ol-layerswitcher, and so on. Two
rules still hold:

1. **Only show what tar1090 actually receives.** Every field must come from
   readsb's JSON, tar1090's own aircraft DB / route API / photo lookups, or
   computation from those. If tar1090 has no data for it, it is not in the
   design. If an optional source is off (route API, photos), hide that block,
   don't show a placeholder.
2. **Keep the data layer intact**: fetching, `planeObject.js` data handling,
   history/trace loading, filters, URL params and config options keep working.
   Hotkeys keep working. Prefer putting new UI code in new files (`html/ui/*`,
   `html/theme.css`) and deleting the old UI code once replaced, so the diff is
   a clear replacement rather than a pile of patches. Expect that the fork will
   diverge from upstream; keep the data-layer files close to upstream so
   upstream fixes (new readsb fields, bug fixes) can still be merged.

Where a mockup shows something tar1090 has no data for, it has been removed.
The mockups are the source of truth; if you find a mismatch between a mockup
and tar1090's real data, tell the user and propose the nearest honest option.

## Visual language

- The map is **dark charcoal land (`#171717`) with a pure black ocean (`#000`)**, so
  coastlines read through contrast alone. No blue tint, no fills for parks or land
  use. The stock vector styles (CARTO Dark Matter, OpenFreeMap Dark, VersaTiles
  Dark) are not like that, so fetch the style JSON at load and rewrite it
  (`mlBlackStyle()` in `ui/mapstyle.js`, palette in `ML_STYLE`) before handing it
  to MapLibre GL JS. Calm and sparse: no rail, paths, POIs or outlines; country
  borders very faint (`#262626`); a few dim grey roads in a clear hierarchy.
- **Label hierarchy** (all from `mlLabelStyle()`): country names larger (11-15 px),
  medium-light grey (`#9a9a9a`), semi-bold; region/state names small (10 px), dim,
  UPPERCASE, letter-spaced, from zoom 4; city names small and dim (`#6a6a6a`,
  from zoom 5); water names (oceans, seas, gulfs) italic and very dim (`#3e3e3e`);
  lakes, rivers and streams have no label. At world zoom only countries and the
  largest water names show. Map labels never compete with aircraft: the aircraft
  layers take part in label collision (they always draw, the map labels give way).
  Fonts are chosen per provider from what its glyph server really has
  (`ML_FONTS`). Nothing sits on the map except floating **glass** surfaces; the
  top-left wordmark has a glass backing so it stays readable over map labels.
- Glass surface: `background: rgba(20,22,27,.74); backdrop-filter: blur(28px);
  border: 1px solid rgba(255,255,255,.09)`. Provide a solid fallback
  (`rgba(20,22,27,.95)`) where `backdrop-filter` is unsupported.
- Big radii: panels 32px, inner cards 20-24px, pills fully round.
- Numbers, callsigns, hex, squawk, coordinates: **JetBrains Mono**. Everything
  else: **Inter**. Self-host both (many installs are offline).
- Aircraft icons **and tracks** are coloured by altitude (keep tar1090's existing
  scale; the icons, the tracks and the legend all use the same one). Tracks are
  **not white**: the selected aircraft's track uses the same altitude colours,
  slightly thicker, and every track has a thin dark casing so it reads on the
  black map. The selected aircraft's icon is white with a white label pill
  (black text); the projected heading line is dashed white.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000` | map / page |
| `--glass` | `rgba(20,22,27,.74)` | panels, bars, buttons |
| `--tile` | `rgba(255,255,255,.05)` | stat tiles, chips, inputs inside glass |
| `--line` | `rgba(255,255,255,.09)` | 1px borders |
| `--text` | `#F5F7FA` | primary |
| `--text2` | `#C3CAD3` | secondary |
| `--muted` | `#9BA3AD` | labels, must stay >=4.5:1 on glass |
| `--accent` | `#FFFFFF` | selection, active toggles, primary button, selected aircraft and track. **White is the second colour; no blue UI accent.** |
| `--accent-bg` | `rgba(255,255,255,.14)` | active toggle / selected row |
| `--on-accent` | `#000` | text/knob on a white fill |
| `--ok` | `#34D17F`/`#3DDC97` | ADS-B source, climbing |
| `--warn` | `#F5B94A` | warnings |
| `--bad` | `#FF6B6B` | emergency squawk (7500/7600/7700), destructive |

Source markers (consistent everywhere): ADS-B = green circle, MLAT = blue
square `#5FB6D9`, TIS-B = purple triangle `#C9A0F0`, other/no-pos = outlined
square. Altitude legend gradient (low to high): `#F5994A #F2E44A #6BD96B
#4FD1D9 #5B8CFF #B07BFF`.

## Screens to existing tar1090 pieces

### Shell (all desktop screens)
- **Top-left wordmark**: "Skywatch ADS-B" (20px, 600) with "Created by Aarav Sahni"
  below it in small muted text (11px). **No logo/icon**; do not copy any other
  product's branding. Receiver/decoder info (`#webinterface_version` /
  `#decoder_version`) can go in a tooltip or the About section of settings.
- **Top-centre view pill**: Live map / Aircraft list (toggles the sidebar,
  `#toggle_sidebar_button`) / Graphs (link to the graphs1090 URL if present,
  hide otherwise) / Replay (`Shift+Y`, `#replayBar`).
- **Top-right**: search field (merges `#search_form` and `#jump_form`, `/`
  focuses it) and a round settings button (`#settingsCog`).
- **Right control stack**: North-up (reset rotation), Home (`#H`,
  `resetMap()`), Filters (opens altitude `#altitude_filter_*`, source
  `#sourceFilter`, flags `#flagFilter`, in-view `#V`), Layers (base map and
  overlays, replaces ol-layerswitcher), Hide sidebar.
- **Bottom toolbar** = the existing header buttons grouped, each with its
  hotkey shown: Labels `L`, Extended `O`, Track labels `K` | All tracks `T`,
  Persist `P`, Multi `M` | Military `U`, Dim `B`, Random `R`. Active state:
  `--accent-bg` + `--accent`. Isolate (`I`) lives in the aircraft panel.
- **Bottom-left**: altitude legend (`#altitude_chart`). **Bottom-right**:
  zoom +/- (restyled), the **2D / 3D / Globe** view switch (`#dimSwitch`), attribution
  (`#mlAttribution`, must stay visible and match the active provider).
  - 2D: flat map. 3D: tilt to 60 degrees, right-drag rotation, extruded buildings.
    Globe: MapLibre globe projection; it flattens into the normal map as you zoom
    in. Black space, a very faint atmosphere glow only while zoomed out (below
    zoom 6). The choice is saved (`loStore.viewMode`). The Globe button is hidden
    when the browser has no WebGL2. On phones the switch is a compact pill above
    the toolbar, bottom-left.
  - Aircraft icons shrink to half size and labels are hidden when zoomed far out
    (below zoom 3.5), so thousands of aircraft stay readable on the world view.
  - On the globe the data layer still stores Web Mercator metres; hover/click
    skip aircraft on the far side (`MLR.occluded`), and the "in view" extent
    (`mapa.calcExtent`) falls back to the whole world when the window reaches past
    the horizon.

### 01 Live map: selected aircraft panel (`#selected_infoblock`, compact)
Header: **airline logo circle** (30px; a neutral circle with the airline's
three-letter code when there is no logo, never a broken image; hidden for
callsigns that are not airline flights, e.g. registrations), `#selected_callsign`, `#selected_airline`,
`#selected_icao`, collapse (close = `.infoblockCloseBox`).
Route card: `#selected_route` origin/destination (codes + names), **only when
the route API returned data**; hide the card otherwise. No progress bar, no
ETA (tar1090 does not know where along the route the aircraft is). A dashed
great-circle line from the aircraft to the destination may be drawn on the map
only when the route is known.
Tiles: `#selected_speed1` (+TAS), `#selected_altitude1` (+`#selected_vert_rate`
coloured), `#selected_track1`, `#selected_squawk1` (+`#selected_sitedist2`).
Chips: `#selected_source`, `#selected_rssi1`, `#selected_message_rate`,
`#selected_seen`.
Aircraft card: type name + `#selected_icaotype` badge, `#selected_photo` with
`#copyrightInfo` credit, `#selected_registration`, `#selected_country`,
message count.
"All aircraft details" row opens screen 03. Action bar: History
(`#show_trace`), Follow (`toggleFollow()` / `#F`), Isolate (`#I`). No share button.

### 02 Aircraft list (sidebar, nothing selected)
Header with decoder version. Four stat tiles: `#dump1090_total_ac`,
`#dump1090_total_ac_positions`, `#dump1090_message_rate`,
`#dump1090_total_history`. Search (as above). Filter chips (in-view, altitude,
source, flags) and "Columns n of 22" (opens the existing `#sortableColumns`
picker). Table = `#planesTable` (still rebuilt by `planeMan.redraw`; restyle
rows via CSS, don't change the structure). Emergency squawk rows use the
`--bad` outline style and a squawk badge. Source legend at the bottom
(`#legend`).

### 03 Aircraft details + history
Wide state of `#selected_infoblock`. Cards: Altitude (baro, geom, baro rate,
geom rate), Speed (GS, TAS, IAS, Mach), Direction (track, true/mag heading,
roll), Autopilot (nav altitude, nav heading, QNH, nav modes), Wind &
temperature (wind, OAT, TAT, track rate), Signal (RSSI, msg rate, messages,
seen pos), Position (lat/lon, distance, bearing), Accuracy (NACp/NACv, SIL,
NICbaro, Rc). Note: QNH and nav modes currently live elsewhere in the DOM;
regroup them into the Autopilot card. Header: photo, callsign, hex, airline,
type, reg, country, owner, ADS-B version, category. Export buttons
`#export_kml_*`.
**History bar** (bottom of the map) = existing trace controls moved into one
glass bar: `#trace_back_1d`, `#trace_jump_1d`, `#histDatePicker`/`#trace_date`,
`#leg_prev`, `#leg_sel`, `#leg_next`, `#trace_time`, `#tStop`, `#t1x`...`#t40x`.
The altitude-profile scrubber is **new**.

### 04 Settings
Replaces `#settings_infoblock`. Sections: Map & layers, Aircraft & labels,
Table & sidebar, Units & altitude, Photos & routes, Advanced. Every switch is
an existing `Toggle` (rendered into the existing containers, just restyled
and regrouped). Units = `#units_selector`. Sliders = `#iconScaleSlider`,
`#userScaleSlider`. "Reset all settings" = `resetSettings()`.
**Base map picker**: thumbnail grid, OpenFreeMap Dark default, then
Positron, Fiord, Liberty, Satellite (ESRI), OpenStreetMap, Bright, More...
(rest of `layers.js`). Overlays: distance circles (`SiteCircles`), actual
range outline, OpenAIP, RainViewer, wind. Map thumbnails can be static images.

### 05 Phone
Full-screen map, floating search + layers button, small right control stack,
aircraft as a bottom sheet (drag handle; callsign, airline/type/reg, route
bar, six stats, Follow / Show track / expand). The sidebar becomes a sheet.
`onMobile` is already detected in `early.js`. All targets >=44px.

## New work (not in tar1090 today)
1. Altitude-profile scrubber in the history bar (data is in the trace).
2. Unified search field merging `#search_form` and `#jump_form`.
3. Base map thumbnail picker + overlay list replacing ol-layerswitcher.
4. North-up button and `/` search hotkey (check for key clashes in the
   `keydown` handler first).
5. Bottom sheet behaviour on phone.
6. (done) The 2D / 3D / Globe switch is live.

Deliberately **not** designed (ACARS and ATC voice are not in V1): ACARS, weather, flight-schedule timings,
"flown today", route progress/ETA, share-link buttons. tar1090 has
no such data, or the feature is not wanted.

## Airline logos
A round logo (22px in list rows, 30px in the panel header, 16px on map labels)
in front of the callsign, in the aircraft list rows, the selected panel, the
hover card and map labels. tar1090 only knows the ICAO prefix of the callsign;
`ui/airline-codes.js` (Wikidata, CC0) maps it to the IATA code and the logo is
loaded by IATA code from a keyless host (`airlineLogoUrl`). Fallback is a
neutral circle with the 3-letter airline code (on the map: no icon). Only
callsigns of the form 3 letters + digit count as airline flights. One request
per airline, cached; a Settings switch turns logos off. No logo files are stored in the repo.

## Map tech note
The map is rendered by **MapLibre GL JS** (BSD-3, vendored in `html/libs/`),
behind a thin adapter (`ui/map-adapter.js`, `ui/mapgeo.js`). Aircraft, trails,
labels and range overlays are GeoJSON sources with data-driven layers. Only
**keyless** map providers are used (the site is public, no billing risk):
OpenFreeMap Dark is the default, CARTO Dark Matter is the second choice and the
automatic fallback if a provider fails. CARTO may require a key for vector styles in
future. OpenLayers (the original renderer) was removed in the last commit of the MapLibre
work; the tag `phase-11-done` is the last version that still contains it.

## Accessibility
Real `<button>`/`<input>`/`<label>`, `aria-label` on icon-only buttons,
visible focus rings in `--accent`, text contrast >=4.5:1, source and altitude
never conveyed by colour alone (shape differs for source), respect
`prefers-reduced-motion` and `prefers-reduced-transparency` (solid panels).
