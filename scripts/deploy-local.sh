#!/bin/bash
# Redeploy this repo's html/ into the running ultrafeeder container.
#
# Requires your ultrafeeder docker-compose.yml to mount this repo at
# /var/tar1090_git_source (read-only). Whatever is in the working tree,
# including uncommitted changes, is what gets deployed.
#
# Mirrors what the container's own tar1090-update service does:
#   1. install tar1090 from the mounted source
#   2. re-apply TAR1090_* env settings to config.js
#   3. re-apply the range outline settings

set -euo pipefail

CONTAINER="${CONTAINER:-ultrafeeder}"
SITE_URL="${SITE_URL:-http://127.0.0.1:8096}"
SRC=/var/tar1090_git_source
IPATH=/usr/local/share/tar1090

# -it only when run from a real terminal, so this also works from scripts/CI
TTY_FLAGS=()
if [[ -t 0 && -t 1 ]]; then TTY_FLAGS=(-it); fi

if ! docker exec "$CONTAINER" test -d "$SRC/html"; then
    echo "ERROR: $SRC/html not found in container '$CONTAINER'. Is the repo mounted?" >&2
    exit 1
fi

echo "==> Installing tar1090 from $SRC"
docker exec "${TTY_FLAGS[@]}" "$CONTAINER" bash /tar1090-install.sh /run/readsb webroot "$IPATH" "$SRC"

echo "==> Re-applying TAR1090_* configuration"
docker exec "${TTY_FLAGS[@]}" "$CONTAINER" /command/with-contenv bash /etc/s6-overlay/startup.d/04-tar1090-configure
docker exec "${TTY_FLAGS[@]}" "$CONTAINER" /command/with-contenv bash /etc/s6-overlay/startup.d/06-range-outline

echo "==> Cache-busting generated config.js"
# config.js is rewritten by the configure step above, so it cannot be hashed at install time
docker exec "${TTY_FLAGS[@]}" "$CONTAINER" bash -c "cd $IPATH/html-webroot; h=\$(md5sum config.js | cut -c1-12); sed -i -E 's#src=\"config(_[0-9a-f]+)?\\.js(\\?v=[0-9a-f]+)?\"#src=\"config.js?v='\"\$h\"'\"#' index.html; grep -o 'config[^\"]*js[^\"]*' index.html"

echo "==> Check"
code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/" || true)
version=$(curl -s "$SITE_URL/version.json" || true)
echo "local index: HTTP $code"
echo "version.json: $version"
[[ "$code" == "200" ]] || { echo "ERROR: site did not return 200" >&2; exit 1; }
echo "Done. Hard-refresh the browser (Ctrl+Shift+R) if you don't see changes."
