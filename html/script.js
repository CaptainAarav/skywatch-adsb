// Some global variables are defined in early.js
// early.js takes care of getting some history files while the html page and
// some javascript libraries are still loading, hopefully speeding up loading


"use strict";

g.planes        = {};
g.planesOrdered = [];
g.route_cache = [];
g.route_check_todo = {};
g.route_check_in_flight = false;
g.route_next_lookup = 0;
g.route_last_lookup = 0;

g.mapOrientation = mapOrientation;

// Define our global variables
let tabHidden = false;
let siteCircleLayer;
let locationDotLayer;
let iconLayer;
let trailLayers;
let iconCache = {};
let addToIconCache = [];
let replayPlanes = {};
let PlaneFilter   = {};
let SelectedPlane = null;
let sp = null;
let SelPlanes = [];
let SelectedAllPlanes = false;
let HighlightedPlane = null;
let FollowSelected = false;
let followPos = [];
let loadStart = new Date().getTime();
let mapResizeTimeout;
let pointerMoveTimeout;
let iconSize = 1;
let debugTracks = false;
let verboseUpdateTrack = false;
let debugAll = false;
let trackLabels = false;
let multiSelect = false;
let uat_data = null;
g.enableLabels = false;
g.extendedLabels = 0;
let mapIsVisible = true;
let onlyMilitary = false;
let onlySelected = false;
let debug = false;
let debugJump = false;
let jumpTo = null;
let noMLAT = false;
let noVanish = false;
let filterTracks = false; // altitude filter: don't filter planes but rather their tracks by altitude
let refreshId = 0;
let lastFetch = 0;
let actualOutline = {};
let globeIndexNow = {};
let globeIndexDist = {};
let globeIndexSpecialLookup = {};
let globeTilesViewCount = 0;
let globeTableLimitBase = 80;
let globeTableLimit = 80;
let fetchCounter = 0;
let lastGlobeExtent;
let lastRenderExtent;
let pendingFetches = 0;
let firstFetch = true;
let debugCounter = 0;
let pathName = window.location.pathname.replace(/\/+/, '/') || "/";
let sourcesFilter = null;
let sources = ['adsb', ['uat', 'adsr'], 'mlat', 'tisb', 'modeS', 'other', 'adsc', 'ais'];
let flagFilter = null;
let flagFilterValues = ['military', 'pia', 'ladd'];
let showTrace = false;
let showTraceExit = false;
let showTraceWasIsolation = false;
let showTraceTimestamp = null;
let traceDate = null;
let traceDateString = null;
let traceOpts = {};
let icaoParam = null;
let newWidth = lineWidth;
let SiteOverride = (SiteLat != null && SiteLon != null);
let onJumpInput = null;
let selectedLabelFont = null;
let legSel = -1;
let geoMag = null;
let solidT = false;
let lastActive = new Date().getTime();
let enableOverlays = [];
let halloween = false;
let noRegOnly = false;
let triggerRefresh = 0;
let firstDraw = true;
let darkerColors = false;
let autoselect = false;
let nogpsOnly = false;
let spritesDataURL = null;
let trace_hist_only = false;
let traces_high_res = false;
let show_rId = true;
let labels_top = false;
let lockDotCentered = false;
let overrideMapType = null;
let layerMoreContrast = false;
let layerDimFactor = 0;
let layerExtraContrast = 0;
let shareFiltersParam = false;
let lastRequestSize = 0;
let lastRequestBox = '';
let nextQuerySelected = 0;
let enableDynamicCachebusting = false;
g.lastRefreshInt = 1000;
let reapTimeout = globeIndex ? 4 * 60 : 15 * 60;


let baroCorrectQNH = 1013.25;

let limitUpdates = -1;

let infoBlockWidth = baseInfoBlockWidth;

const renderBuffer = 60;

let shareLink = '';

let CenterLat = 0;
let CenterLon = 0;
g.zoomLvl = 5;
g.zoomLvlCache;

let TrackedAircraft = 0;
let globeTrackedAircraft = 0;
let TrackedAircraftPositions = 0;
let TrackedHistorySize = 0;
let aircraftShown = 0;

let SitePosition = null;

// timestamps
let now = 0;
let last = 0;
let uat_now = 0;
let uat_last = 0;
let FetchPending = [];
let FetchPendingUAT = null;

let MessageCountHistory = [];
let MessageRate = 0;

let layers;
let layers_group;

let showingReplayBar = false;

function processAircraft(ac, init, uat) {
    const isArray = Array.isArray(ac);
    let hex = isArray ? ac[0] : ac.hex;

    if (icaoFilter && !icaoFilter.includes(hex))
        return;

    if (icaoBlacklist && icaoBlacklist.includes(hex))
        return;

    if (MergeNonIcao && hex.startsWith('~')) {
        hex = hex.slice(1);
    }

    const type = isArray ? ac[7] : ac.type;
    if (g.historyKeep && !g.historyKeep[hex] && type != 'adsc') {
        return;
    }

    if (uat && uatNoTISB && ac.type && ac.type.substring(0,4) == "tisb") {
        // drop non ADS-B planes from UAT (TIS-B)
        return;
    }

    // Do we already have this plane object in g.planes?
    // If not make it.
    let plane = g.planes[hex]

    if (!noVanish && plane && g.historyKeep && g.historyKeep[hex] && type != 'adsc') {
        if (now - plane.last_info_server > reapTimeout) {

            //console.log(`deleting ${hex} at ${now}`);

            delete g.planes[plane.icao];
            for (let i = 0; i < g.planesOrdered.length; ++i) {
                if (g.planesOrdered[i].icao == hex) {
                    g.planesOrdered.splice(i, 1);
                    break;
                }
            }

            plane.destroy();
            plane = null;
        }
    }


    if (!plane) {
        plane = new PlaneObject(hex);
        if (uat)
            plane.uat = true;
    }


    if (showTrace)
        return;

    // Call the function update
    if (globeIndex || replay) {
        if (!onlyMilitary || plane.military || (ac.dbFlags && ac.dbFlags & 1)) {
            plane.updateData(now, last, ac, init);
        } else {
            plane.last_message_time = now - ac.seen;
        }
        return;
    }
    if (uat_now == 0) {
        plane.updateData(now, last, ac, init);
        return;
    }

    // UAT dual source stuff below

    let newPos = ac.seen_pos;
    if (newPos === undefined || isNaN(newPos)) {
        newPos = 1000;
    }
    let oldPos = plane.seen_pos;
    if (oldPos === undefined || isNaN(oldPos)) {
        oldPos = 1000;
    }
    let newSeen = ac.seen;
    if (newSeen === undefined || isNaN(newSeen)) {
        newSeen = 1000;
    }
    let oldSeen = plane.seen;
    if (oldSeen === undefined || isNaN(oldSeen)) {
        oldSeen = 1000;
    }

    if (!uat) {
        if (!plane.uat // plane isn't uat, new data isn't uat, accept immediately
            || (prefer978 < 0 && newPos < -prefer978)
            || (newPos < 2 && oldPos > 4 + prefer978)
            || (oldPos > 60 && newSeen < 2 && oldSeen > 4 + prefer978)
            || init) {
            plane.uat = false;
            plane.updateData(now, last, ac, init);
        }
    } else {
        if (plane.uat // plane is uat, new data is uat, accept immediately
            || (prefer978 > 0 && newPos < prefer978)
            || (newPos < 2 && (oldPos > 4 - prefer978 || plane.dataSource == "mlat"))
            || (oldPos > 60 && newSeen < 2 && oldSeen > 4 - prefer978)
            || init) {
            let tisb = Array.isArray(ac) ? (ac[7] == "tisb") : (ac.tisb != null && ac.tisb.indexOf("lat") >= 0);
            if (tisb && plane.dataSource == "adsb") {
                // ignore TIS-B data for current ADS-B 1090 planes
            } else {
                plane.uat = true;
                plane.updateData(uat_now, uat_last, ac, init);
            }
        }
    }
}

