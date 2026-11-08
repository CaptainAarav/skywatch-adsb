"use strict";
// Skywatch ADS-B: thin map adapter.
//
// script.js and planeObject.js talk to the map only through `mapa` (view, extent, pixels, layers) and
// `mapgeo` (projection, distance, geometry). The implementation, on MapLibre GL JS, is in ui/maplibre.js.
//
// Coordinates: "lonlat" is [lon, lat]; "proj" is Web Mercator metres (what the plane data layer stores).
// Zoom uses the 256 px-world numbering tar1090 always had (MapLibre's zoom + 1).

const mapa = {};
