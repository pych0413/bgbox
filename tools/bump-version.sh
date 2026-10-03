#!/bin/sh
# Stamp a new ?v= on every asset URL and module import, and refresh the service worker.
#
#   tools/bump-version.sh [STAMP] [--no-check]
#
# STAMP is digits only; default is the current UTC time (YYYYMMDDHHMMSS). Seconds matter: two
# pushes in one minute must not share a stamp, or the second one would be served from cache.
#
# GitHub Pages serves everything with Cache-Control: max-age=600 and lets you change nothing about
# that. Without a version stamp a visitor who opened the page in the last 10 minutes gets the NEW
# index.html with the OLD css/js, a half-broken screen. Run this before pushing any change that
# touches css/ or js/.
#
# What it does
#   1. restamps every relative  <path>.js|.css?v=<digits>  in js/**/*.js, css/**/*.css,
#      index.html and sw.js (static imports, import('...') strings, href/src, @import)
#   2. writes the stamp into sw.js as VERSION (the cache name includes it)
#   3. regenerates the PRECACHE list in sw.js from the file tree
#   4. runs tools/check-imports.mjs (skip with --no-check) and exits with its status
#
# Plain POSIX sh; runs under Git Bash on Windows. No sed -i, no find (BSD/GNU/Windows differences).
set -eu
LC_ALL=C
export LC_ALL
cd "$(dirname "$0")/.."

STAMP=""
CHECK=1
for arg in "$@"; do
  case "$arg" in
    --no-check) CHECK=0 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) STAMP="$arg" ;;
  esac
done
[ -n "$STAMP" ] || STAMP="$(date -u +%Y%m%d%H%M%S)"
case "$STAMP" in
  *[!0-9]*) echo "stamp must be digits only, got: $STAMP" >&2; exit 2 ;;
esac

[ -f index.html ] || { echo "index.html not found (run from the repo)" >&2; exit 1; }
[ -f sw.js ] || { echo "sw.js not found" >&2; exit 1; }
grep -q '^// BEGIN PRECACHE' sw.js && grep -q '^// END PRECACHE' sw.js \
  || { echo "sw.js is missing its BEGIN/END PRECACHE markers" >&2; exit 1; }
grep -q "^const VERSION = '" sw.js || { echo "sw.js is missing its VERSION line" >&2; exit 1; }

TMP="${TMPDIR:-/tmp}/bgb-bump.$$"
trap 'rm -f "$TMP".*' EXIT INT TERM

# Recursive file lister in plain sh. Globs skip dotfiles and come out sorted (LC_ALL=C).
walk() {
  for p in "$1"/*; do
    [ -e "$p" ] || continue
    if [ -d "$p" ]; then walk "$p"; else printf '%s\n' "$p"; fi
  done
}

# ---- 1. restamp -------------------------------------------------------------------------------
# A reference starts at a quote, backtick or "(" and may not contain a colon or whitespace, so
# absolute URLs (https://cdn...) are never touched. Files are only rewritten when they change.
PAT="([\"'\`(][^\"'\`:[:space:]]*\\.(m?js|css))\\?v=[0-9]+"
# Git Bash's sed silently turns CRLF into LF unless told -b (binary). BSD sed has no -b, but
# there the problem does not exist, so probe for it.
if echo x | sed -b p >/dev/null 2>&1; then SED="sed -b"; else SED="sed"; fi
CHANGED=0
restamp() {
  $SED -E "s/${PAT}/\\1?v=${STAMP}/g" "$1" > "$TMP.stamp"
  if ! cmp -s "$1" "$TMP.stamp"; then
    cat "$TMP.stamp" > "$1"
    CHANGED=$((CHANGED + 1))
    echo "  restamped $1"
  fi
}

{
  [ -d js ] && walk js | while IFS= read -r f; do case "$f" in *.js|*.mjs|*.css) echo "$f" ;; esac; done
  [ -d css ] && walk css | while IFS= read -r f; do case "$f" in *.css) echo "$f" ;; esac; done
  echo index.html
  echo sw.js
} > "$TMP.files" || true

while IFS= read -r f; do restamp "$f"; done < "$TMP.files"

# ---- 2 + 3. sw.js: VERSION and PRECACHE -------------------------------------------------------
{
  echo "const PRECACHE = ["
  echo "  './',"
  echo "  'index.html',"
  [ -f manifest.webmanifest ] && echo "  'manifest.webmanifest',"
  [ -f icon.svg ] && echo "  'icon.svg',"
  [ -d icons ] && walk icons | while IFS= read -r f; do case "$f" in *.png|*.svg) echo "  '$f'," ;; esac; done
  [ -d css ] && walk css | while IFS= read -r f; do case "$f" in *.css) echo "  '$f?v=${STAMP}'," ;; esac; done
  [ -d js ] && walk js | while IFS= read -r f; do case "$f" in *.js|*.css) echo "  '$f?v=${STAMP}'," ;; esac; done
  echo "];"
} > "$TMP.list" || true

# (awk drops CRs, so sw.js is always written back with LF endings; .gitattributes enforces LF anyway)
awk -v list="$TMP.list" '
  /^\/\/ BEGIN PRECACHE/ { print; while ((getline line < list) > 0) print line; close(list); skip = 1; next }
  /^\/\/ END PRECACHE/   { skip = 0 }
  !skip { print }
' sw.js | sed -E "s/^(const VERSION = ')[^']*(';)/\\1${STAMP}\\2/" > "$TMP.sw"

grep -q '^// END PRECACHE' "$TMP.sw" && grep -q "^const VERSION = '${STAMP}';" "$TMP.sw" \
  || { echo "refusing to write a malformed sw.js" >&2; exit 1; }
if ! cmp -s sw.js "$TMP.sw"; then
  cat "$TMP.sw" > sw.js
  CHANGED=$((CHANGED + 1))
  echo "  rewrote sw.js (VERSION + PRECACHE)"
fi

PRECOUNT=$(grep -c "^  '" sw.js || true)
echo "asset version -> ${STAMP}  (${CHANGED} files changed, ${PRECOUNT} precache entries)"
echo "stamps now in the tree:"
while IFS= read -r f; do grep -o '?v=[0-9][0-9]*' "$f" || true; done < "$TMP.files" | sort | uniq -c

# ---- 4. verify --------------------------------------------------------------------------------
if [ "$CHECK" = 1 ]; then
  if command -v node >/dev/null 2>&1; then
    rc=0
    node tools/check-imports.mjs --same-stamp || rc=$?
    exit "$rc"
  fi
  echo "node not found: skipped tools/check-imports.mjs" >&2
fi
