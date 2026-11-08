"use strict";
// Skywatch ADS-B: selected aircraft panel renderer.
// Compact card = design/mockups/01-live-map.html, wide details = 03-aircraft-details-history.html.
// refreshSelected() (script.js) calls ibRender(plane) every update. Rows with no
// data are hidden (decision e10) instead of showing "n/a".

const IB_MINUS = '−';
const ibCache = {};

function ibEsc(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// thousands separators, typographic minus
function ibNum(v, dec) {
    if (v == null || !isFinite(v))
        return null;
    dec = dec || 0;
    const s = Math.abs(v).toLocaleString('en-US', {minimumFractionDigits: dec, maximumFractionDigits: dec});
    return (v < 0 && Number(s.replace(/,/g, '')) != 0 ? IB_MINUS : '') + s;
}
function ibSigned(v, dec) {
    const s = ibNum(v, dec);
    if (s == null) return null;
    return (v > 0 && Number(s.replace(/,/g, '')) != 0 ? '+' : '') + s;
}
function ibDeg(v) {
    if (v == null || !isFinite(v)) return null;
    let d = Math.round(v) % 360;
    if (d < 0) d += 360;
    return String(d).padStart(3, '0') + '°';
}

function ibEl(id) {
    let e = ibCache[id];
    if (!e || !e.isConnected)
        e = ibCache[id] = document.getElementById(id);
    return e;
}
// set text; an empty value hides the surrounding [data-row]
function ibText(id, v) {
    const e = ibEl(id);
    if (!e) return;
    const s = (v == null || v === '') ? '' : String(v);
    if (e.textContent !== s)
        e.textContent = s;
    const row = e.closest('[data-row]');
    if (row)
        row.hidden = (s === '');
}
// set text without touching row visibility (secondary lines)
function ibSub(id, v) {
    const e = ibEl(id);
    if (!e) return;
    const s = (v == null) ? '' : String(v);
    if (e.textContent !== s)
        e.textContent = s;
    e.hidden = (s === '');
}
function ibHtml(id, html) {
    const e = ibEl(id);
    if (!e) return;
    if (e._ibHtml !== html) {
        e._ibHtml = html;
        e.innerHTML = html;
    }
    e.hidden = (html === '');
}

function ibUnit(q) {
    return get_unit_label(q, DisplayUnits);
}
function ibAlt(alt) {
    if (alt == null) return null;
    if (alt === 'ground') return 'ground';
    return ibNum(convert_altitude(alt, DisplayUnits));
}
function ibSpeed(v) {
    return v == null ? null : ibNum(convert_speed(v, DisplayUnits));
}
function ibRate(v) {
    if (v == null) return null;
    const metric = units_for('verticalRate', DisplayUnits) === 'metric';
    return ibSigned(convert_vert_rate(v, DisplayUnits), metric ? 1 : 0);
}
function ibDist(m) {
    if (m == null) return null;
    const d = convert_distance(m, DisplayUnits);
    return ibNum(d, d < 100 ? 1 : 0);
}
function ibCompass(t) {
    if (t == null) return null;
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.floor((360 + t % 360 + 22.5) / 45) % 8];
}
// initial bearing from the receiver to the aircraft (decision e11)
function ibBearing(from, to) {
    const r = Math.PI / 180;
    const la1 = from[1] * r, la2 = to[1] * r, dl = (to[0] - from[0]) * r;
    const y = Math.sin(dl) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return (Math.atan2(y, x) / r + 360) % 360;
}

function ibAirline(p) {
    if (!airlineLookup || !p.getAirline) return '';
    const op = p.getAirline();
    return (op && op.n) ? op.n : '';
}

function ibFlag(p) {
    if (!p.country) return '';
    const name = p.country.replace('special use', 'special');
    const img = p.country_code ? `<img class="ibFlag" src="flags/3x2/${ibEsc(p.country_code.toUpperCase())}.svg" alt="" onerror="this.remove()">` : '';
    return img + ibEsc(name);
}

function ibSourceChip(p) {
    const src = format_data_source(p.dataSource);
    if (!p.dataSource) return '';
    return `<span class="chip ibSrc src-${sourceGroup(p.dataSource)}">${ibEsc(src)}</span>`;
}

function ibVersion(v) {
    if (v == null) return '';
    return 'ADS-B v' + v;
}

