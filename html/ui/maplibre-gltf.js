"use strict";
// Skywatch ADS-B: real glTF aircraft models for the 3D layer (Phase 42 Part C). OPTIONAL: with no models installed nothing is fetched beyond one small index
// file and the procedural archetypes are used, with no error. Models are dropped in with tools/models/optimise.js, which validates the licence (tools/models/
// models-manifest.json), the size and triangle budget, the axis and the scale, and writes html/models/<archetype>.glb plus html/models/index.json.
//   - html/models/index.json: {version, models: {<archetype>: {file, forward, author, source, licence, attribution}}}
//   - lazily loaded: only in 3D with models on, one file per archetype the first time that archetype is on screen, cached for the session
//   - parsed with three's GLTFLoader (+ meshopt / Draco decoders, vendored in libs/), merged into ONE geometry, normalised by ui/models-norm.js, and instanced exactly like
//     the archetypes. Aircraft smaller than LOD_PX on screen keep the simple archetype geometry (the LOD); instancing is preserved either way.
(function () {
    const INDEX_URL = 'models/index.json', LOADER = 'libs/gltf-loader-0.170.0.module.min.js';
    const st = {index: null, indexTried: false, loading: {}, geos: {}, failed: {}, loaderMod: null};
    MLR.gltfState = st;
    function fetchIndex() {
        if (st.indexTried) return Promise.resolve(st.index);
        st.indexTried = true;
        return fetch(INDEX_URL, {cache: 'no-cache'}).then(r => r.ok ? r.json() : null).catch(() => null).then(j => { st.index = j && j.models ? j : null; if (st.index) MLR.gltfCredits && MLR.gltfCredits(); return st.index; });
    }
    function loadModule() { return st.loaderMod || (st.loaderMod = import('../' + LOADER)); }      // relative to ui/maplibre-gltf.js
    // glTF scene -> normalised BufferGeometry (positions, normals, part), world-space node transforms applied, indexed meshes expanded to plain triangles
    function toGeometry(T, scene, forward) {
        scene.updateMatrixWorld(true);
        const prims = [], v = new T.Vector3(), nm = new T.Matrix3();
        scene.traverse(o => {
            if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
            const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, idx = g.index, cnt = idx ? idx.count : pa.count;
            nm.getNormalMatrix(o.matrixWorld);
            const pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3), mat = Array.isArray(o.material) ? o.material[0] : o.material;
            for (let i = 0; i < cnt; i++) {
                const j = idx ? idx.getX(i) : i;
                v.fromBufferAttribute(pa, j).applyMatrix4(o.matrixWorld); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
                if (na) { v.fromBufferAttribute(na, j).applyMatrix3(nm).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z; } else nor[i * 3 + 1] = 1;
            }
            prims.push({pos, nor, material: (mat && mat.name || '') + ' ' + (o.name || '')});
        });
        if (!prims.length) throw new Error('no meshes in the model');
        const r = MODELNORM.normalize(prims, {forward});
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(r.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(r.nor, 3)); g.setAttribute('part', new T.BufferAttribute(r.part, 1));
        g.userData = {triangles: r.triangles, ratio: r.ratio};
        return g;
    }
    function load(arch, T) {
        if (st.geos[arch] || st.failed[arch]) return Promise.resolve(st.geos[arch] || null);
        if (st.loading[arch]) return st.loading[arch];
        return st.loading[arch] = fetchIndex().then(idx => {
            const m = idx && idx.models && idx.models[arch];
            if (!m) throw new Error('no model for ' + arch);
            return Promise.all([loadModule(), fetch('models/' + m.file).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })]).then(([mod, buf]) => {
                const loader = new mod.GLTFLoader();
                loader.setMeshoptDecoder(mod.MeshoptDecoder);
                const draco = new mod.DRACOLoader(); draco.setDecoderPath('libs/draco/'); loader.setDRACOLoader(draco);
                return new Promise((res, rej) => loader.parse(buf, 'models/', gltf => { try { res(toGeometry(T, gltf.scene, m.forward || '-z')); } catch (e) { rej(e); } finally { draco.dispose(); } }, rej));
            });
        }).then(g => { st.geos[arch] = g; return g; }, err => { st.failed[arch] = String(err && err.message || err); return null; });
    }
    // called when the model layer is created (state has the scene and the archetype meshes): attach the real model of every archetype that is already loaded, and start
    // loading the ones that are not; a model that arrives later is attached the same way
    function attach(state, T, arch) {
        const g = st.geos[arch]; if (!g || !state.ok) return;
        const ai = MODELS.ARCHETYPES.indexOf(arch); if (ai < 0 || state.hiByIndex[ai]) return;
        const mesh = new T.InstancedMesh(g.clone(), state.mat, MLR.modelCap);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.count = 0; mesh.frustumCulled = false;
        mesh.setColorAt(0, new T.Color(1, 1, 1)); mesh.instanceColor.setUsage(T.DynamicDrawUsage);
        state.hiByIndex[ai] = mesh; state.hiGeos.push(mesh.geometry); state.scene.add(mesh);
        MLR.touch && MLR.touch('planes'); MLR.map && MLR.map.triggerRepaint();
    }
    MLR.gltfAttachAll = function (state, T) {
        fetchIndex().then(idx => {
            if (!idx) return;
            for (const arch of Object.keys(idx.models)) load(arch, T).then(() => attach(state, T, arch));
        });
    };
    // Settings > About: one credits line per model that is actually installed (CC-BY needs attribution)
    MLR.gltfCredits = function () {
        const idx = st.index; if (!idx) return;
        const el = document.getElementById('modelCredits'); if (!el) return;
        const lines = Object.values(idx.models).filter(m => m.attribution).map(m => m.attribution);
        el.textContent = lines.length ? '3D aircraft models: ' + [...new Set(lines)].join('; ') : '';
        el.hidden = !lines.length;
    };
    MLR.gltfStats = () => ({index: !!st.index, loaded: Object.keys(st.geos), failed: st.failed});
    // Settings > Map: Aircraft colour
    jQuery(function () {
        const list = document.getElementById('set_appearance'); if (!list) return;
        const row = document.createElement('div'); row.className = 'setSlider';
        const lab = document.createElement('label'); lab.htmlFor = 'modelColourSel';
        const t = document.createElement('span'); t.textContent = 'Aircraft colour (3D)'; lab.appendChild(t);
        const sel = document.createElement('select'); sel.id = 'modelColourSel'; sel.className = 'searchInput';
        for (const [v, n] of [['realistic', 'Realistic'], ['altitude', 'Altitude']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.appendChild(o); }
        sel.value = MLR.modelColourMode ? MLR.modelColourMode() : 'realistic';
        sel.addEventListener('change', () => MLR.setModelColourMode(sel.value));
        row.append(lab, sel);
        list.insertBefore(row, list.firstChild);
    });
})();
