// Run in the page via CDP (Runtime.evaluate, awaitPromise) at 1440x900. DOM and ImageData assertions only (no screenshots).
// 1. the real label sprites: pill box = image, text ink centred (left/right and top/bottom padding), fill and selected colours
// 2. six synthetic aircraft within 20 px: no two pills overlap, the selected one renders
// 3. 2D, 3D and Globe: the pill follows the (lifted) icon because it is part of the same feature
// Prints one JSON object {checks, failures, numbers}.
(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms));
  const checks = {}, failures = [], numbers = {};
  const check = (n, v, note) => { checks[n] = !!v; if (!v) failures.push(n + (note !== undefined ? ' ' + JSON.stringify(note) : '')); };
  await document.fonts.load('600 13px Inter'); await w(300);
  const D = 2;

  // ---- 1. sprite pixels ----
  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  function analyse(spec) {
    const r = LABELS.render(spec, D), im = r.image, W = im.width, H = im.height, d = im.data;
    let minA = 255; for (let i = 3; i < d.length; i += 4) if (d[i] < minA) minA = d[i];
    // pill box = non-transparent pixels
    let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const lead = (spec.logo || spec.mono) ? (LABELS.STYLE.chip + LABELS.STYLE.chipGap) * D : 0;
    // text ink: pixels clearly different from the fill, inside the border ring and right of the chip
    const sel = !!spec.selected, fillL = sel ? 255 : 17;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 3; y < H - 3; y++) for (let x = Math.ceil(LABELS.STYLE.padX * D) + lead - 4; x < W - 3; x++) {
      const i = (y * W + x) * 4; if (x < lead) continue;
      if (Math.abs(lum(d, i) - fillL) > 70 && d[i + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const ctr = (xx, yy) => { const i = (yy * W + xx) * 4; return Array.from(d.slice(i, i + 4)); };
    return {W, H, cssW: r.w, cssH: r.h, minA, box: [bx0, by0, bx1, by1], ink: [x0, y0, x1, y1], padL: x0 - 0 - lead - 0, padR: W - 1 - x1, padT: y0, padB: H - 1 - y1, lead,
      fillPx: ctr(Math.floor(W * 0.5), 3), corner: ctr(0, 0)};
  }
  const specs = {
    single: {lines: ['BAW123']}, hex: {lines: ['4CA1B2']}, long: {lines: [LABELS.ellipsize('LONGCALLSIGN12345')]},
    two: {lines: ['BAW123', 'FL350 · 450']}, withChip: {lines: ['EZY4521'], mono: 'EZY'},
    selected: {lines: ['BAW123', 'FL350 · 450'], selected: true}, selectedOne: {lines: ['BAW123'], selected: true},
  };
  const sprite = {};
  for (const [k, s] of Object.entries(specs)) {
    const a = analyse(Object.assign({fontPx: 13}, s)); sprite[k] = a;
    const hPad = k === 'withChip' ? null : Math.abs(a.padL - a.padR), vPad = Math.abs(a.padT - a.padB);
    check('sprite ' + k + ': box fills the image', a.box[0] <= 1 && a.box[1] <= 1 && a.box[2] >= a.W - 2 && a.box[3] >= a.H - 2, a.box);
    check('sprite ' + k + ': top padding equals bottom padding (<=1px at 2x)', vPad <= 2, {top: a.padT, bottom: a.padB});
    if (hPad != null) check('sprite ' + k + ': left and right padding differ by at most 1px', hPad <= 2, {left: a.padL, right: a.padR});
    check('sprite ' + k + ': corners transparent (radius 9)', a.corner[3] < 40, a.corner);
    check('sprite ' + k + ': one line is 24px tall at 1x, two lines 40px', Math.abs(a.cssH - (s.lines.length === 1 ? 24 : 40)) < 0.5, a.cssH);
  }
  check('dark pill fill is #111111 at 0.92 alpha', Math.abs(sprite.single.fillPx[0] - 17) <= 2 && Math.abs(sprite.single.fillPx[3] - 235) <= 3, sprite.single.fillPx);
  check('selected pill fill is white', sprite.selected.fillPx[0] >= 250 && sprite.selected.fillPx[3] === 255, sprite.selected.fillPx);
  check('no pure-black pill', sprite.single.fillPx[0] > 0);
  numbers.sprites = Object.fromEntries(Object.entries(sprite).map(([k, a]) => [k, {cssSize: [a.cssW, a.cssH], padding2x: {left: a.padL, right: a.padR, top: a.padT, bottom: a.padB}}]));

  // ---- 2. collision: six aircraft within 20 px ----
  const m = MLR.map; m.jumpTo({zoom: 10, pitch: 0, bearing: 0}); await w(1500);
  const base = g.planesOrdered.find(p => p.position && p.shape);
  async function scenario(selIdx) {
    const c0 = m.project(m.getCenter()), fakes = [];
    [[0, 0], [8, 6], [14, -4], [-9, 9], [18, 12], [-14, -10]].forEach((o, i) => {
      const ll = m.unproject([c0.x + o[0], c0.y + o[1]]), hex = 'ff00' + (10 + i);
      const f = Object.assign(Object.create(Object.getPrototypeOf(base)), {icao: hex, flight: 'TST' + (100 + i), proj: mapgeo.fromLonLat([ll.lng, ll.lat]), position: [ll.lng, ll.lat], altitude: 3000 + i * 4000, shape: base.shape, scale: base.scale, rotation: 90, zIndex: i, inView: true, selected: i === selIdx, strokeWidth: base.strokeWidth});
      fakes.push(f);
      MLR.setPlane(f, '#ffffff', 'w#ffffff!' + base.shape.name + '!' + base.strokeWidth, LABELS.build({flight: f.flight, hex, logo: false, selected: i === selIdx, extended: true, alt: 'FL' + (30 + i), speed: '4' + i + '0'}), '#0b0b0d');
    });
    MLR.flush(); await w(1800);
    const rendered = m.queryRenderedFeatures({layers: ['tar-plane-labels', 'tar-plane-labels-top']}).filter(f => /^ff00/.test(f.properties.hex));
    const uniq = new Map(); for (const f of rendered) uniq.set(f.properties.hex, f);
    const rects = [...uniq.values()].map(f => {
      const e = MLR.lbl.get(f.properties.limg), pt = m.project(f.geometry.coordinates), off = typeof f.properties.loff === 'string' ? JSON.parse(f.properties.loff) : f.properties.loff;
      return {hex: f.properties.hex, x: pt.x + off[0], y: pt.y - e.h / 2, r: pt.x + off[0] + e.w, b: pt.y + e.h / 2};
    });
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5) overlaps++;
    }
    for (const f of fakes) MLR.planes.delete(f.icao);
    MLR.touch('planes'); MLR.flush(); await w(500);
    return {uniq, rects, overlaps};
  }
  const A = await scenario(3);
  check('six aircraft within 20px, one selected: the selected pill renders', A.uniq.has('ff0013'), [...A.uniq.keys()]);
  check('six aircraft within 20px, one selected: no two pills overlap', A.overlaps === 0, {overlaps: A.overlaps, shown: A.rects.length});
  const B = await scenario(-1);
  check('six aircraft within 20px, none selected: at least one pill renders', B.rects.length >= 1, B.rects.length);
  check('six aircraft within 20px, none selected: no two pills overlap', B.overlaps === 0, {overlaps: B.overlaps, shown: B.rects.length});
  check('six aircraft within 20px: collision hides the rest (not all six drawn)', B.rects.length < 6, B.rects.length);
  check('lowest altitude is placed before higher ones', B.uniq.has('ff0010'), [...B.uniq.keys()]);
  numbers.collision = {selected: {shown: A.rects.length, of: 6, overlaps: A.overlaps, selectedShown: A.uniq.has('ff0013')}, none: {shown: B.rects.length, of: 6, overlaps: B.overlaps, shown_hex: [...B.uniq.keys()]}};

  // ---- 3. 2D, 3D, Globe: the pill is a symbol of the same feature, so it follows the lifted icon ----
  const real = g.planesOrdered.find(p => p.position && typeof p.altitude == 'number' && p.altitude > 3000);
  selectPlaneByHex(real.icao, {follow: false}); await w(1500);
  const modes = {};
  for (const [mode, btn] of [['2d', 'view2d'], ['3d', 'view3d'], ['globe', 'viewGlobe'], ['2d-back', 'view2d']]) {
    document.getElementById(btn).click(); await w(3500);
    m.jumpTo({center: [real.position[0], real.position[1]], zoom: mode === 'globe' ? 3 : 9}); await w(2500);
    const lab = m.queryRenderedFeatures({layers: ['tar-plane-labels-top']}).filter(f => f.properties.hex === real.icao);
    const pl = m.queryRenderedFeatures({layers: ['tar-planes']}).filter(f => f.properties.hex === real.icao);
    const sameCoord = lab.length && pl.length && Math.abs(lab[0].geometry.coordinates[0] - pl[0].geometry.coordinates[0]) < 1e-6 && Math.abs(lab[0].geometry.coordinates[1] - pl[0].geometry.coordinates[1]) < 1e-6;
    const ground = mapgeo.toLonLat(real.proj), drawn = pl.length ? pl[0].geometry.coordinates : null;
    const liftedPx = drawn ? Math.abs(m.project(drawn).y - m.project(ground).y) : null;
    modes[mode] = {labelRendered: lab.length > 0, iconRendered: pl.length > 0, sameCoord: !!sameCoord, liftPx: liftedPx == null ? null : Math.round(liftedPx), view: MLR.viewMode};
    check('pill rendered in ' + mode, lab.length > 0 && pl.length > 0, modes[mode]);
    check('pill follows the icon in ' + mode, !!sameCoord, modes[mode]);
  }
  check('3D lifts the icon and the pill with it', modes['3d'].liftPx > 2 && modes['3d'].sameCoord, modes['3d']);
  check('2D does not lift', modes['2d'].liftPx < 1, modes['2d']);
  numbers.modes = modes;

  return {checks, failures, numbers};
})()