function ibRoute(p) {
    if (!useRouteAPI || !p.name) return null;
    const r = g.route_cache && g.route_cache[normalized_callsign(p.name)];
    if (!r || !r._airports || r._airports.length < 2) return null;
    return r;
}
function ibCode(a) {
    return a.iata || a.icao || '';
}
function ibAirportName(a) {
    return (a.name || a.location || '').replace(/ International Airport$| Airport$/, '');
}

function ibIsPhone() {
    return window.matchMedia('(max-width: 700px)').matches;
}

// phone sheet (mockup 05): six tiles, Follow / Show track / expand
function ibRenderPhone(p, airline, sq, sitedist) {
    const parts = [airline, p.icaoType, p.registration].filter(Boolean);
    ibSub('ib_sub_phone', parts.length ? parts.join(' \u00b7 ') : p.icao.toUpperCase());
    ibHtml('ib_head_src', ibSourceChip(p));

    const onGround = p.altitude === 'ground';
    const altFt = adjust_baro_alt(p.altitude);
    ibText('ib_p_alt', onGround ? 'Ground' : ibAlt(altFt));
    ibSub('ib_p_alt_u', (altFt != null && !onGround) ? ibUnit('altitude') : '');
    const vr = p.vert_rate;
    let vs = null, vsu = '';
    if (vr != null && !onGround) {
        if (units_for('verticalRate', DisplayUnits) === 'metric') {
            vs = ibSigned(convert_vert_rate(vr, DisplayUnits), 1); vsu = 'm/s';
        } else if (Math.abs(vr) >= 1000) {
            vs = ibSigned(vr / 1000, 1); vsu = 'k';
        } else {
            vs = ibSigned(Math.round(vr / 10) * 10, 0); vsu = 'fpm';
        }
    }
    ibText('ib_p_vs', vs);
    ibSub('ib_p_vs_u', vsu);
    const vsv = ibEl('ib_p_vs_v');
    vsv.classList.toggle('climb', vr != null && vr > 192 && !onGround);
    vsv.classList.toggle('descend', vr != null && vr < -192 && !onGround);
    ibText('ib_p_trk', ibDeg(p.track));
    ibText('ib_p_sq', sq);
    ibText('ib_p_dist', sitedist != null ? ibDist(sitedist) : null);
    ibSub('ib_p_dist_u', sitedist != null ? ibUnit('distance') : '');

    const fb = ibEl('ib_p_follow');
    fb.classList.toggle('on', !!FollowSelected);
    fb.setAttribute('aria-pressed', FollowSelected ? 'true' : 'false');
    fb.textContent = FollowSelected ? 'Following' : 'Follow';
    // "Show track" needs traces; without them the second button isolates the aircraft
    const b2 = ibEl('ib_p_second');
    const traces = !!(haveTraces || globeIndex);
    const label = traces ? (showTrace ? 'Hide track' : 'Show track') : (onlySelected ? 'Show all' : 'Isolate');
    if (b2.textContent != label) b2.textContent = label;
    b2.dataset.mode = traces ? 'trace' : 'isolate';
}

