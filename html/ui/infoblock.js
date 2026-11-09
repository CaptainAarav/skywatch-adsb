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
// a lookup that finished with no usable route (nothing known, or the service was unreachable): the card says so quietly instead of vanishing
function ibRouteNone(p) {
    if (!useRouteAPI || !p.name || p.name === 'no callsign' || p.registration === p.name) return false;
    const r = g.route_cache && g.route_cache[normalized_callsign(p.name)];
    return !!r && !(r._airports && r._airports.length >= 2);
}
function ibRouteFlag(id, a) {
    const e = ibEl(id);
    if (!e) return;
    const cc = a && a.countryiso2 ? String(a.countryiso2).toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc)) { const u = 'flags/3x2/' + cc + '.svg'; if (e.getAttribute('src') !== u) e.setAttribute('src', u); e.hidden = false; }
    else { e.removeAttribute('src'); e.hidden = true; }
}
function ibCode(a) {
    return a.iata || a.icao || '';
}
function ibAirportName(a) {
    return (a.name || a.location || '').replace(/ International Airport$| Airport$/, '');
}


function ibRender(p) {
    const wide = document.body.classList.contains('infoWide');   // desktop only; the phone sheet uses the compact components
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

    // one muted line: Operator · Aircraft type name (whatever of the two the receiver data has)
    const subParts = [airline || p.ownOp || '', p.typeLong || p.icaoType || ''].filter(Boolean);
    ibSub('ib_sub', subParts.length ? subParts.join(' \u00b7 ') : (hasCallsign ? '' : 'No callsign \u00b7 ' + hex));
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
    ibHtml('ib_head_chips', hc);

    // ---- route card: ONE component for the compact card, the wide panel and the phone sheet ----
    const rc = ibEl('ib_route');
    if (route) {
        const a = route._airports;
        const first = a[0], last = a[a.length - 1];
        ibSub('ib_route_from', ibCode(first));
        ibSub('ib_route_to', ibCode(last));
        ibSub('ib_route_from_n', ibAirportName(first));
        ibSub('ib_route_to_n', ibAirportName(last));
        ibSub('ib_route_via', a.length > 2 ? 'via ' + a.slice(1, -1).map(ibCode).join(', ') : '');
        ibRouteFlag('ib_route_from_f', first); ibRouteFlag('ib_route_to_f', last);
        ibEl('ib_route_warn').hidden = route.plausible !== false;
        ibEl('ib_route_none').hidden = true;
        rc.classList.remove('ibRouteEmpty');
        rc.title = a.map(x => `${ibCode(x)} ${x.name || x.location || ''}`).join('\n');
        rc.hidden = false;
    } else if (rc && ibRouteNone(p)) {
        ibSub('ib_route_from', ''); ibSub('ib_route_to', ''); ibSub('ib_route_from_n', ''); ibSub('ib_route_to_n', ''); ibSub('ib_route_via', '');
        ibRouteFlag('ib_route_from_f', null); ibRouteFlag('ib_route_to_f', null);
        ibEl('ib_route_warn').hidden = true;
        ibEl('ib_route_none').hidden = false;
        rc.classList.add('ibRouteEmpty');
        rc.title = '';
        rc.hidden = false;
    } else if (rc) {
        rc.hidden = true;
    }

    // ---- instruments (ui/instruments.js): derived values once, drawn at most 4 times a second ----
    const d = IBI.derive(p);
    const sitedist = d.dist;                 // null unless the receiver location is set AND shown (privacy)
    IBI.sample(p, d);
    const panel = ibEl('selected_infoblock');
    panel.classList.toggle('emergency', !!(d.emerg || d.emergState));
    if (IBI.due(p, ibCache.force)) {
        ibCache.force = false;
        if (wide) IBI.renderWide(p, d);
        else IBI.renderCompact(p, d, sitedist);
    }
    // one plain sentence under the header (from real data only)
    const st = ibEl('ib_status');
    const stText = FLIGHTSTATUS.sentence(onGround ? 'ground' : altFt, onGround ? null : (d.rate != null ? d.rate : null), p.gs, units_for('altitude', DisplayUnits) === 'metric');
    st.textContent = stText; st.hidden = !stText;
    ibActionState(p);

    // ---- chips: ONE compact row (source, signal); everything else is in the collapsed Details card ----
    let chips = ibSourceChip(p);
    if (!showTrace && p.rssi != null) chips += `<span class="chip mono">${ibNum(p.rssi, 1)} dBFS</span>`;
    ibHtml('selected_showTrace_hide', chips);
    ibDetails(p, d);

    // ---- aircraft card ----
    let typeName = p.typeLong || '';
    if (!typeName && p.icaoType) typeName = p.icaoType;
    const row = (id, v) => { const e = ibEl(id); if (e) { e.textContent = v || ''; const r = e.closest('[data-row]'); if (r) r.hidden = !v; } };
    row('ib_type_name', typeName ? (p.year ? typeName + ' (' + p.year + ')' : typeName) : '');
    row('ib_icaotype', p.typeLong ? (p.icaoType || '') : '');
    row('ib_typedesc', p.typeDescription || '');
    ibHtml('ib_country', ibFlag(p));
    ibEl('ib_country').closest('[data-row]').hidden = !p.country;
    row('ib_operator', airline || p.ownOp || '');
    const yr = p.year ? Number(p.year) : null;
    row('ib_built', yr ? String(yr) : '');
    row('ib_age', yr ? Math.max(0, new Date().getUTCFullYear() - yr) + ' yrs' : '');
    const cat = p.category ? p.category.toUpperCase() : '';
    row('ib_category', cat ? cat + (IBI.CATEGORY[cat] ? ' · ' + IBI.CATEGORY[cat] : '') : '');
    if (!reg) ibText('selected_registration', '');
    ibEl('reg_info').hidden = !reg || p.isNonIcao();

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

// Details card: the secondary numbers, collapsed by default (same card on desktop and phone). Rebuilt only when the text changes.
function ibDetails(p, d) {
    const rows = [];
    const add = (k, v) => { if (v != null && v !== '') rows.push([k, v]); };
    const u = {alt: ibUnit('altitude'), spd: ibUnit('speed')};
    if (d.selAlt != null) add('Selected altitude', ibAlt(d.selAlt) + ' ' + u.alt);
    if (d.selHdg != null) add('Selected heading', ibDeg(d.selHdg));
    if (d.qnh != null) add('Pressure setting', Math.round(d.qnh) + ' hPa');
    if (d.head != null) add(d.head < 0 ? 'Tailwind' : 'Headwind', ibSpeed(Math.abs(d.head)) + ' ' + u.spd);
    if (!showTrace) {
        if (p.seen != null && p.seen < 1e6) add('Last heard', format_duration(p.seen) + ' ago');
        if (p.messageRate != null) add('Message rate', ibNum(p.messageRate, p.messageRate < 10 ? 1 : 0) + ' msg/s');
        const rxMode = ((p.messages == undefined && p.receiverCount) || (globeIndex && binCraft));
        const mc = rxMode ? (p.receiverCount >= 5 && p.dataSource != 'mlat' ? '> ' + p.receiverCount : p.receiverCount) : ibNum(p.messages);
        if (mc != null && mc !== '') add(rxMode ? 'Receivers' : 'Messages', String(mc));
    }
    const key = rows.map(r => r.join('=')).join('|');
    const kv = ibEl('ib_details_kv');
    if (kv._key === key) return;
    kv._key = key;
    kv.replaceChildren(...rows.map(([k, v]) => {
        const r = document.createElement('div'); r.className = 'kv';
        const a = document.createElement('span'); a.className = 'k'; a.textContent = k;
        const b = document.createElement('span'); b.className = 'v'; b.textContent = v;
        r.append(a, b); return r;
    }));
    ibEl('ib_details_card').hidden = rows.length === 0;
}

// action bar state: Follow / Following, Show track availability
function ibActionState(p) {
    const f = ibEl('F_label'), want = FollowSelected ? 'Following' : 'Follow';
    if (f && f.textContent !== want) f.textContent = want;
    const fb = ibEl('F'); if (fb) { fb.classList.toggle('on', !!FollowSelected); fb.setAttribute('aria-pressed', FollowSelected ? 'true' : 'false'); }
    const il = ibEl('I_label'), wantI = onlySelected ? 'Show all' : 'Isolate';
    if (il && il.textContent !== wantI) il.textContent = wantI;
    const t = ibEl('act_track');
    if (t) { const traces = !!(haveTraces || globeIndex); t.hidden = !traces; t.textContent = showTrace ? 'Hide track' : 'Show track'; }
}

function ibShare() {
    const p = SelectedPlane; if (!p) return;
    const url = location.origin + location.pathname + '?icao=' + p.icao;
    const title = (p.flight && p.flight.trim()) || p.registration || p.icao.toUpperCase();
    if (navigator.share) navigator.share({title: title, url: url}).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => { if (typeof SKYUI != 'undefined') SKYUI.toast('Link copied'); }).catch(() => {});
}

function ibCloseMenu() { const m = document.getElementById('act_menu'); if (m && !m.hidden) { m.hidden = true; const b = document.getElementById('act_more'); b && b.setAttribute('aria-expanded', 'false'); } }

function ibLayout() {
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
    jQuery('#ib_p_share, #act_share').on('click', function () { ibShare(); ibCloseMenu(); });
    jQuery('#act_track').on('click', function () { jQuery('#show_trace').trigger('click'); ibCloseMenu(); if (SelectedPlane) refreshSelected(); });
    jQuery('#act_more').on('click', function (e) {
        e.stopPropagation();
        const m = ibEl('act_menu'), open = m.hidden;
        m.hidden = !open; this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    jQuery(document).on('click', function (e) { if (!e.target.closest('#act_menu, #act_more')) ibCloseMenu(); });
    jQuery('#act_menu').on('keydown', function (e) { if (e.key === 'Escape') { ibCloseMenu(); ibEl('act_more').focus(); e.stopPropagation(); } });
    const mq = window.matchMedia('(max-width: 768px), (pointer: coarse)');
    const onMq = () => { if (typeof adjustInfoBlock == 'function') adjustInfoBlock(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
}
jQuery(initInfoblock);
