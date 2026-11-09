"use strict";
// Skywatch ADS-B: real 3D aircraft models in the 3D view (2D and Globe keep the stock icons).
//
// * A MapLibre custom layer (type 'custom', renderingMode '3d') drawn with three.js. three.js (core only, MIT, libs/three-0.170.0.module.min.js) is
//   LAZY-LOADED the first time the 3D view is entered with the setting on; 2D users never download it. Leaving 3D removes the layer and disposes
//   every GPU resource (geometries, materials, renderer state).
// * One InstancedMesh per archetype (narrowbody, widebody twin / quad, regional jet, business jet, turboprop, light single / twin, helicopter,
//   generic) plus one for the ground shadows. Flat-shaded low-poly built from three.js primitives, no textures, no downloaded models. Capped at the
//   MODEL_CAP aircraft nearest the screen centre; the rest keep their icons.
// * POSITION is the aircraft's TRUE interpolated lon/lat with real height above the surface (terrain added when terrain is on): the model is a real
//   object in the scene, not a lifted icon. Heights: Settings > Map > Aircraft height, Realistic (true) or Compressed (default). The icon stays in
//   the layer as the invisible hit target at the ground point that projects to the model's screen point (MLR.modelAnchor, used by liftLL), so the
//   label pill, hit-testing (MLR.closestPlane) and Follow use the projected 3D point and need no second picking system.
// * SIZE is never below MODELS.MIN_PX on screen (ui/models-calc.js scaleFactor), true scale once the real length exceeds that; icon -> model
//   crossfade over half a zoom level starting at MODELS_Z0.
// * ORIENTATION: yaw from true heading (else track), pitch from vertical rate / ground speed, roll from the reported roll (else the turn rate);
//   all clamped and exponentially smoothed. Conventions: ui/models-calc.js header.
// A failure at any point (no WebGL2, the lazy load fails, a shader error) falls back to icons with one console.debug line.
(function () {
    const KEY = 'models3d', CAP = 300, Z0 = 9, BAND = 0.5, MIN_PX = 28, LAYER = 'tar-models3d';
    const SRC = 'libs/three-0.170.0.module.min.js';
    let wanted = true;
    try { const v = localStorage.getItem(KEY); if (v === '0' || v === 'false') wanted = false; } catch (e) { /* private mode: default on */ }
    let T = null, loading = null, failed = false, layer = null, dimOn = false;
    const stats = {drawn: 0, byArchetype: {}, loaded: false, active: false, lastFrameMs: 0, builds: 0, disposals: 0,
        frames: 0, skipped: 0, culled: 0, tris: 0, measureAlloc: false, allocBytes: 0, allocMax: 0, gpuMs: null, gpuState: 'not measured'};
    // per-frame CPU timing of the layer (prepare = placement and buffer writes, render = three.js submit), ring buffers filled when stats.timing is on
    const RING = 1024, ring = {prep: new Float64Array(RING), rend: new Float64Array(RING), n: 0};
    stats.timing = false; stats.ring = ring;
    MLR.modelsStats = stats;
    MLR.modelCap = CAP;
    MLR.modelSet = new Map();                     // icao -> {arch, ai, span, length, f, px}
    MLR.modelArr = [];                            // the same entries as an array (the frame loop walks it without allocating)

    MLR.modelsWanted = function () { return wanted && !failed && this.is3D && !this.isGlobe(); };
    MLR.modelsActive = function () { return !!layer && this.modelsWanted(); };
    MLR.setModelsWanted = function (on) {
        wanted = !!on;
        try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* not persisted */ }
        this.syncModels();
    };
    MLR.modelsEnabled = function () { return wanted; };
    // every colour the model layer draws that is not the altitude gradient (the body tint comes from the icon fill): for the colour audit
    MLR.modelsColors = function () { return {trim: [107, 107, 107], shadow: [0, 0, 0], selected: [255, 255, 255], fallbackBody: [207, 207, 207]}; };

    // icon opacity: the dim-others setting and the model/icon crossfade in one expression per layer (restated on state changes only, never per frame)
    MLR.applyIconOpacity = function () {
        const m = this.map;
        if (!m || !this.ready) return;
        const dim = dimOn ? ['case', ['==', ['get', 'sel'], 1], 1, 0.6] : 1;
        const hide = ['case', ['==', ['get', 'm'], 1], 0, 1];
        const planes = this.modelsActive()
            ? ['interpolate', ['linear'], ['zoom'], Z0, dim, Z0 + BAND, ['*', dim, hide]]
            : dim;
        const set = (id, v) => { try { if (m.getLayer(id)) m.setPaintProperty(id, 'icon-opacity', v); } catch (e) { /* style changing */ } };
        set('tar-planes', planes);
        set('tar-planes-sel', this.modelsActive() ? ['interpolate', ['linear'], ['zoom'], Z0, 1, Z0 + BAND, hide] : 1);
        set('tar-plane-labels', dim); set('tar-plane-labels-top', dim);
    };
    MLR.setDimOthers = function (on) { dimOn = !!on; this.applyIconOpacity(); };

    // ----- archetype geometry (authored in unit span x unit length; +Y nose, +X right wing, +Z up) -----
    // Each part is a three.js primitive transformed into place and flagged body (0, tinted) or trim (1, neutral grey: cockpit, engines, props).
    function buildGeometry(arch) {
        const D = MODELS.DEFAULT[arch] || MODELS.DEFAULT.generic, ar = D[1] / D[0];     // length / span: keeps round things round after the non-uniform scale
        const parts = [];
        const M4 = T.Matrix4, V3 = T.Vector3, Q = T.Quaternion, E = T.Euler;
        const add = (geo, pos, rot, scl, part) => {
            const m = new M4().compose(new V3(pos[0], pos[1], pos[2]), new Q().setFromEuler(new E(rot[0], rot[1], rot[2])), new V3(scl[0], scl[1], scl[2]));
            let g = geo.index ? geo.toNonIndexed() : geo; g.applyMatrix4(m); g.computeVertexNormals();
            parts.push({g, part});
            if (g !== geo) geo.dispose();
        };
        const box = (w, l, h, pos, rot, part) => add(new T.BoxGeometry(1, 1, 1), pos, rot || [0, 0, 0], [w, l, h], part || 0);
        const cyl = (rx, len, rz, pos, rot, part, seg) => add(new T.CylinderGeometry(1, 1, 1, seg || 8, 1), pos, rot || [0, 0, 0], [rx, len, rz], part || 0);   // axis along Y
        const cone = (rx, len, rz, pos, rot, part, seg) => add(new T.ConeGeometry(1, 1, seg || 8, 1), pos, rot || [0, 0, 0], [rx, len, rz], part || 0);          // tip at +Y
        const disc = (r, pos, part) => add(new T.CylinderGeometry(1, 1, 1, 14, 1), pos, [0, 0, 0], [r * ar, 0.004, r], part == null ? 1 : part);                  // flat disc in XY
        const jets = arch === 'narrowbody' || arch === 'widebodyTwin' || arch === 'widebodyQuad' || arch === 'regionalJet' || arch === 'businessJet' || arch === 'generic';
        const P = {   // fuselage radius (of length), wing chord, wing y, sweep (rad), tail y, engines [[x, y, len, r]]
            narrowbody:   {r: 0.06, ch: 0.11, wy: 0.04, sw: 0.5, ty: -0.42, eng: [[0.2, 0.02, 0.09, 0.028], [-0.2, 0.02, 0.09, 0.028]]},
            widebodyTwin: {r: 0.07, ch: 0.12, wy: 0.04, sw: 0.5, ty: -0.43, eng: [[0.2, 0.03, 0.11, 0.04], [-0.2, 0.03, 0.11, 0.04]]},
            widebodyQuad: {r: 0.07, ch: 0.12, wy: 0.05, sw: 0.5, ty: -0.43, eng: [[0.13, 0.05, 0.1, 0.034], [-0.13, 0.05, 0.1, 0.034], [0.27, 0.0, 0.1, 0.034], [-0.27, 0.0, 0.1, 0.034]]},
            regionalJet:  {r: 0.055, ch: 0.1, wy: 0.02, sw: 0.45, ty: -0.42, eng: [[0.07, -0.34, 0.1, 0.03], [-0.07, -0.34, 0.1, 0.03]]},
            businessJet:  {r: 0.07, ch: 0.12, wy: 0.0, sw: 0.45, ty: -0.43, eng: [[0.09, -0.32, 0.1, 0.035], [-0.09, -0.32, 0.1, 0.035]]},
            generic:      {r: 0.06, ch: 0.11, wy: 0.04, sw: 0.5, ty: -0.42, eng: [[0.2, 0.02, 0.09, 0.028], [-0.2, 0.02, 0.09, 0.028]]},
            turboprop:    {r: 0.06, ch: 0.1, wy: 0.04, sw: 0.0, ty: -0.42, eng: [[0.17, 0.08, 0.14, 0.032], [-0.17, 0.08, 0.14, 0.032]]},
            lightSingle:  {r: 0.07, ch: 0.16, wy: 0.04, sw: 0.0, ty: -0.42, eng: []},
            lightTwin:    {r: 0.06, ch: 0.15, wy: 0.04, sw: 0.0, ty: -0.42, eng: [[0.2, 0.09, 0.15, 0.032], [-0.2, 0.09, 0.15, 0.032]]},
        }[arch];
        if (arch === 'helicopter') {
            add(new T.SphereGeometry(1, 8, 6), [0, 0.12, 0.02], [0, 0, 0], [0.11 * ar, 0.2, 0.12], 0);            // cabin
            cyl(0.02 * ar, 0.5, 0.025, [0, -0.28, 0.05], [0, 0, 0], 0, 6);                                       // tail boom
            box(0.012 * ar, 0.07, 0.12, [0, -0.52, 0.09], [0, 0, 0], 0);                                         // tail fin
            cyl(0.01, 0.2, 0.01, [0, 0.0, 0.17], [0, 0, 0], 1, 6);                                                // mast
            disc(0.5, [0, 0.0, 0.2], 1);                                                                          // main rotor
            add(new T.CylinderGeometry(1, 1, 1, 10, 1), [0.02 * ar, -0.54, 0.09], [0, 0, Math.PI / 2], [0.05, 0.004, 0.05 * ar], 1);   // tail rotor
            box(0.2 * ar, 0.012, 0.012, [0, 0.12, -0.075], [0, 0, 0], 1); box(0.2 * ar, 0.012, 0.012, [0, 0.0, -0.075], [0, 0, 0], 1);  // skids
        } else {
            const r = P.r, L = 1;
            cyl(r * ar, 0.78 * L, r, [0, -0.04, 0], [0, 0, 0], 0, 10);                                           // fuselage
            cone(r * ar, 0.2 * L, r, [0, 0.45, 0], [0, 0, 0], 0, 10);                                            // nose
            cone(r * ar * 0.9, 0.2 * L, r * 0.9, [0, -0.45, 0.01], [Math.PI, 0, 0], 0, 10);                     // tail cone
            add(new T.SphereGeometry(1, 6, 4), [0, 0.38, r * 0.45], [0, 0, 0], [r * ar * 0.62, 0.05, r * 0.5], 1);   // cockpit glazing
            for (const s of [1, -1]) {                                                                           // wings, swept back
                const half = 0.5 - r * ar;
                add(new T.BoxGeometry(1, 1, 1), [s * (r * ar + half / 2 * Math.cos(P.sw)), P.wy - half / 2 * Math.sin(P.sw), -r * 0.2], [0, 0, -s * P.sw], [half, P.ch, 0.012], 0);
                add(new T.BoxGeometry(1, 1, 1), [s * 0.12, P.ty, 0.0], [0, 0, -s * 0.3], [0.17, 0.07, 0.01], 0);   // tailplane
            }
            const fin = (arch === 'regionalJet' || arch === 'businessJet');
            box(0.012 * ar, 0.1, 0.16, [0, P.ty - 0.01, fin ? r + 0.07 : r + 0.06], [0, 0, 0], 0);              // fin
            if (fin) box(0.26, 0.07, 0.01, [0, P.ty - 0.02, r + 0.14], [0, 0, 0], 0);                            // T-tail
            for (const [x, y, len, er] of P.eng) {
                const pod = arch === 'regionalJet' || arch === 'businessJet';
                cyl(er * ar * 1.2, len, er, [x, y, pod ? r * 0.55 : -r * 0.9], [0, 0, 0], 1, 8);
                if (arch === 'turboprop' || arch === 'lightTwin') disc(0.1, [x, y + len / 2 + 0.003, pod ? 0 : -r * 0.9], 1);
            }
            if (arch === 'lightSingle') { disc(0.1, [0, 0.5, 0], 1); box(0.01 * ar, 0.02, 0.02, [0, 0.5, 0], [0, 0, 0], 1); }
            if (arch === 'turboprop' || arch === 'lightSingle' || arch === 'lightTwin') {}
        }
        // merge
        let n = 0; for (const p of parts) n += p.g.attributes.position.count;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
        let o = 0;
        for (const p of parts) {
            const c = p.g.attributes.position.count;
            pos.set(p.g.attributes.position.array, o * 3); nor.set(p.g.attributes.normal.array, o * 3);
            for (let i = 0; i < c; i++) part[o + i] = p.part;
            o += c; p.g.dispose();
        }
        let minZ = Infinity; for (let i = 2; i < pos.length; i += 3) if (pos[i] < minZ) minZ = pos[i];
        for (let i = 2; i < pos.length; i += 3) pos[i] -= minZ;                      // the belly is the origin: scale and rotation pivot about it, and a grounded aircraft rests on the surface
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('part', new T.BufferAttribute(part, 1));
        void jets;
        return g;
    }
    function makeMaterial() {
        return new T.ShaderMaterial({
            transparent: false, depthWrite: true, depthTest: true, side: T.BackSide,    // opaque and depth-tested; the Mercator mirror flips winding, so BackSide culls the far faces
            
            uniforms: {uAlpha: {value: 1}, uTrim: {value: new T.Color(107 / 255, 107 / 255, 107 / 255)}},
            vertexShader: 'attribute float part; varying vec3 vN; varying float vPart; varying vec3 vTint;\n' +
                'void main() { vPart = part;\n#ifdef USE_INSTANCING_COLOR\n vTint = instanceColor;\n#else\n vTint = vec3(1.0);\n#endif\n' +
                ' mat3 nm = mat3(instanceMatrix); vN = normalize(nm * normal);\n gl_Position = projectionMatrix * instanceMatrix * vec4(position, 1.0); }',
            fragmentShader: 'precision highp float; uniform float uAlpha; uniform vec3 uTrim; varying vec3 vN; varying float vPart; varying vec3 vTint;\n' +
                'void main() { vec3 base = mix(vTint, uTrim, vPart); vec3 L = normalize(vec3(0.35, -0.45, 0.82));\n' +
                ' float d = abs(dot(normalize(vN), L)); float shade = 0.5 + 0.5 * d;\n gl_FragColor = vec4(base * shade, uAlpha); }',
        });
    }

    // ----- the custom layer -----
    function createLayer() {
        const state = {meshes: {}, meshesByIndex: [], shadow: null, scene: null, camera: null, renderer: null, mats: [], geos: [], tmp: null};
        const mat4 = () => new T.Matrix4();
        return {
            id: LAYER, type: 'custom', renderingMode: '3d', _s: state,
            onAdd(map, gl) {
                if (typeof WebGL2RenderingContext == 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is not available');
                state.map = map; state.gl = gl;
                state.renderer = new T.WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true});
                state.renderer.autoClear = false;
                state.scene = new T.Scene(); state.camera = new T.Camera();
                state.mat = makeMaterial(); state.mats.push(state.mat);
                for (const a of MODELS.ARCHETYPES) {
                    const g = buildGeometry(a); state.geos.push(g);
                    (stats.trisByArchetype || (stats.trisByArchetype = {}))[a] = g.attributes.position.count / 3;
                    const mesh = new T.InstancedMesh(g, state.mat, CAP);
                    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
                    mesh.setColorAt(0, new T.Color(1, 1, 1)); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
                    state.meshes[a] = mesh; state.meshesByIndex.push(mesh); state.scene.add(mesh);
                }
                const sg = new T.CircleGeometry(0.5, 16); state.geos.push(sg);
                const sm = new T.MeshBasicMaterial({color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false}); state.mats.push(sm);
                state.shadow = new T.InstancedMesh(sg, sm, CAP); state.shadow.count = 0; state.shadow.frustumCulled = false; state.shadow.renderOrder = -1;
                state.shadow.instanceMatrix.setUsage(T.DynamicDrawUsage);
                state.scene.add(state.shadow);
                stats.builds++; stats.loaded = true;
                state.ok = true;
            },
            render(gl, args) {
                if (!state.ok) return;
                const t0 = performance.now();
                try { MLR.modelsFrame(state, args); } catch (e) { MLR.modelsFail(e); return; }
                stats.lastFrameMs = performance.now() - t0;
            },
            onRemove() {
                try {
                    for (const m of Object.values(state.meshes)) { m.dispose && m.dispose(); }
                    if (state.shadow) state.shadow.dispose();
                    for (const g of state.geos) g.dispose();
                    for (const m of state.mats) m.dispose();
                    state.renderer && state.renderer.dispose();
                } catch (e) { /* already gone */ }
                state.ok = false; state.meshes = {}; state.meshesByIndex = []; state.geos = []; state.mats = []; stats.disposals++; stats.loaded = false;
            },
        };
    }

    // ----- true 3D placement -----
    // A model stands at its TRUE lon/lat with real height above the surface; the layer's matrix is map.transform.mercatorMatrix (double precision),
    // so the model is a real object in the scene and zooming scales it like the map. "Realistic" uses the true height (geometric altitude, else
    // barometric); "Compressed" (default) places the model at the height whose SCREEN offset above its shadow is the soft-limited (tanh) offset of the
    // real altitude (same formula as the 2D-icon lift): monotonic in altitude, never decreasing with zoom, always in view above its shadow.
    const HKEY = 'modelHeight';
    let heightMode = 'compressed';
    try { const v = localStorage.getItem(HKEY); if (v === 'realistic' || v === 'compressed') heightMode = v; } catch (e) { /* default */ }
    MLR.modelHeightMode = function () { return heightMode; };
    MLR.setModelHeightMode = function (v) {
        heightMode = v === 'realistic' ? 'realistic' : 'compressed';
        try { localStorage.setItem(HKEY, heightMode); } catch (e) { /* not persisted */ }
        if (this.liftCamera) this.liftCamera();
        this.touch && this.touch('planes');
        this.map && this.map.triggerRepaint();
    };
    const G = {}, PO = {}, ELL = {x: 0, y: 0}, R = new Float64Array(9), R2 = new Float64Array(9);
    const CAM = {w: 1, h: 1, pitch: 0, mpp: 1};
    function meters(p) {
        if (MLR.testAltM != null) return MLR.testAltM;               // test hook: a known altitude for the projection tables
        if (p.altitude === 'ground' || p.onGround) return 0;
        const ft = typeof p.alt_geom === 'number' ? p.alt_geom : (typeof p.altitude === 'number' ? p.altitude : 0);
        return ft > 0 ? ft * 0.3048 : 0;
    }
    function terrainM(map, s, lon, lat, now) {
        if (!map.getTerrain || !map.getTerrain()) return 0;
        if (s.elT === undefined || now - s.elT > 1000) {
            s.elT = now;
            try { s.el = map.queryTerrainElevation({lng: lon, lat}) || 0; } catch (er) { s.el = s.el || 0; }
        }
        return s.el || 0;
    }
    // the model's pose for entry e at the CURRENT camera. Returns PO {x, y (screen px of the belly), dz, ok} and G (ground clip); no allocation.
    MLR.modelPose = function (e, ll, now) {
        const map = this.map, t = map.transform, M = t.mercatorMatrix, c = map.getContainer();
        const W = c.clientWidth, H = c.clientHeight, p = e.plane;
        const s = e.mo || (e.mo = {t: now});
        MODELS.ground(M, ll[0], ll[1], terrainM(map, s, ll[0], ll[1], now), G);
        if (!G.ok) { PO.ok = false; return PO; }
        const altM = meters(p);
        const pitch = map.getPitch() * Math.PI / 180, mpp = MODELS.metresPerPixel(ll[1], map.getZoom());
        const raw = pitch < 0.01 ? 0 : altM * MLR.liftK() / mpp * Math.sin(pitch);
        MODELS.pose(M, G, altM, heightMode, raw, Math.min(LIFT.max, H * 0.3), W, H, PO);
        return PO;
    };
    MLR.liftK = function () { return LIFT.k; };
    // ground point that projects to the model's screen point: the icon, label, hit target and Follow use it (ui/maplibre-lift.js liftLL)
    MLR.modelAnchor = function (ll, p) {
        const e = this.planes.get(p.icao);
        if (!e) return null;
        const po = this.modelPose(e, ll, performance.now());
        if (!po.ok || !isFinite(po.x) || !isFinite(po.y)) return null;
        const u = this.map.unproject([po.x, po.y]);
        return [u.lng, u.lat];
    };

    // one frame: place every model-set aircraft, update the instance buffers, render. Allocation-free in steady state (scratch objects and typed
    // arrays only); `stats.alloc*` measure it when MLR.modelsStats.measureAlloc is set.
    const TMP = {};
    const D2R = Math.PI / 180;
    MLR.modelsFrame = function (state, args) {
        const map = this.map, t = map.transform, M = t.mercatorMatrix, zoom = map.getZoom(), w = MODELS.modelWeight(zoom, Z0, BAND), now = performance.now();
        const heap = stats.measureAlloc && performance.memory ? performance.memory.usedJSHeapSize : 0;
        const src = this.modelTestPlanes || this.planes;
        stats.frames++;
        if (!TMP.q) { TMP.counts = new Int32Array(MODELS.ARCHETYPES.length); TMP.p = new T.Matrix4(); }
        const c = map.getContainer(), W = c.clientWidth, H = c.clientHeight;
        const pitch = map.getPitch() * D2R, maxPx = Math.min(LIFT.max, H * 0.3), kx = LIFT.k;
        // origin: the map centre in Mercator (double precision) folded into the projection matrix; instance positions are relative to it
        const cc = t.center, cs = Math.sin(cc.lat * D2R), ox = (cc.lng + 180) / 360, oy = 0.5 - Math.log((1 + cs) / (1 - cs)) / (4 * Math.PI);
        const counts = TMP.counts; counts.fill(0);
        let shadows = 0, drawn = 0;
        const arr = this.modelArr, n = arr.length, margin = 120;
        let culled = 0;
        for (let q = 0; q < n; q++) {
            const d = arr[q], e = src.get(d.icao);
            if (!e || !e.plane.proj) continue;
            const p = e.plane, ai = d.ai, mesh = state.meshesByIndex[ai];
            if (!mesh || counts[ai] >= CAP) continue;
            const ll = this.baseLL(e);
            const s = e.mo || (e.mo = {t: now});
            MODELS.ground(M, ll[0], ll[1], terrainM(map, s, ll[0], ll[1], now), G);
            if (!G.ok) continue;
            // cheap cull before any further maths: the ground point and the (compressed or true) top of the model must be near the screen
            const altM = meters(p), mpp = MODELS.metresPerPixel(ll[1], zoom);
            const raw = pitch < 0.01 ? 0 : altM * kx / mpp * Math.sin(pitch);
            MODELS.pose(M, G, altM, heightMode, raw, maxPx, W, H, PO);
            if (!PO.ok) continue;
            const sg = 0.5 * (1 + G.cx / G.cw) * W;
            if ((PO.x < -margin - d.px && sg < -margin - d.px) || (PO.x > W + margin + d.px && sg > W + margin + d.px) || PO.y < -margin - d.px * 2 || PO.y - maxPx > H + margin + d.px) { culled++; continue; }
            const dt = Math.min(0.5, (now - s.t) / 1000); s.t = now;
            const heading = typeof p.true_heading == 'number' ? p.true_heading : (typeof p.track == 'number' ? p.track : (p.rotation || 0));
            const vs = typeof p.geom_rate == 'number' ? p.geom_rate : p.baro_rate, gs = typeof p.gs == 'number' ? p.gs : p.speed;
            const onG = p.altitude === 'ground' || p.onGround;
            s.yaw = MODELS.smoothAngle(s.yaw, heading, dt, 0.5, true);
            s.pitch = MODELS.smoothAngle(s.pitch, onG ? 0 : MODELS.pitchFrom(vs, gs), dt, 0.9);
            s.roll = MODELS.smoothAngle(s.roll, onG ? 0 : MODELS.rollFrom(typeof p.roll == 'number' ? p.roll : null, p.track_rate, gs), dt, 0.7);
            MODELS.orientationInto(R, s.yaw, s.pitch, s.roll);
            const sc = G.k * d.f, sx = d.span * sc, sy = d.length * sc, sz = d.length * sc;
            const i = counts[ai]++, a = mesh.instanceMatrix.array, o = i * 16;
            // T(rel) * diag(1,-1,1) * R_enu * S  (Mercator y runs south; the belly of the model is its origin, so it pivots about the belly)
            a[o] = R[0] * sx; a[o + 1] = -R[3] * sx; a[o + 2] = R[6] * sx; a[o + 3] = 0;
            a[o + 4] = R[1] * sy; a[o + 5] = -R[4] * sy; a[o + 6] = R[7] * sy; a[o + 7] = 0;
            a[o + 8] = R[2] * sz; a[o + 9] = -R[5] * sz; a[o + 10] = R[8] * sz; a[o + 11] = 0;
            a[o + 12] = G.mx - ox; a[o + 13] = G.my - oy; a[o + 14] = G.zg + PO.dz; a[o + 15] = 1;
            const ca = mesh.instanceColor.array, co = i * 3;
            if (e.mcSrc !== (e.sel ? '#ffffff' : e.fillColor)) { e.mcSrc = e.sel ? '#ffffff' : e.fillColor; parseHex(e.mcSrc || '#cfcfcf', e); }
            ca[co] = e.mcR; ca[co + 1] = e.mcG; ca[co + 2] = e.mcB;
            drawn++;
            if (shadows < CAP) {   // soft blob on the surface at the TRUE ground point
                MODELS.orientationInto(R2, s.yaw, 0, 0);
                const sa = state.shadow.instanceMatrix.array, so = shadows * 16, ssx = d.span * sc * 0.55, ssy = d.length * sc * 0.55;
                sa[so] = R2[0] * ssx; sa[so + 1] = -R2[3] * ssx; sa[so + 2] = 0; sa[so + 3] = 0;
                sa[so + 4] = R2[1] * ssy; sa[so + 5] = -R2[4] * ssy; sa[so + 6] = 0; sa[so + 7] = 0;
                sa[so + 8] = 0; sa[so + 9] = 0; sa[so + 10] = 1; sa[so + 11] = 0;
                sa[so + 12] = G.mx - ox; sa[so + 13] = G.my - oy; sa[so + 14] = G.zg + 0.2 * G.k; sa[so + 15] = 1;
                shadows++;
            }
        }
        const meshes = state.meshesByIndex;
        for (let ai = 0; ai < meshes.length; ai++) {
            const mesh = meshes[ai]; mesh.count = counts[ai];
            if (counts[ai]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
            stats.byArchetype[MODELS.ARCHETYPES[ai]] = counts[ai];
        }
        stats.drawn = drawn;
        state.shadow.count = shadows; if (shadows) state.shadow.instanceMatrix.needsUpdate = true;
        stats.culled = culled;
        const t1 = stats.timing ? performance.now() : 0;
        if (!drawn && !shadows) { stats.skipped++; if (heap) trackAlloc(heap); return; }
        state.mat.uniforms.uAlpha.value = w; state.mat.transparent = w < 1;
        state.shadow.material.opacity = 0.3 * w;
        // projection = mercatorMatrix * translate(origin): the same double-precision matrix the map uses, with the origin folded in
        const P = TMP.p.elements;
        for (let k = 0; k < 12; k++) P[k] = M[k];
        P[12] = M[0] * ox + M[4] * oy + M[12]; P[13] = M[1] * ox + M[5] * oy + M[13]; P[14] = M[2] * ox + M[6] * oy + M[14]; P[15] = M[3] * ox + M[7] * oy + M[15];
        state.camera.projectionMatrix.copy(TMP.p);
        state.renderer.resetState();
        const q0 = gpuBegin(state);
        state.renderer.render(state.scene, state.camera);
        gpuEnd(state, q0);
        state.renderer.resetState();
        if (stats.timing) { const i = ring.n++ % RING; ring.prep[i] = t1 - now; ring.rend[i] = performance.now() - t1; }
        if (heap) trackAlloc(heap);
    };
    function trackAlloc(h0) { const d = performance.memory.usedJSHeapSize - h0; if (d > 0) { stats.allocBytes += d; if (d > stats.allocMax) stats.allocMax = d; } }
    // GPU time with EXT_disjoint_timer_query_webgl2 when the browser offers it (software GL headless does not): one query in flight at a time
    function gpuBegin(state) {
        if (!stats.timing) return null;
        const gl = state.gl;
        if (state.gpuExt === undefined) { state.gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null; stats.gpuState = state.gpuExt ? 'EXT_disjoint_timer_query_webgl2' : 'not available'; }
        if (!state.gpuExt) return null;
        if (state.gpuQ) {
            const q = state.gpuQ;
            if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
                if (!gl.getParameter(state.gpuExt.GPU_DISJOINT_EXT)) { stats.gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; (stats.gpuSamples || (stats.gpuSamples = [])).push(stats.gpuMs); }
                gl.deleteQuery(q); state.gpuQ = null;
            } else return null;
        }
        const q = gl.createQuery(); gl.beginQuery(state.gpuExt.TIME_ELAPSED_EXT, q); return q;
    }
    function gpuEnd(state, q) { if (q) { state.gl.endQuery(state.gpuExt.TIME_ELAPSED_EXT); state.gpuQ = q; } }
    function parseHex(h, e) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h);
        e.mcR = m ? parseInt(m[1], 16) / 255 : 0.81; e.mcG = m ? parseInt(m[2], 16) / 255 : 0.81; e.mcB = m ? parseInt(m[3], 16) / 255 : 0.81;
    }

    // choose the model set: the CAP aircraft nearest the screen centre among those that are in view and have a position (called from flush)
    MLR.modelsSelect = function () {
        this.modelSet.clear(); this.modelArr.length = 0;
        if (!this.modelsActive()) return;
        const m = this.map, c = m.getCenter(), ctr = m.project(c), items = [];
        const cw = m.getContainer().clientWidth, ch = m.getContainer().clientHeight;
        for (const e of this.planes.values()) {
            const p = e.plane;
            if (!p.proj || !p.position) continue;
            if (typeof p.category === 'string' && p.category[0] === 'C') continue;      // surface vehicles and obstacles keep their icons
            const q = m.project(this.baseLL(e));
            if (q.x < -60 || q.y < -60 - 260 || q.x > cw + 60 || q.y > ch + 60 + 260) continue;     // the model may stand well above its ground point
            items.push({x: q.x, y: q.y, e});
        }
        for (const it of MODELS.nearest(items, ctr.x, ctr.y, CAP)) {
            const e = it.e, p = e.plane;
            const code = p.icaoType, arch = MODELS.archetypeFor(code, {desc: p.typeDescription, wtc: p.wtc, category: p.category}), dm = MODELS.dimsFor(code, arch);
            const lat = p.position[1], f = MODELS.scaleFactor(dm.length, lat, m.getZoom(), MIN_PX), mpp = MODELS.metresPerPixel(lat, m.getZoom());
            const d = {icao: p.icao, arch, ai: MODELS.ARCHETYPES.indexOf(arch), span: dm.span, length: dm.length, f, px: dm.length * f / mpp};
            this.modelSet.set(p.icao, d); this.modelArr.push(d);
        }
    };

    MLR.modelsFail = function (err) {
        if (failed) return;
        failed = true;
        console.debug('3D aircraft models unavailable, using icons:', err && err.message ? err.message : err);
        this.removeModelsLayer();
        this.modelSet.clear(); this.modelArr.length = 0; this.touch && this.touch('planes'); this.applyIconOpacity();
    };
    MLR.removeModelsLayer = function () {
        const m = this.map;
        try { if (m && m.getLayer(LAYER)) m.removeLayer(LAYER); } catch (e) { /* style changing */ }
        layer = null; stats.active = false;
    };
    // add or remove the layer so it matches (3D view && setting on); lazy-loads three.js on first use
    MLR.syncModels = function () {
        const m = this.map;
        if (!m || !this.ready) return;
        const want = this.modelsWanted();
        if (!want) {
            if (layer) { this.removeModelsLayer(); this.modelSet.clear(); this.modelArr.length = 0; this.touch('planes'); }
            this.applyIconOpacity();
            return;
        }
        if (layer && m.getLayer(LAYER)) return;
        if (!T) {
            if (!loading) {
                loading = import(new URL(SRC, document.baseURI).href).then((mod) => { T = mod; try { T.ColorManagement.enabled = false; } catch (e) { /* older build */ } }).catch((e) => { loading = null; this.modelsFail(e); });
            }
            loading.then(() => { if (T && !failed) this.syncModels(); });
            return;
        }
        try {
            layer = createLayer();
            m.addLayer(layer, m.getLayer('tar-plane-glow') ? 'tar-plane-glow' : undefined);
            stats.active = true;
        } catch (e) { this.modelsFail(e); return; }
        this.touch('planes'); this.applyIconOpacity();
    };
    MLR.installModels = function () { layer = null; this.syncModels(); this.applyIconOpacity(); };

    jQuery(function () {
        if (typeof Toggle == 'undefined') return;
        const seg = document.getElementById('heightSegmented');
        if (seg) {
            const sync = () => { for (const b of seg.querySelectorAll('[data-height]')) { const on = b.dataset.height === MLR.modelHeightMode(); b.classList.toggle('on', on); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', on ? 'true' : 'false'); } };
            seg.addEventListener('click', (ev) => { const b = ev.target.closest('[data-height]'); if (b) { MLR.setModelHeightMode(b.dataset.height); sync(); } });
            sync();
        }
        new Toggle({key: 'models3d', display: '3D aircraft models (3D view)', container: '#set_appearance', init: wanted,
            setState: function (s) { MLR.setModelsWanted(s); }});
    });
    window.addEventListener('tar:viewmode', () => { try { MLR.syncModels(); } catch (e) { /* not ready */ } });
})();