function ibRender(p) {
    const wide = document.body.classList.contains('infoWide') || document.body.classList.contains('sheetFull');
    const airline = ibAirline(p);
    const hex = p.icao.toUpperCase();
    const onGround = p.altitude === 'ground';
    const altFt = adjust_baro_alt(p.altitude);

    // ---- header ----
    // no callsign: show the registration (or hex) instead of the words "no callsign"
    const hasCallsign = p.flight && p.flight.trim();
    ibHtml('ib_logo', airlineLogoHTML(airlineFlight(p), 36, 'head'));
    ibSub('selected_callsign', hasCallsign ? p.name : (p.registration || hex));
    ibEl('selected_callsign').title = hasCallsign ? 'Callsign' : 'No callsign received';
    let flags = '';
    if (p.military) flags += '<span class="chip ibFlagChip warn">Military</span>';
    if (p.ladd) flags += '<a class="chip ibFlagChip" target="_blank" rel="noreferrer" href="https://www.faa.gov/pilots/ladd/" title="Limiting Aircraft Data Displayed">LADD</a>';
    if (p.pia) flags += '<a class="chip ibFlagChip" target="_blank" rel="noreferrer" href="https://www.faa.gov/air_traffic/technology/equipadsb/privacy/" title="Privacy ICAO Address">PIA</a>';
    ibHtml('ib_dbflags', flags);

    ibHtml('ib_sub', (airline ? ibEsc(airline) + ' · ' : (hasCallsign ? '' : 'No callsign · ')) + `<span class="mono">${hex}</span>`);
    ibSub('ib_hex_w', hex);

    let typeLong = (p.year ? p.year + ' ' : '') + (p.typeLong || '');
    const reg = p.registration || '';
    const l1rest = [typeLong, reg ? ibEsc(reg) : '', ibFlag(p)].filter(Boolean);
    let line1 = airline ? ibEsc(airline) : '';
    if (l1rest.length)
        line1 += (line1 ? ' · ' : '') + `<span class="lbl">${l1rest.map((x, i) => i == 0 ? ibEsc(x) : x).join(' · ')}</span>`;
    ibHtml('ib_line1', line1);
    const l2 = [];
    if (p.ownOp) l2.push('Owner: ' + p.ownOp);
    if (p.version != null) l2.push(ibVersion(p.version));
    if (p.category) l2.push('Category ' + p.category);
    ibHtml('ib_line2', ibEsc(l2.join(' · ')));

    const route = ibRoute(p);
    const sq = (p.squawk == null || p.squawk == '0000') ? '' : p.squawk;
    let hc = ibSourceChip(p);
    if (sq) hc += `<span class="chip mono">sq ${ibEsc(sq)}</span>`;
    if (p.icaoType) hc += `<span class="chip mono">${ibEsc(p.icaoType)}</span>`;
    if (route) {
        const a = route._airports;
        hc += `<span class="chip">${a.map(x => ibEsc(ibCode(x))).join(' → ')}</span>`;
    }
    ibHtml('ib_head_chips', hc);

    // ---- route card (only with a looked-up route; decision e9) ----
    const rc = ibEl('ib_route');
    if (route) {
        const a = route._airports;
        const first = a[0], last = a[a.length - 1];
        ibSub('ib_route_from', ibCode(first));
        ibSub('ib_route_to', ibCode(last));
        ibSub('ib_route_from_n', ibAirportName(first));
        ibSub('ib_route_to_n', ibAirportName(last));
        ibSub('ib_route_via', a.length > 2 ? 'via ' + a.slice(1, -1).map(ibCode).join(', ') : '');
        ibEl('ib_route_warn').hidden = route.plausible !== false;
        rc.title = a.map(x => `${ibCode(x)} ${x.name || x.location || ''}`).join('\n');
        rc.hidden = false;
    } else if (rc) {
        rc.hidden = true;
    }

    // ---- instruments (ui/instruments.js): derived values once, drawn at most 4 times a second ----
    const d = IBI.derive(p);
    const sitedist = d.dist;                 // null unless the receiver location is set AND shown (privacy)
    IBI.sample(p, d);
    const phone = ibIsPhone();
    const panel = ibEl('selected_infoblock');
    panel.classList.toggle('emergency', !!(d.emerg || d.emergState));
    if (IBI.due(p, ibCache.force)) {
        ibCache.force = false;
        if (phone) IBI.renderPhone(p, d, sitedist);
        if (wide) IBI.renderWide(p, d);
        else if (!phone) IBI.renderCompact(p, d, sitedist);
    }
    if (phone)
        ibRenderPhone(p, airline, sq, sitedist);

    // ---- chips: phase, source, signal (hidden in trace view) ----
    let chips = '';
    if (d.phase) {
        const arrow = d.phase == 'Descending' ? '<path d="M12 4v16M6 14l6 6 6-6"/>' : d.phase == 'Climbing' ? '<path d="M12 20V4M6 10l6-6 6 6"/>' : d.phase == 'Level' ? '<path d="M4 12h16"/>' : '<path d="M4 20h16M7 16l5-10 5 10"/>';
        chips += `<span class="chip ibPhase"><svg aria-hidden="true" class="ico" width="12" height="12" viewBox="0 0 24 24">${arrow}</svg>${d.phase}</span>`;   // d.phase is one of four fixed words
    }
    chips += ibSourceChip(p);
    if (!showTrace) {
        if (p.rssi != null) chips += `<span class="chip mono">${ibNum(p.rssi, 1)} dBFS</span>`;
        if (p.messageRate != null) chips += `<span class="chip mono">${ibNum(p.messageRate, p.messageRate < 10 ? 1 : 0)} msg/s</span>`;
        if (p.seen != null && p.seen < 1e6) chips += `<span class="chip mono">seen ${format_duration(p.seen)}</span>`;
        const rxMode = ((p.messages == undefined && p.receiverCount) || (globeIndex && binCraft));
        const mc = rxMode ? (p.receiverCount >= 5 && p.dataSource != 'mlat' ? '> ' + p.receiverCount : p.receiverCount) : ibNum(p.messages);
        if (mc != null && mc !== '') chips += `<span class="chip mono">${mc}${rxMode ? ' receivers' : ' msgs'}</span>`;
    }
    ibHtml('selected_showTrace_hide', chips);

    // ---- aircraft card ----
    let typeName = p.typeLong || '';
    if (!typeName && p.icaoType) typeName = p.icaoType;
    ibSub('ib_type_name', typeName ? (p.year ? typeName + ' (' + p.year + ')' : typeName) : '');
    ibSub('ib_icaotype', p.typeLong ? (p.icaoType || '') : '');
    ibSub('ib_typedesc', p.typeDescription || '');
    ibHtml('ib_country', ibFlag(p));
    ibText('ib_operator', airline || p.ownOp || '');
    ibEl('ib_operator_row').hidden = !(airline || p.ownOp);
    const yr = p.year ? Number(p.year) : null;
    ibText('ib_built', yr || '');
    ibText('ib_age', yr ? Math.max(0, new Date().getUTCFullYear() - yr) + ' yrs' : '');
    const cat = p.category ? p.category.toUpperCase() : '';
    ibText('ib_category', cat ? cat + (IBI.CATEGORY[cat] ? ' · ' + IBI.CATEGORY[cat] : '') : '');
    ibEl('ib_facts2').hidden = !(yr || cat);
    ibEl('ib_country').closest('[data-row]').hidden = !p.country;
    if (!reg) ibText('selected_registration', '');
    else ibEl('reg_info').hidden = p.isNonIcao();

    const receivers = ((p.messages == undefined && p.receiverCount) || (globeIndex && binCraft)) && !showTrace;
    let msgs;
    if (receivers) {
        msgs = (p.receiverCount >= 5 && p.dataSource != 'mlat') ? '> ' + p.receiverCount : p.receiverCount;
    } else {
        msgs = ibNum(p.messages);
    }
    ibSub('ib_messages_l', receivers ? 'Receivers' : 'Messages');
    ibSub('ib_w_msgs_l', receivers ? 'Receivers' : 'Messages');
    ibText('ib_messages', msgs);
    const card = ibEl('ib_aircraft');
    const photoVisible = !!document.querySelector('#selected_photo img, #selected_photo p');
    card.hidden = !typeName && !reg && !p.country && !airline && !photoVisible && !yr && !cat;

    // ---- wide: "All values" (instruments are drawn above) ----
    if (wide) {
        const altU = ' ' + ibUnit('altitude'), vrU = ' ' + ibUnit('verticalRate');
        const withU = (v, u) => v == null ? null : v + u;
        ibText('ib_baro', onGround ? 'ground' : withU(ibAlt(altFt), altU));
        ibText('ib_geom', withU(ibAlt(adjust_geom_alt(p.alt_geom, p.position)), altU));
        ibText('ib_baro_rate', withU(ibRate(p.baro_rate), vrU));
        ibText('ib_geom_rate', withU(ibRate(p.geom_rate), vrU));
        ibText('ib_w_mach', p.mach != null ? p.mach.toFixed(3) : null);

        let magResult = null;
        if (geoMag && p.position != null)
            magResult = geoMag(p.position[1], p.position[0], onGround ? 0 : (p.altitude || 0));
        let heading = p.true_heading;
        if (heading == null && !globeIndex && magResult && p.mag_heading != null && p.track != null)
            heading = (p.mag_heading + magResult.dec + 360) % 360;
        ibText('ib_w_thdg', ibDeg(heading));
        ibText('ib_w_mhdg', ibDeg(p.mag_heading));
        ibText('ib_w_decl', magResult ? ibSigned(magResult.dec, 1) + '°' : null);
        ibText('ib_w_navhdg', ibDeg(p.nav_heading));
        ibText('ib_w_rc', p.rc == null ? null : (p.rc == 0 ? 'unknown' : format_distance_short(p.rc, DisplayUnits)));
        ibText('ib_w_epoch', isFinite(p.position_time) && p.position_time ? Math.round(p.position_time) : null);
        ibText('ib_w_rid', (p.rId && show_rId) ? p.rId : null);
        let links = '';
        if (flightawareLinks) links += getFlightAwareModeSLink(p.icao, p.flight, 'FlightAware');
        if (globeIndex || shareBaseUrl)
            links += (links ? ' · ' : '') + `<a class="link" href="${ibEsc(shareLink)}" onclick="copyShareLink(); return false;">${Date.now() - copyLinkTime < 2000 ? 'Copied' : 'Copy link'}</a>`;
        const pl = getPhotoLink(p);
        if (pl) links += (links ? ' · ' : '') + pl;
        ibHtml('ib_w_links', links);
        ibEl('ib_w_links').closest('[data-row]').hidden = !links;

        ibExportVisible(p);
        const all = ibEl('wc_all');
        all.hidden = !all.querySelector('[data-row]:not([hidden])');
        // nothing at all to show: one calm note instead of empty cards
        const lim = ibEl('ib_limited');
        const cards = document.querySelectorAll('#ib_wide > section[data-card]:not(#wc_id):not(#wc_all)');
        lim.hidden = [...cards].some(c => !c.hidden);
    }
}

