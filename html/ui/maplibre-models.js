"use strict";
// Skywatch ADS-B: real 3D aircraft models in the 3D view (2D and Globe keep the stock icons).
//
// * A MapLibre custom layer (type 'custom', renderingMode '3d') drawn with three.js. three.js (core only, MIT, libs/three-0.170.0.module.min.js) is
//   LAZY-LOADED the first time the 3D view is entered with the setting on; 2D users never download it. Leaving 3D removes the layer and disposes
//   every GPU resource (geometries, materials, renderer state).
// * One InstancedMesh per archetype (narrowbody, widebody twin / quad, regional jet, business jet, turboprop, light single / twin, helicopter,
//   generic) plus one for the ground shadows. Flat-shaded low-poly built from three.js primitives, no textures, no downloaded models. Capped at the
//   MODEL_CAP aircraft nearest the screen centre; the rest keep their icons.
// * POSITION is exactly where the icon is drawn: MLR.drawnLL(entry), the interpolated position with the 3D altitude lift (ui/maplibre-lift.js), on
//   the terrain surface when terrain is on. So the label pill, hit-testing (MLR.closestPlane), trails and Follow need no second system.
//   The icon stays in the layer as the (invisible) hit target: its opacity is 0 for model-drawn aircraft; closestPlane widens its radius to the model.
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
    const stats = {drawn: 0, byArchetype: {}, loaded: false, active: false, lastFrameMs: 0, builds: 0, disposals: 0};
    MLR.modelsStats = stats;
    MLR.modelCap = CAP;
    MLR.modelSet = new Map();                     // icao -> {arch, span, length, px}

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
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('part', new T.BufferAttribute(part, 1));
        void jets;
        return g;
    }
    function makeMaterial() {
        return new T.ShaderMaterial({
            transparent: true, depthWrite: true, depthTest: true, side: T.DoubleSide,
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
        const state = {meshes: {}, shadow: null, scene: null, camera: null, renderer: null, mats: [], geos: [], tmp: null};
        const mat4 = () => new T.Matrix4();
        return {
            id: LAYER, type: 'custom', renderingMode: '3d', _s: state,
            onAdd(map, gl) {
                if (typeof WebGL2RenderingContext == 'undefined' || !(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is not available');
                state.map = map;
                state.renderer = new T.WebGLRenderer({canvas: map.getCanvas(), context: gl, antialias: true});
                state.renderer.autoClear = false;
                state.scene = new T.Scene(); state.camera = new T.Camera();
                state.mat = makeMaterial(); state.mats.push(state.mat);
                for (const a of MODELS.ARCHETYPES) {
                    const g = buildGeometry(a); state.geos.push(g);
                    const mesh = new T.InstancedMesh(g, state.mat, CAP);
                    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
                    mesh.setColorAt(0, new T.Color(1, 1, 1)); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
                    state.meshes[a] = mesh; state.scene.add(mesh);
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
                state.ok = false; state.meshes = {}; state.geos = []; state.mats = []; stats.disposals++; stats.loaded = false;
            },
        };
    }

    const TMP = {};
    // one frame: place every model-set aircraft, update the instance buffers, render
    MLR.modelsFrame = function (state, args) {
        const map = this.map, zoom = map.getZoom(), w = MODELS.modelWeight(zoom, Z0, BAND), now = performance.now();
        const proj = (args && args.defaultProjectionData && args.defaultProjectionData.mainMatrix) || (args && args.modelViewProjectionMatrix) || args;
        if (!TMP.q) { TMP.q = new T.Quaternion(); TMP.v = new T.Vector3(); TMP.s = new T.Vector3(); TMP.m = new T.Matrix4(); TMP.r = new T.Matrix4(); TMP.c = new T.Color(); TMP.S = new T.Matrix4().makeScale(1, -1, 1); TMP.r2 = new T.Matrix4(); TMP.o = new T.Matrix4(); TMP.p = new T.Matrix4(); }
        // positions are made relative to the map centre in double precision and the centre is folded into the projection matrix:
        // float32 world coordinates (0..1 around the Earth) would jitter by metres at high zoom
        const oc = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 0);
        const counts = {}; let shadows = 0; stats.drawn = 0;
        const terrain = map.getTerrain && map.getTerrain();
        for (const a of MODELS.ARCHETYPES) counts[a] = 0;
        for (const [icao, d] of this.modelSet) {
            const e = this.planes.get(icao);
            if (!e || !e.plane.proj) continue;
            const p = e.plane, mesh = state.meshes[d.arch];
            if (!mesh || counts[d.arch] >= CAP) continue;
            const ll = this.drawnLL(e), base = this.baseLL(e);
            const lat = ll[1], k = maplibregl.MercatorCoordinate.fromLngLat({lng: ll[0], lat}, 0).meterInMercatorCoordinateUnits();
            const f = MODELS.scaleFactor(d.length, lat, zoom, MIN_PX);
            let elev = 0, belev = 0;
            if (terrain) { try { elev = map.queryTerrainElevation({lng: ll[0], lat}) || 0; belev = map.queryTerrainElevation({lng: base[0], lat: base[1]}) || 0; } catch (er) { /* tiles not ready */ } }
            const mc = maplibregl.MercatorCoordinate.fromLngLat({lng: ll[0], lat}, 0);
            // orientation with smoothing (state kept on the entry)
            const s = e.mo || (e.mo = {t: now});
            const dt = Math.min(0.5, (now - s.t) / 1000); s.t = now;
            const heading = typeof p.true_heading == 'number' ? p.true_heading : (typeof p.track == 'number' ? p.track : (p.rotation || 0));
            const vs = typeof p.geom_rate == 'number' ? p.geom_rate : p.baro_rate, gs = typeof p.gs == 'number' ? p.gs : p.speed;
            const onG = p.altitude === 'ground' || p.onGround;
            s.yaw = MODELS.smoothAngle(s.yaw, heading, dt, 0.5, true);
            s.pitch = MODELS.smoothAngle(s.pitch, onG ? 0 : MODELS.pitchFrom(vs, gs), dt, 0.9);
            s.roll = MODELS.smoothAngle(s.roll, onG ? 0 : MODELS.rollFrom(typeof p.roll == 'number' ? p.roll : null, p.track_rate, gs), dt, 0.7);
            const Rm = MODELS.orientationENU(s.yaw, s.pitch, s.roll);        // ENU rotation; Mercator = S * R, applied by the mirror matrix below
            TMP.r.set(Rm[0], Rm[1], Rm[2], 0, Rm[3], Rm[4], Rm[5], 0, Rm[6], Rm[7], Rm[8], 0, 0, 0, 0, 1);
            const sc = k * f;
            TMP.s.set(d.span * sc, d.length * sc, d.length * sc);
            TMP.m.makeTranslation(mc.x - oc.x, mc.y - oc.y, mc.z + elev * k);
            TMP.m.multiply(TMP.S).multiply(TMP.r).scale(TMP.s);
            const i = counts[d.arch]++;
            mesh.setMatrixAt(i, TMP.m);
            TMP.c.set(e.sel ? '#ffffff' : (e.fillColor || '#cfcfcf'));
            mesh.setColorAt(i, TMP.c);
            stats.drawn++;
            if (shadows < CAP) {   // soft blob on the surface under the real ground position
                const bm = maplibregl.MercatorCoordinate.fromLngLat({lng: base[0], lat: base[1]}, 0);
                TMP.m.makeTranslation(bm.x - oc.x, bm.y - oc.y, bm.z + belev * k + 0.2 * k);
                TMP.m.multiply(TMP.S).multiply(TMP.r2.makeRotationZ(-s.yaw * Math.PI / 180)).scale(TMP.s.set(d.span * sc * 0.55, d.length * sc * 0.55, 1));
                state.shadow.setMatrixAt(shadows++, TMP.m);
            }
        }
        for (const a of MODELS.ARCHETYPES) {
            const mesh = state.meshes[a]; mesh.count = counts[a];
            if (counts[a]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
            stats.byArchetype[a] = counts[a];
        }
        state.shadow.count = shadows; if (shadows) state.shadow.instanceMatrix.needsUpdate = true;
        state.mat.uniforms.uAlpha.value = w; state.mat.transparent = w < 1;
        state.shadow.material.opacity = 0.3 * w;
        TMP.p.fromArray(proj).multiply(TMP.o.makeTranslation(oc.x, oc.y, 0));
        state.camera.projectionMatrix.copy(TMP.p); state.camera.projectionMatrixInverse.copy(TMP.p).invert();
        state.renderer.resetState();
        state.renderer.render(state.scene, state.camera);
        state.renderer.resetState();
    };

    // choose the model set: the CAP aircraft nearest the screen centre among those that are in view and have a position (called from flush)
    MLR.modelsSelect = function () {
        this.modelSet.clear();
        if (!this.modelsActive()) return;
        const m = this.map, c = m.getCenter(), ctr = m.project(c), items = [];
        for (const e of this.planes.values()) {
            const p = e.plane;
            if (!p.proj || !p.position) continue;
            if (typeof p.category === 'string' && p.category[0] === 'C') continue;      // surface vehicles and obstacles keep their icons
            const ll = this.drawnLL(e), q = m.project(ll);
            const cw = m.getContainer().clientWidth, ch = m.getContainer().clientHeight;
            if (q.x < -60 || q.y < -60 || q.x > cw + 60 || q.y > ch + 60) continue;
            items.push({x: q.x, y: q.y, e});
        }
        for (const it of MODELS.nearest(items, ctr.x, ctr.y, CAP)) {
            const e = it.e, p = e.plane;
            const code = p.icaoType, arch = MODELS.archetypeFor(code, {desc: p.typeDescription, wtc: p.wtc, category: p.category}), dm = MODELS.dimsFor(code, arch);
            const lat = p.position[1], f = MODELS.scaleFactor(dm.length, lat, m.getZoom(), MIN_PX), mpp = MODELS.metresPerPixel(lat, m.getZoom());
            this.modelSet.set(p.icao, {arch, span: dm.span, length: dm.length, px: dm.length * f / mpp});
        }
    };

    MLR.modelsFail = function (err) {
        if (failed) return;
        failed = true;
        console.debug('3D aircraft models unavailable, using icons:', err && err.message ? err.message : err);
        this.removeModelsLayer();
        this.modelSet.clear(); this.touch && this.touch('planes'); this.applyIconOpacity();
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
            if (layer) { this.removeModelsLayer(); this.modelSet.clear(); this.touch('planes'); }
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
        new Toggle({key: 'models3d', display: '3D aircraft models (3D view)', container: '#set_appearance', init: wanted,
            setState: function (s) { MLR.setModelsWanted(s); }});
    });
    window.addEventListener('tar:viewmode', () => { try { MLR.syncModels(); } catch (e) { /* not ready */ } });
})();
