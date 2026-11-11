# Aircraft models for the 3D view

The 3D layer ships with its own simple procedural aircraft (one per archetype). Real models are optional: drop in a free model, run one script, and that archetype uses it
(aircraft more than about 90 px long on screen draw the real model, smaller ones the simple one). With no models installed nothing breaks and nothing is fetched except one tiny index file.

## Licences: read this first

Only **CC0** and **CC-BY** models may go in this public repository, and you must **verify the licence on the model's own page** and put that page's URL in the manifest.
Royalty-free marketplace models (CGTrader, TurboSquid, Hum3D, 3DSky and similar) normally forbid redistributing the file: do **not** use them. Do **not** download models from sites you do not know.
CC-BY needs the attribution text shown (the script puts it in Settings > About and you add it to `THIRD_PARTY.md`). NC (non-commercial) and ND licences are refused.

## Where to look (free sources with a licence filter)

| Source | How to filter | Notes |
|---|---|---|
| [Poly Pizza](https://poly.pizza) | search "airplane", "jet", "helicopter"; every model page shows its licence (CC0 or CC-BY) | many small low-poly aircraft, already light |
| [Sketchfab](https://sketchfab.com) | Search > filter "Downloadable" and Licence "CC0" or "CC Attribution"; open the model page and read its licence box | choose glTF/GLB download; skip "Standard"/"Editorial" licences |
| [Kenney](https://kenney.nl/assets) | "Pirate/Space/Car/Vehicle" kits | CC0, stylised |
| [Quaternius](https://quaternius.com) | free packs, check the licence in each pack | CC0, low poly |
| [NASA 3D Resources](https://science.nasa.gov/3d-resources/) | search "aircraft" | NASA media is generally public domain; check the page |

## What to look for, per archetype (one model per slot, file name = archetype)

| Archetype (slot) | Typical real types | Look for |
|---|---|---|
| `narrowbody` | A320 family, 737 | twin underwing engines, single aisle, swept wings |
| `widebodyTwin` | 787, 777, A330, A350 | twin engines, large wingspan, long fuselage |
| `widebodyQuad` | 747, A380 | four engines (A380: full-length upper deck) |
| `regionalJet` | E-Jets, CRJ | rear fuselage engines, T-tail |
| `businessJet` | Citation, Gulfstream, Learjet | small, rear engines, winglets |
| `turboprop` | ATR 72, Dash 8 | high wing, two propellers |
| `lightSingle` | Cessna 172, Piper | single piston engine and propeller |
| `lightTwin` | Piper Seneca, Beech Baron | two piston engines |
| `helicopter` | EC135, R44 | main and tail rotor |
| `generic` | anything else | a plain airliner shape |

Liveries are not wanted: the 3D layer shades by geometry and material **names** (a material or mesh whose name contains glass, window, cockpit, engine, nacelle, propeller, rotor, wheel or gear is drawn
as grey trim; the rear top of the fuselage is the tail fin, which takes the optional airline tint). Textures are dropped by the optimiser.

## Adding a model

1. Download the `.glb` (or glTF) from a page whose licence you have read. Do not edit the file by hand.
2. Add an entry to `models-manifest.json` (the key is the file name without extension):
   ```json
   "a320-lowpoly": {
     "name": "A320 low poly", "archetype": "narrowbody", "author": "Jane Doe",
     "source": "https://poly.pizza/m/XXXX", "licence": "CC-BY-4.0",
     "attribution": "\"A320 low poly\" by Jane Doe (CC BY 4.0), poly.pizza/m/XXXX", "forward": "-z"
   }
   ```
   `forward` is which way the nose points in the file (`-z` is the usual export, `+z` is the glTF spec's "front", `+x`, `-x`). If the model comes out backwards or sideways in the 3D view,
   change it and run the script again.
3. Optimise and install (needs Node 22; or `docker run --rm -v "$PWD":/w -w /w/tools/models node:22 sh -c "npm install && node optimise.js a320-lowpoly /w/path/to/a320.glb"`):
   ```
   cd tools/models && npm install
   node optimise.js a320-lowpoly /path/to/a320.glb
   ```
   The script refuses a model whose entry is incomplete or whose licence is not CC0/CC-BY, simplifies it to at most 15 000 triangles, drops textures, compresses it to at most 300 KB, checks that its
   wingspan/length proportions fit the archetype (a wrong `forward` axis or a model on its side is rejected), writes `html/models/<archetype>.glb` and regenerates `html/models/index.json`.
   A near-square aircraft (span about equal to length, such as a narrowbody) cannot be checked this way, so look at it in the 3D view once.
4. Add the attribution line to `THIRD_PARTY.md` (the test `models-pipeline` fails if an installed CC-BY model is not credited there) and commit `tools/models/models-manifest.json`, `html/models/` and `THIRD_PARTY.md`.

`node optimise.js --index` regenerates `html/models/index.json` from the manifest and the installed files. `tools/test/models-pipeline.test.js` (part of `tools/run-checks.sh`) fails if a manifest entry is incomplete, a licence is not
allowed, an installed model has no manifest entry, or the index and the manifest disagree.

## Runtime behaviour

`html/ui/maplibre-gltf.js` fetches `models/index.json` once when the 3D model layer is created; for each listed archetype it loads the `.glb` lazily (GLTFLoader with the vendored meshopt and Draco
decoders), merges it into one geometry, normalises it (`html/ui/models-norm.js`: unit span and length, belly at the origin, nose along +Y) and draws it with the same instancing as the simple archetype. A missing,
corrupt or unsupported file is ignored silently (the failure is only recorded in `MLR.gltfStats()`).