// move the photo between the compact card and the wide header
function ibExportVisible(p) {
    for (const id of ['export_kml_baro', 'export_kml_geom', 'export_kml_geom_avg'])
        ibEl(id).hidden = !p.position;
}

function ibSetSheetFull(on) {
    ibCache.force = true;
    on = !!on && ibIsPhone() && document.body.classList.contains('infoOpen');
    document.body.classList.toggle('sheetFull', on);
    for (const id of ['sheetHandle', 'ib_p_expand']) {
        const e = document.getElementById(id);
        if (!e) continue;
        e.setAttribute('aria-expanded', on ? 'true' : 'false');
        e.setAttribute('aria-label', on ? 'Show less' : 'Show all details');
    }
    const sc = document.getElementById('infoblock-container');
    if (sc) sc.scrollTop = 0;
    if (on && SelectedPlane) refreshSelected();
}

function ibLayout() {
    if (!document.body.classList.contains('infoOpen') || !ibIsPhone())
        document.body.classList.remove('sheetFull');
    const wide = document.body.classList.contains('infoWide');
    const photo = document.getElementById('photo_container');
    const slot = document.getElementById(wide ? 'ib_photo_wide' : 'ib_photo_compact');
    if (photo && slot && photo.parentNode !== slot)
        slot.appendChild(photo);
}

