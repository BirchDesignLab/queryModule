#!/usr/bin/env bash
# Fetches the self-hosted IBM Plex woff2 files (D0.2, developer-approved 09-29-26) from the official
# IBM/plex GitHub releases into apps/web/src/fonts/. Vite emits them under /assets/ (the API serves
# only /assets/* statically, so public/ would 404). Latin-1 split subsets; OFL 1.1 licence beside them.
# Needs: gh (authenticated), unzip. Re-run to refresh; bump the versions below and the PR body.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=apps/web/src/fonts
SANS=@ibm/plex-sans@1.1.0
CONDENSED=@ibm/plex-sans-condensed@2.0.0
MONO=@ibm/plex-mono@2.5.0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

fetch() { # tag zip-name dir-in-zip files...
  local tag=$1 zip=$2 dir=$3
  shift 3
  gh release download "$tag" -R IBM/plex -p "$zip" -D "$TMP" --clobber
  for f in "$@"; do
    unzip -o -j -q "$TMP/$zip" "$dir/fonts/split/woff2/$f" -d "$OUT"
  done
  unzip -o -j -q "$TMP/$zip" "$dir/LICENSE.txt" -d "$TMP/$dir"
  cp "$TMP/$dir/LICENSE.txt" "$OUT/OFL.txt"
}

fetch "$SANS" ibm-plex-sans.zip ibm-plex-sans \
  IBMPlexSans-Regular-Latin1.woff2 IBMPlexSans-Medium-Latin1.woff2 IBMPlexSans-SemiBold-Latin1.woff2
fetch "$CONDENSED" ibm-plex-sans-condensed.zip ibm-plex-sans-condensed \
  IBMPlexSansCondensed-SemiBold-Latin1.woff2
fetch "$MONO" ibm-plex-mono.zip ibm-plex-mono \
  IBMPlexMono-Regular-Latin1.woff2 IBMPlexMono-Medium-Latin1.woff2
echo "fonts written to $OUT"
