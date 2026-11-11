#!/bin/bash
# ONE command that runs every check on the exact working tree and exits non-zero if any fails. Every push comes from a full run of this script.
#   tools/run-checks.sh            full run (deploys the tree first, verifies the served files are the tree's files, then runs everything)
#   tools/run-checks.sh --only RE  only checks whose name matches the regex (for iterating; a push needs the full run)
# Needs: docker (node:22-slim for syntax, unit tests and the CDP driver), chromium-browser (headless, software GL), the local deploy at SITE_URL.
# Logs: $LOGDIR/<check>.log (default .private/checks). The summary is printed last and written to $LOGDIR/summary.txt.
cd "$(dirname "$0")/.." || exit 2
SITE_URL=${SITE_URL:-http://127.0.0.1:8096}
LOGDIR=${LOGDIR:-.private/checks}; mkdir -p "$LOGDIR"; rm -f "$LOGDIR"/*.log "$LOGDIR"/summary.txt
ONLY=""; [ "$1" = "--only" ] && ONLY="$2"
NODE=(docker run --rm -v "$PWD":/w:ro -w /w node:22-slim)
NODEHOST=(docker run --rm --user "$(id -u):$(id -g)" --network host -v "$PWD":/w -w /w node:22-slim)
PORT=${PORT_BASE:-9400}
declare -a NAMES RESULTS PROFS
CP=""; NP=""
# every Chromium this run starts is killed and its profile directory (hundreds of MB each) deleted on exit, also on Ctrl-C or an error
rmprof() { local i; for i in 1 2 3 4 5; do rm -rf "$1" 2>/dev/null; [ -e "$1" ] || return 0; sleep 0.5; done; rm -rf "$1"; }
cleanup() { [ -n "$NP" ] && kill $NP 2>/dev/null; [ -n "$CP" ] && kill $CP 2>/dev/null; for d in "${PROFS[@]}"; do rmprof "$d"; done; }
trap cleanup EXIT; trap 'cleanup; exit 143' TERM; trap 'cleanup; exit 130' INT     # TERM (e.g. from `timeout`) must END the run, not just clean up
want() { [ -z "$ONLY" ] || [[ "$1" =~ $ONLY ]]; }
record() { NAMES+=("$1"); RESULTS+=("$2"); printf '%-34s %s\n' "$1" "$2"; }
chrome() { # chrome PORT W H -> starts headless chromium, sets CP
  local prof=$HOME/snap/chromium/common/rc-profile-$1; rm -rf "$prof"; PROFS+=("$prof")
  chromium-browser --headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-precise-memory-info --js-flags=--expose-gc --no-sandbox --hide-scrollbars \
    --window-size=$2,$3 --remote-debugging-port=$1 --user-data-dir="$prof" about:blank >/dev/null 2>&1 &
  CP=$!; sleep 3
}
stopchrome() { kill $CP 2>/dev/null; wait $CP 2>/dev/null; CP=""; local last="${PROFS[${#PROFS[@]}-1]}"; [ -n "$last" ] && rmprof "$last"; }
snippet() { # snippet NAME FILE W H [phone] [prefix] [timeout]
  want "$1" || return 0
  PORT=$((PORT+1)); chrome $PORT $3 $4
  local ph=""; [ "$5" = phone ] && ph="--phone"
  "${NODEHOST[@]}" node tools/cdp-run.js --cdp http://127.0.0.1:$PORT --url "$SITE_URL/" --snippet "$2" --w $3 --h $4 $ph --prefix "${6:-}" --timeout "${7:-400}" --out "$LOGDIR/$1.json" >"$LOGDIR/$1.log" 2>&1 &
  NP=$!; wait $NP; local rc=$?; NP=""; stopchrome
  [ $rc -eq 0 ] && record "$1" PASS || { record "$1" "FAIL (log: $LOGDIR/$1.log)"; head -8 "$LOGDIR/$1.log" | cut -c1-220 | sed 's/^/      /'; }
}
S=tools/cdp-snippets
echo "load average at start: $(cut -d' ' -f1-3 /proc/loadavg)"

if want "deploy"; then
  if bash scripts/deploy-local.sh >"$LOGDIR/deploy.log" 2>&1; then
    idx=$(curl -s "$SITE_URL/"); miss=0
    while read -r f; do [ -f "html/$f" ] || continue; h=$(md5sum "html/$f" | cut -c1-32); echo "$idx" | grep -q "$h" || { echo "served page does not reference the tree's $f" >>"$LOGDIR/deploy.log"; miss=1; }; done < cachebust.list
    [ $miss -eq 0 ] && record "deploy+exact-tree" PASS || record "deploy+exact-tree" "FAIL (log: $LOGDIR/deploy.log)"
  else record "deploy+exact-tree" "FAIL (log: $LOGDIR/deploy.log)"; fi
fi

if want "syntax"; then
  if "${NODE[@]}" sh -c 'f=0; for x in html/ui/*.js html/script.js tools/*.js tools/models/*.js tools/test/*.js tools/cdp-snippets/*.js; do node --check "$x" || f=1; done; exit $f' >"$LOGDIR/syntax.log" 2>&1; then record syntax PASS; else record syntax "FAIL (log: $LOGDIR/syntax.log)"; fi
  bash -n tools/run-checks.sh scripts/deploy-local.sh 2>>"$LOGDIR/syntax.log" || record syntax-sh FAIL
fi

if want "unit"; then
  "${NODE[@]}" sh -c 'f=0; n=0; for t in tools/test/*.test.js; do n=$((n+1)); out=$(node "$t" 2>&1) || { echo "FAIL $t"; echo "$out" | tail -5; f=1; }; done; echo "$n test files"; exit $f' >"$LOGDIR/unit.log" 2>&1 \
    && record "unit ($(tail -1 "$LOGDIR/unit.log"))" PASS || record unit "FAIL (log: $LOGDIR/unit.log)"
fi

if want "hotkeys"; then snippet hotkeys $S/hotkeys.js 1440 900 desktop "" 300; fi
if want "console-flow"; then snippet console-flow-desktop $S/console-flow.js 1440 900 desktop; snippet console-flow-phone $S/console-flow.js 390 844 phone; fi

for v in "320 640" "360 640" "375 667" "390 844" "412 915" "430 932"; do set -- $v; snippet "layout-collision-$1x$2" $S/layout-collision.js $1 $2 phone "" 500; done
snippet layout-collision-1440x900 $S/layout-collision.js 1440 900 desktop "" 500
for v in "320 640" "360 640" "375 667" "390 844" "412 915" "430 932"; do set -- $v; snippet "phone-sheet-$1x$2" $S/phone-sheet.js $1 $2 phone "" 400; done
for v in "320 640" "360 640" "375 667" "390 844" "412 915" "430 932"; do set -- $v; snippet "controls-$1x$2" $S/controls-regression.js $1 $2 phone "" 300; done
snippet controls-1440x900 $S/controls-regression.js 1440 900 desktop "" 300
for v in "1920 1080" "1440 900" "1100 800" "900 800" "780 800"; do set -- $v; snippet "intra-panel-$1x$2" $S/intra-panel.js $1 $2 desktop "" 500; done
for v in "320 640" "360 640" "375 667" "390 844" "412 915" "430 932"; do set -- $v; snippet "intra-panel-$1x$2" $S/intra-panel.js $1 $2 phone "" 500; done
RF="window.ROUTE_FIXTURE=$(tr -d "\n" < tools/test/fixtures/route-response.json);"
snippet route-fixture-desktop $S/route-fixture.js 1440 900 desktop "$RF" 300
snippet route-fixture-phone $S/route-fixture.js 390 844 phone "$RF" 300
snippet route-link-desktop $S/route-link.js 1440 900 desktop "" 300
snippet route-link-phone $S/route-link.js 390 844 phone "" 300
snippet live-smoke $S/live-smoke.js 1440 900 desktop "" 200
snippet perf-overlay $S/perf-overlay.js 1440 900 desktop "" 200
snippet component-signature-desktop $S/component-signature.js 1440 900 desktop
snippet component-signature-phone $S/component-signature.js 390 844 phone
if want "component-signature-match"; then
  if [ -f "$LOGDIR/component-signature-desktop.json" ] && [ -f "$LOGDIR/component-signature-phone.json" ] && \
     "${NODE[@]}" node -e 'const a=require("./'"$LOGDIR"'/component-signature-desktop.json"),b=require("./'"$LOGDIR"'/component-signature-phone.json");process.exit(a.signature===b.signature&&a.ids===b.ids?0:1)'; then record component-signature-match PASS; else record component-signature-match FAIL; fi
fi
snippet label-sprite $S/label-sprite.js 1440 900 desktop
snippet airport-pins $S/airport-pins.js 1440 900 desktop "" 500
snippet airport-click-desktop $S/airport-click.js 1440 900 desktop "" 560
snippet perf-counters $S/perf-counters.js 1440 900 desktop "" 560
snippet models-gltf $S/models-gltf.js 1440 900 desktop "" 300
snippet contrails-sky $S/contrails-sky.js 1440 900 desktop "" 300
snippet airport-proxy $S/airport-proxy.js 1440 900 desktop "" 400
snippet models3d-desktop $S/models3d.js 1440 900 desktop "window.M3_PART='a';" 500
snippet models3d-phone $S/models3d.js 390 844 phone "window.M3_PART='a';" 500
snippet models3d-height $S/models3d-height.js 1440 900 desktop "" 560
snippet models3d-budget $S/models3d-budget.js 1440 900 desktop "" 560
snippet models3d-zoom-soak $S/models3d-soak.js 1440 900 desktop "" 560

for ph in "" phone; do
  want "audit-colours${ph:+-phone}" || continue
  PORT=$((PORT+1)); chrome $PORT 1440 900
  "${NODEHOST[@]}" node tools/audit-colours.js --cdp http://127.0.0.1:$PORT --url "$SITE_URL/" --out "$LOGDIR/colour-audit${ph:+-phone}.md" ${ph:+--phone} >"$LOGDIR/audit-colours${ph:+-phone}.log" 2>&1; rc=$?
  stopchrome
  [ $rc -eq 0 ] && record "audit-colours${ph:+-phone}" "PASS ($(tail -1 "$LOGDIR/audit-colours${ph:+-phone}.log" | cut -c1-70))" || record "audit-colours${ph:+-phone}" "FAIL (log: $LOGDIR/audit-colours${ph:+-phone}.log)"
done

echo; echo "=== SUMMARY ($(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . || echo '+uncommitted'), load $(cut -d' ' -f1-3 /proc/loadavg)) ==="
fail=0; { for i in "${!NAMES[@]}"; do printf '%-34s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"; [[ "${RESULTS[$i]}" == FAIL* ]] && fail=$((fail+1)); done; echo "checks: ${#NAMES[@]}, failed: $fail"; } | tee "$LOGDIR/summary.txt"
[ $fail -eq 0 ] && [ ${#NAMES[@]} -gt 0 ]