function initInfoblock() {
    jQuery('#ib_details_btn').on('click', function () {
        ibCache.force = true;
        toggles['wideInfoblock'].toggle(true);
        if (SelectedPlane) refreshSelected();
    });
    jQuery('#ib_collapse').on('click', function () {
        toggles['wideInfoblock'].toggle(false);
    });
    jQuery('#ib_p_expand').on('click', () => ibSetSheetFull(!document.body.classList.contains('sheetFull')));
    jQuery('#ib_p_second').on('click', function () {
        if (this.dataset.mode == 'trace') jQuery('#show_trace').trigger('click');
        else toggleIsolation();
        if (SelectedPlane) refreshSelected();
    });
    // drag handle: tap toggles; swipe up expands; swipe down collapses, then closes
    const h = document.getElementById('sheetHandle');
    let y0 = null;
    h.addEventListener('pointerdown', (e) => { y0 = e.clientY; h.setPointerCapture(e.pointerId); });
    h.addEventListener('pointerup', (e) => {
        if (y0 == null) return;
        const dy = e.clientY - y0;
        y0 = null;
        const full = document.body.classList.contains('sheetFull');
        if (dy < -30) ibSetSheetFull(true);
        else if (dy > 40) {
            if (full) ibSetSheetFull(false);
            else jQuery('#infoblock_close').trigger('click');
        } else ibSetSheetFull(!full);
    });
    h.addEventListener('pointercancel', () => { y0 = null; });
    const mq = window.matchMedia('(max-width: 700px)');
    const onMq = () => { if (typeof adjustInfoBlock == 'function') adjustInfoBlock(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
}
jQuery(initInfoblock);