let notNewCounter = 0;
let backwardsCounter = 0;
function processReceiverUpdate(data, init) {
    // update now and last
    let uat = data.uat_978;
    if (uat) {
        if (data.now <= uat_now)
            return;
        uat_last = uat_now;
        uat_now = data.now;
    } else {
        if (uat_now && now - uat_now > 15) {
            uat_now = now;
        }
        if (data.now <= now && !globeIndex) {
            if (data.now < now) {
                backwardsCounter++;
                console.log('timestep backwards or the same, ignoring data: ' + now + ' -> ' + data.now);
                if (backwardsCounter >= 5) {
                    backwardsCounter = 0;
                    console.log('resetting all data now:' + now + ' -> ' + data.now);
                    now = data.now;
                    last = now - 1;
                    reaper(1);
                    enableDynamicCachebusting = true;
                }
            }
            if (++notNewCounter > 2) {
                // data.now is too old, possibly a caching issues
                enableDynamicCachebusting = true;
            }
            return;
        }
        if (data.now > now) {
            if (0 && now && data.now - now > 10) {
                console.log('now jumped: ' + localTime(new Date(now * 1000)) + ' -> ' + localTime(new Date(data.now * 1000)));
            }
            notNewCounter = 0;
            backwardsCounter = 0;
            last = now;
            now = data.now;
        }
    }
    g.now = now;

    if (globeIndex) {
        globeTrackedAircraft = data.global_ac_count_withpos;
        globeIndexNow[data.globeIndex] = data.now;
    }

    if (!(uat || init || (globeIndex && aggregator))) {
        updateMessageRate(data);
    }

    // Loop through all the planes in the data packet
    for (let j=0; j < data.aircraft.length; j++) {
        processAircraft(data.aircraft[j], init, uat);
    }
}
function fetchFail(jqxhr, status, error) {
    try {
        pendingFetches--;
        if (pendingFetches <= 0 && !tabHidden) {
            triggerRefresh++;
            checkMovement();
        }
        status = jqxhr.status;
        if (jqxhr.readyState == 0) error = "Can't connect to server, check your network!";
        let errText = status + (error ? (": " + error) : "");
        console.log(jqxhr);
        console.log(error);
        if (status != 429 && status != '429') {
            SKYUI.conn.fail(errText);
            StaleReceiverCount++;
        } else {
            if (C429++ > 16) {
                globeRateUpdate();
                C429 = 0;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

function fetchDone(data) {
    try {
        pendingFetches--;
        if (data == null) {
            return;
        }
        if (zstd) {
            let arr = new Uint8Array(data);
            lastRequestSize = arr.byteLength;
            let res;
            try {
                res = zstdDecode( arr, 0 );
            } catch (e) {
                let errText = e.message;
                console.log(errText);
                SKYUI.conn.fail(errText);
                return;
            }
            let arrayBuffer = res.buffer
            // return type is Uint8Array, wqi requires the ArrayBuffer
            data = { buffer: arrayBuffer, };
            wqi(data);
        } else if (binCraft) {
            lastRequestSize = data.byteLength / 2;
            data = { buffer: data, };
            wqi(data);
        }
        data.urlIndex = this.urlIndex;

        if (!data.aircraft || !data.now) {
            let error = data.error;
            if (error) {
                SKYUI.conn.fail(error);
                StaleReceiverCount++;
            }
            return;
        }

        if (!timersActive) {
            //console.log(localTime(new Date()) + " fetchDone: not applying data due to !timersActive");
            return;
        }

        //console.time("Process " + data.globeIndex);
        processReceiverUpdate(data);
        //console.timeEnd("Process " + data.globeIndex);
        data = null;

        if (uat_data) {
            processReceiverUpdate(uat_data);
            uat_data = null;
        }

        if (pendingFetches <= 0 && !tabHidden) {
            triggerRefresh++;
            checkMovement();
            if (firstFetch) {
                firstFetch = false;
                if (uuid || filterUuid) {
                    const ext = myExtent(mapa.calcExtent());
                    let jump = true;
                    for (let i = 0; i < g.planesOrdered.length; ++i) {
                        const plane = g.planesOrdered[i];
                        if (plane.visible && inView(plane.position, ext)) {
                            jump = false;
                            break;
                        }
                    }
                    if (jump) {
                        followRandomPlane();
                        deselectAllPlanes();
                        mapa.setZoom(6);
                    }
                }
                checkRefresh();
            }
        }
        fetchDoneCount++;
        if (fetchDoneCount == 1) { console.timeEnd("first fetch()"); };

        if (!g.firstFetchDone) { afterFirstFetch(); };

        // Check for stale receiver data
        if (last == now && !globeIndex) {
            StaleReceiverCount++;
            SKYUI.conn.ok(false);       // answering, but the receiver time did not advance (the banner turns "stale" after 30 s)
        } else {
            StaleReceiverCount = 0;
            SKYUI.conn.ok(true);
        }
    } catch (e) {
        console.error(e);
    }
}

let operatorsCache = null;
let operatorsCacheLoaded = false;

function db_load_type_cache() {
    return jQuery.getJSON(databaseFolder + "/icao_aircraft_types2.js").done(function(typeLookupData) {
        g.type_cache = typeLookupData;
        for (let i in g.planesOrdered) {
            g.planesOrdered[i].setTypeData();
        }
    });
}

function db_load_operators_cache() {
    if (operatorsCacheLoaded) {
        return jQuery.Deferred().resolve(operatorsCache).promise();
    }
    operatorsCacheLoaded = true;
    return jQuery.getJSON(databaseFolder + "/operators.js").done(function(operatorData) {
        operatorsCache = operatorData || {};
    }).fail(function() {
        operatorsCache = {};
    });
}

function lookupAirlineForCallsign(callsign, registration, category) {
    if (!airlineLookup || !operatorsCache) {
        return null;
    }
    if (!callsign) {
        return null;
    }
    if (category && category.startsWith('C')) {
        return null;
    }

    // borrows approach used in FlightGazer, probably could be improved
    let cs = callsign.replace(/\s/g, '');
    if (cs.length < 4) {
        return null;
    }
    cs = cs.toUpperCase();
    let first4 = cs.slice(0, 4);
    if (/^[A-Z]{4}$/.test(first4)) {
        return null;
    }
    let prefix = cs.slice(0, 3);
    if (!/^[A-Z]{3}$/.test(prefix)) {
        return null;
    }
    if (registration) {
        let regNormalized = registration.replace(/[\-\+]/g, '').toUpperCase();
        if (regNormalized === cs) {
            return null;
        }
    }
    return operatorsCache[prefix] || null;
}

g.afterLoadDone = false;
g.afterLoad = [];
function runAfterLoad(func) {
    if (g.afterLoadDone) {
        func()
    } else {
        g.afterLoad.push(func);
    }
}

function afterFirstFetch() {
    if (g.firstFetchDone) { return; }

    g.firstFetchDone = true;

    updateVisible();
    mapRefresh();

    setTimeout(() => {
        console.time('afterFirstFetch()');


        let func;
        while ((func = g.afterLoad.pop())) {
            func();
        }
        g.afterLoadDone = true;
        while ((func = g.afterLoad.pop())) {
            func();
        }


        geoMag = geoMagFactory(cof2Obj());

        jQuery.when(db_load_type_cache(), db_load_operators_cache()).always(function() {
            refresh();
        });

        if (usp.has('screenshot')) {
            clearIntervalTimers('silent');
        }

        console.timeEnd('afterFirstFetch()');
    }, 30);
}

let debugFetch = false;
let C429 = 0;
let fetchCalls = 0;
let fetchDoneCount = 0;
function fetchData(options) {
    options = options || {};
    if (!timersActive) {
        //console.log(localTime(new Date()) + " fetchData inhibited by !timersActive");
        return;
    }
    if (heatmap || replay || showTrace || pTracks || !loadFinished || inhibitFetch) {
        return;
    }
    let currentTime = new Date().getTime();
    const refreshMs = refreshInt()
    g.lastRefreshInt = refreshMs;

    if (!options.force) {
        if (
            currentTime - lastFetch <= refreshMs
            || pendingFetches > 0
            || mapa.isBusy()
        ) {
            return;
        }
    }
    setTimeout(fetchData, refreshMs);
    if (debugFetch) {
        console.log('Time since last fetch: ' + (currentTime - lastFetch) + ' ms');
    }
    lastFetch = currentTime;

    FetchPending = [];
    if (FetchPendingUAT != null) {
        // don't double up on fetches, let the last one resolve
        return;
    }

    //console.timeEnd("Starting Fetch");
    //console.time("Starting Fetch");

    if (limitUpdates != -1 && fetchCalls > limitUpdates) {
        return;
    }
    fetchCalls++;

    if (fetchCalls == 1) { console.time("first fetch()"); };

    if (enable_uat) {
        FetchPendingUAT = jQuery.ajax({ url: 'chunks/978.json',
            dataType: 'json' });

        FetchPendingUAT.done(function(data) {
            uat_data = data;
            FetchPendingUAT = null;
        });
        FetchPendingUAT.fail(function(jqxhr, status, error) {
            FetchPendingUAT = null;
        });
    }

    let suffix = zstd ? '.binCraft.zst' : (binCraft ? '.binCraft' : '.json');
    if (enableDynamicCachebusting) {
        suffix += `?${currentTime}`;
    }

    let ac_url = [];
    if (uuid != null) {
        for (let i in uuid) {
            ac_url.push('uuid/?feed=' + uuid[i]);
        }
    } else if (filterUuid) {
        for (let i in filterUuid) {
            let url = 're-api/?' + (binCraft ? 'binCraft' : 'json');
            url += zstd ? '&zstd' : '';
            url += onlyMilitary ? '&filter_mil' : '';
            lastRequestBox = requestBoxString();

            if (firstFetch) {
                url += '&box=-90,90,-180,180';
            } else {
                url += '&box=' + lastRequestBox;
            }

            if (SelPlanes.length > 0) {
                url += '&find_hex='
                for (let k in SelPlanes) {
                    url += SelPlanes[k].icao + ','
                }
                url = url.slice(0, -1); // remove trailing comma
            }
            url += '&filter_uuid=' + filterUuid[i];
            ac_url.push(url);
        }
    } else if (reApi) {
        let url = 're-api/?' + (binCraft ? 'binCraft' : 'json');
        url += zstd ? '&zstd' : '';
        url += onlyMilitary ? '&filter_mil' : '';
        lastRequestBox = requestBoxString();
        if (icaoFilter) {
            if (icaoFilter.length > 0) {
                url += '&find_hex='
                for (let k in icaoFilter) {
                    url += icaoFilter[k] + ','
                }
                url = url.slice(0, -1); // remove trailing comma
            }
        } else if (onlySelected && SelPlanes.length > 0) {
            url += '&find_hex='
            for (let k in SelPlanes) {
                url += SelPlanes[k].icao + ','
            }
            url = url.slice(0, -1); // remove trailing comma
        } else  {
            url += '&box=' + lastRequestBox;

            if (SelPlanes.length > 0) {
                url += '&find_hex='
                for (let k in SelPlanes) {
                    url += SelPlanes[k].icao + ','
                }
                url = url.slice(0, -1); // remove trailing comma
            }
        }

        ac_url.push(url);
        //console.log(url);

    } else if (globeIndex) {
        let indexes = globeIndexes();
        const ancient = (currentTime - 2 * refreshMs / globeSimLoad * globeTilesViewCount) / 1000;
        for (let i in indexes) {
            const k = indexes[i];
            if (globeIndexNow[k] < ancient) {
                globeIndexNow[k] = null;
            }
        }
        indexes.sort(function(x,y) {
            if (!globeIndexNow[x] && !globeIndexNow[y]) {
                return globeIndexDist[x] - globeIndexDist[y];
            }
            if (globeIndexNow[x] == null)
                return -1;
            if (globeIndexNow[y] == null)
                return 1;
            return (globeIndexNow[x] - globeIndexNow[y]);
        });

        if (binCraft && onlyMilitary && g.zoomLvl < 5.5) {
            ac_url.push('data/globeMil_42777' + suffix);
        } else {

            indexes = indexes.slice(0, globeSimLoad);

            let mid = (binCraft && onlyMilitary) ? 'Mil_' : '_';
            for (let i in indexes) {
                ac_url.push('data/globe' + mid + indexes[i].toString().padStart(4, '0') + suffix);
            }
        }
    } else {
        ac_url.push('data/aircraft' + suffix);
    }

    pendingFetches += ac_url.length;
    fetchCounter += ac_url.length;

    for (let i in ac_url) {
        if (debugFetch) {
            console.log('Fetching: ' + ac_url[i]);
        }
        let req;
        if (binCraft || zstd) {
            req = jQuery.ajax({
                url: `${ac_url[i]}`, method: 'GET',
                xhr: arraybufferRequest,
                timeout: 15000,
                urlIndex: i,
            });
        } else {
            req = jQuery.ajax({ url: `${ac_url[i]}`, dataType: 'json', urlIndex: i });
        }
        FetchPending.push(req);

        req
            .done(fetchDone)
            .fail(fetchFail);
    }


    if (now - lastReap > 60) {
        reaper();
    }
}

// this function is called from index.html on body load
// kicks off the whole rabbit hole
function initialize() {
    if (usp.has('iconTest') || usp.has('iconTestLabels')) {
        jQuery('#iconTestCanvas').show();
        iconTest();
        return;
    }

    // things that can run without receiver json being known
    earlyInitPage();
    initMapEarly();

    jQuery.when(configureReceiver, heatmapDefer).done(function() {

        if (receiverJson) {
            if (receiverJson.trace_hist_only)
                trace_hist_only = true;
            if (receiverJson.json_trace_interval < 2)
                traces_high_res = true;
            if (receiverJson.lat != null && !SiteOverride) {
                //console.log("receiver.json lat: " + receiverJson.lat)
                SiteLat = receiverJson.lat;
                SiteLon = receiverJson.lon;
            }
            if (receiverJson.jaeroTimeout) {
                jaeroTimeout = receiverJson.jaeroTimeout * 60;
            }


            if (receiverJson.readsb) {
                positionFilter = false;
                altitudeFilter = false;
            }
        }

        if (SiteLat && SiteLon) {
            SitePosition = [SiteLon, SiteLat];
            DefaultCenterLat = SiteLat;
            DefaultCenterLon = SiteLon;
        }

        configureReceiver = null;

        // Initialize stuff
        initPage();
        initMap();

        processQueryToggles();

        jQuery.when(historyQueued).done(push_history);

        if (!nHistoryItems) {
            historyLoaded.resolve();
        }

        jQuery.when(historyLoaded, zstdDefer).done(startPage);
    });
}


function processQueryToggles() {
    if (!usp.has('toggles')) {
        return;
    }
    let todo;
    try {
        todo = usp.get('toggles').split(',');;
    } catch (e) {
        console.error(e);
        return;
    }
    while (todo.length >= 2) {
        let key = todo.shift();
        let value = todo.shift();
        let state = true;
        if (value == 'false' || value == '0') {
            state = false;
        }
        try {
            toggles[key].toggle(state, "init");
            console.log((state ? "Enabled" : "Disabled") + " setting: " + key);
        } catch (e) {
            console.error(e);
        }
    }
}

function replaySpeedChange(arg) {
    traceOpts.replaySpeed = arg;
    console.log(arg);
    if (traceOpts.animate)
        return;
    legShift(0);
};

function initPage() {

    if (globeIndex) {
        function setGlobeTableLimit() {
            let mult = 1 + 4 * toggles['moreTableLines1'].state + 16 * (toggles['moreTableLines2'] && toggles['moreTableLines2'].state);
            globeTableLimit = globeTableLimitBase * mult;
            if (toggles['allTableLines'] && toggles['allTableLines'].state)
                globeTableLimit = 1e9;
            if (onMobile)
                globeTableLimit /= 2;
        };
        new Toggle({
            key: "moreTableLines1",
            display: "More Table Lines",
            container: "#sidebar-table",
            init: false,
            setState: setGlobeTableLimit,
        });
        new Toggle({
            key: "moreTableLines2",
            display: "Even More Table Lines",
            container: "#sidebar-table",
            init: false,
            setState: setGlobeTableLimit,
        });
        new Toggle({
            key: "allTableLines",
            display: "All Table Lines",
            container: "#sidebar-table",
            init: false,
            setState: setGlobeTableLimit,
        });
    }


    if (!globeIndex && !haveTraces) {
        jQuery("#lastLeg_cb").parent().hide();
        jQuery('#show_trace').hide();
    }
    if (globeIndex) {
        toggleTableInView('enable');
        if (icaoFilter) {
            toggleTableInView('disable');
        }
    } else {
        jQuery('#V').show();
    }

    if (usp.has('SiteLat') && usp.has('SiteLon')) {
        let lat = parseFloat(usp.get('SiteLat'));
        let lon = parseFloat(usp.get('SiteLon'));
        if (!isNaN(lat) && !isNaN(lon)) {
            SiteLat = CenterLat = DefaultCenterLat = lat;
            SiteLon = CenterLon = DefaultCenterLon = lon;
            SiteOverride = true;
            loStore['SiteLat'] = lat;
            loStore['SiteLon'] = lon;
        }
    }
    if (loStore['SiteLat'] != null && loStore['SiteLon'] != null) {
        if (usp.has('SiteClear')) {
            loStore.removeItem('SiteLat');
            loStore.removeItem('SiteLon');
        }
    } else {
        CenterLat = DefaultCenterLat;
        CenterLon = DefaultCenterLon;
    }

}

function earlyInitPage() {
    // things that can run without receiver json being known
    if (audio_url) {
        if (!Array.isArray(audio_url)) {
            audio_url = [ audio_url ];
        }
        let html = "";
        for (const entry of audio_url) {
            let url = entry;
            let title = entry;
            if (Array.isArray(url)) {
                url = entry[0];
                title = entry[1];
            }
            if (url) {
                html += `
                    <tr><td style="text-align: center">${title}</td></tr>
                    <tr><td style="text-align: center">
                    <audio crossorigin="anonymous" preload="none" src="${url}" type="audio/mp3" controls="controls" autoplay="false"></audio>
                    </td></tr>
                `;
            }
        }
        if (html) {
            document.getElementById('mp3player').innerHTML = html;
            jQuery('#mp3player').show();
        }
    }

    let value;

    if (uk_advisory) {
        defaultOverlays.push('uka_airports');
        defaultOverlays.push('uka_airspaces');
        defaultOverlays.push('uka_runways');
        defaultOverlays.push('uka_shoreham');
        atcStyle = true;
    }

    if (atcStyle) {
        labels_top = true;
        tempTrails = true;
        tempTrailsTimeout = 45;
        SiteCirclesDistances = new Array(5, 10, 20);
        SiteCirclesLineDash = [5, 5];
        SiteCirclesColors = ['#2b3436', '#2b3436', '#2b3436'];
        MapType_tar1090 = 'carto_light_all';
        lineWidth=4;
        g.enableLabels=true;
    }

    if (usp.has('debugFetch')) {
        debugFetch = true;
    }

    if (usp.has('rangeRings')) {
        SiteCircles = Boolean(parseInt(usp.get('rangeRings')));
    }

    if (usp.has('limitUpdates')) {
        let tmp = parseInt(usp.get('limitUpdates'));
        if (!isNaN(tmp))
            limitUpdates = tmp;
    }

    if (usp.has('screenshot')) {
        limitUpdates = 0;
    }

    if (usp.has('showGrid')) {
        showGrid = true;
        loStore['layer_site_pos'] = 'true';
    }

    if (usp.has('halloween'))
        halloween = true;

    if (usp.has('outlineWidth')) {
        let tmp = parseInt(usp.get('outlineWidth'));
        if (!isNaN(tmp))
            outlineWidth = tmp;
    }

    if (usp.has('kiosk')) {
        tempTrails = true;
        hideButtons = true;
        userScale = 2;
    }

    if (pTracks) {
        noVanish = true;
        buttonActive('#P', noVanish);
        filterTracks = true;
        selectAllPlanes();
    }

    if (usp.has('mobile'))
        onMobile = true;
    if (usp.has('desktop'))
        onMobile = false;

    if (usp.has('hideSidebar'))
        loStore['sidebar_visible'] = "false";
    if (usp.has('sidebarWidth')) {
        loStore['sidebar_width'] = usp.get('sidebarWidth');
        loStore['sidebar_visible'] = "true";
    }

    if (usp.has('allTracks') || defaultAllTracks) {
        SelectedAllPlanes = true;
        buttonActive('#T', SelectedAllPlanes);
    }
    if (usp.has('tempTrails')) {
        tempTrails = true;
        let tmp = parseInt(usp.get('tempTrails'));
        if (tmp > 0)
            tempTrailsTimeout = tmp;
    }
    if (usp.has('squareMania')) {
        squareMania = true;
    }

    if (usp.has('darkerColors')) {
        darkerColors = true;
    }

    if (usp.has('mapDim')) {
        let dim = parseFloat(usp.get('mapDim'));
        if (!isNaN(dim))
            mapDimPercentage = dim;
    } else if (heatmap) {
        mapDimPercentage = 0.6;
        MapDim = true;
    }

    if (usp.has('noRegOnly'))
        noRegOnly = true;

    if (usp.has('nogpsOnly') || usp.has('badgps'))
        nogpsOnly = true;

    if (usp.has('mapContrast')) {
        let contrast = parseFloat(usp.get('mapContrast'));
        if (!isNaN(contrast))
            mapContrastPercentage = contrast;
    }

    if (value = usp.getFloat('labelScale')) {
        labelScale = value;
    }

    if (value = usp.getFloat('largeMode')) {
        userScale = Math.pow(1.2, value) / 1.2;
        iconScale = 1;
    }

    if (value = usp.getFloat('iconScale')) {
        iconScale = value;
    } else if (loStore['iconScale'] != null) {
        iconScale = loStore['iconScale'];
    }

    if (value = usp.getFloat('scale')) {
        userScale = value;
    } else if (loStore['userScale'] != null) {
        userScale = loStore['userScale'];
    }

    // Skywatch ADS-B: native range inputs in the settings dialog (ui/settings.js shows the value)
    const iconRange = document.getElementById('iconScaleRange');
    const userRange = document.getElementById('userScaleRange');
    iconRange.value = iconScale;
    userRange.value = userScale;
    iconRange.addEventListener('change', function() {
        iconScale = Number(this.value);
        checkScale();
        mapRefresh();
        loStore['iconScale'] = iconScale;
    });
    userRange.addEventListener('change', function() {
        userScale = Number(this.value);
        checkScale();
        mapRefresh();
        loStore['userScale'] = userScale;
        setGlobalScale(userScale);
    });
    setGlobalScale(userScale, "init");

    if (usp.has('hideButtons'))
        hideButtons = true;

    if (usp.has('baseMap')) {
        overrideMapType = usp.get('baseMap');
    }

    if (usp.has('offlineMap')) {
        overrideMapType = 'osm_tiles_offline';
    }

    if (usp.has('overlays'))
        enableOverlays = usp.get('overlays').split(',');

    if (value = usp.get('icaoFilter')) {
        icaoFilter = value.toLowerCase().split(',');
    }

    if (value = usp.get('icaoBlacklist')) {
        icaoBlacklist = value.toLowerCase().split(',');
    }

    if (value = usp.getFloat('filterMaxRange')) {
        filterMaxRange = value;
    }
    filterMaxRange *= 1852; // convert from nmi to meters


    if (value = usp.getFloat('mapOrientation')) {
        g.mapOrientation = value;
    }
    g.mapOrientation *= (Math.PI/180); // adjust to radians

    if (usp.has('r') || usp.has('replay')) {
        let numbers = (usp.get('r') || usp.get('replay') || "").split(/(?:-|:)/);
        let ts = new Date();
        if (numbers.length == 5) {
            ts.setUTCFullYear(numbers[0]);
            ts.setUTCMonth(numbers[1] - 1);
            ts.setUTCDate(numbers[2]);
            ts.setUTCHours(numbers[3]);
            ts.setUTCMinutes(numbers[4]);
        }
        if (isNaN(ts)) {
            ts = new Date();
        }
        console.log(ts);
        replay = replayDefaults(ts);
    }

    //Pulling filters from params
    if (usp.has('filterAltMin')) {
        const minAlt = usp.getInt('filterAltMin');
        if (minAlt !== null)  {
            PlaneFilter.minAltitude = minAlt;
            PlaneFilter.enabled = true;
            PlaneFilter.maxAltitude = 1000000;
        }
    }
    if (usp.has('filterAltMax')) {
        const maxAlt = usp.getInt('filterAltMax');
        if (maxAlt !== null)  {
            PlaneFilter.maxAltitude = maxAlt;
            PlaneFilter.enabled = true;
            if (PlaneFilter.minAltitude === undefined) {
                PlaneFilter.minAltitude = -1000000;
            }
        }
    }

    if (usp.has('filterSources')) {
        PlaneFilter.sources = usp.get('filterSources').split(',');
        shareFiltersParam = true;
    }
    if (usp.has('filterDbFlag')) {
        PlaneFilter.flagFilter = usp.get('filterDbFlag').split(',');
        shareFiltersParam = true;
    }


    if (false && iOSVersion() <= 12 && !('PointerEvent' in window)) {
        jQuery("#generic_error_detail").text("Enable Settings - Safari - Advanced - Experimental features - Pointer Events");
        jQuery("#generic_error").css('display','block');
        setTimeout(function() {
            jQuery("#generic_error").css('display','none');
        }, 30000);
    }

    // one-time: labels are on by default now (callsign + airline logo); reset older saved L / O choices
    try {
        if (loStore['labelsDefaultV'] !== '1') {
            delete loStore['enableLabels']; delete loStore['extendedLabels'];
            loStore['labelsDefaultV'] = '1';
        }
    } catch (e) {}
    if (loStore['enableLabels'] == 'true' || usp.has('enableLabels')
        || (loStore['enableLabels'] == undefined && defaultLabels)) {
        toggleLabels();
    }
    if (usp.has('extendedLabels')) {
        g.extendedLabels = parseInt(usp.getFloat('extendedLabels'));
        toggleExtendedLabels({ noIncrement: true });
    } else if (loStore['extendedLabels']) {
        g.extendedLabels = parseInt(loStore['extendedLabels']);
        toggleExtendedLabels({ noIncrement: true });
    } else if (defaultExtendedLabels) {
        g.extendedLabels = parseInt(defaultExtendedLabels);
        toggleExtendedLabels({ noIncrement: true });
    }
    if (loStore['trackLabels'] == "true" || usp.has('trackLabels')
        || (loStore['trackLabels'] == undefined && defaultTrackLabels)) {
        toggleTrackLabels();
    }
    if (loStore['tableInView'] == "true" || usp.has('tableInView')) {
        toggleTableInView('enable');
    }
    if (loStore['debug'] == "true")
        debug = true;
    if (loStore['debugPosFilter'] == "true")
        debugPosFilter = true;

    if (loStore['noVanish'] == "true" || usp.has('noVanish')) {
        noVanish = true;
        //filterTracks = noVanish;
        //loStore['noVanish'] = "false";
        buttonActive('#P', noVanish);
    }


    // Set page basics
    document.title = PROJECT_NAME;   // the name is fixed (html/project.js); TAR1090_PAGETITLE / PageName no longer set the title

    initializeUnitsSelector();
    TAR.planeMan.init();

    // (sidebar width, splitter and expand/shrink buttons: replaced by the floating panels in ui/shell.js)

    jQuery("#altimeter_form").submit(onAltimeterChange);
    jQuery("#altimeter_set_standard").click(onAltimeterSetStandard);
    jQuery("#altimeter_set_selected").click(onAltimeterSetSelected);

    // Set up altitude filter button event handlers and validation options
    jQuery("#altitude_filter_form").submit(onFilterByAltitude);
    jQuery("#source_filter_form").submit(updateSourceFilter);
    jQuery("#flag_filter_form").submit(updateFlagFilter);

    jQuery("#altitude_filter_reset_button").click(onResetAltitudeFilter);
    jQuery("#source_filter_reset_button").click(onResetSourceFilter);
    jQuery("#flag_filter_reset_button").click(onResetFlagFilter);

    // Search: the unified top-bar search is wired in ui/shell.js (onUnifiedSearch)

    jQuery("#show_trace").click(toggleShowTrace);
    jQuery("#trace_back_1d").click(function() {shiftTrace(-1)});
    jQuery("#trace_jump_1d").click(function() {shiftTrace(1)});

    jQuery("#histDatePicker").datepicker({
        maxDate: '+1d',
        dateFormat: "yy-mm-dd",
        onSelect: function(date){
            setTraceDate({string: date});
            shiftTrace();
            jQuery("#histDatePicker").blur();
        },
        autoSize: true,
        onClose: !onMobile ? null : function(dateText, inst){
            jQuery("#histDatePicker").attr("disabled", false);
        },
        beforeShow: !onMobile ? null : function(input, inst){
            jQuery("#histDatePicker").attr("disabled", true);
        },
    });

    jQuery("#replayPlay").click(function(){

        if (replay.playing){
            //if playing, pause.
            playReplay(false);

        } else {
            //if paused, play.
            playReplay(true);
        }
    });

    jQuery("#leg_prev").click(function() {legShift(-1)});
    jQuery("#leg_next").click(function() {legShift(1)});

    // Skywatch ADS-B: the settings dialog is opened/closed by ui/settings.js

    jQuery('#groundvehicle_filter').on('click', function() {
        filterGroundVehicles(true);
        refresh();
    });

    jQuery('#blockedmlat_filter').on('click', function() {
        filterBlockedMLAT(true);
        refresh();
    });

    new Toggle({
        key: "lastLeg",
        display: "Last Leg only",
        container: "#settingsLeft",
        init: true,
        setState: function(state) {
            lastLeg = state;
            if (loadFinished && !showTrace) {
                for (let i in SelPlanes) {
                    SelPlanes[i].processTrace();
                }
            }
        }
    });
    new Toggle({
        key: "labelsGeom",
        display: "Labels: geom. alt. (WGS84)",
        container: "#settingsLeft",
        init: labelsGeom,
        setState: function(state) {
            labelsGeom = state;
            if (loadFinished) {
                remakeTrails();
                refreshSelected();
            }
        }
    });
    new Toggle({
        key: "geomUseEGM",
        display: "Geom. alt.: WGS84 -> EGM conversion (long load)",
        container: "#settingsLeft",
        init: geomUseEGM,
        setState: function(state) {
            geomUseEGM = state;
            if (geomUseEGM) {
                jQuery('#selected_altitude_geom2_title').updateText('Geometric (EGM96)');
                let egm = loadEGM();
                if (egm) {
                    egm.addEventListener('load', function() {
                        remakeTrails();
                        refreshSelected();
                    });
                    return;
                }
            } else {
                jQuery('#selected_altitude_geom2_title').updateText('Geometric');
            }
            if (loadFinished) {
                remakeTrails();
                refreshSelected();
            }
        }
    });

    new Toggle({
        key: "baroUseQNH",
        display: "Baro. alt.: correct for QNH",
        container: "#settingsLeft",
        init: baroUseQNH,
        setState: function(state) {
            baroUseQNH = state;
            if (baroUseQNH) {
                jQuery('#selected_altitude2_title').updateText('Barometric (QNH)');
                jQuery('#infoblock_altimeter').removeClass('hidden');
            } else {
                jQuery('#selected_altitude2_title').updateText('Barometric');
                jQuery('#infoblock_altimeter').addClass('hidden');
            }
            if (loadFinished) {
                remakeTrails();
                refreshSelected();
            }
        }
    });

    if (usp.has('labelsGeom')) {
        toggles['labelsGeom'].toggle(true, 'init');
    }

    if (usp.has('geomEGM')) {
        toggles['geomUseEGM'].toggle(true, 'init');
    }

    new Toggle({
        key: "utcTimesLive",
        display: "Live track labels: UTC",
        container: "#settingsLeft",
        init: utcTimesLive,
        setState: function(state) {
            utcTimesLive = state;
            remakeTrails();
            refreshSelected();
        }
    });

    new Toggle({
        key: "utcTimesHistoric",
        display: "Historic track labels: UTC",
        container: "#settingsLeft",
        init: utcTimesHistoric,
        setState: function(state) {
            utcTimesHistoric = state;
            remakeTrails();
            refreshSelected();
        }
    });

    new Toggle({
        key: "windLabelsSlim",
        display: "Smaller wind labels",
        container: "#settingsLeft",
        init: windLabelsSlim,
        setState: function(state) {
            windLabelsSlim = state;
            if (!loadFinished)
                return;
            for (let key in g.planesOrdered) {
                g.planesOrdered[key].updateMarker();
            }
        }
    });

    new Toggle({
        key: "showLabelUnits",
        display: "Label units",
        container: "#settingsLeft",
        init: showLabelUnits,
        setState: function(state) {
            showLabelUnits = state;
            if (!loadFinished)
                return;
            for (let key in g.planesOrdered) {
                g.planesOrdered[key].updateMarker();
            }
            remakeTrails();
            refreshSelected();
        }
    });


    jQuery('#tStop').on('click', function() { traceOpts.replaySpeed = 0; gotoTime(traceOpts.showTime); });
    jQuery('#t1x').on('click', function() { replaySpeedChange(1); });
    jQuery('#t5x').on('click', function() { replaySpeedChange(5); });
    jQuery('#t10x').on('click', function() { replaySpeedChange(10); });
    jQuery('#t20x').on('click', function() { replaySpeedChange(20); });
    jQuery('#t40x').on('click', function() { replaySpeedChange(40); });

    new Toggle({
        key: "shareFilters",
        display: "Include Filters In URLs",
        container: "#settingsRight",
        init: false,
        setState: function(state) {
            updateAddressBar();
        }
    });

    new Toggle({
        key: "debugTracks",
        display: "Debug Tracks",
        container: "#settingsRight",
        init: false,
        setState: function(state) {
            debugTracks = state;
            remakeTrails();
        }
    });

    new Toggle({
        key: "debugAll",
        display: "Debug show all",
        container: "#settingsRight",
        init: false,
        setState: function(state) {
            if (state)
                debugAll = true;
            else
                debugAll = false;
        }
    });

    /*
    new Toggle({
        key: "SiteCircles",
        display: "Distance Circles",
        container: "#settingsRight",
        init: SiteCircles,
        setState: function(state) {
            SiteCircles = state;
            if (loadFinished)
                initSitePos();
        }
    });
    */

    new Toggle({
        key: "updateLocation",
        display: "Update GPS location",
        container: "#settingsRight",
        init: updateLocation,
        setState: function(state) {
            updateLocation = state;
            runAfterLoad(watchPosition);
        }
    });

    new Toggle({
        key: "autoselect",
        display: "Auto-select plane",
        container: "#settingsRight",
        init: autoselect,
        setState: function(state) {
            autoselect = state;
            setAutoselect();
        }
    });
    if (usp.has('autoselect')) {
        autoselect = true;
        setAutoselect();
    }

    new Toggle({
        key: "ColoredPlanes",
        display: "Colored Planes",
        container: "#settingsRight",
        init: true,
        setState: function(state) {
            if (state)
                monochromeMarkers = null;
            else
                monochromeMarkers = "#EEEEEE";

            refreshFeatures();
        }
    });

    new Toggle({
        key: "ColoredTrails",
        display: "Colored Trails",
        container: "#settingsRight",
        init: true,
        setState: function(state) {
            if (state)
                monochromeTracks = null;
            else
                monochromeTracks = "#c4c8d0";   // light grey: black would vanish on the black map

            remakeTrails();
        }
    });

    new Toggle({
        key: "sidebar_visible",
        display: "Sidebar visible",
        container: null,
        checkbox: null,
        init: (onMobile ? false : true),
        setState: function (state) {
            // Skywatch ADS-B: the aircraft list is a floating panel (ui/shell.js)
            jQuery("#sidebar_container").toggle(!!state);
            if (typeof shellSync == 'function')
                shellSync();
            if (loadFinished && state)
                TAR.planeMan.redraw();
        },
    });

    if (!showPictures) {
        planespottingAPI = false;
        planespottersAPI = false;
    }
    new Toggle({
        key: "planespottingAPI",
        display: "Pictures planespotting.be",
        container: "#settingsRight",
        init: planespottingAPI,
        setState: function(state) {
            planespottingAPI = state;
            if (state) {
                toggles['planespottersAPI'] && toggles['planespottersAPI'].toggle(false);
            }
            setPictureVisibility();
            refreshSelected();
        }
    });
    new Toggle({
        key: "planespottersAPI",
        display: "Pictures planespotters.net",
        container: "#settingsRight",
        init: planespottersAPI,
        setState: function(state) {
            planespottersAPI = state;
            if (state) {
                toggles['planespottingAPI'] && toggles['planespottingAPI'].toggle(false);
            }
            setPictureVisibility();
            refreshSelected();
        }
    });

    if (routeApiUrl) {
        if (location.protocol == 'http:' && routeApiUrl == "https://adsb.im/api/0/routeset") {
            // adsb.im API provider kindly asks that tar1090 uses http for the route API if possible
            routeApiUrl = "http://adsb.im/api/0/routeset";
        }
        new Toggle({
            key: "useRouteAPI",
            display: "Lookup route",
            container: "#settingsRight",
            init: useRouteAPI,
            setState: function(state) {
                useRouteAPI = state;
                if (useRouteAPI) {
                    jQuery('#routeRow').show();
                    jQuery('#routeRowHighlighted').show();
                } else {
                    jQuery('#routeRow').hide();
                    jQuery('#routeRowHighlighted').hide();
                }
                if (loadFinished) {
                    TAR.planeMan.redraw(); // route column only exists while lookups are on
                    typeof updateListChips == 'function' && updateListChips();
                }
            }
        });
        if (useIataAirportCodes == false) {
            routeDisplay = 'icao'; // cope with deprecated useIata var
        }
        if (usp.has('routeDisplay')) {
            routeDisplay = usp.get('routeDisplay');
        }
        routeDisplay = routeDisplay.split(',');
    } else {
        useRouteAPI = false;
    }


    new Toggle({
        key: "enableInfoblock",
        display: "Enable Infoblock",
        container: "#settingsRight",
        init: true,
        setState: function(state) {
            adjustInfoBlock();
        }
    });

    new Toggle({
        key: "wideInfoblock",
        display: "Wide Infoblock",
        container: "#settingsRight",
        init: wideInfoBlock,
        setState: function(state) {
            wideInfoBlock = state;
            adjustInfoBlock();
        }
    });

    if (onMobile) {
        enableMouseover = false;
        (typeof hideById != 'undefined') && (hideById) && (hideById('tracking_leaderboard_container'));
    }

    new Toggle({
        key: "enableMouseover",
        display: "Enable mouse-over block",
        container: "#settingsRight",
        init: enableMouseover,
        setState: function(state) {
            enableMouseover = state;
            if (loadFinished) {
                checkPointermove();
            }
        }
    });



    jQuery('#selectall_checkbox').on('click', function() {
        if (jQuery('#selectall_checkbox').hasClass('settingsCheckboxChecked')) {
            deselectAllPlanes();
        } else {
            selectAllPlanes();
        }
    })


    filterGroundVehicles(false);
    filterBlockedMLAT(false);

    TAR.altitudeChart.init();

    if (aggregator) {
        jQuery('#aggregator_header').show();
        jQuery('#credits').show();
        if (!onMobile) {
            jQuery('#creditsSelected').show();
        }
        jQuery('#selected_infoblock').addClass('aggregator-selected-bg');

        // activate to prevent iframe use
        if (inhibitIframe && window.self != window.top) {
            window.top.location.href = "https://www.aggregator.com/";
            return;
        }
    }
    if (imageConfigLink != "") {
        let host = window.location.hostname;
        let configLink = imageConfigLink.replace('HOSTNAME', host);
        jQuery('#imageConfigLink').attr('href',configLink)
        jQuery('#imageConfigLink').text(imageConfigText)
        jQuery('#imageConfigHeader').show();
    }
    if (aiscatcher_server) {
        aiscatcher_server = aiscatcher_server.replace('HOSTNAME', window.location.hostname);
    }

    if (hideButtons) {
        showHideButtons();
        runAfterLoad(showHideButtons);
    }
}

// Source groups share one marker shape + colour everywhere (table rows,
// legend, source filter chips): ADS-B family, MLAT, TIS-B, everything else.
function sourceGroup(dataSource) {
    switch (dataSource) {
        case 'adsb': case 'uat': case 'adsr':
            return 'adsb';
        case 'mlat':
            return 'mlat';
        case 'tisb':
            return 'tisb';
        default:
            return 'other';
    }
}

const emergencySquawks = new Set(['7500', '7600', '7700']);

function initLegend() {
    const item = function (group, text, title) {
        return '<span class="legendItem src-' + group + '" title="' + title + '">' + text + '</span>';
    };
    let other = ['Mode-S', jaeroLabel];
    if (aiscatcher_server)
        other.push('AIS');
    let html = '';
    html += item('adsb', 'ADS-B', 'ADS-B, UAT, ADS-R');
    html += item('mlat', 'MLAT', 'Multilateration');
    html += item('tisb', 'TIS-B', 'Traffic information service broadcast');
    html += item('other', 'Other', other.join(', ') + ', no position');

    document.getElementById('legend').innerHTML = html;
}

function initSourceFilter() {
    const createFilter = function (text, key) {
        return '<li class="ui-widget-content src-' + sourceGroup(key) + '" id="source-filter-' + key + '">' + text + '</li>';
    };

    let html = '';
    html += createFilter('ADS-B', sources[0]);

    html += createFilter('UAT / ADS-R', sources[1][0]);
    html += createFilter('MLAT', sources[2]);
    html += createFilter('TIS-B', sources[3]);
    html += createFilter('Mode-S', sources[4]);
    html += createFilter('Other', sources[5]);
    html += createFilter(jaeroLabel, sources[6]);

    if (aiscatcher_server) {
        html += createFilter('AIS', sources[7]);
    }

    document.getElementById('sourceFilter').innerHTML = html;

    jQuery("#sourceFilter").selectable({
        stop: function () {
            sourcesFilter = [];
            jQuery(".ui-selected", this).each(function () {
                const index = jQuery("#sourceFilter li").index(this);
                if (Array.isArray(sources[index]))
                    sources[index].forEach(member => { sourcesFilter.push(member); });
                else
                    sourcesFilter.push(sources[index]);
            });
        }
    });

    jQuery("#sourceFilter").on("selectablestart", function (event, ui) {
        event.originalEvent.ctrlKey = true;
    });
}

function initFlagFilter() {
    const createFilter = function (text, key) {
        return '<li class="ui-widget-content" id="flag-filter-' + key + '">' + text + '</li>';
    };

    let html = '';
    html += createFilter('Military', flagFilterValues[0]);
    html += createFilter('PIA', flagFilterValues[1]);
    html += createFilter('LADD', flagFilterValues[2]);

    document.getElementById('flagFilter').innerHTML = html;

    jQuery("#flagFilter").selectable({
        stop: function () {
            flagFilter = [];
            jQuery(".ui-selected", this).each(function () {
                const index = jQuery("#flagFilter li").index(this);
                if (Array.isArray(flagFilterValues[index]))
                    flagFilterValues[index].forEach(member => { flagFilter.push(member); });
                else
                    flagFilter.push(flagFilterValues[index]);
            });
        }
    });

    jQuery("#flagFilter").on("selectablestart", function (event, ui) {
        event.originalEvent.ctrlKey = true;
    });
}

function push_history() {
    HistoryItemsReturned = 0;
    PositionHistoryBuffer = [];

    for (let i = 0; i < nHistoryItems; i++) {
        push_history_item(i);
    }
}

function push_history_item(i) {
    deferHistory[i]
        .done(function(json) {
            HistoryItemsReturned++;

            if (HistoryChunks) {
                if (json && json.files) {
                    //g.refreshHistory && console.log("itemsreturned chunk: " + HistoryItemsReturned + " chunklen: " + json.files.length);
                    for (let i in json.files) {
                        PositionHistoryBuffer.push(json.files[i]);
                        if (i == 0 || i == json.files.length - 1) {
                            //g.refreshHistory && console.log("history buffer push: " + localTime(new Date(json.files[i].now * 1000)));
                        }
                    }
                } else if (json && json.now) {
                    //g.refreshHistory && console.log("itemsreturned simple json: " + HistoryItemsReturned);
                    PositionHistoryBuffer.push(json);
                    //g.refreshHistory && console.log("history buffer push: " + localTime(new Date(json.now * 1000)));
                }
            } else {
                PositionHistoryBuffer.push(json);
            }

            if (HistoryItemsReturned == nHistoryItems) {
                parseHistory();
            }
            if (HistoryItemsReturned > nHistoryItems) {
                console.log(localTime(new Date()) + " WARNING: (HistoryItemsReturned > nHistoryItems)");
            }
        })

        .fail(function(jqxhr, status, error) {

            //Doesn't matter if it failed, we'll just be missing a data point
            //console.log(error);
            HistoryItemsReturned++;
            if (HistoryItemsReturned == nHistoryItems) {
                parseHistory();
            }
        });
}

function parseHistory() {
    console.timeEnd("Downloaded History");
    console.time("Loaded aircraft tracks from History");

    for (let i in deferHistory)
        deferHistory[i] = null;
    deferHistory = null;


    if (PositionHistoryBuffer.length > 0) {

        // Sort history by timestamp
        console.log(localTime(new Date()) + " Sorting history: " + PositionHistoryBuffer.length);
        PositionHistoryBuffer.sort(function(x,y) { return (y.now - x.now); });

        let currentTime = new Date().getTime()/1000;

        if (!pTracks && !noVanish) {
            // get all planes within the reapTimeout
            g.historyKeep = {};
            for (let i = 0; i < PositionHistoryBuffer.length; i++)  {
                let data = PositionHistoryBuffer[i];
                if (currentTime - data.now > reapTimeout) {
                    break;
                }
                for (let j=0; j < data.aircraft.length; j++) {
                    const ac = data.aircraft[j];
                    const isArray = Array.isArray(ac);
                    const hex = isArray ? ac[0] : ac.hex;
                    const seen = isArray ? ac[6] : ac.seen;
                    if (currentTime - (data.now - seen) < reapTimeout) {
                        g.historyKeep[hex] = 1;
                    }
                }
                //console.log("hist: " + localTime(new Date(data.now * 1000)));
            }
            for (let i in g.planesOrdered) {
                let hex = g.planesOrdered[i].icao;
                g.historyKeep[hex] = 1;
            }
        }

        // Process history
        let data;
        let h = 0;
        let pruneInt = 100;
        let lastTimestamp = 0;
        let counter = 0;

        while (data = PositionHistoryBuffer.pop()) {
            counter++;

            if (data.now < lastTimestamp) {
                console.log('parseHistory sorting issue');
            }

            if (lastTimestamp && data.now - lastTimestamp > 15) {
                console.log("History " + String(counter).padStart(4) + " from: "
                    + localTime(new Date(data.now * 1000)) + " GAP: " + localTime(new Date(lastTimestamp * 1000)));
            }

            lastTimestamp = data.now;

            if (pTracks && currentTime - data.now > pTracks * 3600) {
                continue;
            }

            if (g.refreshHistory && now > data.now) {
                continue;
            }

            // process new data
            if (PositionHistoryBuffer.length < 10) {
                processReceiverUpdate(data, false);
            } else {
                processReceiverUpdate(data, true);
            }

            ++h;
            if (h == 1 || h % pruneInt == 0 || PositionHistoryBuffer.length == 0) {
                console.log("Apply History " + String(counter).padStart(4) + " from: "
                    + localTime(new Date(data.now * 1000)));
            }
        }

        // only restrict aircraft process to this list while parsing history
        g.historyKeep = null;

        reaper();

        // Final pass to update all planes to their latest state
        //console.log("Final history cleanup pass");
        for (let i in g.planesOrdered) {
            let plane = g.planesOrdered[i];

            // Skywatch ADS-B privacy: distances from the receiver (with the aircraft positions they reveal where it is) only when the site position is shown
            if (plane.position && SitePosition && SiteShow && !pTracks)
                plane.sitedist = mapgeo.getDistance(SitePosition, plane.position);

            if (uatNoTISB && plane.uat && plane.type && plane.type.substring(0,4) == "tisb") {
                plane.last_message_time -= 999;
            }
        }
    }

    console.timeEnd("Loaded aircraft tracks from History");

    if (g.refreshHistory) {
        g.refreshHistory = false;
        noLongerHidden();
        return;
    }

    historyLoaded.resolve();
}

let replay_was_active = false;


let timers = {};
let timersActive = false;
function clearIntervalTimers(arg) {
    if (!timersActive) {
        console.trace();
        return;
    }

    if (loadFinished && arg != 'silent') {
        console.log(localTime(new Date()) + ' clear timers');
        jQuery("#timers_paused_detail").text('Timers paused (tab hidden).');
        jQuery("#timers_paused").css('display','block');
    }
    const entries = Object.entries(timers);
    for (let i in entries) {
        clearInterval(entries[i][1]);
    }

    timersActive = false;

    // in case the visibility changed while this was running
    handleVisibilityChange();
}

function setIntervalTimers() {
    if (timersActive) {
        return;
    }

    if (loadFinished) {
        jQuery("#timers_paused").css('display','none');
    }
    console.log(localTime(new Date()) + " set timers ");
    if (dynGlobeRate && !uuid) {
        timers.globeRateUpdate = setInterval(globeRateUpdate, 180000);
    }
    pollPositionInterval();
    setAutoselect();

    timers.checkMove = setInterval(checkMovement, 50);
    timers.everySecond = setInterval(everySecond, 850);

    //timers.reaper = setInterval(reaper, 40000);

    if (tempTrails) {
        timers.trailReaper = window.setInterval(trailReaper, 10000);
        trailReaper(now);
    }
    if (enable_pf_data && !pTracks && !globeIndex) {
        jQuery('#pf_info_container').removeClass('hidden');
        timers.pf_data = window.setInterval(fetchPfData, RefreshInterval*10.314);
        fetchPfData();
    }
    if (actualOutline.enabled) {
        timers.drawOutline = window.setInterval(drawOutlineJson, actualOutline.refresh);
        setTimeout(drawOutlineJson, 50);
    }

    if (aiscatcher_server) {
        timers.aiscatcher = setInterval(updateAIScatcher, aiscatcher_refresh * 1000);
        updateAIScatcher();
    }
    if (droneJson) {
        timers.droneJson = setInterval(updateDrones, droneRefresh * 1000);
        updateDrones();
    }

    timersActive = true;

    fetchData();

    // in case the visibility changed while this was running
    handleVisibilityChange();
}

function updateDrones() {
    let jsons = Array.isArray(droneJson) ? droneJson : [ droneJson ];
    for (let i in jsons) {
        let req = jQuery.ajax({
            url: jsons[i],
            dataType: 'json',
        });

        req.done(function(data) {
            handleDrones(data);
        });
    }
}

function handleDrones(data) {
    g.droneLast = g.droneNow || 0;
    g.droneNow = new Date().getTime() / 1000;

    for (let i in data) {
        processDrone(data[i], g.droneNow, g.droneLast);
    }
}

function processDrone(drone, now, last) {
    const hex = drone.id;

    // Do we already have this plane object in g.planes?
    // If not make it.
    let plane = g.planes[hex]

    if (!plane) {
        plane = new PlaneObject(hex);
    }

    let ac = drone;

    ac.type = 'other';
    ac.t = 'DRON';
    ac.gs = drone.speed / 1852 * 3600; // m/s to knots
    ac.flight = drone.description;
    ac.alt_baro = drone.alt * 3.28; // m to ft
    ac.baro_rate = drone.vspeed * 3.28 * 60; // m/s to fpm

    ac.seen = now - new Date(drone.time).getTime() / 1000;

    if (drone.lat && drone.lon) {
        ac.lat = drone.lat;
        ac.lon = drone.lon
        ac.seen_pos = ac.seen;
    }
    //console.log(ac);

    plane.updateData(now, last, ac, false);
}

function updateAIScatcher() {
    let req = jQuery.ajax({
        url: aiscatcher_server + '/geojson',
        dataType: 'text',
    });

    req.done(function(data) {
        //console.log(data);
        g.aiscatcher_source.setUrl("data:text/plain;base64,"+btoa(data));
        g.aiscatcher_source.refresh();

        if (1 || aiscatcher_test) {
            processAIS(JSON.parse(data));
        }
    });
}

function processAIS(data) {
    g.ais_last = g.ais_now || 0;
    g.ais_now = new Date().getTime() / 1000;

    const features = data.features;
    aisTimeout = data.time_span || aisTimeout;
    for (let i in features) {
        processBoat(features[i], g.ais_now, g.ais_last);
    }
}

function shortShiptype(typeNumber) {
    if (typeNumber == 0) return "UNKN";
    if (typeNumber <= 19) return "RESE";
    if (typeNumber <= 28) return "WING";
    if (typeNumber <= 29) return "ASAR"; //Airborne SAR
    if (typeNumber <= 30) return "FISH";
    if (typeNumber <= 32) return "TUG";
    if (typeNumber <= 33) return "DRED";
    if (typeNumber <= 34) return "DIVE";
    if (typeNumber <= 35) return "MIL";
    if (typeNumber <= 36) return "SAIL";
    if (typeNumber <= 37) return "YACH";
    if (typeNumber <= 39) return "RESE";
    if (typeNumber <= 49) return "HSPD";
    if (typeNumber <= 50) return "PILO";
    if (typeNumber <= 50) return "PILO";
    if (typeNumber <= 51) return "SAR";
    if (typeNumber <= 52) return "TUG";
    if (typeNumber <= 53) return "TEND";
    if (typeNumber <= 54) return "POLC";
    if (typeNumber <= 55) return "LAW";
    if (typeNumber <= 57) return "LOC";
    if (typeNumber <= 58) return "MED";
    if (typeNumber <= 59) return "SPEC";
    if (typeNumber <= 69) return "PASS";
    if (typeNumber <= 79) return "CARG";
    if (typeNumber <= 89) return "TANK";
    if (typeNumber <= 99) return "OTHE";
    return "";
}

function processBoat(feature, now, last) {
    const pr = feature.properties;
    const hex = 'MMSI' + pr.mmsi;

    // Do we already have this plane object in g.planes?
    // If not make it.
    let plane = g.planes[hex]

    if (!plane) {
        plane = new PlaneObject(hex);
        plane.country = pr.country;
        plane.country_code = pr.country;
        plane.baseScale = 0.2;
    }

    let ac = {};

    ac.type = 'ais';
    ac.gs = pr.speed;
    // Maritime callsign is the ITU ship-station license - a registration-
    // role identifier, not an operational one. A vessel is hailed by NAME.
    ac.flight = pr.shipname || pr.callsign || String(pr.mmsi);
    ac.r = pr.callsign;
    ac.seen = now - pr.last_signal;

    ac.messages  = pr.count;
    ac.rssi      = pr.level;

    ac.track = pr.cog;

    if (pr.destination) { ac.route = pr.destination; }
    if (pr.shiptype !== undefined) { ac.t = shortShiptype(pr.shiptype); }
    // Identify Non-Ship Types
    if (pr.mmsi_type == 6) { ac.t = "ANAV"; } // Aids to Navigation
    if (pr.mmsi_type == 5) {ac.t = "BASE"; } // Land Base Station
    if (pr.mmsi_type == 3) {ac.t = "COAS"; } // Coast Station


    if (feature.geometry && feature.geometry.coordinates) {
        const coords = feature.geometry.coordinates;
        ac.lat = coords[1];
        ac.lon = coords[0];
        ac.seen_pos = now - pr.last_signal;
    }
    //console.log(ac);

    plane.updateData(now, last, ac, false);
}

let djson;
let dstring;
let dresult;

function startPage() {
    if (!heatmap)
        jQuery("#loader").hide();

    changeZoom("init");
    changeCenter("init");

    processURLParams();
    if (usp.has('reg')) {
        let req = regIcaoDownload();
        req.done(function() {
            const queries = usp.get('reg').split(',');
            for (let i in queries) {
                let icao = db.regCache[queries[i].toUpperCase()];
                if (icao) {
                    icao = icao.toLowerCase();
                    urlIcaos.push(icao);
                }
            }
            processURLParams();
        });
    }

    loadFinished = true;

    setIntervalTimers();

    if (tempTrails)
        selectAllPlanes();

    if (replay) {
        showReplayBar();
    }

    initVisibilityChange();

    if (pTracks)
        setTimeout(TAR.planeMan.refresh, 10000);

    window.addEventListener("beforeunload", clearIntervalTimers);

    setTimeout(afterFirstFetch, 50);

    console.timeEnd("Page Load");
}

//
// Utils begin
//
(function (global, jQuery, TAR) {
    let utils = TAR.utils = TAR.utils || {};

    // Make a LineString with 'points'-number points
    // that is a closed circle on the sphere such that the
    // great circle distance from 'center' to each point is
    // 'radius' meters
    // Point 'distance' meters from 'start' ([lon, lat]) along 'bearing' (radians) on the sphere
    utils.geodesic_destination = function (start, bearing, distance) {
        const angularDistance = distance / 6378137.0;
        const lon1 = start[0] * Math.PI / 180.0;
        const lat1 = start[1] * Math.PI / 180.0;

        let lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) +
            Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
        let lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
            Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));

        return [lon2 * 180.0 / Math.PI, lat2 * 180.0 / Math.PI];
    }

    utils.make_geodesic_circle = function (center, radius, points) {
        let geom;
        for (let i = 0; i <= points; ++i) {
            const bearing = i * 2 * Math.PI / points;
            const point = utils.geodesic_destination(center, bearing, radius);

            if (!geom)
                geom = new mapgeo.LineString([point]);
            else
                geom.appendCoordinate(point);
        }
        return geom;
    }

    return TAR;
}(window, jQuery, TAR || {}));
//
// Utils end
//
//

// what a click on the map selected: planeHex (an aircraft), trailHex (a trail) or trailTS (a time on a trace)
function mapClickResult(planeHex, trailHex, trailTS, isDblclick) {
    const dblclick = isDblclick && !showTrace;

    if (showTrace && trailTS) {
        planeHex = null;
        gotoTime(trailTS);
    }
    if (planeHex) {
        selectPlaneByHex(planeHex, {noDeselect: dblclick, follow: dblclick});
    } else if (trailHex) {
        selectPlaneByHex(trailHex, {noDeselect: true});
    }

    if (!planeHex && !trailHex && !multiSelect && !showTrace) {
        if (onlySelected)
            toggleIsolation();
        deselect(SelectedPlane);
        refreshFilter();
    }
}

function ol_map_init() {

    if (0) {
        let canvas = iconTest();
        spritesDataURL = canvas.toDataURL();
        jQuery('#iconTestCanvas').remove();
        console.log(spritesDataURL);
    }

        mlMapInit();

    

    if (showZoomLevel)
        jQuery('#zoomLevel').show();

    let foundType = false;
    mapa.forEachLayer(function(lyr) {
        if (lyr.get('name') && lyr.get('type') == 'base') {
            if (MapType_tar1090 == lyr.get('name')) {
                foundType = true;
            }
        }
    });
    if (!foundType) {
        // unknown or legacy (OpenLayers era) id: never leave the map blank
        MapType_tar1090 = "SkywatchDark";
        try { delete loStore['MapType_tar1090']; } catch (e) {}
    }

    mapa.forEachLayer(function(lyr) {
        if (!lyr.get('name'))
            return;

        if (lyr.get('type') == 'base') {
            if (MapType_tar1090 == lyr.get('name')) {
                foundType = true;
                lyr.setVisible(true);

                mapTypeSettings();
                const onVisible = lyr.get('onVisible');
                onVisible && onVisible(lyr);
            } else {
                lyr.setVisible(false);
            }

            lyr.on('change:visible', function(evt) {
                if (evt.target.getVisible()) {
                    MapType_tar1090 = loStore['MapType_tar1090'] = evt.target.get('name');
                    mapTypeSettings();
                    const onVisible = lyr.get('onVisible');
                    onVisible && onVisible(lyr);
                }
            });
        } else if (lyr.get('type') === 'overlay') {
            if (
                loStore['layer_' + lyr.get('name')] == 'true'
                || enableOverlays.indexOf(lyr.get('name')) >= 0
                || (loStore['layer_' + lyr.get('name')] != 'false' && defaultOverlays.indexOf(lyr.get('name')) >= 0)
            ) {
                lyr.setVisible(true);
            }
            if (loStore['layer_' + lyr.get('name')] == 'false') {
                lyr.setVisible(false);
            }

            lyr.on('change:visible', function(evt) {
                loStore['layer_' + evt.target.get('name')] = evt.target.getVisible();
                if (evt.target.get('name') == 'aiscatcher' && loadFinished)
                    refreshFilter();
            });
        }
    })

    if (!foundType) {
        mapa.forEachLayer(function(lyr) {
            if (foundType)
                return;
            if (lyr.get('type') === 'base') {
                lyr.setVisible(true);
                foundType = true;
            }
        });
    }

    

    mapa.setRotation(g.mapOrientation); // adjust orientation

    // Skywatch ADS-B: base maps and overlays are chosen in the settings dialog (ui/settings.js),
    // which replaces the ol-layerswitcher control.

    

    // show the hover box
    checkPointermove();
}

function initMapEarly() {

    // One-time v2 migration: older saved base map / Dim choices must not hide the new default.
    try {
        if (loStore['uiVersion'] !== 'v4') {
            delete loStore['MapType_tar1090'];
            // receiver position and actual range outline are off by default now
            delete loStore['layer_locationDot']; delete loStore['layer_site_pos']; delete loStore['layer_actualRangeOutline'];
            loStore['MapDim'] = 'false';
            loStore['uiVersion'] = 'v4';
        }
    } catch (e) {}

    // Load stored map settings if present
    if (overrideMapType)
        MapType_tar1090 = overrideMapType;
    else if (loStore['MapType_tar1090']) {
        MapType_tar1090 = loStore['MapType_tar1090'];
    }

    mapTypeSettings();

    // Initialize OpenLayers

        mlCreateLayers();

    //add_kml_overlay('https://developers.google.com/kml/documentation/KML_Samples.kml', 'samples', 0.8);

        siteCircleLayer = mlBuiltinLayer({name: 'siteCircles', type: 'overlay', title: 'Range rings', visible: SiteCircles});

    siteCircleLayer.on('change:visible', function(evt) {
        if (evt.target.getVisible()) {
            runAfterLoad(geoFindMe);
        }
    });
}

function showHideButtons() {
    // Skywatch ADS-B: Shift+H hides every floating control (ui/shell.css .buttonsHidden)
    document.body.classList.toggle('buttonsHidden', !!hideButtons);
}

// Initalizes the map and starts up our timers to call various functions
function initMap() {

    CenterLon = Number(lopaStore['CenterLon']) || DefaultCenterLon;
    CenterLat = Number(lopaStore['CenterLat']) || DefaultCenterLat;
    //console.log("initMap Centerlat: " + CenterLat);
    g.zoomLvl = Number(lopaStore['zoomLvl']) || DefaultZoomLvl;
    g.zoomLvlCache = g.zoomLvl;

    // (History tile: shown in the redesigned list, mockup 02)

    if ((globeIndex && aggregator) || filterUuid) {
        jQuery('#dump1090_message_rate_td').hide();
    }
    if ((globeIndex && aggregator) || (receiverJson && receiverJson.haveReplay)) {
        jQuery('#RP').show();
    }

        locationDotLayer = mlBuiltinLayer({name: 'locationDot', type: 'overlay',
        title: (receiverJson && receiverJson.lat != null) ? 'Site position' : 'Your position', visible: SiteShow});

    locationDotLayer.on('change:visible', function(evt) {
        if (evt.target.getVisible()) {
            runAfterLoad(geoFindMe);
        }
    });


    actualOutline.enabled = multiOutline || (receiverJson && receiverJson.outlineJson);

    if (actualOutline.enabled) {
        actualOutline.refresh = 15000;
        actualOutline.url = multiOutline ? 'data/multiOutline.json' : 'data/outline.json';

                actualOutline.features = new MLSource('outline');
        actualOutline.layer = mlBuiltinLayer({name: 'actualRangeOutline', type: 'overlay', title: 'actual range outline', visible: actual_range_show});
    
    }
    if (calcOutlineData) {
                calcOutlineLayer = mlBuiltinLayer({name: 'calcOutline', type: 'overlay', title: 'terrain-based range outline', visible: true});
    
        drawUpintheair();
    }


        trailLayers = mlBuiltinLayer({name: 'ac_trail', title: 'Aircraft trails', type: 'overlay', visible: true});
    iconLayer = mlBuiltinLayer({name: 'iconLayer', type: 'overlay', title: 'Aircraft positions', visible: true});

    ol_map_init();

    // handle the layer settings pane checkboxes
    //OLMap.once('postrender', function(e) {
        //toggleLayer('#nexrad_checkbox', 'nexrad');
        //toggleLayer('#sitepos_checkbox', 'site_pos');
        //toggleLayer('#actrail_checkbox', 'ac_trail');
        //toggleLayer('#acpositions_checkbox', 'webglLayer');
    //});

    jQuery('#infoblock_close').on('click', function () {
        if (showTrace)
            toggleShowTrace();
        if (onlySelected)
            toggleIsolation();

        deselect(SelectedPlane);
        refreshFilter();
    });



    new Toggle({
        key: "darkerColors",
        display: "Darker Colors",
        container: "#settingsLeft",
        init: darkerColors,
        setState: function(state) {
            darkerColors = state;
            if (loadFinished) {
                refreshFeatures();
                remakeTrails();
                TAR.altitudeChart.render();
            }
        }
    });

    // Dark mode was removed (the UI is dark-only); drop the stale preference.
    delete loStore['darkMode'];

    initLegend();

    initFilters();

    mapa.forEachLayer(function(lyr) {
        if (lyr.get('type') != 'base')
            return;
        lyr.dimKey = lyr.on('postrender', dim);
    });

    new Toggle({
        key: "MapDim",
        display: "Dim Map",
        container: "#settingsLeft",
        init: MapDim,
        setState: function(state) {
            /*
            if (!state) {
                mapa.forEachLayer(function(lyr) {
                    if (lyr.get('type') != 'base')
                        return;
                    ol.Observable.unByKey(lyr.dimKey);
                });
            } else {
                mapa.forEachLayer(function(lyr) {
                    if (lyr.get('type') != 'base')
                        return;
                    lyr.dimKey = lyr.on('postrender', dim);
                });
            }
            */
            if (loadFinished) {
                mapa.render();
            }
            buttonActive('#B', state);
        }
    });

    window.addEventListener('keydown', function(e) {
        active();
        if (e.defaultPrevented ) {
            return; // Do nothing if the event was already processed
        }
        // Skywatch ADS-B: map hotkeys pause while the settings dialog is open (ui/settings.js)
        if (document.body.classList.contains('settingsOpen')) {
            return;
        }
        if (e.target.type == "text") {
            return;
        }
        if (e.srcElement.nodeName == 'INPUT') {
            return;
        }

        if( e.ctrlKey || e.altKey || e.metaKey) {
            return;
        }
        let oldCenter, extent, newCenter;
        switch (e.key) {
            case "c":
            case "Esc":
            case "Escape":
                deselectAllPlanes();
                break;
                // zoom and movement
            case "q":
            case "-":
            case "Subtract":
                zoomOut();
                break;
            case "e":
            case "+":
            case "Add":
                zoomIn();
                break;
            case "ArrowUp":
            case "w":
                mapa.panEdge('up');
                toggleFollow(false);
                break;
            case "ArrowDown":
            case "s":
                mapa.panEdge('down');
                toggleFollow(false);
                break;
            case "ArrowLeft":
            case "a":
                mapa.panEdge('left');
                toggleFollow(false);
                break;
            case "ArrowRight":
            case "d":
                mapa.panEdge('right');
                toggleFollow(false);
                break;
                // misc
            case "b":
                toggles['MapDim'].toggle();
                break;
            case "m":
                toggleMultiSelect();
                break;
            case "v":
                toggleTableInView();
                break;
            case "r":
                followRandomPlane();
                break;
            case "R":
                fetchData();
                break;
            case "t":
                selectAllPlanes();
                break;
            case "G":
                nogpsOnly = !nogpsOnly;
                refreshFilter();
                break;
            case "h":
                resetMap();
                break;
            case "H":
                hideButtons = !hideButtons;
                showHideButtons();
                break;
            case "f":
                toggleFollow();
                break;
                // filters
            case "T":
                filterTISB = !filterTISB;
                refreshFilter();
                break;
            case "Y":
                showReplayBar();
                break;
            case "u":
                toggleMilitary();
                break;
            case "i":
                toggleIsolation();
                break;
                // persistence mode
            case "p":
                togglePersistence();
                break;
                // Labels
            case "l":
                toggleLabels();
                break;
            case "o":
                toggleExtendedLabels();
                break;
            case "k":
                toggleTrackLabels();
                break;
                // debug stuff
            case "L":
                toggles['lastLeg'].toggle();
                break;
            case "D":
                debug = !debug;
                loStore['debug'] = debug;
                console.log('debug = ' + debug);
                break;
            case "P":
                debugPosFilter = !debugPosFilter;
                loStore['debugPosFilter'] = debugPosFilter;
                console.log('debugPosFilter = ' + debugPosFilter);
                break;
            case "?":
                if (!SelectedPlane) {
                    console.log("No plane selected");
                    break;
                }
                console.log(SelectedPlane.icao + ": " + SelectedPlane.baseMarkerKey + "  " + SelectedPlane.shape);
                console.log(SelectedPlane);
                console.log(SelectedPlane.milRange());
                break;
            case "j":
                selectPlaneByHex(jumpTo, {follow: true});
                break;
            case "J":
                debugJump = !debugJump;
                loStore['debugJump'] = debugJump;
                console.log('debugJump = ' + debugJump);
                break;
            case "N":
                noMLAT = !noMLAT;
                loStore['noMLAT'] = noMLAT;
                console.log('noMLAT = ' + noMLAT);
                break;
        }
    }, true);


    if (!usp.has('icao')
        && !usp.has("lat") && !usp.has("lon")
        && !usp.has('airport')
    ) {
        runAfterLoad(geoFindMe);
    } else {
        runAfterLoad(initSitePos);
    }

}

// This looks for planes to reap out of the master g.planes variable
let lastReap = 0;
let reapInProgress = false;
function reaper(all) {
    //console.log("Reaping started..");

    if (reapInProgress) {
        return;
    }

    lastReap = now;

    if (noVanish && !all) {
        return;
    }

    reapInProgress = true;

    if (!all) {
        releaseMem();
    }

    // Look for planes where we have seen no messages for >300 seconds
    let plane;
    let length = g.planesOrdered.length;
    let temp = []
    for (let i in g.planesOrdered) {
        plane = g.planesOrdered[i];
        if (plane == null)
            continue;
        plane.seen = now - plane.last_message_time;
        if ( all ||
            (
                (!plane.selected)
                && plane.seen > reapTimeout
                && (plane.dataSource != 'adsc' || plane.seen > jaeroTimeout)
                && (plane.dataSource != 'ais' || plane.seen > aisTimeout)
            )
        ) {
            // Reap it.
            //console.log("Removed " + plane.icao);
            delete g.planes[plane.icao];
            plane.destroy();
            continue;
        }

        // Keep it.
        temp.push(plane);

        if (globeIndex) {
            if (plane.clearTraceAfter) {
                //console.log(now - plane.clearTraceAfter);
                if (now > plane.clearTraceAfter) {
                    plane.clearTrace();
                    //console.log("clearTrace: " + plane.icao);
                }
            } else if (!plane.linesDrawn) {
                plane.clearTraceAfter = now + 300;
            }
        }
    }
    g.planesOrdered = temp;

    reapInProgress = false;
    const removed = length - g.planesOrdered.length;
    if (removed > 0) {
        //console.log(`reaper removed ${removed} planes.`);
    }

    return removed;
}

// Page Title update function
function refreshPageTitle() {
    if (pTracks)
        return;
    if (!PlaneCountInTitle && !MessageRateInTitle) {
        return;
    }

    let subtitle = "";

    if (PlaneCountInTitle) {
        if (globeIndex) {
            subtitle += 'tracking ' + globeTrackedAircraft + ' aircraft';
        } else {
            subtitle += TrackedAircraftPositions + '/' + TrackedAircraft;
        }
    }

    if (MessageRateInTitle && MessageRate != null) {
        if (subtitle) subtitle += ' | ';
        subtitle += MessageRate.toFixed(1) + '/s';
    }

    if (PROJECT_NAME) {
        document.title = PROJECT_NAME + ' - ' + subtitle;
    } else {
        document.title = subtitle;
    }
}

function displaySil() {
    jQuery('#copyrightInfo').html("");
    if (!showSil) {
        setPhotoHtml("");
        return;
    }
    let selected = SelectedPlane;
    let new_html="";
    let type = selected.icaoType ? selected.icaoType : 'ZZZZ';
    let hex = selected.icao.toUpperCase();
    const sil = document.createElement('img');
    sil.id = 'silhouette';
    sil.width = Math.round(151 * globalScale);
    sil.src = 'aircraft_sil/' + type.replace(/[^A-Za-z0-9]/g, '') + '.png';
    setPhotoNode(sil, 'sil:' + type);
    selected.icao.toUpperCase();
}

function displayPhoto() {
    if (!SelectedPlane)
        return;
    if (!SelectedPlane.psAPIresponse) {
        displaySil();
        return;
    }
    let photos = SelectedPlane.psAPIresponse["photos"] || SelectedPlane.psAPIresponse["images"];
    if (!photos || photos.length == 0) {
        displaySil();
        adjustInfoBlock();
        return;
    }
    let new_html="";
    // Skywatch ADS-B: the larger thumbnail stays sharp in the wider photo slot
    const thumb = photos[0]["thumbnail_large"] || photos[0]["thumbnail"];
    let photoToPull = thumb["src"] || thumb;
    let linkToPicture = photos[0]["link"];
    //console.log(linkToPicture);
    // network-derived URLs: built as DOM, https/http only (a javascript: URL from the API can never become a link)
    const imgUrl = safeUrl(photoToPull), linkUrl = safeUrl(linkToPicture);
    if (!imgUrl) { displaySil(); adjustInfoBlock(); return; }
    const img = document.createElement('img');
    img.id = 'airplanePhoto';
    img.src = imgUrl;
    img.referrerPolicy = 'no-referrer';
    let node = img;
    if (linkUrl) {
        node = document.createElement('a');
        node.className = 'link'; node.href = linkUrl; node.target = '_blank'; node.rel = 'noopener noreferrer';
        node.appendChild(img);
    }
    let copyright = photos[0]["photographer"] || photos[0]["user"];
    jQuery('#copyrightInfo').text("© " + copyright + (planespottersAPI ? " · planespotters.net" : ""));
    setPhotoNode(node, 'photo:' + imgUrl);
    adjustInfoBlock();
}

function refreshPhoto(selected) {
    if (!showPictures || selected.icao[0] == '~' || (!planespottingAPI && !planespottersAPI)) {
        displaySil();
        return;
    }
    let urlTail;
    let param;
    if (!selected.dbinfoLoaded) {
        displaySil();
        return;
    } else if (false && selected.registration != null && selected.registration.match(/^[0-9]{0,2}\+?[0-9]{0,2}$/)) {
        urlTail = '/hex/' + selected.icao.toUpperCase();
    } else if (selected.registration != null) {
        urlTail = '/hex/' + selected.icao.toUpperCase() + '?reg=' + selected.registration;
        const type = selected.icaoType;
        // && type != 'E170' && !type.startsWith('E75')
        if (type) {
            urlTail += '&icaoType=' + type;
        }
        param = 'DB';
    } else {
        urlTail = 'hex/' + selected.icao.toUpperCase();
        param = 'hex';
    }


    const ts = new Date().getTime();
    if (param == selected.psAPIparam) {
        if (selected.psAPIresponse) {
            displayPhoto();
            return;
        }
        if (selected.psAPIresponseTS && selected.psAPIresponseTS - ts < 10000) {
            return;
        }
    }
    selected.psAPIparam = param;

    setPhotoHtml("<p>Loading image...</p>");
    jQuery('#copyrightInfo').html("<span></span>");
    //console.log(ts/1000 + 'sending psAPI request');
    selected.psAPIresponseTS = ts;

    if (planespottersAPI) {
        let req = jQuery.ajax({
            url: planespottersAPIurl.replace(/\/+$/, '') + '/' + urlTail.replace(/^\/+/, ''),
            dataType: 'json',
            plane: selected,
        });

        req.done(function(data) {
            this.plane.psAPIresponse = data;
            if (SelectedPlane == this.plane) {
                displayPhoto();
            }
        });
        // Skywatch ADS-B: without this the panel kept showing "Loading image..." forever
        req.fail(function() {
            this.plane.psAPIresponse = {'photos': []};
            if (SelectedPlane == this.plane) {
                displayPhoto();
            }
        });
    } else if (planespottingAPI) {
        let req = jQuery.ajax({
            url: 'https://www.planespotting.be/api/objects/imagesRegistration.php?registration=' + selected.registration,
            dataType: 'json',
            plane: selected,
        });

        req.done(function(data) {
            this.plane.psAPIresponse = data;
            if (SelectedPlane == this.plane) {
                displayPhoto();
            }
        });
        req.fail(function() {
            this.plane.psAPIresponse = {'photos': []};
            if (SelectedPlane == this.plane) {
                displayPhoto();
            }
        });
    }
}

let selCall = null;
let selReg = null;
let selAirline = null;

let somethingSelected = false;
// Refresh the detail window about the plane
function refreshSelected() {
    const selected = SelectedPlane;

    if (!selected || !selected.nav_qnh) {
        jQuery('#altimeter_set_selected').prop("disabled", true);
    } else {
        jQuery('#altimeter_set_selected').prop("disabled", false);
    }

    if (!selected) {
        if (somethingSelected) {
            adjustInfoBlock();
            buttonActive('#F', FollowSelected);
        }
        somethingSelected = false;
        return;
    }
    somethingSelected = true;
    buttonActive('#F', FollowSelected);

    selected.updateVisible();
    selected.checkForDB();

    refreshPhoto(selected);

    jQuery('#selected_callsign').updateText(selected.name);

    if (showTrace) {
        if (selected.position_time) {
            const date = new Date(selected.position_time * 1000);
            let timestamp = utcTimesHistoric ? (zuluTime(date) + NBSP + 'Z') : (lDateString(date) + ' ' + localTime(date) + NBSP + TIMEZONE);
            jQuery('#trace_time').updateText(timestamp);
        } else {
            jQuery('#trace_time').updateText('');
        }
    }

    if (selected.isNonIcao() && selected.source != 'mlat') {
        jQuery('#anon_mlat_info').addClass('hidden');
        jQuery('#reg_info').addClass('hidden');
        jQuery('#tisb_info').removeClass('hidden');
    } else if (selected.isNonIcao() && selected.source == 'mlat') {
        jQuery('#reg_info').addClass('hidden');
        jQuery('#tisb_info').addClass('hidden');
        jQuery('#anon_mlat_info').removeClass('hidden');
    } else {
        jQuery('#tisb_info').addClass('hidden');
        jQuery('#anon_mlat_info').addClass('hidden');
        jQuery('#reg_info').removeClass('hidden');
    }

    let checkReg = selected.registration + ' ' + selected.dbinfoLoaded;
    if (checkReg != selReg) {
        selReg = checkReg;
        if (selected.registration) {
            if (flightawareLinks) {
                jQuery('#selected_registration').html(getFlightAwareIdentLink(selected.registration, selected.registration));
            } else if (registrationLinks && registrationLink(selected)) {
                jQuery('#selected_registration').html(`<a class="link" target="_blank" rel="noreferrer" href="${escHtml(safeUrl(registrationLink(selected)))}">${escHtml(selected.registration)}</a>`);
            } else {
                jQuery('#selected_registration').updateText(selected.registration);
            }
        } else {
            jQuery('#selected_registration').updateText("");
        }
    }

    // Skywatch ADS-B: all other fields are rendered by ui/infoblock.js
    ibRender(selected);

    adjustInfoBlock();
}

let somethingHighlighted = false;
function refreshHighlighted() {
    // this is following nearly identical logic, etc, as the refreshSelected function, but doing less junk for the highlighted pane
    let highlighted = HighlightedPlane;

    if (!highlighted) {
        if (somethingHighlighted)
            jQuery('#highlighted_infoblock').hide();
        somethingHighlighted = false;
        return;
    }
    somethingHighlighted = true;

    highlighted.checkVisible();

    jQuery('#highlighted_infoblock').show();

    let infoBox = jQuery('#highlighted_infoblock');

    let markerCoordinates;
        markerCoordinates = highlighted.markerDrawn ? highlighted.proj : null;
    if (!markerCoordinates) {
        jQuery('#highlighted_infoblock').hide();
        return;
    }
    let markerPosition = mapa.pixelFromProj(markerCoordinates);
    if (!markerPosition)
        return;

    let mapSize = mapa.getSize();
    let infoBoxLeft = markerPosition[0];
    let infoBoxTop = markerPosition[1];
    if ((infoBoxLeft + 20 + infoBox.width()) < mapSize[0])
        infoBoxLeft += 20;
    else if ((infoBoxLeft - 20 - infoBox.width()) > 0)
        infoBoxLeft -= (20 + infoBox.width());
    else
        infoBoxLeft = 0;
    if ((infoBoxTop + 20 + infoBox.height()) < mapSize[1])
        infoBoxTop += 20;
    else if (infoBoxTop - (20 + infoBox.height()) > 0)
        infoBoxTop -= (20 + infoBox.height());
    else
        infoBoxTop = 0;
    infoBox.css("left", infoBoxLeft);
    infoBox.css("top", infoBoxTop);

    jQuery('#highlighted_callsign').text(highlighted.name);
    jQuery('#highlighted_logo').html(airlineLogoHTML(airlineFlight(highlighted), 22, 'head'));

    if (highlighted.icaoType !== null) {
        jQuery('#highlighted_icaotype').text(highlighted.icaoType);
    } else {
        jQuery('#highlighted_icaotype').text("n/a");
    }

    if (useRouteAPI) {
        if (highlighted.routeString) {
            jQuery('#highlighted_route').updateText(highlighted.routeString);
        } else {
            jQuery('#highlighted_route').updateText('n/a');
        }
    }

    jQuery('#highlighted_source').text(format_data_source(highlighted.getDataSource()));

    if (highlighted.registration !== null) {
        jQuery('#highlighted_registration').text(highlighted.registration);
    } else {
        jQuery('#highlighted_registration').text("n/a");
    }

    let highlightedOperator = highlighted.getAirline();
    if (highlightedOperator) {
        jQuery('#highlighted_airline').text(highlightedOperator.n || 'n/a');
    } else {
        jQuery('#highlighted_airline').text('n/a');
    }

    jQuery('#highlighted_speed').text(format_speed_long(highlighted.gs, DisplayUnits));

    jQuery("#highlighted_altitude").text(format_altitude_long(adjust_baro_alt(highlighted.altitude), highlighted.vert_rate, DisplayUnits));

    jQuery('#highlighted_pf_route').text((highlighted.pfRoute ? highlighted.pfRoute : highlighted.icao.toUpperCase()));

    jQuery('#highlighted_rssi').text(highlighted.rssi != null ? highlighted.rssi.toFixed(1) + ' dBFS' : "n/a");
}

function removeHighlight() {
    HighlightedPlane = null;
    refreshHighlighted();
}

function mstime() {
    return new Date().getTime();
}

// recreating all OpenLayers Features for the planes every now and then releases some retained memory
// Haven't been able to create a reproducer ... regardless let's stick with this workaround
// in other words: probably not an issue with OpenLayers.

let nextCacheClear = mstime() + 300 * 1000;

function releaseMem() {
    if (!loadFinished || mstime() < nextCacheClear) {
        return;
    }

    nextCacheClear = mstime() + 300 * 1000;
    iconCache = {};

    //console.trace();
    //console.log('releaseMem()');
    for (let i in g.planesOrdered) {
        let plane = g.planesOrdered[i];
        plane.clearMarker();
        plane.destroyTR();
    }
    refreshFeatures();
    TAR.planeMan.redraw();
    refresh();
}

function refreshFeatures() {
    if (!loadFinished) {
        return;
    }
    updateVisible();
    for (let i in g.planesOrdered) {
        g.planesOrdered[i].updateFeatures(true);
    }
}

//
// g.planes table begin
//
(function (global, jQuery, TAR) {
    let planeMan = TAR.planeMan = TAR.planeMan || {};

    function compareAlpha(xa,ya) {
        if (xa === ya)
            return 0;
        if (xa < ya)
            return -1;
        return 1;
    }

    function compareBeta(xa, ya) {
        if (xa === ya)
            return 0;
        if (planeMan.sortAscending && xa < ya)
            return -1;
        if (!planeMan.sortAscending && (xa.replace(/ /g, "").split("").reverse().join("") > ya.replace(/ /g, "").split("").reverse().join("")))
            return -1;
        return 1;
    }

    function compareNumeric(xf,yf) {
        if (Math.abs(xf - yf) < 1e-9)
            return 0;

        return xf - yf;
    }

    function compareAlphaCI(xa, ya) {
        // only used by the airline column for now
        // assumes ASCII strings from the database
        if (xa === ya)
            return 0;
        xa = xa ? xa.toLowerCase() : '';
        ya = ya ? ya.toLowerCase() : '';
        if (xa < ya)
            return -1;
        if (xa > ya)
            return 1;
        return 0;
    }

    const cols = planeMan.cols = {};

    cols.icao = {
        text: 'Hex ID',
        sort: function () { sortBy('icao', compareAlpha, function(x) { return x.icao; }); },
        value: function(plane) { return plane.icao; },
        td: '<td class="icaoCodeColumn">',
    };
    cols.country = {
        text: 'Flag',
        header: function() { return ""; },
        sort: function () { sortBy('country', compareAlpha, function(x) { return x.country; }); },
        value: function(plane) { return (plane.country_code ? ('<img width="18" height="12" style="display: block;margin: auto;" src="flags/3x2/' + plane.country_code.toUpperCase() + '.svg" title="' + plane.country + '"></img>') : ''); },
        hStyle: 'style="width: 18px; padding: 3px;"',
        html: true,
    };
    cols.flight = {
        sort: function () { sortBy('flight', compareAlpha, function(x) { return x.flight }); },
        value: function(plane) {
            let html = flightawareLinks ? getFlightAwareModeSLink(plane.icao, plane.flight, plane.name)
                : (plane.flight || '').replace(/[<>&"]/g, '');
            // Skywatch ADS-B: airline logo (monogram until it loads) in front of the callsign
            html = airlineLogoHTML(airlineFlight(plane), 18, 'sm') + html;
            // Skywatch ADS-B: emergency squawk badge next to the callsign
            if (emergencySquawks.has(String(plane.squawk)))
                html += ' <span class="sqBadge" title="Emergency squawk">' + plane.squawk + '</span>';
            return html;
        },
        html: true,
        text: 'Callsign' };
    cols.airline = {
        text: 'Airline',
        sort: function () { sortBy('airline', compareAlphaCI, function(x) {
            let operatorData = x.getAirline();
            return operatorData ? (operatorData.n || '') : null;
        }); },
        value: function(plane) {
            let operatorData = plane.getAirline();
            if (!operatorData) {
                return '';
            }
            let title = operatorData.c ? operatorData.c + (operatorData.r ? ' / "' + operatorData.r + '"' : '') : (operatorData.r || '');
            return '<span title="' + escHtml(title) + '">' + escHtml(operatorData.n || '') + '</span>';
        },
        html: true
    };
    if (routeApiUrl) {
        cols.route = {
            sort: function () { sortBy('route', compareAlpha, function(x) { return x.routeColumn }); },
            value: function(plane) {
                if (!useRouteAPI) return '';
                if (plane.routeString) {
                    return '<span title="' + escHtml(plane.routeVerbose) + '">' + escHtml(plane.routeColumn) + '</span>';
                } else {
                    return '';
                }
            },
            html: true,
            text: 'Route' };
    }
    cols.registration = {
        sort: function () { sortBy('registration', compareAlpha, function(x) { return x.registration; }); },
        value: function(plane) { return (flightawareLinks ? getFlightAwareIdentLink(plane.registration, plane.registration) : (plane.registration ? plane.registration : "")); },
        html: flightawareLinks,
        text: 'Registration' };
    cols.type = {
        sort: function () { sortBy('type', compareAlpha, function(x) { return x.icaoType; }); },
        value: function(plane) { return (plane.icaoType != null ? plane.icaoType : ""); },
        text: 'Type' };
    cols.squawk = {
        text: 'Squawk',
        sort: function () { sortBy('squawk', compareAlpha, function(x) { return x.squawk; }); },
        value: function(plane) { return (plane.squawk != null ? plane.squawk : ""); },
        align: 'right' };
    cols.altitude = {
        text: 'Altitude',
        sort: function () { sortBy('altitude',compareNumeric, function(x) { return (x.altitude == "ground" ? -100000 : x.altitude); }); },
        value: function(plane) { return format_altitude_brief(adjust_baro_alt(plane.altitude), plane.vert_rate, DisplayUnits).replace(/\d{4,}/, (n) => Number(n).toLocaleString('en-US')); },
        align: 'right',
        header: function () { return 'Alt' + NBSP + '<span class="colUnit">' + get_unit_label("altitude", DisplayUnits) + '</span>';},
    };
    cols.speed = {
        text: pTracks ? 'Max. Speed' : 'Speed',
        sort: function () { sortBy('speed', compareNumeric, function(x) { return x.speed; }); },
        value: function(plane) { return format_speed_brief(plane.speed, DisplayUnits); },
        align: 'right',
        header: function () { return (pTracks ? 'Max. ' : '') + 'GS' + NBSP + '<span class="colUnit">' + get_unit_label("speed", DisplayUnits) + '</span>';},
    };
    cols.vert_rate = {
        text: 'Vertical Rate',
        sort: function () { sortBy('vert_rate', compareNumeric, function(x) { return x.vert_rate; }); },
        value: function(plane) { return format_vert_rate_brief(plane.vert_rate, DisplayUnits); },
        align: 'right',
        header: function () { return 'V. Rate(' + get_unit_label("verticalRate", DisplayUnits) + ')';},
    };
    cols.sitedist = {
        text: pTracks ? 'Max. Distance' : 'Distance',
        sort: function () { sortBy('sitedist',compareNumeric, function(x) { return x.sitedist; }); },
        value: function(plane) { return format_distance_brief(plane.sitedist, DisplayUnits); },
        align: 'right',
        header: function () { return (pTracks ? 'Max. ' : '') + 'Dist' + NBSP + '<span class="colUnit">' + get_unit_label("distance", DisplayUnits) + '</span>';},
    };
    cols.track = {
        text: 'Track',
        sort: function () { sortBy('track', compareNumeric, function(x) { return x.track; }); },
        value: function(plane) { return format_track_brief(plane.track); },
        align: 'right' };
    cols.msgs = {
        text: 'Messages',
        sort: function () { sortBy('msgs', compareNumeric, function(x) { return x.messages; }); },
        value: function(plane) { return plane.messages; },
        align: 'right' };
    cols.seen = {
        text: 'Seen',
        sort: function () { sortBy('seen', compareNumeric, function(x) { return x.seen; }); },
        value: function(plane) { return plane.seen.toFixed(0); },
        align: 'right' };
    cols.rssi = {
        text: 'RSSI',
        sort: function () { sortBy('rssi', compareNumeric, function(x) { return x.rssi; }); },
        value: function(plane) { return (plane.rssi != null ? plane.rssi.toFixed(1) : ""); },
        align: 'right' };
    cols.lat = {
        text: 'Latitude',
        sort: function () { sortBy('lat', compareNumeric, function(x) { return (x.position !== null ? x.position[1] : null); }); },
        value: function(plane) { return (plane.position != null ? plane.position[1].toFixed(4) : ""); },
        align: 'right' };
    cols.lon = {
        text: 'Longitude',
        sort: function () { sortBy('lon', compareNumeric, function(x) { return (x.position !== null ? x.position[0] : null); }); },
        value: function(plane) { return (plane.position != null ? plane.position[0].toFixed(4) : ""); },
        align: 'right' };
    cols.data_source = {
        text: 'Source',
        sort: function () { sortBy('data_source', compareNumeric, function(x) { return x.getDataSourceNumber(); } ); },
        value: function(plane) { return format_data_source(plane.getDataSource()); },
        align: 'right' };
    cols.military = {
        text: 'Mil.',
        sort: function () { sortBy('military', compareAlpha, function(x) { return (x.military ? 'yes' : 'no'); } ); },
        value: function(plane) { return (plane.military ? 'yes' : 'no'); },
        align: 'right' };
    cols.wd = {
        text: 'Wind D.',
        sort: function () { sortBy('wd', compareNumeric, function(x) { return x.wd; }); },
        value: function(plane) { return plane.wd != null ? (plane.wd + '°') : ''; },
        align: 'right' };
    cols.ws = {
        text: 'Wind S.',
        sort: function () { sortBy('ws', compareNumeric, function(x) { return x.ws; }); },
        value: function(plane) { return format_speed_brief(plane.ws, DisplayUnits); },
        align: 'right',
        header: function () { return 'Wind' + NBSP + '(' + get_unit_label("speed", DisplayUnits) + ')'; },
    };

    const colsEntries = Object.entries(cols);
    for (let i in colsEntries) {
        let key = colsEntries[i][0];
        let value = colsEntries[i][1];
        value.id = key;
        value.text = value.text ? value.text : "";
        value.header = value.header ? value.header : function() { return value.text; };
        value.hStyle = value.hStyle ? value.hStyle : "";
        if (!value.td)
            value.td = value.align ? ('<td style="text-align: ' + value.align + '">') : '<td>';
    }

    let columns = createOrderedColumns();
    let activeCols = null;

    let initializing = true;

    let planeRowTemplate = null;
    let htmlTable = null;
    let tbody = null;

    planeMan.init = function () {
        // initialize columns
        htmlTable = document.getElementById('planesTable');
        for (let i in columns) {
            let col = columns[i];
            col.visible = true;
            col.toggleKey = 'column_' + col.id;

            if (HideCols.includes('#' + col.id)) {
                planeMan.setColumnVis(col.id, false);
            }
        }

        createColumnToggles();

        if (!ShowFlags) {
            planeMan.setColumnVis('flag', false);
        }
    }

    planeMan.redraw = function () {
        activeCols = [];
        for (let i in columns) {
            let col = columns[i];
            if (!planeMan.columnUsable(col))
                continue; // Skywatch ADS-B: no empty Route column when routes are off
            if (col.visible || !mapIsVisible) {
                activeCols.push(col);
            }
        }
        for (let i = 0; i < g.planesOrdered.length; ++i) {
            g.planesOrdered[i].destroyTR();
        }
        let table = '';
        table += '<thead class="aircraft_table_header">';
        table += '  <tr>';
        for (let i in activeCols) {
            let col = activeCols[i];
            table += '<td id="' + col.id + '" onclick="TAR.planeMan.cols.' + col.id + '.sort();"' + col.hStyle + '>'+ col.header() +'</td>';
        }
        table += '  </tr>';
        table += '</thead>';
        table += '<tbody>';
        table += '</tbody>';
        htmlTable.innerHTML = table;
        tbody = htmlTable.tBodies[0];

        planeRowTemplate = document.createElement('tr');
        let template = ''
        for (let i in activeCols) {
            let col = activeCols[i];
            template += col.td;
            template += '</td>';
        }
        planeRowTemplate.innerHTML = template;

        if (!initializing) {
            planeMan.refresh();
        }
    }

    planeMan.columnUsable = function (col) {
        return col.id != 'route' || useRouteAPI;
    }

    planeMan.setColumnVis = function (col, visible) {
        cols[col].visible = visible;

        if (!initializing)
            planeMan.redraw();
    }

    // Refreshes the larger table of all the planes
    planeMan.refresh = function () {
        if (!loadFinished)  {
            return;
        }
        //console.trace();

        if (initializing) {
            planeMan.redraw();
            initializing = false;
        }

        const atime = false;
        atime && console.time("planeMan.refresh()");

        const ctime = false; // gets enabled for debugging table refresh speed
        // globeTableLimit = 1000; for testing performance

        ctime && console.time("planeMan.refresh()");


        TrackedAircraft = 0;
        TrackedAircraftPositions = 0;
        TrackedHistorySize = 0;

        ctime && console.time("inView");
        let pList = []; // list of planes that might go in the table and need sorting
        for (let i = 0; i < g.planesOrdered.length; ++i) {
            const plane = g.planesOrdered[i];

            TrackedHistorySize += plane.history_size;

            if (tableInView) {
                if (plane.visible)
                    TrackedAircraft++;
                if ((plane.inView && plane.visible) || plane.selected) {
                    pList.push(plane);
                    TrackedAircraftPositions++;
                }
            } else {
                if (plane.visible) {
                    TrackedAircraft++;
                    pList.push(plane);
                    if (plane.position != null)
                        TrackedAircraftPositions++;
                }
            }
        }

        ctime && console.timeEnd("inView");

        ctime && console.time("resortTable");
        resortTable(pList);
        ctime && console.timeEnd("resortTable");

        const sidebarVisible = toggles['sidebar_visible'].state;

        let inTable = []; // list of planes that will actually be displayed in the table

        ctime && console.time("modTRs");
        for (let i in pList) {
            const plane = pList[i];

            if (!sidebarVisible || (inTable.length > globeTableLimit && mapIsVisible && globeIndex)) {
                break;
            }
            inTable.push(plane);

            if (plane.tr == null) {
                plane.makeTR(planeRowTemplate.cloneNode(true));
                plane.tr.id = plane.icao;
                plane.refreshTR = 0;
            }

            if (now - plane.refreshTR > 5 || plane.selected != plane.selectCache) {
                plane.refreshTR = now;
                plane.selectCache = plane.selected;

                // row state as classes, styled in theme.css
                let rowClass = 'plane_table_row src-' + sourceGroup(plane.dataSource);
                if (plane.selected)
                    rowClass += ' selected';
                if (emergencySquawks.has(String(plane.squawk)))
                    rowClass += ' emergency';
                if (typeof listFilterMatch == 'function' && !listFilterMatch(plane))
                    rowClass += ' filteredOut';
                if (plane.trClassCache != rowClass) {
                    plane.trClassCache = rowClass;
                    plane.tr.className = rowClass;
                }
                // Skywatch ADS-B: 3px altitude colour bar at the row start (ui/list.css)
                const altColor = (plane.altitude == null) ? 'transparent' : hslToRgb(altitudeColor(plane.alt_rounded));
                if (plane.trAltCache != altColor) {
                    plane.trAltCache = altColor;
                    plane.tr.style.setProperty('--alt', altColor);
                }

                for (let cell in activeCols) {
                    let col = activeCols[cell];
                    if (!col.value)
                        continue;
                    let newValue = col.value(plane);
                    if (newValue != plane.trCache[cell]) {
                        plane.trCache[cell] = newValue;
                        if (col.html) {
                            plane.tr.cells[cell].innerHTML = newValue;
                        } else {
                            plane.tr.cells[cell].textContent = newValue;
                        }
                    }
                }
            }
        }
        ctime && console.timeEnd("modTRs");

        global.refreshPageTitle();
        jQuery('#dump1090_total_history').updateText(TrackedHistorySize);
        jQuery('#dump1090_total_history_short').updateText(TrackedHistorySize >= 1000 ? (TrackedHistorySize / 1000).toFixed(1) + 'k' : TrackedHistorySize);
        jQuery('#dump1090_message_rate').updateText(MessageRate === null ? 'n/a' : MessageRate.toFixed(1));
        jQuery('#dump1090_total_ac').updateText(globeIndex ? globeTrackedAircraft : TrackedAircraft);
        jQuery('#dump1090_total_ac_positions').updateText(TrackedAircraftPositions);



        ctime && console.time("DOM1");

        let newBody = document.createElement('tbody');
        for (let i in inTable) {
            const plane = inTable[i];
            newBody.appendChild(plane.tr);
        }

        ctime && console.timeEnd("DOM1");
        ctime && console.time("DOM2");

        htmlTable.replaceChild(newBody, tbody);
        tbody.remove();
        tbody = newBody;

        ctime && console.timeEnd("DOM2");

        ctime && console.timeEnd("planeMan.refresh()");
        atime && console.timeEnd("planeMan.refresh()");
    }

    //
    // ---- table sorting begin ----
    //

    planeMan.sortId = '';
    planeMan.sortCompare = null;
    planeMan.sortExtract = null;
    planeMan.sortAscending = true;

    function sortFunction(x,y) {
        const xv = x._sort_value;
        const yv = y._sort_value;

        // always sort missing values at the end, regardless of
        // ascending/descending sort
        if (xv == null && yv == null) return x._sort_pos - y._sort_pos;
        if (xv == null) return 1;
        if (yv == null) return -1;

        const c = planeMan.sortAscending ? planeMan.sortCompare(xv,yv) : planeMan.sortCompare(yv,xv);
        if (c !== 0) return c;

        return x._sort_pos - y._sort_pos;
    }

    function resortTable(pList) {
        if (!planeMan.sortExtract)
            return;
        if (globeIndex) {
            // don't presort for globeIndex
        }
        // presort by dataSource
        else if (planeMan.sortId == "sitedist") {
            for (let i = 0; i < pList.length; ++i) {
                pList[i]._sort_pos = i;
            }
            pList.sort(function(x,y) {
                const a = x.getDataSourceNumber();
                const b = y.getDataSourceNumber();
                if (a == b)
                    return (x._sort_pos - y._sort_pos);

                return (a-b);
            });
        }
        // or distance
        else if (planeMan.sortId == "data_source") {
            pList.sort(function(x,y) {
                return (x.sitedist - y.sitedist);
            });
        }
        // or longitude
        else {
            pList.sort(function(x,y) {
                return (x.position ? x.position[0] : 500) - (y.position ? y.position[0] : 500);
            });
        }

        // number the existing rows so we can do a stable sort
        // regardless of whether sort() is stable or not.
        // Also extract the sort comparison value.
        if (globeIndex) {
            for (let i = 0; i < pList.length; ++i) {
                pList[i]._sort_pos = pList[i].numHex;
                pList[i]._sort_value = planeMan.sortExtract(pList[i]);
            }
        } else {
            for (let i = 0; i < pList.length; ++i) {
                pList[i]._sort_pos = i;
                pList[i]._sort_value = planeMan.sortExtract(pList[i]);
            }
        }

        pList.sort(sortFunction);

        // In multiSelect put selected planes on top, do a stable sort!
        if (multiSelect) {
            for (let i = 0; i < pList.length; ++i) {
                pList[i]._sort_pos = i;
            }
            pList.sort(function(x,y) {
                if (x.selected && y.selected) {
                    return (x._sort_pos - y._sort_pos);
                }
                if (x.selected)
                    return -1;
                if (y.selected)
                    return 1;

                return (x._sort_pos - y._sort_pos);
            });
        }
    }

    function sortBy(id, sc, se) {
        loStore['sortCol'] = id;

        if (id === planeMan.sortId) {
            planeMan.sortAscending = !planeMan.sortAscending;
            g.planesOrdered.reverse(); // this correctly flips the order of rows that compare equal
        }

        loStore['sortAscending'] = planeMan.sortAscending ? 'true' : '';

        planeMan.sortId = id;
        planeMan.sortCompare = sc;
        planeMan.sortExtract = se;

        planeMan.refresh();
    }

    //
    // ---- table sorting end ----
    //

    function createColumnToggles() {
        const prefix = 'dd_';
        const sortableColumns = jQuery('#sortableColumns').sortable({
            update: function (event, ui) {
                const order = [];
                jQuery('#sortableColumns li').each(function (e) {
                    order.push(jQuery(this).attr('id').replace(prefix, ''));
                });

                loStore['columnOrder'] = JSON.stringify(order);
                columns = createOrderedColumns();

                planeMan.redraw();
            }
        });

        for (let col of columns) {
            sortableColumns.append(`<li class="ui-state-default" id="${prefix + col.id}"></li>`);

            new Toggle({
                key: col.toggleKey,
                display: col.text,
                container: jQuery(`#${prefix + col.id}`),
                init: col.visible,
                setState: function (state) {
                    planeMan.setColumnVis(col.id, state);
                }
            });
        }
    }

    function createOrderedColumns() {
        const order = loStore['columnOrder'];
        if (order !== undefined) {
            const columns = [];
            for (let col of JSON.parse(order)) {
                const column = cols[col];
                if (column !== undefined) {
                    columns.push(column);
                }
            }
            if (columns.length > 0) {
                return columns;
            }
        }
        return Object.values(cols);
    }

    return TAR;
}(window, jQuery, TAR || {}));
//
// g.planes table end
//

let lastSelected = null;
function deselect(plane) {
    if (!plane || !plane.selected)
        return;
    plane.selected = false;
    const index = SelPlanes.indexOf(plane);
    if (index > -1) {
        SelPlanes.splice(index, 1);
    }
    lastSelected = plane;
    if (plane == SelectedPlane) {
        if (SelPlanes.length > 0) {
            sp = SelectedPlane = SelPlanes[0];
        } else {
            sp = SelectedPlane = null;
        }
        refreshSelected();
    }

    plane.updateTick('redraw');
    updateAddressBar();
}
let scount = 0;
function select(plane, options) {
    if (!plane)
        return;
    options = options || {};
    //console.log("select()", plane.icao, options);
    plane.selected = true;
    if (!SelPlanes.includes(plane))
        SelPlanes.push(plane);

    sp = SelectedPlane = plane;
    updateAddressBar();
    refreshSelected();
    plane.updateTick('redraw');

    // selecting (from the map or the list) eases the camera onto the aircraft's drawn icon, zooms in (never out)
    // and turns Follow on; callers that set their own zoom or a trace view keep the old behaviour
    const focus = !options.noFocus && !options.zoom && !showTrace && plane.position && typeof MLR != 'undefined' && MLR.ready;
    if (focus) MLR.focusOn(plane);
    if (options.follow || focus) {
        toggleFollow(true);
        if (!options.zoom)
            options.zoom = 'follow';
    } else {
        toggleFollow(false);
    }
}

function selectPlaneByHex(hex, options) {
    active();
    options = options || {};
    console.log(`SELECTING ${hex} follow: ${options.follow}`);
    //console.log("select: " + hex);
    // If SelectedPlane has something in it, clear out the selected
    if (SelectedAllPlanes) {
        deselectAllPlanes();
    }
    // already selected plane
    let oldPlane = SelectedPlane;
    // plane to be selected
    let newPlane = g.planes[hex];

    const multiDeselect = multiSelect && newPlane && newPlane.selected && !onlySelected;

    if (!options.noFetch && (globeIndex || showTrace || haveTraces) && hex) {
        newPlane = getTrace(newPlane, hex, options);
    }

    // If we are clicking the same plane, we are deselecting it unless noDeselect is specified
    if (oldPlane == newPlane && (options.noDeselect || showTrace)) {
        oldPlane = null;
    } else {
        if (multiSelect) {
            // multiSelect deselect
            if (multiDeselect) {
                deselect(newPlane);
                newPlane = null;
                hex = null;
            }
        } else if (oldPlane) {
            // normal deselect
            if (oldPlane != newPlane) {
                deselect(oldPlane);
                oldPlane = null;
            }
            if (oldPlane == newPlane) {
                console.log('oldplane == newplane');
                deselect(newPlane);
                oldPlane = null;
                newPlane = null;
                hex = null;
            }
        }
    }

    // Assign the new selected
    select(newPlane, options);

    if (!newPlane) {
        toggleFollow(false);
    }

    if (options.zoom == 'follow') {
        //if (mapa.getZoom() < 8)
        //    mapa.setZoom(8);
    } else if (options.zoom) {
        mapa.setZoom(options.zoom);
    }

    pTracks || TAR.planeMan.refresh();

    return newPlane !== undefined;
}

// loop through the planes and mark them as selected to show the paths for all planes
function selectAllPlanes() {
    HighlightedPlane = null;
    // if all planes are already selected, deselect them all
    if (SelectedAllPlanes) {
        deselectAllPlanes();
        return;
    }
    buttonActive('#T', true);
    // If SelectedPlane has something in it, clear out the selected
    if (SelectedPlane)
        deselect(SelectedPlane);

    toggleIsolation("off");

    SelectedAllPlanes = true;

    // disable this for the moment
    if (0 && globeIndex) {
        for (let i in g.planesOrdered) {
            let plane = g.planesOrdered[i];
            if (plane.visible && plane.inView) {
                plane.processTrace();
            }
        }
    }
    refreshFeatures();

    refreshSelected();
    refreshHighlighted();
    pTracks || TAR.planeMan.refresh();
}

// deselect all the planes
function deselectAllPlanes(keepMain) {
    if (showTrace && !keepMain)
        return;
    if (!multiSelect && SelectedPlane)
        toggleIsolation("off");

    clearTimeout(getTraceTimeout);

    if (SelectedAllPlanes) {
        buttonActive('#T', false);
        jQuery('#selectall_checkbox').removeClass('settingsCheckboxChecked');
        SelectedAllPlanes = false;
        refreshFilter();
        return;
    }

    let bounce = [];
    for (let i in SelPlanes) {
        const plane = SelPlanes[i];
        if (keepMain && plane == SelectedPlane)
            continue;
        bounce.push(plane);
    }
    for (let i in bounce) {
        deselect(bounce[i]);
    }
    refreshFilter();
    updateAddressBar();
}

function toggleFollow(override) {
    if (override == true)
        FollowSelected = true;
    else if (override == false)
        FollowSelected = false;
    else
        FollowSelected = !FollowSelected;

    traceOpts.follow = FollowSelected;

    if (FollowSelected) {
        if (!SelectedPlane || !SelectedPlane.position)
            FollowSelected = false;
    }
    if (FollowSelected) {
        //if (override == undefined && mapa.getZoom() < 8)
        //    mapa.setZoom(8);
        SelectedPlane.setProjection('follow');
    }
    buttonActive('#F', FollowSelected);
    if (typeof MLR != 'undefined' && MLR.syncFollowZoom) MLR.syncFollowZoom(FollowSelected);
}

function resetMap() {
    geoFindMe().always(function() {
        if (SitePosition) {
            CenterLon = SiteLon;
            CenterLat = SiteLat;
        } else {
            CenterLon = DefaultCenterLon;
            CenterLat = DefaultCenterLat;
        }
        // Reset loStore values and map settings
        lopaStore['CenterLat'] = CenterLat
        lopaStore['CenterLon'] = CenterLon
        //lopaStore['zoomLvl']   = g.zoomLvl = DefaultZoomLvl;

        // Set and refresh
        //mapa.setZoom(g.zoomLvl);

        //console.log('resetMap setting center ' + [CenterLat, CenterLon]);
        mapa.setCenter([CenterLon, CenterLat]);
        mapa.setRotation(g.mapOrientation);

        //selectPlaneByHex(null,false);
        jQuery("#update_error").css('display','none');
    });
}

function updateMapSize() {
    mapa.updateSize();
}

let selectedPhotoCache = null;

function setPhotoNode(node, key) {
    if (selectedPhotoCache == key) return;
    selectedPhotoCache = key;
    const box = document.getElementById('selected_photo');
    box.textContent = '';
    box.appendChild(node);
}

function setPhotoHtml(source) {
    if (selectedPhotoCache == source)
        return;
    //console.log(source + ' ' + selectedPhotoCache);
    selectedPhotoCache = source;
    jQuery('#selected_photo').html(source);
}

function adjustInfoBlock() {
    // Skywatch ADS-B: position and size come from CSS (ui/shell.css); this only
    // shows/hides the panel and tells the shell which state the left panel is in.
    const show = !!(SelectedPlane && toggles['enableInfoblock'].state);
    // the wide details view needs room; phones always get the compact sheet
    const roomy = !window.matchMedia('(max-width: 700px)').matches;
    document.body.classList.toggle('infoOpen', show);
    const wideNow = show && !!wideInfoBlock && roomy;
    const prevShow = adjustInfoBlock.lastShow, infoChanged = prevShow !== show || adjustInfoBlock.lastWide !== wideNow;
    adjustInfoBlock.lastShow = show; adjustInfoBlock.lastWide = wideNow;
    document.body.classList.toggle('infoWide', wideNow);
    if (infoChanged && typeof MLR != 'undefined' && MLR.ready) {
        // panel closed: drop the camera padding (deferred: selecting another aircraft deselects first); widened: re-centre
        if (!show) setTimeout(() => { if (!SelectedPlane || !toggles['enableInfoblock'].state) MLR.clearFocus(); }, 0);
        else if (prevShow && !MLR.focusAnim) setTimeout(() => MLR.refocusPadding(), 0);   // widened / narrowed while open
    }
    if (typeof ibLayout == 'function')
        ibLayout();
    if (typeof shellSync == 'function')
        shellSync();
}

function initializeUnitsSelector() {
    // Get display unit preferences from local storage otherwise use value previously set defaults.js or config.js
    if (loStore.getItem('displayUnits')) {
        DisplayUnits = loStore['displayUnits'];
    }

    // Initialize drop-down
    jQuery('#units_selector')
        .val(DisplayUnits)
        .on('change', onDisplayUnitsChanged);

    jQuery(".altitudeUnit").text(get_unit_label("altitude", DisplayUnits));
    jQuery(".speedUnit").text(get_unit_label("speed", DisplayUnits));
    jQuery(".distanceUnit").text(get_unit_label("distance", DisplayUnits));
    jQuery(".verticalRateUnit").text(get_unit_label("verticalRate", DisplayUnits));
}

function onDisplayUnitsChanged(e) {
    loStore['displayUnits'] = DisplayUnits = e.target.value;

    TAR.altitudeChart.render();

    // Update filters
    updateAltFilter();

    // Refresh data
    refreshFilter();

    // Draw range rings
    drawSiteCircle();

    // Reset map scale line units
    mapa.setScaleUnits(units_for('distance', DisplayUnits));

    jQuery(".altitudeUnit").text(get_unit_label("altitude", DisplayUnits));
    jQuery(".speedUnit").text(get_unit_label("speed", DisplayUnits));
    jQuery(".distanceUnit").text(get_unit_label("distance", DisplayUnits));
    jQuery(".verticalRateUnit").text(get_unit_label("verticalRate", DisplayUnits));
    TAR.planeMan.redraw();

    remakeTrails();
    refreshSelected();
}

function onFilterByAltitude(e) {
    e.preventDefault();
    jQuery("#altitude_filter_min").blur();
    jQuery("#altitude_filter_max").blur();

    updateAltFilter();
    refreshFilter();
}

function filterGroundVehicles(switchFilter) {
    if (typeof loStore['groundVehicleFilter'] === 'undefined') {
        loStore['groundVehicleFilter'] = 'not_filtered';
    }
    let groundFilter = loStore['groundVehicleFilter'];
    if (switchFilter === true) {
        groundFilter = (groundFilter === 'not_filtered') ? 'filtered' : 'not_filtered';
    }
    if (groundFilter === 'not_filtered') {
        jQuery('#groundvehicle_filter').addClass('settingsCheckboxChecked');
    } else {
        jQuery('#groundvehicle_filter').removeClass('settingsCheckboxChecked');
    }
    loStore['groundVehicleFilter'] = groundFilter;
    PlaneFilter.groundVehicles = groundFilter;
}

function filterBlockedMLAT(switchFilter) {
    if (typeof loStore['blockedMLATFilter'] === 'undefined') {
        loStore['blockedMLATFilter'] = 'not_filtered';
    }
    let blockedMLATFilter = loStore['blockedMLATFilter'];
    if (switchFilter === true) {
        blockedMLATFilter = (blockedMLATFilter === 'not_filtered') ? 'filtered' : 'not_filtered';
    }
    if (blockedMLATFilter === 'not_filtered') {
        jQuery('#blockedmlat_filter').addClass('settingsCheckboxChecked');
    } else {
        jQuery('#blockedmlat_filter').removeClass('settingsCheckboxChecked');
    }
    loStore['blockedMLATFilter'] = blockedMLATFilter;
    PlaneFilter.blockedMLAT = blockedMLATFilter;
}

function buttonActive(id, state) {
    if (state) {
        jQuery(id).addClass('activeButton');
        jQuery(id).removeClass('inActiveButton');
    } else {
        jQuery(id).addClass('inActiveButton');
        jQuery(id).removeClass('activeButton');
    }
}

function toggleIsolation(state, noRefresh) {
    let prevState = onlySelected;
    if (showTrace && state !== "on")
        return;
    onlySelected = !onlySelected;
    if (state === "on")
        onlySelected = true;
    if (state === "off")
        onlySelected = false;

    buttonActive('#I', onlySelected);

    if (prevState != onlySelected && noRefresh != "noRefresh")
        refreshFilter();

    fetchData({force: true});
}

function toggleMilitary() {
    onlyMilitary = !onlyMilitary;
    buttonActive('#U', onlyMilitary);

    refreshFilter();
    active();
    fetchData({force: true});
}

function togglePersistence() {
    noVanish = !noVanish;
    //filterTracks = noVanish;

    buttonActive('#P', noVanish);

    remakeTrails();

    if (!noVanish)
        reaper();
    loStore['noVanish'] = noVanish;
    console.log('noVanish = ' + noVanish);

    refreshFilter();
}

function dim(evt) {
    try {
        let currentDimPercentage = mapDimPercentage * layerDimFactor;
        let currentContrastPercentage = mapContrastPercentage + layerExtraContrast;

        if (!toggles['MapDim'].state) {
            // slight dim even if disabled
            currentDimPercentage /= 4;
            currentContrastPercentage /= 4;
        }

        const dim = currentDimPercentage * (1 + 0.25 * toggles['darkerColors'].state);
        const contrast = currentContrastPercentage * (1 + 0.1 * toggles['darkerColors'].state);
        if (dim > 0.0001) {
            evt.context.globalCompositeOperation = 'multiply';
            evt.context.fillStyle = 'rgba(0,0,0,'+dim+')';
            evt.context.fillRect(0, 0, evt.context.canvas.width, evt.context.canvas.height);
        } else if (dim < -0.0001) {
            evt.context.globalCompositeOperation = 'screen';
            console.log(evt.context.globalCompositeOperation);
            evt.context.fillStyle = 'rgba(255, 255, 255,'+(-dim)+')';
            evt.context.fillRect(0, 0, evt.context.canvas.width, evt.context.canvas.height);
        }
        if (contrast > 0.0001) {
            evt.context.globalCompositeOperation = 'overlay';
            evt.context.fillStyle = 'rgba(0,0,0,'+contrast+')';
            evt.context.fillRect(0, 0, evt.context.canvas.width, evt.context.canvas.height);
        } else if (contrast < -0.0001) {
            evt.context.globalCompositeOperation = 'overlay';
            evt.context.fillStyle = 'rgba(255, 255, 255,'+ (-contrast)+')';
            evt.context.fillRect(0, 0, evt.context.canvas.width, evt.context.canvas.height);
        }
        evt.context.globalCompositeOperation = 'source-over';
    } catch (error) {
        console.error(error);
    }
}
function invertMap(evt){
  const ctx=evt.context;
  ctx.globalCompositeOperation='difference';
  ctx.fillStyle = "white";
  ctx.globalAlpha = alpha;  // alpha 0 = no effect 1 = full effect
  ctx.fillRect(0, 0, evt.ctx.canvas.width, ctx.canvas.height);


}
//
// Altitude Chart begin
//
(function (global, jQuery, TAR) {
    let altitudeChart = TAR.altitudeChart = TAR.altitudeChart || {};

    function loadLegend() {
        renderAltitudeLegend(document.getElementById('altitude_legend'));
        jQuery('#altitude_chart').show();
    }

    altitudeChart.render = function () {
        if (toggles['altitudeChart'].state) {
            runAfterLoad(loadLegend);
        } else {
            jQuery('#altitude_chart').hide();
        }
    }

    altitudeChart.init = function () {
        let chartOn = (onMobile ? false : altitudeChartDefaultState);
        if (usp.has('altitudeChart')) {
            chartOn = Boolean(parseInt(usp.get('altitudeChart')));
        }
        new Toggle({
            key: "altitudeChart",
            display: "Altitude Chart",
            container: "#settingsRight",
            init: chartOn,
            setState: altitudeChart.render
        });
    }

    return TAR;
}(window, jQuery, TAR || {}));
//
// Altitude Chart end
//

function followRandomPlane() {
    if (showTrace)
        return;
    let this_one = null;
    let tired = 0;
    do {
        this_one = g.planesOrdered[Math.floor(Math.random()*g.planesOrdered.length)];
        if (!this_one || tired++ > 1000)
            break;
    } while ((this_one.isFiltered() && !onlySelected) || !this_one.position || (now - this_one.position_time > 30));
    //console.log(this_one.icao);
    if (this_one)
        selectPlaneByHex(this_one.icao, {follow: true});
}

function toggleTableInView(arg) {
    if (arg == 'enable') {
        tableInView = true;
    } else if (arg == 'disable') {
        tableInView = false;
    } else if (!globeIndex) {
        tableInView = !tableInView;
    }

    TAR.planeMan.refresh();

    if (!globeIndex) {
        loStore['tableInView'] = tableInView;
    }

    jQuery('#with_positions').text(tableInView ? "On screen" : "With pos");

    buttonActive('#V', tableInView);
}

function toggleLabels() {
    g.enableLabels = !g.enableLabels;
    loStore['enableLabels'] = g.enableLabels;
    for (let key in g.planesOrdered) {
        g.planesOrdered[key].updateMarker();
    }
    refreshFeatures();
    buttonActive('#L', g.enableLabels);

    if (showTrace)
        remakeTrails();
}

function toggleExtendedLabels(options) {
    if (isNaN(g.extendedLabels))
        g.extendedLabels = 0;

    options = options || {};
    if (!options.noIncrement) {
        g.extendedLabels++;
    }
    g.extendedLabels %= 4;
    //console.log(extendedLabels);
    loStore['extendedLabels'] = g.extendedLabels;
    for (let key in g.planesOrdered) {
        g.planesOrdered[key].updateMarker();
    }
    buttonActive('#O', g.extendedLabels);
}

function toggleTrackLabels() {
    trackLabels = !trackLabels;
    loStore['trackLabels'] = trackLabels;

    remakeTrails();

    buttonActive('#K', trackLabels);
}

function toggleMultiSelect(newState) {
    let prevState = multiSelect;
    multiSelect = !multiSelect;

    if (newState == "on")
        multiSelect = true;
    if (newState == "off")
        multiSelect = false;

    if (!multiSelect) {
        if (!SelectedPlane)
            toggleIsolation("off");
        if (prevState != multiSelect)
            deselectAllPlanes("keepMain");
    }

    buttonActive('#M', multiSelect);
}

function onJump(e) {
    toggleFollow(false);
    if (e) {
        e.preventDefault();
        onJumpInput = jQuery("#jump_input").val();
        jQuery("#jump_input").val("");
        jQuery("#jump_input").blur();
    }
    let coords = null;
    let airport = null;
    if (onJumpInput.indexOf(",") >= 0) {
        let values = onJumpInput.split(',');
        if (!values || values.length != 2) {
            showSearchWarning('Input format decimal coordinates: LATI.TUDE, LONGI.TUDE');
        }
        coords = [parseFloat(values[0]), parseFloat(values[1])];
    } else {
        airport = onJumpInput.trim().toUpperCase();
    }
    if (airport) {
        if (!g.airport_cache) {
            jQuery.getJSON(databaseFolder + "/airport-coords.js")
                .done(function(data) {
                    g.airport_cache = data;
                    onJump();
                });
            return;
        }
        coords = g.airport_cache[airport];
    }
    if (coords) {
        console.log("jumping to: " + coords[0] + " " + coords[1]);
        mapa.setCenter([coords[1], coords[0]]);

        if (g.zoomLvl >= 7) {
            fetchData({force: true});
        }

        refreshFilter();
        hideSearchWarning();
    } else {
        showSearchWarning('Failed to find airport ' + airport);
    }
}

function hideSearchWarning() {
    const searchWarning = jQuery('#search_warning');
    if (searchWarning.css('display') !== 'none') {
        searchWarning.hide('slow');
    }
}

function showSearchWarning(message) {
    const searchWarning = jQuery('#search_warning');
    searchWarning.text(message)
    if (searchWarning.css('display') === 'none') {
        searchWarning.show();
    }

    //auto hide after 15 seconds
    setTimeout(() => hideSearchWarning(), 15000);
}

function onResetAltitudeFilter(e) {
    jQuery("#altitude_filter_min").val("");
    jQuery("#altitude_filter_max").val("");
    jQuery("#altitude_filter_min").blur();
    jQuery("#altitude_filter_max").blur();

    updateAltFilter();
    refreshFilter();
}

function updateAltFilter() {
    let minAltitude = parseFloat(jQuery("#altitude_filter_min").val().trim());
    let maxAltitude = parseFloat(jQuery("#altitude_filter_max").val().trim());
    let enabled = false;

    if (minAltitude < -1e6 || minAltitude > 1e6 || isNaN(minAltitude))
        minAltitude = -1e6;
    else
        enabled = true;
    if (maxAltitude < -1e6 || maxAltitude > 1e6 || isNaN(maxAltitude))
        maxAltitude = 1e6;
    else
        enabled = true;

    if (!enabled) {
        // no altitude filter: leave min/max unset, otherwise altFiltered() hides
        // everything without an altitude (AIS ships, aircraft without altitude)
        PlaneFilter.enabled = false;
        PlaneFilter.minAltitude = undefined;
        PlaneFilter.maxAltitude = undefined;
        return;
    }

    PlaneFilter.enabled = enabled;

    if (units_for('altitude', DisplayUnits) == "metric") {
        PlaneFilter.minAltitude = minAltitude * 3.2808;
        PlaneFilter.maxAltitude = maxAltitude * 3.2808;
    } else {
        PlaneFilter.minAltitude = minAltitude;
        PlaneFilter.maxAltitude = maxAltitude;
    }
}

function getFlightAwareIdentLink(ident, linkText) {
    if (ident !== null && ident !== "") {
        if (!linkText) {
            linkText = ident;
        }
        return '<a class="link" target="_blank" href="https://flightaware.com/live/flight/' + encodeURIComponent(ident.trim()) + '" rel="noreferrer">' + escHtml(linkText) + '</a>';
    }

    return "";
}

function onResetSourceFilter(e) {
    jQuery('#sourceFilter .ui-selected').removeClass('ui-selected');

    sourcesFilter = null;

    updateSourceFilter();
}

function updateSourceFilter(e) {
    if (e)
        e.preventDefault();

    PlaneFilter.sources = sourcesFilter;

    refreshFilter();
}

function onResetFlagFilter(e) {
    jQuery('#flagFilter .ui-selected').removeClass('ui-selected');

    flagFilter = null;

    updateFlagFilter();
}

function updateFlagFilter(e) {
    if (e)
        e.preventDefault();

    PlaneFilter.flagFilter = flagFilter;

    refreshFilter();
}

const filters = {};
const filter_list = [];
const filters_active = [];

function Filter(arg) {
    this.key = arg.key;
    this.field = arg.field;
    this.name = arg.name;
    this.tbody = document.getElementById(arg.table).getElementsByTagName('tbody')[0];

    this.id = 'filters_' + this.key;
    this.sid = '#' + this.id;

    filters[this.key] = this;
    filter_list.push(this);

    this.init();
}

Filter.prototype.update = function(e) {
    if (e) {
        e.preventDefault();
    }

    this.input.blur();
    const val = this.input.val().trim();

    this.set(val);

    return false;
}
Filter.prototype.set = function(val) {

    this.input.val(val);
    this.pattern = val;
    this.PATTERN = this.pattern.toUpperCase();

    const list_index = filters_active.indexOf(this);
    if (val && list_index < 0) {
        filters_active.push(this);
    }
    if (!val && list_index >= 0) {
        filters_active.splice(list_index);
    }

    refreshFilter();
}

Filter.prototype.reset = function(e) {
    if (e) {
        e.preventDefault();
    }
    this.set("");
    return false;
}

Filter.prototype.init = function() {
    // don't F directly with the innerhtml of the body because it will drop event listeners / recreate dom elements
    const row = this.tbody.insertRow();
    // Skywatch ADS-B: compact row in the filter popover (ui/shell.css .textFilters)
    row.innerHTML =
        `<td><form id="${this.id}" class="textFilter">`
        + `<label for="${this.id}_input">${this.name.charAt(0).toUpperCase() + this.name.slice(1)}</label>`
        + `<input id="${this.id}_input" name="${this.id}_name" type="text" class="searchInput" maxlength="1024" spellcheck="false" autocomplete="off">`
        + `<button type="button" class="btn textFilterReset" id="${this.id}_reset" aria-label="Clear ${this.name} filter">`
        + '<svg aria-hidden="true" class="ico" width="14" height="14" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>'
        + '</form></td>'
    ;
    this.input = jQuery(this.sid + '_input');
    this.form = document.getElementById(this.id)
    this.form.onsubmit = (e) => { return this.update(e); };
    jQuery(this.sid + '_reset').click((e) => { return this.reset(e); });
}

function initFilters() {
    initSourceFilter();
    initFlagFilter();
    new Filter({
        key: 'callsign',
        field: 'name',
        name: 'callsign',
        table: "filterTable",
    });
    new Filter({
        key: 'squawk',
        field: 'squawk',
        name: 'squawk',
        table: "filterTable",
    });
    new Filter({
        key: 'type',
        field: 'icaoType',
        name: 'type code',
        table: "filterTable",
    });
    new Filter({
        key: 'description',
        field: 'typeDescription',
        name: 'type description',
        table: "filterTable",
    });
    new Filter({
        key: 'icao',
        field: 'icao',
        name: 'ICAO hex id',
        table: "filterTable",
    });


    new Filter({
        key: 'registration',
        field: 'registration',
        name: 'registration',
        table: 'filterTable3'
    });
    if (routeApiUrl) {
        new Filter({
            key: 'route',
            field: 'routeString',
            name: 'route',
            table: 'filterTable3'
        });
    }
    new Filter({
        key: 'country',
        field: 'country',
        name: 'country of registration',
        table: 'filterTable3'
    });
    new Filter({
        key: 'category',
        field: 'category',
        name: 'category (A3,B0,..)',
        table: 'filterTable3'
    });

    if (PlaneFilter) {
        if (PlaneFilter.minAltitude && PlaneFilter.minAltitude > -1000000) {
            jQuery('#altitude_filter_min').val(PlaneFilter.minAltitude);
        }
        if (PlaneFilter.maxAltitude && PlaneFilter.maxAltitude < 1000000) {
            jQuery('#altitude_filter_max').val(PlaneFilter.maxAltitude);
        }

        for (const filter of filter_list) {
            if (usp.has(`filter${filter.key}`)) {
                filter.set(usp.get(`filter${filter.key}`));
            }
        }

        if (PlaneFilter.sources) {
            sourcesFilter = PlaneFilter.sources
            sourcesFilter.map((f) => jQuery('#source-filter-' + f).addClass('ui-selected'))
        }

        if (PlaneFilter.flagFilter) {
            flagFilter = PlaneFilter.flagFilter
            flagFilter.map((f) => jQuery('#flag-filter-' + f).addClass('ui-selected'))
        }
    }
}





function getFlightAwareModeSLink(code, ident, linkText) {
    if (code !== null && code.length > 0 && code[0] !== '~' && code !== "000000") {
        if (!linkText) {
            linkText = "FlightAware: " + code.toUpperCase();
        }

        let linkHtml = "<a class=\"link\" target=\"_blank\" href=\"https://flightaware.com/live/modes/" + encodeURIComponent(code);
        if (ident != null && ident !== "") {
            linkHtml += "/ident/" + encodeURIComponent(ident.trim());
        }
        linkHtml += "/redirect\" rel=\"noreferrer\">" + escHtml(linkText) + "</a>";
        return linkHtml;
    }

    return "";
}

function getPhotoLink(ac) {
    if (jetphotoLinks) {
        if (ac.registration == null || ac.registration == "")
            return "";
        return "<a class=\"link\" target=\"_blank\" href=\"https://www.jetphotos.com/photo/keyword/" + ac.registration.replace(/[^0-9a-z]/ig,'') + "\" rel=\"noreferrer\">Jetphotos</a>";
    } else if (flightawareLinks) {
        if (ac.registration == null || ac.registration == "")
            return "";
        return "<a class=\"link\" target=\"_blank\" href=\"https://flightaware.com/photos/aircraft/" + ac.registration.replace(/[^0-9a-z]/ig,'') + "\" rel=\"noreferrer\">FA Photos</a>";
    } else if (showPictures) {
        return "<a class=\"link\" target=\"_blank\" href=\"https://www.planespotters.net/hex/" + encodeURIComponent(ac.icao.toUpperCase()) + "\" rel=\"noreferrer\">planespotters.net</a>";
    }
}

// takes in an elemnt jQuery path and the OL3 layer name and toggles the visibility based on clicking it
function toggleLayer(element, layer) {
    // set initial checked status
    mapa.forEachLayer(function(lyr) {
        if (lyr.get('name') === layer && lyr.getVisible()) {
            jQuery(element).addClass('settingsCheckboxChecked');
        }
    });
    jQuery(element).on('click', function() {
        let visible = false;
        if (jQuery(element).hasClass('settingsCheckboxChecked')) {
            visible = true;
        }
        mapa.forEachLayer(function(lyr) {
            if (lyr.get('name') === layer) {
                if (visible) {
                    lyr.setVisible(false);
                    jQuery(element).removeClass('settingsCheckboxChecked');
                } else {
                    lyr.setVisible(true);
                    jQuery(element).addClass('settingsCheckboxChecked');
                }
            }
        });
    });
}

let fetchingPf = false;
function fetchPfData() {
    if (fetchingPf)
        return;
    fetchingPf = true;
    for (let i in pf_data) {
        const req = jQuery.ajax({ url: pf_data[i],
            dataType: 'json' });
        jQuery.when(req).done(function(data) {
            for (let i in g.planesOrdered) {
                const plane = g.planesOrdered[i];
                const ac = data.aircraft[plane.icao.toUpperCase()];
                if (!ac) {
                    continue;
                }
                plane.pfRoute = ac.route;
                plane.pfMach = ac.mach;
                plane.pfFlightno = ac.flightno;
                if (!plane.registration && ac.reg && ac.reg != "????" && ac.reg != "z.NO-REG")
                    plane.registration = ac.reg;
                if (!plane.icaoType && ac.type && ac.type != "????" && ac.type != "ZVEH") {
                    plane.icaoType = ac.type;
                    plane.setTypeData();
                }
            }
            fetchingPf = false;
        });
    }
}

function solidGoldT(arg) {
    solidT = true;
    let list = [[], [], [], []];
    for (let i = 0; i < g.planesOrdered.length; i++) {
        let plane = g.planesOrdered[i];
        //console.log(plane);
        if (plane.visible) {
            list[Math.floor(4*i/g.planesOrdered.length)].push(plane);
        }
    }
    getTrace(null, null, {onlyRecent: arg == 2, onlyFull: arg == 1, list: list[0],});
    getTrace(null, null, {onlyRecent: arg == 2, onlyFull: arg == 1, list: list[1],});
    getTrace(null, null, {onlyRecent: arg == 2, onlyFull: arg == 1, list: list[2],});
    getTrace(null, null, {onlyRecent: arg == 2, onlyFull: arg == 1, list: list[3],});
}

function bearingFromLonLat(position1, position2) {
    // Positions in format [lon in deg, lat in deg]
    const lon1 = position1[0]*Math.PI/180;
    const lat1 = position1[1]*Math.PI/180;
    const lon2 = position2[0]*Math.PI/180;
    const lat2 = position2[1]*Math.PI/180;

    const y = Math.sin(lon2-lon1)*Math.cos(lat2);
    const x = Math.cos(lat1)*Math.sin(lat2)
        - Math.sin(lat1)*Math.cos(lat2)*Math.cos(lon2-lon1);
    return (Math.atan2(y, x)* 180 / Math.PI + 360) % 360;
}

function zoomIn() {
    const zoom = mapa.getZoom();
    mapa.setZoom((zoom+1).toFixed());
    if (FollowSelected)
        toggleFollow(true);
}

function zoomOut() {
    const zoom = mapa.getZoom();
    mapa.setZoom((zoom-1).toFixed());
    if (FollowSelected)
        toggleFollow(true);
}

function changeZoom(init) {
    if (!mapa.ready())
        return;

    g.zoomLvl = mapa.getZoom();

    checkScale();

    if (showZoomLevel)
        jQuery('#zoomLevel').updateText('zoom ' + g.zoomLvl.toFixed(1));

    // small zoomstep, no need to change aircraft scaling
    if (!init && Math.abs(g.zoomLvl-g.zoomLvlCache) < 0.4)
        return;

    lopaStore['zoomLvl'] = g.zoomLvl;
    g.zoomLvlCache = g.zoomLvl;

    if (!init && showTrace)
        updateAddressBar();

    checkPointermove();
}

function checkScale() {
    if (g.zoomLvl > markerZoomDivide) {
        iconSize = markerBig;
    } else if (g.zoomLvl > markerZoomDivide - 1) {
        iconSize = markerSmall;
    } else {
        iconSize = markerSmall;
        if (aircraftShown > 700) {
            iconSize *= 0.9;
        }
    }

    // scale markers according to global scaling
    iconSize *= Math.pow(1.3, globalScale) * globalScale * iconScale;
    // disable, doesn't work well
    // iconSize *= 1 - 0.37 * Math.pow(TrackedAircraftPositions + 1, 0.8) / Math.pow(10000, 0.8);
}
function setGlobalScale(scale, init) {
    globalScale = scale;
    document.documentElement.style.setProperty("--SCALE", globalScale);

    labelFont = `${labelStyle} ${(12 * globalScale * labelScale)}px/${(14 * globalScale * labelScale)}px ${labelFamily}`;

    checkScale();
    setLineWidth();
    if (!init) {
        refreshFeatures();
        refreshSelected();
        refreshHighlighted();
        remakeTrails();
    }
}

function checkPointermove() {
    if (g.zoomLvl > 5.5 && enableMouseover && !onMobile) {
        mapa.pointerMove(true);
    } else {
        mapa.pointerMove(false);
        removeHighlight();
    }
}


function changeCenter(init) {
    const rawCenter = mapa.getCenterProj();
    const center = mapgeo.toLonLat(rawCenter);

    const centerChanged = (Math.abs(center[1] - CenterLat) > 0.000001 || Math.abs(center[0] - CenterLon) > 0.000001);

    if (!init && !centerChanged) {
        return;
    }

    lopaStore['CenterLon'] = CenterLon = center[0];
    lopaStore['CenterLat'] = CenterLat = center[1];

    if (!init) {
        updateAddressBar();
    }

    if (rawCenter[0] < -mapgeo.HALF || rawCenter[0] > mapgeo.HALF) {
        mapa.setCenter(center);
        refresh();
    }
    if (CenterLat < -85)
        mapa.setCenter([center[0], -85]);
    if (CenterLat > 85)
        mapa.setCenter([center[0], 85]);
}

let lastMovement = 0;
let checkMoveZoom;
let checkMoveCenter = [0, 0];
let checkMoveDone = 0;

function checkMovement() {
    if (!mapa.ready())
        return;

    if (!g.firstFetchDone) {
        return;
    }

    let currentTime = Date.now()/1000;
    if (currentTime > g.route_next_lookup && !g.route_check_in_flight) {
        // check if it's time to send a batch of request to the API server
        g.route_next_lookup = currentTime + 1;
        routeDoLookup();
    }

    const zoom = mapa.getZoom();
    const center = mapa.getCenter();
    const ts = new Date().getTime();

    if (
        checkMoveZoom != zoom ||
        checkMoveCenter[0] != center[0] ||
        checkMoveCenter[1] != center[1]
    ) {
        checkMoveDone = 0;
        if (FollowSelected) {
            checkFollow();
        }
        active();
        lastMovement = ts;
    }

    checkMoveZoom = zoom;
    checkMoveCenter[0] = center[0];
    checkMoveCenter[1] = center[1];

    changeZoom();
    changeCenter();

    const elapsed = Math.abs(ts - lastMovement);

    if (elapsed > 500 || (!onMobile && elapsed > 45)) {
        checkRefresh();
    }

    fetchData();
}

function getZoom() {
    return mapa.getZoom();
}

function getCenter() {
    return mapa.getCenter();
}

let lastRefresh = 0;
let refreshZoom, refreshCenter;
function checkRefresh() {
    if (showTrace)
        return;

    if (!g.firstFetchDone) {
        return;
    }
    if (triggerRefresh) {
        refresh();
        return;
    }
    const center = getCenter();
    const zoom = getZoom();
    if (zoom != refreshZoom || !refreshCenter || center[0] != refreshCenter[0] || center[1] != refreshCenter[1]) {
        const ts = new Date().getTime();
        const elapsed = Math.abs(ts - lastRefresh);
        let num = Math.min(1500, Math.max(250, TrackedAircraftPositions / 300 * 250));
        if (elapsed > num) {
            refresh();
        }
    }
}
function refresh(redraw) {
    lastRefresh = new Date().getTime();

    refreshZoom = getZoom();
    refreshCenter = getCenter();

    if (replay) {
        for (let i in SelPlanes) {
            const plane = SelPlanes[i];
            plane.processTrace();
        }
    }

    // before planeman refresh / mapRefresh
    updateVisible();

    mapRefresh(redraw);

    //console.time("refreshTable");
    TAR.planeMan.refresh();
    //console.timeEnd("refreshTable");


    refreshSelected();
    refreshHighlighted();

    triggerRefresh = 0;
}

function refreshFilter() {
    if (filterTracks)
        remakeTrails();

    refresh(true);

    if (toggles.shareFilters && toggles.shareFilters.state) {
        updateAddressBar();
    }
}


function updateVisible() {
    if (mapIsVisible || !lastRenderExtent) {
        lastRenderExtent = getRenderExtent();
    }
    aircraftShown = 0;
    for (let i in g.planesOrdered) {
        const plane = g.planesOrdered[i];
        plane.updateVisible();
        aircraftShown += (plane.visible && plane.inView);
    }
    checkScale();
}

function mapRefresh(redraw) {
    if (!mapIsVisible || heatmap)
        return;
    let addToMap = [];
    let nMapPlanes = 0;
    let count = 0;

    if (globeIndex && !icaoFilter) {
        for (let i in g.planesOrdered) {
            count++;
            const plane = g.planesOrdered[i];
            delete plane.glMarker;
            // disable mobile limitations when using webGL
            if (plane.selected || (plane.inView && plane.visible && (!onMobile || (nMapPlanes < 150 && (!plane.onGround || g.zoomLvl > 10))))) {
                addToMap.push(plane);
                nMapPlanes++;
            } else {
                plane.markerDrawn && plane.clearMarker();
                !SelectedAllPlanes && plane.linesDrawn && plane.clearLines();
            }
        }
    } else {
        for (let i in g.planesOrdered) {
            const plane = g.planesOrdered[i];
            delete plane.glMarker;
            addToMap.push(plane);
        }
    }

    //console.log('planes on map: ' + nMapPlanes + ' / ' + count);

    // webGL zIndex hack:
    // sort all planes by altitude
    // clear the vector source
    // delete all feature objects so they are recreated, this is important
    // draw order will be insertion / updateFeatures order

    addToMap.sort(function(x, y) { return x.zIndex - y.zIndex; });
    //console.log('maprefresh(): ' + addToMap.length);
    for (let i in addToMap) {
        addToMap[i].updateFeatures(redraw);
    }
}

// hover: the plane under the pointer (or null)
function highlightPlane(plane) {
    if (!plane) {
        const had = HighlightedPlane;
        HighlightedPlane = null;
        refreshHighlighted();
        if (had) MLR.touch('planes');          // the hovered label goes back to normal collision
        return;
    }
    if (HighlightedPlane && plane.icao == HighlightedPlane.icao)
        return;
    HighlightedPlane = g.planes[plane.icao] || null;
    refreshHighlighted();
    MLR.touch('planes');
}

let urlIcaos = [];
function parseURLIcaos() {
    if (usp.has('icao')) {
        let inArray = usp.get('icao').toLowerCase().split(',');
        for (let i = 0; i < inArray.length; i++) {
            const icao = inArray[i].toLowerCase();
            if (icao && (icao.length == 7 || icao.length == 6) && icao.toLowerCase().match(/[a-f,0-9]{6}/)) {
                urlIcaos.push(icao);
                let newPlane = g.planes[icao] || new PlaneObject(icao);
                newPlane.last_message_time = NaN;
                newPlane.position_time = NaN;
                newPlane.selected = true;
                SelPlanes.push(newPlane);
                //console.log(newPlane);
                // preliminary adding of URL specified icaos
            }
        }
    }
}
function processURLParams(){
    if (usp.has('showTrace')) {
        let date = setTraceDate({string: usp.get('showTrace')});
        if (date && usp.has('startTime')) {
            let numbers =  usp.get('startTime').split(':');
            traceOpts.startHours = numbers[0] ? parseInt(numbers[0]) : 0;
            traceOpts.startMinutes = numbers[1] ? parseInt(numbers[1]) : 0;
            traceOpts.startSeconds = numbers[2] ? parseInt(numbers[2]) : 0;
        }
        if (date && usp.has('endTime')) {
            let numbers = usp.get('endTime').split(':');
            traceOpts.endHours = numbers[0] ? parseInt(numbers[0]) : 24;
            traceOpts.endMinutes = numbers[1] ? parseInt(numbers[1]) : 0;
            traceOpts.endSeconds = numbers[2] ? parseInt(numbers[2]) : 0;
        }
        if (date && usp.getFloat('timestamp')) {
            showTraceTimestamp = usp.getFloat('timestamp');
        }
    }

    const callsign = usp.get('callsign');
    let zoom = null;
    let follow = true;
    if (usp.get("zoom")) {
        try {
            zoom = parseFloat(usp.get("zoom"));
            if (zoom === 0)
                zoom = 8;
        } catch (error) {
            console.log("Error parsing zoom:", error);
        }
    }

    if (usp.get("lat") && usp.get("lon")) {
        try {
            const lat = parseFloat(usp.get("lat"));
            const lon = parseFloat(usp.get("lon"));
            mapa.setCenter([lon, lat]);
            follow = false;
            traceOpts.noFollow = new Date().getTime() / 1000;
        }
        catch (error) {
            console.log("Error parsing lat/lon:", error);
        }
    }

    lastRenderExtent = getRenderExtent();

    if (urlIcaos.length > 0) {
        const icaos = urlIcaos;
        if (!usp.has('noIsolation') && !usp.has('replay'))
            toggleIsolation("on");
        if (icaos.length > 1) {
            toggleMultiSelect("on");
            //follow = false;
        }
        for (let i = 0; i < icaos.length; i++) {
            const icao = icaos[i];
            console.log('Selected ICAO id: '+ icao + ' traceDate: ' + traceDateString);
            let options = {follow: follow, noDeselect: true};
            if (traceDate != null) {
                let newPlane = g.planes[icao] || new PlaneObject(icao);
                newPlane.last_message_time = NaN;
                newPlane.position_time = NaN;
                newPlane.selected = true;
                select(newPlane, options);

                (!zoom) && (zoom = 5);
            } else {
                (!zoom) && (zoom = 7);
                selectPlaneByHex(icao, options);
            }
        }
        if (traceDate != null)
        {
            toggleShowTrace();
            toggleFollow(follow);
        }
        updateAddressBar();
    } else if (callsign != null) {
        findPlanes(callsign, false, true, false, false, false);
    }

    if (zoom) {
        mapa.setZoom(zoom);
    }

    if (usp.has('mil') || defaultMilitaryOnly)
        toggleMilitary();

    if (usp.has('airport')) {
        onJumpInput = usp.get('airport').trim().toUpperCase();
        onJump();
    }

    if (usp.has('leg')) {
        legSel = parseInt(usp.get('leg'), 10);
        if (isNaN(legSel) || legSel < -1)
            legSel = -1;
        else
            legSel--;
    }

    let tracks = usp.get('monochromeTracks');
    if (tracks != undefined) {
        if (tracks.length == 6)
            monochromeTracks = '#' + tracks;
        else
            monochromeTracks = "#000000";
    }

    let markers = usp.get('monochromeMarkers');
    if (markers != undefined) {
        if (markers.length == 6)
            monochromeMarkers = '#' + markers;
        else
            monochromeMarkers = "#FFFFFF";
    }

    let outlineColor = usp.get('outlineColor');
    if (outlineColor != undefined) {
        if (outlineColor.length == 6)
            OutlineADSBColor = '#' + outlineColor;
        else
            OutlineADSBColor = "#000000";
    }

    if (usp.has('centerReceiver')) {
        mapa.setCenter([SiteLon, SiteLat]);
    }
    if (usp.has('lockDotCentered')) {
        lockDotCentered = true;
        mapa.setCenter([SiteLon, SiteLat]);
    }
}

let regIcaoDownloadRunning = false;
function regIcaoDownload(opts) {
    regIcaoDownloadRunning = true;
    let req = jQuery.ajax({ url: databaseFolder + "/regIcao.js",
        cache: true,
        timeout: 60000,
        dataType : 'json',
        opts: opts,
    });
    req.done(function(data) {
        db.regCache = data;
    });
    req.always(function() {
        regIcaoDownloadRunning = false;
    });
    return req;
}
function findPlanes(queries, byIcao, byCallsign, byReg, byType, showWarnings) {
    if (queries == null)
        return;
    queries = queries.toLowerCase();
    queries = queries.split(',');
    if (queries.length > 1)
        toggleMultiSelect("on");
    let results = [];
    for (let i in queries) {
        const query = queries[i];
        if (byReg) {
            let upper = query.toUpperCase().replace("-", "");
            if (db.regCache) {
                if (db.regCache[upper]) {
                    selectPlaneByHex(db.regCache[upper].toLowerCase(), {noDeselect: true, follow: true});
                }
            } else if (!regIcaoDownloadRunning) {
                let req = regIcaoDownload({ upper: `${upper}` });
                req.done(function() {
                    if (db.regCache[this.opts.upper]) {
                        selectPlaneByHex(db.regCache[this.opts.upper].toLowerCase(), {noDeselect: true, follow: true});
                    }
                });
            }
        }
        for (let i in g.planesOrdered) {
            const plane = g.planesOrdered[i];
            if (
                (byCallsign && plane.flight != null && plane.flight.toLowerCase().match(query))
                || (byIcao && plane.icao.toLowerCase().match(query))
                || (byReg && plane.registration != null && plane.registration.toLowerCase().match(query))
                || (byType && plane.icaoType != null && plane.icaoType.toLowerCase().match(query))
            ) {
                results.push(plane);
                /* leaving this code in place just in case, not sure what this limitation to planes on screen is for when searching
                if (globeIndex) {
                    if (plane.inView)
                        results.push(plane);
                } else {
                    if (plane.checkVisible())
                        results.push(plane);
                }
                */
            }
        }
    }
    if (results.length > 1) {
        toggleMultiSelect("on");
        for (let i in results) {
            select(results[i], {});
            results[i].updateTick(true);
            sp = SelectedPlane = null;
        }
        showWarnings && hideSearchWarning();
    } else if (results.length == 1) {
        selectPlaneByHex(results[0].icao, {noDeselect: true, follow: true});
        console.log("query selected: " + queries);
        showWarnings && hideSearchWarning();
    } else {
        console.log("No match found for query: " + queries);
        let foundByHex = 0;
        if (haveTraces) {
            for (let i in queries) {
                const query = queries[i];
                if (query.toLowerCase().match(/~?[a-f,0-9]{6}/)) {
                    console.log("maybe it's an icao, let's try to fetch the history for it!");
                    selectPlaneByHex(query, {noDeselect: true, follow: true}) && foundByHex++
                }
            }
        }
        if (foundByHex === 0 && showWarnings) {
            if (globeIndex) {
                showSearchWarning("No match found in current view: " + queries);
            } else {
                showSearchWarning("No match found for query: " + queries);
            }
        }
    }
    return results;
}

function trailReaper() {
    for (let i in g.planesOrdered) {
        g.planesOrdered[i].reapTrail();
    }
}

function setIndexDistance(index, center, coords) {
    if (index >= 1000) {
        globeIndexDist[index] = mapgeo.getDistance(center, coords);
        return;
    }
    let tile = globeIndexSpecialTiles[index];
    let min = mapgeo.getDistance(center, [tile[1], tile[0]]);
    min = Math.min(min, mapgeo.getDistance(center, [tile[1], tile[2]]));
    min = Math.min(min, mapgeo.getDistance(center, [tile[3], tile[0]]));
    min = Math.min(min, mapgeo.getDistance(center, [tile[3], tile[2]]));
    globeIndexDist[index] = min;
}

function globeIndexes() {
    const center = mapa.getCenter();
    if (mapIsVisible || lastGlobeExtent == null) {
        lastGlobeExtent = getViewOversize(1.02);
    }
    let extent = lastGlobeExtent.extent;
    const bottomLeft = mapgeo.toLonLat([extent[0], extent[1]]);
    const topRight = mapgeo.toLonLat([extent[2], extent[3]]);
    let x1 = bottomLeft[0];
    let y1 = bottomLeft[1];
    let x2 = topRight[0];
    let y2 = topRight[1];
    if (Math.abs(extent[2] - extent[0]) > 40075016) {
        // all longtitudes in view, only check latitude
        x1 = -179;
        x2 = 179;
    }
    if (y1 < -89.5)
        y1 = -89.5;
    if (y2 > 89.5)
        y2 = 89.5;
    let indexes = [];
    //console.log(x1 + ' ' + x2);
    let grid = globeIndexGrid;

    let x3 = x1 < x2 ? x2 : 199;
    let count = 0;

    //console.time('indexes');
    for (let lon = x1; lon < x3 + grid; lon += grid) {
        if (x1 > x2 && lon > 180) {
            lon -= 360;
            x3 = x2;
        }
        if (lon > x3)
            lon = x3 + 0.01;
        if (count++ > 360 / grid) {
            console.log("globeIndexes fail, lon: " + lon);
        }
        let count2 = 0;
        for (let lat = y1; lat < y2 + grid; lat += grid) {
            if (count2++ > 180 / grid) {
                console.log("globeIndexes fail, lon: " + lon + ", lat: " + lat);
                break;
            }
            if (lat > y2)
                lat = y2 + 0.01;
            if (lat > 90)
                break;
            let index = globe_index(lat, lon);
            //console.log(lat + ' ' + lon + ' ' + index);
            if (!indexes.includes(index)) {
                setIndexDistance(index, center, [lon, lat]);
                indexes.push(index);
            }
        }
    }
    //console.timeEnd('indexes');
    globeTilesViewCount = indexes.length;
    return indexes;
}

function globe_index(lat, lon) {
    let grid = globeIndexGrid;

    lat = grid * Math.floor((lat + 90) / grid) - 90;
    lon = grid * Math.floor((lon + 180) / grid) - 180;

    let i = Math.floor((lat+90) / grid);
    let j = Math.floor((lon+180) / grid);

    let lat_multiplier = Math.floor(360 / grid + 1);
    let defaultIndex = i * lat_multiplier + j + 1000;

    let index = globeIndexSpecialLookup[defaultIndex];
    if (index) {
        return index;
    }

    // not yet in lookup, check special tiles
    for (let i = 0; i < globeIndexSpecialTiles.length; i++) {
        let tile = globeIndexSpecialTiles[i];
        if ((lat >= tile[0] && lat < tile[2])
            && ((tile[1] < tile[3] && lon >= tile[1] && lon < tile[3])
                || (tile[1] > tile[3] && (lon >= tile[1] || lon < tile[3])))) {
            globeIndexSpecialLookup[defaultIndex] = index = i;
        }
    }
    if (index == null) {
        // not a special tile, set lookup to default index
        globeIndexSpecialLookup[defaultIndex] = index = defaultIndex;
    }

    return index;
}

function myExtent(extent) {
    let bottomLeft = mapgeo.toLonLat([extent[0], extent[1]]);
    let topRight = mapgeo.toLonLat([extent[2], extent[3]]);
    return {
        extent: extent,
        minLon: bottomLeft[0],
        maxLon: topRight[0],
        minLat: bottomLeft[1],
        maxLat: topRight[1],
    }
}

function inView(pos, ex) {
    if (pos == null)
        return false;

    if (solidT)
        return true;

    let extent = ex.extent;
    let lon = pos[0];
    let lat = pos[1];

    //console.log((currExtent[2]-currExtent[0])/40075016);
    //console.log([bottomLeft[0], topRight[0]]);
    //console.log([bottomLeft[1], topRight[1]]);
    //const proj = mapgeo.fromLonLat(pos);
    if (lat < ex.minLat || lat > ex.maxLat)
        return false;

    if (extent[2] - extent[0] > 40075016) {
        // all longtitudes in view, only check latitude
        return true;
    } else if (ex.minLon < ex.maxLon) {
        // no wraparound: view not crossing 179 to -180 transition line
        return (lon > ex.minLon && lon < ex.maxLon);
    } else {
        // wraparound: view crossing 179 to -180 transition line
        return (lon > ex.minLon || lon < ex.maxLon);
    }
}
let lastAddressBarUpdate = 0;
let updateAddressBarTimeout;
let updateAddressBarPushed = false;
let updateAddressBarString = "";
function updateAddressBar() {
    if (!window.history || !window.history.replaceState)
        return;
    if (heatmap || (pTracks && !haveTraces) || !CenterLat || uuid)
        return;

    let string = '';

    if (replay) {
        string += '?replay=';
        string += zDateString(replay.ts);
        string += '-' + replay.ts.getUTCHours().toString().padStart(2,'0');
        string += ':' + replay.ts.getUTCMinutes().toString().padStart(2,'0');
    }

    if (SelPlanes.length > 0) {
        string += (string ? '&' : '?');
        string += 'icao=' + SelPlanes.map((s) => encodeURIComponent(s.icao)).join(',')
    }

    if (showTrace || replay) {
        string += (string ? '&' : '?');
        string += 'lat=' + CenterLat.toFixed(3) + '&lon=' + CenterLon.toFixed(3) + '&zoom=' + g.zoomLvl.toFixed(1);
    }

    if (SelPlanes.length > 0 && (showTrace)) {
        string += (string ? '&' : '?');
        string += 'showTrace=' + traceDateString;
        if (legSel != -1)
            string += '&leg=' + (legSel + 1);
        if (traceOpts.startHours != null) {
            string += '&startTime=';
            string += traceOpts.startHours.toString().padStart(2, '0');
            string += ':' + traceOpts.startMinutes.toString().padStart(2, '0');
            if (traceOpts.startSeconds) {
                string += ':' + traceOpts.startSeconds.toString().padStart(2, '0');
            }
        }
        if (traceOpts.endHours != null) {
            string += '&endTime=';
            string += traceOpts.endHours.toString().padStart(2, '0');
            string += ':' + traceOpts.endMinutes.toString().padStart(2, '0');
            if (traceOpts.endSeconds) {
                string += ':' + traceOpts.endSeconds.toString().padStart(2, '0');
            }
        }
        if (trackLabels) {
            string += '&trackLabels';
            if (labelsGeom) {
                string += '&labelsGeom';
            }
            if (geomUseEGM) {
                string += '&geomEGM';
            }
        }
        if (traceOpts.showTime) {
            string += '&timestamp=';
            string += Math.ceil(traceOpts.showTime);
        }
    }

    let shareFilter = '';
    if (shareFiltersParam || (toggles.shareFilters  && toggles.shareFilters.state)) {
        let filterStrings = [];

        if (PlaneFilter.minAltitude > -1000000) {
            filterStrings.push('filterAltMin=' + PlaneFilter.minAltitude);
        }
        if (PlaneFilter.maxAltitude < 1000000) {
            filterStrings.push('filterAltMax=' + PlaneFilter.maxAltitude);
        }

        for (const filter of filters_active) {
            filterStrings.push(`filter${filter.key}=${encodeURIComponent(filter.pattern)}`);
        }

        if (PlaneFilter.sources) {
            filterStrings.push('filterSources=' + PlaneFilter.sources.map(f => encodeURIComponent(f)).join(','));
        }
        if (PlaneFilter.flagFilter) {
            filterStrings.push('filterDbFlag=' + PlaneFilter.flagFilter.map(f => encodeURIComponent(f)).join(','));
        }

        if (filterStrings.length > 0) {
            shareFilter = shareFilter + filterStrings.join('&');
        } else {
            shareFilter = '';
        }

        //console.log(shareFilter);

        if (shareFilter) {
            string += (string ? '&' : '?');
            string += shareFilter;
        }
    }

    if (icaoFilter && !showTrace) {
        string += (string ? '&' : '?');
        string += 'icaoFilter=' + icaoFilter.join(',')
    }

    if (shareBaseUrl) {
        shareLink = shareBaseUrl + string;
    } else {
        shareLink = window.location.origin + pathName + string;
    }
    //console.log(shareLink);

    if (!string && !usp.has('showTrace') && !usp.has('icao') && !usp.has('replay')) {
        string = initialURL;
    } else {
        string = pathName + string;
    }

    // Update URL bar
    /*
    let time = new Date().getTime();
    if (time < lastAddressBarUpdate + 200) {
        clearTimeout(updateAddressBarTimeout);
        updateAddressBarTimeout = setTimeout(updateAddressBar, 205);
        return;
    }

    lastAddressBarUpdate = time;
    */

    if (string == updateAddressBarString) {
        return;
    }
    updateAddressBarString = string;

    if (!updateAddressBarPushed) {
        // make sure we keep the thing we clicked on first in the browser history
        window.history.pushState("object or string", "Title", string);
        updateAddressBarPushed = true;
    } else {
        // but don't create a new history entry for every plane we click on
        window.history.replaceState("object or string", "Title", string);
    }
}

function refreshInt() {
    let refresh = RefreshInterval;

    if (uuid)
        return 5050;

    // handle non globe case
    if (!globeIndex) {
        return refresh;
    }

    // handle globe case

    if (reApi && (binCraft || zstd)) {
        refresh = RefreshInterval * lastRequestSize / 35000;
        let extent = getViewOversize(1.03);
        const latDiff = extent.maxLat - extent.minLat;
        const lonDiff = extent.maxLon - extent.minLon;
        const area = latDiff * lonDiff;
        const areaThreshold = 30 * 30;
        let min = 1;
        let max = 7;
        if (area > areaThreshold && !onlySelected) {
            const factor2 = Math.min(4, (latDiff * lonDiff) / areaThreshold);
            min *= factor2;
        }
        if (refresh < RefreshInterval * min) {
            refresh = RefreshInterval * min;
        }
        if (refresh > RefreshInterval * max) {
            refresh = RefreshInterval * max;
        }
        if (onlySelected && SelPlanes.length == 0 && reApi) {
            // no aircraft selected, none shown
            refresh = RefreshInterval * max * 2;
        }
        if (!FollowSelected && lastRequestBox != requestBoxString()) {
            refresh = Math.min(RefreshInterval, refresh / 4);
        }
    }

    if (!reApi && binCraft && globeIndex && onlyMilitary && mapa.getZoom() < 5.5) {
        refresh = 5000;
    }

    let inactive = getInactive();

    const base = 70;

    if (inactive < base)
        inactive = base;
    if (inactive > 4 * base)
        inactive = 4 * base;


    if (globeIndex) {
        refresh *= inactive / base;
    }

    if (!mapIsVisible)
        refresh *= 2;

    if (aggregator && window.self != window.top) {
        refresh *= 1.5;
    } else if (onMobile && TrackedAircraftPositions > 800) {
        refresh *= 1.5;
    }

    if (document.visibilityState === 'hidden') { refresh *= 4; } // in case visibility change events don't work, reduce refresh rate if visibilityState works

    //console.log(refresh);

    return refresh;
}

function toggleShowTrace() {
    showTrace = !showTrace;
    if (showTrace) {
        jQuery("#selected_showTrace_hide").hide();

        toggleFollow(false);
        showTraceWasIsolation = onlySelected;
        toggleIsolation("on", "noRefresh");
        shiftTrace();
        refreshFilter();
    } else {
        jQuery("#selected_showTrace_hide").show();

        traceOpts = {};
        fetchData();
        legSel = -1;
        jQuery('#leg_sel').text('Legs: All');
        if (!showTraceWasIsolation)
            toggleIsolation("off");
        //let string = pathName + '?icao=' + SelectedPlane.icao;
        //window.history.replaceState("object or string", "Title", string);
        //shareLink = string;
        updateAddressBar();
        const hex = SelectedPlane.icao;
        sp = SelectedPlane = null;
        showTraceExit = true;
        for (let i in SelPlanes) {
            const plane = SelPlanes[i];
            plane.setNull();
        }
        selectPlaneByHex(hex, {noDeselect: true, follow: true, zoom: g.zoomLvl,});
        if (replay) {
            replayStep();
        }
    }

    // Skywatch ADS-B: the history bar floats over the map (ui/history.js)
    document.getElementById('historyBar').hidden = !showTrace;
    document.body.classList.toggle('traceOpen', showTrace);
    jQuery('#show_trace').toggleClass('active');
    jQuery('#history_action').attr('aria-pressed', String(showTrace)).toggleClass('on', showTrace);
}

function legShift(offset, plane) {
    if(!offset)
        offset = 0;
    if (!plane) {
        legSel += offset;
        for (let i in SelPlanes) {
            legShift(offset, SelPlanes[i]);
        }
        return;
    }


    if (offset != 0)
        traceOpts.showTime = null;

    if (!multiSelect && !plane.fullTrace) {
        jQuery('#leg_sel').text('No Data available for\n' + traceDateString);
        jQuery('#trace_time').text('UTC:\n');
    }
    if (!plane.fullTrace) {
        plane.processTrace();
        return;
    }

    let trace = plane.fullTrace.trace;
    let legStart = null;
    let legEnd = null;
    let count = 0;

    for (let i = 0; i < trace.length; i++) {
        let timestamp = trace[i][0];
        if (traceOpts.startStamp != null && timestamp < traceOpts.startStamp) {
            continue;
        }
        if (traceOpts.endStamp != null && timestamp > traceOpts.endStamp) {
            break;
        }
        if (legStart == null) {
            legStart = i;
            i++;
            if (i >= trace.length)
                break;
        }
        if (trace[i][6] & 2) {
            count++;
        }
    }
    if (legSel < -1)
        legSel = count;
    if (legSel > count)
        legSel = -1;

    if (legSel == -1) {
        jQuery('#leg_sel').text('Legs: All');
        traceOpts.legStart = null;
        traceOpts.legEnd = null;
        plane.processTrace();
        updateAddressBar();
        return;
    }

    count = 0;
    for (let i = legStart + 1; i < trace.length; i++) {
        let timestamp = trace[i][0];
        if (traceOpts.endStamp != null && timestamp > traceOpts.endStamp)
            break;
        if (trace[i][6] & 2) {
            if (count == legSel - 1)
                legStart = i;
            if (count == legSel)
                legEnd = i; // exclusive
            count++;
        }
    }
    jQuery('#leg_sel').text('Leg: ' + (legSel + 1));
    traceOpts.legStart = legStart;
    traceOpts.legEnd = legEnd;
    plane.processTrace();

    updateAddressBar();
}

function setTraceDate(options) {
    options = options || {};
    let numbers = options.string ? options.string.split('-') : [];
    if (numbers.length == 3) {
        traceDate = new Date();
        traceDate.setUTCFullYear(numbers[0]);
        traceDate.setUTCMonth(numbers[1] - 1, numbers[2]);
    } else if (options.ts) {
        traceDate = new Date(options.ts);
    } else {
        return null;
    }
    traceDate.setUTCHours(0);
    traceDate.setUTCMinutes(0);
    traceDate.setUTCSeconds(0);
    traceDate.setUTCMilliseconds(0);

    let tomorrow = (new Date()).getTime() + 86400e3;
    if (traceDate.getTime() > tomorrow) {
        traceDate = new Date(tomorrow);
    }

    traceDateString = zDateString(traceDate);

    return traceDate;
}

function shiftTrace(offset) {
    if (traceRate > 180) {
        jQuery('#leg_sel').text('Slow down! ...');
        return;
    }

    // reset some traceOpts stuff (important)
    traceOpts.startStamp = null;
    traceOpts.endStamp = null;
    traceOpts.showTimeEnd = null;
    traceOpts.showTime = null;

    jQuery('#leg_sel').text('Loading ...');
    if (!traceDate || offset == "today") {
        if (replay) {
            setTraceDate({ ts: replay.ts.getTime() });
        } else {
            setTraceDate({ ts: new Date().getTime() });
        }
    } else if (offset) {
        setTraceDate({ ts: traceDate.getTime() + offset * 86400 * 1000 });
    }

    //jQuery('#trace_date').text('UTC day:\n' + traceDateString);
    jQuery("#histDatePicker").datepicker('setDate', traceDateString);

    for (let i in SelPlanes) {
        selectPlaneByHex(SelPlanes[i].icao, {noDeselect: true, zoom: g.zoomLvl, noFocus: true});
    }

    updateAddressBar();
}


function setLineWidth() {
    newWidth = lineWidth * Math.pow(2, globalScale) / 2 * globalScale

    selectedLabelFont = 'bold ' + (12 * globalScale) + 'px "JetBrains Mono", ui-monospace, monospace';
}
let lastCallLocationChange = 0;
function onLocationChange(position) {
    if (SiteOverride) {
        return;
    }
    lastCallLocationChange = new Date().getTime();
    changeCenter();
    const moveMap = (Math.abs(SiteLat - CenterLat) < 0.000001 && Math.abs(SiteLon - CenterLon) < 0.000001);
    SiteLat = DefaultCenterLat = position.coords.latitude;
    SiteLon = DefaultCenterLon = position.coords.longitude;
    SitePosition = [SiteLon, SiteLat];

    drawSiteCircle();
    createLocationDot();

    if (moveMap || lockDotCentered) {
        mapa.setCenter([SiteLon, SiteLat]);
    }
    console.log('Changed Site Location to: '+ SiteLat +', ' + SiteLon);
    //followRandomPlane();
    //togglePersistence();
}
function logArg(error) {
    console.log(error);
}

let watchPositionId;
let pollPositionSeconds = 10;
function pollPositionInterval() {
    if (!updateLocation || !geoFindEnabled()) {
        return;
    }
    // interval position polling every half minute for browsers that are shit
    //console.trace();
    clearInterval(timers.pollPosition);
    timers.pollPosition = window.setInterval(function() {

        // if we recently got a new location via watchPosition(), don't query
        if (new Date().getTime() - lastCallLocationChange < pollPositionSeconds * 0.85 * 1000)
            return;

        if (tabHidden)
            return;

        console.log('pollPositionInterval: querying position');
        const geoposOptions = {
            enableHighAccuracy: false,
            timeout: pollPositionSeconds * 1000,
            maximumAge: pollPositionSeconds * 1000 ,
        };
        navigator.geolocation.getCurrentPosition(function(position) {
            onLocationChange(position);
        }, logArg, geoposOptions);
    }, pollPositionSeconds * 1000);
}

function watchPosition() {
    if (watchPositionId != null) {
        navigator.geolocation.clearWatch(watchPositionId);
    }
    if (!updateLocation || !geoFindEnabled()) {
        return;
    }
    const geoposOptions = {
        enableHighAccuracy: false,
        timeout: Infinity,
        maximumAge: 25 * 1000,
    };
    console.log("watching position");
    watchPositionId = navigator.geolocation.watchPosition(function(position) {
        onLocationChange(position);
        pollPositionSeconds = 60;
    }, logArg, geoposOptions);
    pollPositionInterval();
}

let geoFindInterval = null;
function geoFindMe() {
    //console.trace();

    g.geoFindDefer = jQuery.Deferred();
    function success(position) {
        SiteLat = DefaultCenterLat = position.coords.latitude;
        SiteLon = DefaultCenterLon = position.coords.longitude;
        if (loStore['geoFindMeFirstVisit'] != 'no' && !(usp.has("lat") && usp.has("lon"))) {
            mapa.setCenter([SiteLon, SiteLat]);
            loStore['geoFindMeFirstVisit'] = 'no';
        }

        initSitePos();
        console.log('Location from browser: '+ SiteLat +', ' + SiteLon);

        g.geoFindDefer.resolve();


        {
            // always update user location every 15 minutes
            clearInterval(geoFindInterval);
            geoFindInterval = window.setInterval(function() {
                if (tabHidden)
                    return;
                const geoposOptions = {
                    enableHighAccuracy: false,
                    timeout: 15 * 60 * 1000,
                    maximumAge: 5 * 60 * 1000 ,
                };
                console.log('geoFindInterval: querying position');
                navigator.geolocation.getCurrentPosition(onLocationChange, logArg, geoposOptions);
            }, 15 * 60 * 1000);
        }
    }

    function error() {
        console.log("Unable to query location.");
        initSitePos();
        g.geoFindDefer.reject();
    }

    if (!geoFindEnabled()) {
        //console.log('Geolocation is not enabled');
        initSitePos();
        g.geoFindDefer.reject();
    } else if (!navigator.geolocation) {
        console.log('Geolocation is not supported by your browser');
        initSitePos();
        g.geoFindDefer.reject();
    } else {
        // change SitePos on location change
        console.log('Locating…');
        const geoposOptions = {
            enableHighAccuracy: false,
            timeout: Infinity,
            maximumAge: 300 * 1000,
        };
        navigator.geolocation.getCurrentPosition(success, error, geoposOptions);
    }

    return g.geoFindDefer;
}

let initSitePosFirstRun = true;
function initSitePos() {
    // fall back to loStore position
    if (loStore['SiteLat'] != null && loStore['SiteLon'] != null && SiteLat == null && SiteLon == null) {
        SiteLat = CenterLat = DefaultCenterLat = parseFloat(loStore['SiteLat']);
        SiteLon = CenterLon = DefaultCenterLon = parseFloat(loStore['SiteLon']);
    }
    // Set SitePosition
    if (SiteLat != null && SiteLon != null) {
        SitePosition = [SiteLon, SiteLat];
        // Add home marker if requested
        drawSiteCircle();
        createLocationDot();
    } else {
        TAR.planeMan.setColumnVis('sitedist', false);
    }
    if (!SiteShow) TAR.planeMan.setColumnVis('sitedist', false);   // privacy: no distance column while the receiver location is hidden

    if (initSitePosFirstRun) {
        initSitePosFirstRun = false;
        const sortBy = usp.get('sortBy');
        if (sortBy == "nosort" ) {
            // no sorting
        } else if (sortBy) {
            TAR.planeMan.ascending = true;
            TAR.planeMan.cols[sortBy].sort();
            if (usp.has('sortByReverse')) {
                TAR.planeMan.cols[sortBy].sort();
            }
        } else if (loStore['sortCol']) {
            TAR.planeMan.sortAscending = Boolean(loStore['sortAscending']);
            TAR.planeMan.cols[loStore['sortCol']].sort();
        } else {
            if (SitePosition) {
                TAR.planeMan.cols.sitedist.sort();
            } else {
                TAR.planeMan.sortAscending = false;
                TAR.planeMan.cols.altitude.sort();
            }
        }
    }
}

/*
function drawAlt() {
    processAircraft({hex: 'c0ffee', });
    let plane = g.planes['c0ffee'];
    newWidth = 4;
    for (let i = 0; i <= 50000; i += 500) {
        plane.position = [i/10000, 0];
        plane.altitude = i;
        plane.alt_rounded = calcAltitudeRounded(plane.altitude);
        plane.updateTrack(now - i, now - i - 5000, { serverTrack: true });
    }
}
*/

function remakeTrails() {
    for (let i in g.planesOrdered) {
        const plane = g.planesOrdered[i];
        plane.removeTrail();
        plane.linesDrawn && (plane.drawLine = 1);
        plane.updateFeatures();
    }
}

function createLocationDot() {
     MLR.setLocation(SitePosition); return;
}
function drawSiteCircle() {
    //console.trace();
     MLR.drawSiteCircles(); return;
}

let calcOutlineLayer;
function drawUpintheair() {
    // Add terrain-limit rings. To enable this:
    //
    //  create a panorama for your receiver location on heywhatsthat.com
    //
    //  note the "view" value from the URL at the top of the panorama
    //    i.e. the XXXX in http://www.heywhatsthat.com/?view=XXXX
    //
    // fetch a json file from the API for the altitudes you want to see:
    //
    //  wget -O /usr/local/share/tar1090/html/upintheair.json \
    //    'http://www.heywhatsthat.com/api/upintheair.json?id=XXXX&refraction=0.25&alts=3048,9144'
    //
    // NB: altitudes are in _meters_, you can specify a list of altitudes
    //
    if (!calcOutlineData)
        return;
     MLR.setCalcOutline(calcOutlineData); return;
}

function drawOutlineJson() {
    let request = jQuery.ajax({ url: actualOutline.url,
        cache: false,
        timeout: actualOutline.refresh,
        dataType: 'json' });
    request.done(function(data) {
        actualOutline.features.clear();
        let points = [];
        if (data.multiRange) {
            points = data.multiRange
        } else if (data.actualRange && data.actualRange.last24h) {
            points[0] = data.actualRange.last24h.points;
        } else {
            points[0] = data.points;
        }
        if (!points[0] || !points[0].length)
            return;
        for (let p = 0; p < points.length; ++p) {
            let geom = null;
            let lastLon = null;
            for (let j = 0; j < points[p].length + 1; ++j) {
                const k = j % points[p].length;
                const lat = points[p][k][0];
                const lon = points[p][k][1];
                const proj = mapgeo.fromLonLat([lon, lat]);
                if (!geom || (lastLon && Math.abs(lon - lastLon) > 270)) {
                    geom = new mapgeo.LineString([proj]);
                    actualOutline.features.addFeature(new mapgeo.Feature(geom));
                } else {
                    geom.appendCoordinate(proj);
                }
                lastLon = lon;
            }
        }
    });

    request.fail(function() {
        // no rings available, do nothing
    });
}

function gotoTime(timestamp) {
    //console.log(`gotoTime(${timestamp}) animate: {${traceOpts.animate}}`);
    clearTimeout(traceOpts.showTimeout);
    if (timestamp) {
        traceOpts.showTime = timestamp;
        traceOpts.animate = false;
    }
    if (!traceOpts.animate) {
        legShift(0);
    } else {
        let marker = SelectedPlane.glMarker || SelectedPlane.marker;
        if (marker) {

            traceOpts.animatePos[0] += (traceOpts.animateToLon - traceOpts.animateFromLon) / traceOpts.animateSteps;
            traceOpts.animatePos[1] += (traceOpts.animateToLat - traceOpts.animateFromLat) / traceOpts.animateSteps;

            SelectedPlane.updateMarker();
        }
        if (--traceOpts.animateCounter == 1) {
            traceOpts.animate = false;
            traceOpts.showTime = traceOpts.showTimeEnd;
        }

        traceOpts.animateStepTime = traceOpts.animateRealtime / traceOpts.replaySpeed / traceOpts.animateSteps;
        clearTimeout(traceOpts.showTimeout);
        //console.log(`setTimeout(gotoTime, (${traceOpts.animateStepTime}))`);
        traceOpts.showTimeout = setTimeout(gotoTime, traceOpts.animateStepTime);
    }
}

function checkFollow() {
    if (!FollowSelected)
        return false;
    if (typeof MLR != 'undefined' && MLR.focusAnim)
        return true;                     // the select ease is moving the camera, that is not the user dragging
    if (!SelectedPlane || !SelectedPlane.position) {
        toggleFollow(false);
        return false;
    }
    const center = mapa.getCenterProj();
    let proj = (typeof MLR != 'undefined' && MLR.followProj && MLR.smoothActive()) ? MLR.followProj : SelectedPlane.proj;

    if (!proj) {
        return false;
    }

    if (Math.abs(center[0] - proj[0]) > 1 ||
        Math.abs(center[1] - proj[1]) > 1)
    {
        toggleFollow(false);
        return false;
    }
    return true;
}

function everySecond() {
    if (traceRate > 0)
        traceRate = traceRate  * 0.985 - 1;
    updateIconCache();

}

let getTraceTimeout = null;
function getTrace(newPlane, hex, options) {

    if (options.list) {
        newPlane = options.list.pop()
        if (!newPlane) {
            return;
        }
        hex = newPlane.icao;
    }

    if (!newPlane) {
        newPlane = g.planes[hex] || new PlaneObject(hex);
        newPlane.last_message_time = NaN;
        newPlane.position_time = NaN;
        select(newPlane, options);
    }

    let time = new Date().getTime();
    let backoff = 200;
    if (!showTrace && !solidT && traceRate > 140 && time < lastTraceGet + backoff) {
        clearTimeout(getTraceTimeout);
        getTraceTimeout = setTimeout(getTrace, lastTraceGet + backoff + 20 - time, newPlane, hex, options);
        return newPlane;
    }

    lastTraceGet = time;

    let URL1;
    let URL2;
    //console.log('Requesting trace: ' + hex);

    // use non historic traces until 60 min after midnight
    let today = new Date();
    let refDate = ((replay && !showTrace) ? replay.ts : traceDate) || today;

    if ((showTrace || replay) && !(today.getTime() > refDate.getTime() && today.getTime() < refDate.getTime() + (24 * 3600 + 60 * 60) * 1000)) {
        URL1 = null;
        URL2 = 'globe_history/' + zDateString(refDate).replace(/-/g, '/') + '/traces/' + hex.slice(-2) + '/trace_full_' + hex + '.json';
        traceRate += 3;
    } else {
        URL1 = 'data/traces/'+ hex.slice(-2) + '/trace_recent_' + hex + '.json';
        URL2 = 'data/traces/'+ hex.slice(-2) + '/trace_full_' + hex + '.json';
        traceRate += 2;
    }
    if (showTrace && trace_hist_only) {
        URL2 = 'globe_history/' + zDateString(refDate).replace(/-/g, '/') + '/traces/' + hex.slice(-2) + '/trace_full_' + hex + '.json';
    }

    traceOpts.follow = (options.follow == true);

    if (showTrace) {
        //console.log(today.toUTCString() + ' ' + traceDate.toUTCString());

        if (traceOpts.startHours == null || traceOpts.startHours < 0)
            traceOpts.startStamp = traceDate.getTime() / 1000;
        else
            traceOpts.startStamp = traceDate.getTime() / 1000 + traceOpts.startHours * 3600 + traceOpts.startMinutes * 60 + traceOpts.startSeconds;

        if (traceOpts.endHours == null || traceOpts.endHours >= 24)
            traceOpts.endStamp = traceDate.getTime() / 1000 + 24 * 3600;
        else
            traceOpts.endStamp = traceDate.getTime() / 1000 + traceOpts.endHours * 3600 + traceOpts.endMinutes * 60 + traceOpts.endSeconds;
    }

    if (newPlane && (showTrace || showTraceExit)) {
        newPlane.trace = [];
        newPlane.recentTrace = null;
        newPlane.fullTrace = null;
    }

    //console.log(URL2);

    //options = JSON.parse(JSON.stringify(options));
    options.plane = `${newPlane.icao}`;
    options.defer = jQuery.Deferred();

    if (URL1 && !options.onlyFull) {
        jQuery.ajax({ url: `${URL1}`,
            dataType: 'json',
            options: options,
        })
            .done(function(data) {
                const options = this.options;
                const plane = g.planes[options.plane];
                plane.recentTrace = normalizeTraceStamps(data);
                if (!showTrace) {
                    plane.processTrace();
                    if (options.follow)
                        toggleFollow(true);
                }
                options.defer.resolve(options);
                if (options.onlyRecent && options.list) {
                    newPlane.updateLines();
                    getTrace(null, null, options);
                }
                this.options = null;
            });
    } else {
        options.defer.resolve(options);
    }

    if (options.onlyRecent)
        return newPlane;

    jQuery.ajax({ url: `${URL2}`,
        dataType: 'json',
        options: options,
    })
        .done(function(data) {
        const options = this.options;
        const plane = g.planes[options.plane];
        plane.fullTrace = normalizeTraceStamps(data);
        options.defer.done(function(options) {
            const plane = g.planes[options.plane];
            if (showTrace) {
                legShift(0, plane);
                if (!multiSelect && showTraceTimestamp) {
                    gotoTime(showTraceTimestamp);
                }
            } else {
                plane.processTrace();
                if (options.follow)
                    toggleFollow(true);
            }
        });
        if (options.list) {
            newPlane.updateLines();
            getTrace(null, null, options);
        }
        options.defer = null;
        this.options = null;
    })
        .fail(function() {
        const options = this.options;
        const plane = g.planes[options.plane];
        if (showTrace)
            legShift(0, plane);
        else
            plane.processTrace();

        if (options.list) {
            getTrace(null, null, options);
        } else {
            plane.getAircraftData();
            refreshSelected();
        }
        this.options = null;
    });

    return newPlane;
}

function setSize(set) {
    let count = 0;
    for (const i in set.values())
        count++;
    return count;
}

function currentExtent(factor) {
    let size = mapa.getSize();
    if (factor != null)
        size = [size[0] * factor, size[1] * factor];
    return myExtent(mapa.calcExtent(size));
}

function replayDefaults(ts) {
    setReplayPlaying(true);
    let playing = true;
    let speed = 30;
    if (usp.has("replaySpeed")) {
        speed = usp.getFloat("replaySpeed");
    }
    if (speed == 0) {
        speed = 30;
        playing = false;
    }
    if (usp.has("replayPaused")) {
        playing = false;
    }
    return {
        playing: playing,
        ts: ts,
        ival: 60 * 1000,
        speed: speed,
        dateText: zDateString(ts),
        hours: ts.getUTCHours(),
        minutes: ts.getUTCMinutes(),
    };
}

function replayClear() {
    clearTimeout(refreshId);
    reaper(true);
    refreshFilter();
    replayPlanes = {};
}

function replayGetChunk(ts) {
    let time = new Date(ts);
    let sDate = sDateString(time);
    let index = 2 * time.getUTCHours() + Math.floor(time.getUTCMinutes() / 30);
    let key = `${sDate} chunk ${index}`;
    let url = "globe_history/" + sDate + "/heatmap/" + index.toString().padStart(2, '0') + ".bin.ttf";
    return { date: sDate, index: index, key: key, url: url, };
}

function loadReplay(ts) {
    if (isNaN(ts.getTime())) {
        ts = new Date();
    }
    let lastAvailable = new Date();
    lastAvailable.setUTCMinutes(Math.floor(lastAvailable.getUTCMinutes() / 30) * 30);
    lastAvailable.setUTCSeconds(0);
    lastAvailable = lastAvailable.getTime() - 10 * 1000;
    if (ts.getTime() > lastAvailable) {
        ts = new Date(lastAvailable);
        ts.setUTCMinutes(Math.floor(ts.getUTCMinutes() / 30) * 30 + 1);
        ts.setUTCSeconds(0);
        console.log('not available, using this time: ' + ts);
        replayClear();
    }

    replay.ts = ts;
    replaySetTimeHint();

    if (!g.replayCache) {
        g.replayCache = new ItemCache(onMobile ? 12 : 24);
    }

    let chunk = replayGetChunk(ts);

    let rKey = chunk.key;
    let data = g.replayCache.get(rKey);

    if (data) {
        initReplay(chunk, data);
    } else {
        if (rKey == replay.loadingKey) {
            // console.log('if (rKey == replay.loadingKey) {');
            // download already in progress, do nothing
            return;
        }
        if (replay.abortController) {
            replay.abortController.abort();
        }

        replay.loadingKey = rKey;

        jQuery('#replayLoading').text('Loading ...');

        replay.abortController = new AbortController();

        jQuery("#update_error").css('display','none');
        clearTimeout(replay.errorTimeout);

        const ff = () => {
            //console.log(`finally ${rKey}`);
            delete replay.loadingKey;
            jQuery('#replayLoading').text('');
        };

        const errorFunc = (error) => {
            ff();
            if (error.name == 'AbortError') {
                //console.log(`aborted: ${rKey}`);
                return;
            }
            SKYUI.toast('No data for this timestamp', {kind: 'warn'});
        };

        fetch(chunk.url, { signal: replay.abortController.signal })
            .then(
                (response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP error, status = ${response.status}`);
                    }
                    response.arrayBuffer()
                        .then((data) => {
                            delete replay.abortController;
                            g.replayCache.add(rKey, data);
                            initReplay(chunk, data);
                            //console.log(`loaded: ${rKey}`);
                            ff();
                        })
                        .catch(errorFunc)
                    ;
                },
                errorFunc
            )
            .catch( errorFunc )
        ;

    }
}
function initReplay(chunk, data) {
    if (data.byteLength % 16 != 0) {
        console.log("Invalid heatmap file (byteLength)");
        return;
    }

    replay.loadedKey = chunk.key;

    let points = new Int32Array(data);
    let pointsU = new Uint32Array(data);
    let pointsU8 = new Uint8Array(data);
    let found = 0;
    replay.slices = [];
    for (let i = 0; i < points.length; i += 4) {
        if (points[i] == 0xe7f7c9d) {
            found = 1;
            replay.slices.push(i);
        }
    }
    if (!found) {
        console.log("Invalid heatmap file (magic number)");
        replay.points = null;
        replay.pointsU = null;
        replay.pointsU8 = null;
        return;
    }
    replay.points = points;
    replay.pointsU = pointsU;
    replay.pointsU8 = pointsU8;

    refreshFilter();

    replay.ival = (replay.pointsU[replay.slices[0] + 3] & 65535) / 1000;
    replay.halfHour = (replay.ts.getUTCMinutes() >= 30) ? 1 : 0;
    let index = Math.round (((replay.ts.getUTCMinutes() % 30) * 60 + replay.ts.getUTCSeconds()) / replay.ival);
    //console.log("init with index" + replay.index);
    if (index > 0) {
        if (false && index > 1) {
            replay.index = 0
            replayStep("fast");
        }
        replay.index = index - 1;
        replayStep("fast");
    }
    replay.index = index;
    replayStep();
}

function setReplayTimeHint(date) {
    histUpdateReplay(date); // ui/history.js
}
function replayOnSliderMove() {
    clearTimeout(refreshId);

    let date = new Date(replay.dateText);
    date.setUTCHours(Number(replay.hours));
    date.setUTCMinutes(Number(replay.minutes));
    replay.seconds = 0;
    date.setUTCSeconds(Number(replay.seconds));

    setReplayTimeHint(date);
}
let replayJumpEnabled = true;
function replayJump() {
    if (!showingReplayBar)
        return;
    if (!replayJumpEnabled)
        return;
    let date = new Date(replay.dateText);
    date.setUTCHours(Number(replay.hours));
    date.setUTCMinutes(Number(replay.minutes));
    date.setUTCSeconds(Number(replay.seconds));

    let ts = new Date(replay.ts.getTime());

    // diff less 10 seconds
    if (Math.abs(date.getTime() - ts.getTime()) < 10000) {
        return;
    }
    //console.log(replay.minutes.toString() + ' ' + ts.toString() + ' ' + (date.getTime() - ts.getTime()).toString());

    //console.trace();
    console.log('jump: ' + date.toUTCString());

    replayClear();
    loadReplay(date);
}
function replaySetTimeHint(arg) {
    replayJumpEnabled = false;
    let dateString;
    let timeString;

    dateString = zDateString(replay.ts);
    timeString = zuluTime(replay.ts) + NBSP + 'Z';

    setReplayTimeHint(replay.ts);
    replayJumpEnabled = true;
}

function replayStep(arg) {
    if (!replay || showTrace) {
        return;
    }
    if (replay.loadedKey != replayGetChunk(replay.ts).key) {
        console.error('no data loaded for current timestamp, can\'t play!');
        return;
    }

    if (replay.playing) {
        clearTimeout(refreshId);
        refreshId = setTimeout(replayStep, replay.ival / replay.speed * 1000);
    }

    if (isNaN(replay.ts.getTime())) {
        loadReplay(new Date());
        return;
    }
    let index = replay.index;
    if (index >= replay.slices.length) {
        console.log('next half hour');
        let date = new Date(replay.ts.getTime() + 30 * 60 * 1000);
        date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 30) * 30);
        date.setUTCSeconds(0);
        clearTimeout(refreshId);
        loadReplay(date);
        return;
    }

    let minutes = replay.halfHour * 30 + Math.floor(replay.ival * index / 60);
    let seconds = (replay.ival * index) % 60;
    //console.log(minutes.toString() + ' ' + seconds.toString());
    replay.ts.setUTCMinutes(minutes)
    replay.ts.setUTCSeconds(seconds)

    replay.hours = replay.ts.getUTCHours();
    replay.minutes = minutes;
    replay.seconds = seconds;

    let points = replay.points;
    let pointsU = replay.pointsU;
    let i = replay.slices[index];

    //console.log('index: ' + index + ', i: ' + i);

    last = now;
    now = replay.pointsU[i + 2] / 1000 + replay.pointsU[i + 1] * 4294967.296;
    g.now = now;

    traceOpts.endStamp = now + replay.ival;

    replay.ival = (replay.pointsU[i + 3] & 65535) / 1000;

    if (arg != 'fast') {
        replaySetTimeHint();
        if (replay.addressMinutes != replay.minutes) {
            replay.addressMinutes = replay.minutes;
            updateAddressBar();
        }
        //console.log(replay.ts.toUTCString());
        if (now - lastReap > 60) {
            reaper();
        }
    }

    i += 4;

    let ext;
    if (g.zoomLvl > 10) {
        ext = currentExtent(1.6);
    } else if (g.zoomLvl > 8) {
        ext = currentExtent(1.2);
    } else {
        ext = currentExtent(1.1);
    }
    ext.maxLat *= 1e6;
    ext.maxLon *= 1e6;
    ext.minLat *= 1e6;
    ext.minLon *= 1e6;
    for (; i < points.length && points[i] != 0xe7f7c9d; i += 4) {
        let lat = points[i + 1];
        let lon = points[i + 2];
        let pos = [lon, lat];
        if (lat >= 1073741824) {
            let hex = (points[i] & ((1<<24) - 1)).toString(16).padStart(6, '0');
            hex = (points[i] & (1<<24)) ? ('~' + hex) : hex;
            let ac = {hex:hex, seen:0, seen_pos:0,};
            if (replay.pointsU8[4 * (i + 2)] != 0) {
                ac.flight = "";
                for (let j = 0; j < 8; j++) {
                    ac.flight += String.fromCharCode(replay.pointsU8[4 * (i + 2) + j]);
                }
            }
            ac.squawk = (lat & 0xFFFF).toString(10).padStart(4, '0');
            if (!g.planes[hex]) {
                replayPlanes[hex] = ac;
                continue;
            }
            processAircraft(ac, false, false);
            continue;
        }
        if (!inView(pos, ext)) {
            continue;
        }

        lat /= 1e6;
        lon /= 1e6;
        pos = [lon, lat];

        let type = (pointsU[i] >> 27) & 0x1F;
        switch (type) {
            case  0: type = 'adsb_icao';        break;
            case  1: type = 'adsb_icao_nt';     break;
            case  2: type = 'adsr_icao';        break;
            case  3: type = 'tisb_icao';        break;
            case  4: type = 'adsc';             break;
            case  5: type = 'mlat';             break;
            case  6: type = 'other';            break;
            case  7: type = 'mode_s';           break;
            case  8: type = 'adsb_other';       break;
            case  9: type = 'adsr_other';       break;
            case 10: type = 'tisb_trackfile';   break;
            case 11: type = 'tisb_other';       break;
            case 12: type = 'mode_ac';          break;
            default: type = 'unknown';
        }
        let hex = (pointsU[i] & 0xFFFFFF).toString(16).padStart(6, '0');
        hex = (pointsU[i] & 0x1000000) ? ('~' + hex) : hex;

        if (icaoFilter && !icaoFilter.includes(hex))
            continue;

        let alt = points[i + 3] & 65535;
        if (alt & 32768)
            alt |= -65536;
        if (alt == -123)
            alt = 'ground';
        else if (alt == -124)
            alt = null;
        else
            alt *= 25;

        let gs = points[i + 3] >> 16;
        if (gs == -1)
            gs = null;
        else
            gs /= 10;

        let ac = {
            seen: 0,
            seen_pos: 0,
        };

        if (!g.planes[hex]) {
            const cached = replayPlanes[hex];
            if (cached) {
                ac = cached;
                //delete replayPlanes[hex];
            }
        }

        ac.hex = hex;
        ac.lat = lat;
        ac.lon = lon;
        ac.alt_baro = alt;
        ac.gs = gs;
        ac.type = type;

        processAircraft(ac, false, false);
    }

    if (arg != "fast") {
        triggerRefresh = 1;
        checkMovement();
        checkRefresh();
    }
    replay.index = index + 1;
}

function updateIconCache() {
    let item;
    let tryAgain = [];
    while(item = addToIconCache.pop()) {
        let svgKey = item[0];
        let element = item[1];
        if (iconCache[svgKey] != undefined) {
            continue;
        }
        if (!element) {
            element = new Image();
            element.src = item[2];
            item[1] = element;
            tryAgain.push(item);
            continue;
        }
        if (!element.complete) {
            console.log("moep");
            tryAgain.push(item);
            continue;
        }

        iconCache[svgKey] = element;
    }
    addToIconCache = tryAgain;
}

function getInactive() {
    return (new Date().getTime() - lastActive) / 1000;
}

function active() {
    lastActive = new Date().getTime();
}

function updateMessageRate(data) {
    if (data.messageRate && data.messageRate > 0) {
        MessageRate = data.messageRate;
    } else if (data.messages && data.messages > 1) {
        // Detect stats reset
        if (MessageCountHistory.length > 0 && MessageCountHistory[MessageCountHistory.length-1].messages > data.messages) {
            MessageCountHistory = [];
        }

        // Note the message count in the history
        MessageCountHistory.push({ 'time' : data.now, 'messages' : data.messages});

        if (MessageCountHistory.length > 1) {
            // .. and clean up any old values
            while ((now - MessageCountHistory[0].time) > 10.5) {
                MessageCountHistory.shift();
            }
            let message_time_delta = MessageCountHistory[MessageCountHistory.length-1].time - MessageCountHistory[0].time;
            let message_count_delta = MessageCountHistory[MessageCountHistory.length-1].messages - MessageCountHistory[0].messages;
            if (message_time_delta > 0) {
                MessageRate = message_count_delta / message_time_delta;
            }
            //console.log(message_time_delta);
        }

    } else if (uuid != null && data.messages == 1) {
        const cache = uuidCache[data.urlIndex] || { now: 0 };
        let time_delta = now - cache.now;
        if (time_delta > 0.5) {
            let newCache = uuidCache[data.urlIndex] = { now: now };
            let message_delta = 0;
            let acs = data.aircraft;
            for (let j=0; j < acs.length; j++) {
                const hex = acs[j].hex;
                const messages = acs[j].messages
                let cachedMessages = cache[hex];
                if (cachedMessages) {
                    message_delta += (messages - cachedMessages);
                }
                newCache[hex] = messages;
            }
            newCache.rate = message_delta / time_delta;
        }
        MessageRate = 0;
        for (let i in uuidCache) {
            const c = uuidCache[i];
            MessageRate += c ? c.rate : 0;
        }
    } else {
        MessageRate = null;
    }
}
function playReplay(state){
    if (!replay){
        return;
    }
    if (state) {
        if (replay.loadedKey != replayGetChunk(replay.ts).key) {
            console.error('no data loaded for current timestamp, can\'t play!');
            return;
        }
        replay.playing = true;
        setReplayPlaying(true);
        replayStep();
    } else {
        replay.playing = false;
        setReplayPlaying(false);
        clearTimeout(refreshId);
    }
};

function showReplayBar(){
    console.log('showReplayBar()');
    showingReplayBar = !showingReplayBar;
    if (!showingReplayBar){
        jQuery("#replayBar").hide();
        clearTimeout(refreshId);
        replay = null;
        jQuery("#selected_showTrace_hide").show();
        fetchData({force: true});
    } else {
        // Skywatch ADS-B: the bar floats over the map (ui/history.js, ui/history.css)
        jQuery("#replayBar").css('display', 'flex');
        if (!replay) {
            replay = replayDefaults(new Date());
        }
        histInitReplay();
        setReplayPlaying(replay.playing);
        jQuery("#selected_showTrace_hide").hide();

        loadReplay(replay.ts);
    }

    updateAddressBar();
};

function timeoutFetch() {
    console.log("timeoutFetch " + localTime(new Date()));
    fetchData();
    if (timers.timeoutFetch) {
        clearTimeout(timers.checkMove);
    }
    timers.timeoutFetch = setTimeout(timeoutFetch, Math.max(RefreshInterval, 10000));
    if (now - lastReap > 120) {
        reaper();
    }
}

function refreshHistory() {
    if (heatmap || replay || globeIndex || pTracks || uuid || !HistoryChunks) {
        noLongerHidden();
        return;
    }

    if (1 && (new Date().getTime() - g.hideStamp) / 1000 < 5) {
        console.log('short tab change, not loading history');
        noLongerHidden();
        return;
    }

    jQuery("#loader_progress").attr('value', 0);

    setTimeout(() => {
        if (!timersActive) {
            jQuery("#loader").show();
        }
    }, 200);

    chunksDefer().done(function(data) {
        console.log(localTime(new Date()) + ' tab change, loading history');
        g.refreshHistory = true;
        HistoryChunks = true;
        chunkNames = [];
        jQuery("#loader_progress").attr('value', 1);
        try {
            for (let i = data.chunks.length-1; i >= 0; i--) {
                let f = data.chunks[i];
                chunkNames.push(f);

                // break after we found a chunk that's older than now
                // chunk timestamp is the start of its data, not the end
                // so we need to include the first chunk that's older
                // which is done above

                let parts = f.split(".")[0].split("_");
                if (parts[0] == "chunk") {
                    if (now > parts[1]/1e3) {
                        break;
                    }
                }
            }
            //console.log(chunkNames);
            nHistoryItems = chunkNames.length;
            get_history();
            push_history();
        } catch (e) {
            console.error(e);
            noLongerHidden();
        }
    }).fail(function() {
        setTimeout(refreshHistory, 500);
    });
}


function handleVisibilityChange() {
    const prevHidden = tabHidden;
    if (document[hideName])
        tabHidden = true;
    else
        tabHidden = false;

    if (tabHidden && timersActive) {
        g.hideStamp = new Date().getTime();
        clearIntervalTimers();
        if (!globeIndex) {
            //timeoutFetch();
        }

        replay_was_active = replay.playing;
        if (replay.playing) {
            playReplay(false);
        }
    }

    // tab is no longer hidden
    if (!tabHidden && !timersActive) {
        loadFinished && jQuery("#timers_paused").css('display','none');
        globeRateUpdate();
        if (heatmap || replay || globeIndex || pTracks) {
            noLongerHidden();
        } else {
            refreshHistory();
        }
    }
}

function noLongerHidden() {
    active();
    setIntervalTimers();

    jQuery("#loader").hide();

    refresh();

    if (replay_was_active) {
        playReplay(true);
    }

    if (showTrace)
        return;
    if (heatmap)
        return;

    if (!haveTraces)
        return;

    let count = 0;
    if (multiSelect && !SelectedAllPlanes) {
        for (let i = 0; i < g.planesOrdered.length; ++i) {
            let plane = g.planesOrdered[i];
            if (plane.selected) {
                getTrace(plane, plane.icao, {});
                if (count++ > 20)
                    break;
            }
        }
    } else if (SelectedPlane) {
        getTrace(SelectedPlane, SelectedPlane.icao, {});
    }
}

let hideName;
function initVisibilityChange() {
    // Set the name of the hidden property and the change event for visibility
    let visibilityChange;
    if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
        hideName = "hidden";
        visibilityChange = "visibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        hideName = "msHidden";
        visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        hideName = "webkitHidden";
        visibilityChange = "webkitvisibilitychange";
    }
    // Warn if the browser doesn't support addEventListener or the Page Visibility API
    if (typeof document.addEventListener === "undefined" || hideName === undefined) {
        console.log("hidden tab handler requires a browser that supports the Page Visibility API.");
    } else {
        // Handle page visibility change
        document.addEventListener(visibilityChange, handleVisibilityChange, false);
    }
    handleVisibilityChange();
}
// for debugging visibilitychange:
function testHide() {
    Object.defineProperty(window.document,'hidden',{get:function(){return true;},configurable:true});
    Object.defineProperty(window.document,'visibilityState',{get:function(){return 'hidden';},configurable:true});
    window.document.dispatchEvent(new Event('visibilitychange'));
}
function testUnhide() {
    Object.defineProperty(window.document,'hidden',{get:function(){return false;},configurable:true});
    Object.defineProperty(window.document,'visibilityState',{get:function(){return 'visible';},configurable:true});
    window.document.dispatchEvent(new Event('visibilitychange'));
}

function autoSelectClosest() {
    if (!loadFinished)
        return;
    let closest = null;
    let closestDistance = null;
    checkMovement();
    for (let key in g.planesOrdered) {
        const plane = g.planesOrdered[key];
        if (!plane.visible)
            continue;
        if (!closest)
            closest = plane;
        if (plane.position == null || plane.seen_pos > 20)
            continue;
        let refLoc = [CenterLon, CenterLat];
        if (autoselectCoords && autoselectCoords.length == 2) {
            refLoc = [ autoselectCoords[1], autoselectCoords[0] ];
        }
        const dist = mapgeo.getDistance(refLoc, plane.position);
        if (dist == null || isNaN(dist))
            continue;
        if (closestDistance == null || dist < closestDistance) {
            closestDistance = dist;
            closest = plane;
        }
    }
    if (!closest)
        return;
    selectPlaneByHex(closest.icao, {noDeselect: true, follow: FollowSelected,});
}
function setAutoselect() {
    clearInterval(timers.autoselect);
    if (!autoselect)
        return;
    timers.autoselect = window.setInterval(autoSelectClosest, 5000);
    autoSelectClosest();
}
function registrationLink(plane) {
    if (registrationLinkTemplate) {
        const values = { REGISTRATION: plane.registration, ICAO: plane.icao, TYPE: plane.icaoType || '' };
        return registrationLinkTemplate.replace(/REGISTRATION|ICAO|TYPE/g, (m) => encodeURIComponent(values[m]));
    }

    const countryLinks = {
        Brazil: (reg) => `https://aeronaves.anac.gov.br/aeronaves/cons_rab_resposta_en.asp?textMarca=${reg}`,
        // CASA only lists VH- regs (not RAAus 24-xxxx or ADF A56-xxx)
        Australia: (reg) => reg.startsWith('VH-') ? `https://www.casa.gov.au/search-centre/aircraft-register?reg=${reg.slice(3)}` : '',
        Jamaica: (reg) => `https://www.jcaa.gov.jm/aircraft-registry/${reg}`,
        Montenegro: (reg) => `https://www.caa.me/en/registri?field_registarska_oznaka1_value=${reg}`,
        Norway: (reg) => `https://www.luftfartstilsynet.no/aktorer/norges-luftfartoyregister/registrerte-luftfartoy/?mark=${reg}`,
        Iceland: (reg) => `https://island.is/en/aircraft-registry?aq=${reg.replace(/^TF-/, '')}`,
        "New Zealand": (reg) => `https://www.aviation.govt.nz/aircraft/aircraft-registration/aircraft-register-search/ShowDetails/${reg.replace(/^ZK-/, '')}`,
        "United States": (reg) => `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${reg.slice(1)}`
    };

    const generator = countryLinks[plane.country];
    return generator ? generator(plane.registration) : '';
}


//simple jquery plugin to only update the text when it changes
jQuery.fn.updateText = function (text) {
    this.text() !== String(text) && this.text(text);
}

function zeroPad(num, size) {
    var s = num + "";
    while (s.length < size) s = "0" + s;
    return s;
}

// Converts "hiccup"-style structures (https://github.com/weavejester/hiccup)
// to XML.
function hiccup(node) {
    if (Array.isArray(node)) {
        const [tag, attribs, ...children] = node;
        let attribStrings = [];
        for (const prop in attribs) {
            if (!attribs.hasOwnProperty(prop) || attribs[prop] === undefined) {
                continue;
            }
            attribStrings.push(`${prop}="${attribs[prop]}"`);
        }
        let xml = `<${tag} ${attribStrings.join(' ')}>`;
        for (const child of children) {
            xml += hiccup(child);
        }
        xml += `</${tag}>\n`;
        return xml;
    } else {
        return '' + node;
    }
}

// Prompts a browser to download a data: URL.
function download(name, contentType, data) {
    var link = document.createElement("a");
    link.download = name;
    link.href = 'data:' + contentType + ',' + encodeURIComponent(data);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function baseExportFilenameForAircrafts(aircrafts) {
    return aircrafts.map((a) => (a.registration || a.icao).toUpperCase()).join('-');
}

// Returns an array of {pos, alt, ts} for an aircraft.
function coordsForExport(plane) {
    let coords = [];
    let numSegs = plane.track_linesegs.length;
    let segs = plane.track_linesegs;
    let runningAverage = 0;
    let lastTimestamp = 0;
    let delta;
    //console.log(kmlStyle);
    if (kmlStyle == 'geom_avg') {
        //console.log('averaging');
        const avgWindow = 8;
        for (let i = 0; i < numSegs; i++) {
            const seg = segs[i];
            const geom = seg.alt_geom;
            const baro = seg.alt_real;
            let geomOffset = null;
            if (!seg.ground && baro != null && geom != null) {
                seg.geomOffset = geom - baro;
                delta = (seg.geomOffset - runningAverage);
                if (delta <= 50) {
                    runningAverage += delta * Math.min(1, (seg.ts - lastTimestamp) / avgWindow);
                } else {
                    runningAverage = seg.geomOffset;
                }
                seg.geomOffAverage = runningAverage;
                lastTimestamp = seg.ts;
            }
        }
        lastTimestamp = 1e12;
        for (let i = numSegs - 1; i >= 0; i--) {
            const seg = segs[i];
            const geom = seg.alt_geom;
            const baro = seg.alt_real;
            let geomOffset = null;
            if (seg.geomOffset != null) {
                delta = (seg.geomOffset - runningAverage);
                if (delta <= 50) {
                    runningAverage += delta * Math.min(1, (lastTimestamp - seg.ts) / avgWindow);
                } else {
                    runningAverage = seg.geomOffset;
                }
                //console.log(seg.geomOffAverage + ' ' + runningAverage);
                seg.geomOffAverage = (seg.geomOffAverage + runningAverage) / 2;
                lastTimestamp = seg.ts;
            }
        }
    }
    for (let i = 0; i < numSegs; i++) {
        const seg = segs[i];
        const pos = seg.position;
        if (pos) {
            let alt = null;
            const baro = seg.alt_real;
            const geom = seg.alt_geom;
            const geomOffAverage = seg.geomOffAverage;
            let using_baro = false;
            if (kmlStyle == 'geom_avg' && geomOffAverage != null) {
                const betterGeom = baro + geomOffAverage;
                alt = Math.round(betterGeom * 0.3048); // convert ft to m
            } else if (kmlStyle != 'baro' && geom != null) {
                alt = Math.round(geom * 0.3048); // convert ft to m
            } else if (kmlStyle == 'baro' && baro != null && baro != 'ground') {
                alt = Math.round(baro * 0.3048);
                using_baro = true;
            }
            if (seg.ground) {
                alt = "ground";
            } else if (alt != null && egmLoaded && !using_baro) {
                // alt is in meters at this point
                alt = Math.round(egm96.ellipsoidToEgm96(pos[1], pos[0], alt));
            }

            const ts = new Date(seg.ts * 1000.0);
            if (alt == null) {
                console.log(`Skipping, no altitude: ${i} ${pos} ${ts}`);
                continue;
            }
            //console.log(`exporting coord: ${i} ${pos} ${alt} ${ts}`);
            coords.push({ pos: pos, alt: alt, ts: ts});
        } else {
            console.log(`Skipping ${i}`);
        }
    }
    return coords;
}

// We use this to give each aircraft a different color track in a
// multi-select export scenario. From colorbrewer, but I moved the red
// to be first.
const EXPORT_RGB_COLORS = [
    'e31a1c',
    'a6cee3',
    '1f78b4',
    'b2df8a',
    '33a02c',
    'fb9a99',
    'fdbf6f',
    'ff7f00',
    'cab2d6',
    '6a3d9a',
    'ffff99',
    'b15928'
];

// Converts "rrggbb" colors to KML format, "aabbggrr".
let RGBColorToKMLColor = function(c) {
    return 'ff' + c.substring(4, 6) + c.substring(2, 4) + c.substring(0, 2);
}

// Returns an array of selected planes, ordered by registration-or-ICAO.
function selectedPlanes() {
    const planes = [];
    for (let key in SelPlanes) {
        let plane = SelPlanes[key];
        if (plane.selected) {
            planes.push(plane);
        }
    }
    planes.sort((a, b) => {
        const keyA = (a.registration || a.icao).toUpperCase();
        const keyB = (b.registration || b.icao).toUpperCase();
        if (keyA < keyB) return -1;
        if (keyA > keyB) return 1;
        return 0;
    });
    return planes;
}

// Exports currently selected aircraft as KML.

let egmScript = null;
let egmLoaded = false;
function loadEGM() {
    if (egmScript) {
        return null;
    }
    egmScript = document.createElement('script');
    egmScript.src = "libs/egm96-universal-1.1.0.min.js";
    egmScript.addEventListener('load', function() {
        egmLoaded = true;
    });
    document.body.appendChild(egmScript);
    return egmScript;
}
function adjust_geom_alt(alt, pos) {
    if (geomUseEGM && egmLoaded) {
        if (alt == null || pos == null) {
            return alt;
        }
        return egm96.ellipsoidToEgm96(pos[1], pos[0], alt * 0.3048) / 0.3048;
    } else {
        return alt;
    }
}
let kmlStyle = '';
function exportKML(altStyle) {
    if (altStyle) {
        kmlStyle = altStyle;
    }
    if (!egmLoaded) {
        let egm = loadEGM();
        if (egm) {
            egm.addEventListener('load', function() {
                exportKML();
            });
        }
        return;
    }

    const planes = selectedPlanes();
    const folders = [];
    for (let planeIndex = 0; planeIndex < planes.length; planeIndex++) {
        const plane = planes[planeIndex];
        let folder = ["Folder", {},
            ["name", {}, `${(plane.registration || plane.icao).toUpperCase()} track`]
        ];
        const coords = coordsForExport(plane);
        let sections = [];
        let currentSection = null;
        let lastGround = null;
        let lastC = null;
        for (let i in coords) {
            const c = coords[i];
            const ground = (c.alt == "ground");
            if (ground !== lastGround) {
                // when changing between airborne and ground, create new section
                if (lastC && currentSection) {
                    // double up last coordinate to work around strange google earth transparency
                    currentSection.coords.push(lastC);
                }
                currentSection = { ground: ground, coords: [] };
                sections.push(currentSection);
            }
            lastGround = ground;
            if (ground) {
                c.alt = 0; // set KML altitude to zero
            }
            currentSection.coords.push(c);
            lastC = c;
        }
        if (lastC && currentSection) {
            // double up last coordinate to work around strange google earth transparency
            currentSection.coords.push(lastC);
        }
        for (let i in sections) {
            console.log("section " + i);
            const s = sections[i];
            const coords = s.coords;
            const ground = s.ground;
            const whenObjs = coords.map((c) => {
                const date = `${c.ts.getUTCFullYear()}-${zeroPad(c.ts.getUTCMonth() + 1, 2)}-${zeroPad(c.ts.getUTCDate(), 2)}`;
                const time = `T${zeroPad(c.ts.getUTCHours(), 2)}:${zeroPad(c.ts.getUTCMinutes(), 2)}:${zeroPad(c.ts.getUTCSeconds(), 2)}.${zeroPad(c.ts.getUTCMilliseconds(), 3)}Z`;
                return ["when", {}, date + time];
            });
            const coordObjs = coords.map((c) => {
                return ["gx:coord", {}, `${c.pos[0]} ${c.pos[1]} ${c.alt}`];
            });
            // splice together the xml track with / without altitude mode
            // clamptoground is google earth default while other programs error on having that option set specifically
            // so let google earth default to clamp to ground for ground track
            let xmlTrack = ["gx:Track", {}];
            if (!ground) {
                xmlTrack.push(["altitudeMode", {}, "absolute"]);
            }
            xmlTrack = xmlTrack.concat([
                ["extrude", {}, ground ? "0" : "1"],
                ...whenObjs,
                ...coordObjs
            ]);
            folder.push(
                ["Placemark", {},
                    ["name", {}, (plane.registration || plane.icao).toUpperCase()],
                    ["Style", {},
                        ["LineStyle", {},
                            ["color", {}, RGBColorToKMLColor(EXPORT_RGB_COLORS[planeIndex % EXPORT_RGB_COLORS.length])],
                            ["width", {}, 4]
                        ],
                        ["IconStyle", {},
                            ["Icon", {},
                                ["href", {}, "http://maps.google.com/mapfiles/kml/shapes/airports.png"]
                            ]
                        ]
                    ],
                    xmlTrack
                ]
            );
        }
        folders.push(folder);
    }
    const filename = baseExportFilenameForAircrafts(planes);
    const prologue = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const xmlObj = ["kml", {
        "xmlns": "http://www.opengis.net/kml/2.2",
        "xmlns:gx": "http://www.google.com/kml/ext/2.2"
    },
        ["Folder", {},
            ...folders
        ]
    ];
    const xml = prologue + hiccup(xmlObj);
    let styleName = '';
    if (kmlStyle == 'geom') { styleName = 'EGM96'; };
    if (kmlStyle == 'geom_avg') { styleName = 'EGM96_avg'; };
    if (kmlStyle == 'baro') { styleName = 'press_alt_uncorrected'; };
    //console.log(kmlStyle + ' ' + styleName);
    download(
        filename + '-track-' + styleName + '.kml',
        'application/vnd.google-earth.kml+xml',
        xml);
}

function deleteTraces() {
    for (let i in g.planesOrdered) {
        let plane = g.planesOrdered[i];
        delete plane.recentTrace;
        delete plane.fullTrace;
    }
}

function setPictureVisibility() {
    showPictures = planespottersAPI || planespottingAPI;
    if (showPictures) {
        jQuery('#photo_container').removeClass('hidden');
    } else {
        jQuery('#photo_container').addClass('hidden');
    }
    if (planespottersLinks && !showPictures) {
        jQuery('#photoLinkRow').removeClass('hidden');
    } else {
        jQuery('#photoLinkRow').addClass('hidden');
    }
}

// just an idea, unused
let infoBits = {
    type: {
        head: 'Type:',
        title: '4 character ICAO type code (i.e.: A320,B738,G550)',
        value: function(plane) { return plane.icaoType || 'n/a'; },
    },
};

function geoFindEnabled() {
    return (!disableGeoLocation && !SiteOverride && (globeIndex || uuid || askLocation) && (window && window.location && window.location.protocol == 'https:'));
}

function _printTrace(trace) {
    for (let i = 0; i < trace.length; i++) {
        const state = trace[i];
        const timestamp = state[0];
        let stale = state[6] & 1;
        const leg_marker = state[6] & 2;
        console.log(zuluTime(new Date(timestamp * 1000)) + ' ' + (state[1] + ',' + state[2]).padStart(26, ' ')  + ' ' + String(state[3]).padStart(6, ' ') + ' ' + state[6]);
    }
}

function printTrace() {
    console.log('full trace');
    _printTrace(SelectedPlane.fullTrace.trace);
    console.log('recent trace');
    _printTrace(SelectedPlane.recentTrace.trace);
}

function copyShareLink() {
    navigator.clipboard.writeText(shareLink);
    copyLinkTime = Date.now();
    if (SelectedPlane) ibRender(SelectedPlane);
}

let copyLinkTime = 0;

function mapTypeSettings() {
    if (MapType_tar1090.startsWith('maptiler_sat') || MapType_tar1090.startsWith('maptiler_hybrid')) {
        layerDimFactor = 0.25;
    } else if (MapType_tar1090 == 'esri') {
        layerDimFactor = 0.5;
    } else if (MapType_tar1090 == 'gibs') {
        layerDimFactor = 0.5;
    } else if (MapType_tar1090.startsWith('carto_raster')) {
        layerDimFactor = 0.70;
        layerExtraContrast = 0.6;
    } else if (MapType_tar1090.startsWith('carto_light')) {
        layerDimFactor = 0.80;
        layerExtraContrast = 0.2;
    } else if (MapType_tar1090.startsWith('carto_dark')) {
        layerDimFactor = 0.25;
        layerExtraContrast = 0.05;
    } else {
        layerDimFactor = 1;
        layerExtraContrast = 0;
    }
}

function getViewOversize(factor) {
    factor || (factor = 1);
    let mapSize = mapa.getSize();
    let size = [mapSize[0] * factor, mapSize[1] * factor];
    return myExtent(mapa.calcExtent(size));
}

function getRenderExtent(extra) {
    extra || (extra = 0);
    const mapSize = mapa.getSize();
    const over = renderBuffer + extra;
    const size = [mapSize[0] + over, mapSize[1] + over];
    return myExtent(mapa.calcExtent(size));
}

function requestBoxString() {
    if (!mapIsVisible && lastRequestBox) {
        return lastRequestBox;
    }
    let extent = getRenderExtent(80);
    let minLon = extent.minLon.toFixed(6);
    let maxLon = extent.maxLon.toFixed(6);
    if (Math.abs(extent.extent[2] - extent.extent[0]) > 40075016) { // all longtitudes in view
        minLon = -180, maxLon = 180;
    }
    return `${extent.minLat.toFixed(6)},${extent.maxLat.toFixed(6)},${minLon},${maxLon}`;
}

if (aggregator && window.location.hostname.startsWith('inaccurate')) {
    jQuery('#inaccurate_warning').removeClass('hidden');
    document.getElementById('inaccurate_warning').innerHTML = `
<br>
This map includes inaccurate / very approximate positions, errors of 200 nmi or more are not unusual.
<br>
If no ADS-B / MLAT info is available but at least 1 receiver is receiving ModeS data from a hex, the aircraft is placed where the receiving station on average receives planes which do have a location.
<br>
Please add a disclaimer to any screenshots of this website or better yet just report that an aircraft was spotted in the approximate area WITHOUT using screenshots.
<br>
<br>
        `;

}

function getn(n) {
    limitUpdates=n; RefreshInterval=0; fetchCalls=0;
}

function onAltimeterSetStandard(e) {
    e.preventDefault();
    jQuery("#altimeter_input").val(1013.25);
    onAltimeterChange(e);
}
function onAltimeterSetSelected(e) {
    e.preventDefault();
    if (!SelectedPlane || !SelectedPlane.nav_qnh) {
        return;
    }
    jQuery("#altimeter_input").val(SelectedPlane.nav_qnh);
    onAltimeterChange(e);
}
function onAltimeterChange(e) {
    e.preventDefault();
    jQuery("#altimeter_input").blur();
    let altimeter = parseFloat(jQuery("#altimeter_input").val().trim());

    if (altimeter < 100) {
        // assume inHg, convert to mbar
        baroCorrectQNH = 33.8639 * altimeter;
    } else {
        // assume mbar / hPa
        baroCorrectQNH = altimeter;
    }

    remakeTrails();
    refreshSelected();
    refreshFeatures();
    TAR.planeMan.redraw();
    refresh();
}

// Using formula from: https://www.weather.gov/media/epz/wxcalc/pressureAltitude.pdf
// See also: https://en.wikipedia.org/wiki/Pressure_altitude
// Inverse equation on wikipedia seems imprecise,
// used the the weather.gov pdf and inverted the equation myself
// This uses ISA atmosphere (should be the same as altimeters in planes)
function adjust_baro_alt(alt) {
    if (!baroUseQNH || alt == null || alt == "ground") {
        return alt;
    }
    let station_pressure = Math.pow(1 - alt / 145366.45, 5.2553026) * 1013.25;

    let res = ( 1 - Math.pow(station_pressure / baroCorrectQNH, 0.190284) ) * 145366.45;
    return res;
}

function globeRateUpdate() {
    if (aggregator) {
        dynGlobeRate = true;
        if (0) {
            const cookieExp = getCookie('asdf_id').split('_')[0];
            const ts = new Date().getTime();
            if (!cookieExp || cookieExp < ts + 3600*1000)
                setCookie('adsbx_sid', ((ts + 2*86400*1000) + '_' + Math.random().toString(36).substring(2, 15)), 2);
        }
    }
    if (dynGlobeRate) {
        return jQuery.ajax({url:'/globeRates.json', cache: false, dataType: 'json', }).done(function(data) {
            if (data.simload != null)
                globeSimLoad = data.simload;
            if (data.refresh != null && globeIndex)
                RefreshInterval = data.refresh;
        });
    } else {
        return jQuery.Deferred().resolve();
    }
}
globeRateUpdate();



parseURLIcaos();
initialize();
