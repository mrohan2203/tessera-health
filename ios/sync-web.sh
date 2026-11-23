#!/bin/sh
# Copies the web app (../tessera) into the iOS bundle folder (TesseraHealth/web).
# Runs automatically as a build phase; safe to run by hand.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../tessera"
DST="$HERE/TesseraHealth/web"
# If macOS blocks reading ../tessera (Xcode lacks Desktop folder access), keep the copy already
# in TesseraHealth/web instead of failing the build.
if ! ls "$SRC" >/dev/null 2>&1; then
  if [ -f "$DST/index.html" ]; then
    echo "warning: can't read $SRC (macOS privacy). Using the existing bundled copy. Give Xcode Desktop access to pick up web changes."
    exit 0
  fi
  echo "error: can't read $SRC. System Settings > Privacy & Security > Files & Folders > Xcode > Desktop Folder." >&2
  exit 1
fi
SRC="$(cd "$SRC" && pwd)"
mkdir -p "$DST"
rsync -a --delete \
  --exclude 'tests' --exclude '.claude' --exclude 'README.md' --exclude '.*' \
  "$SRC/" "$DST/"
# The published page gets a document skeleton at publish time; give the bundled copy one too
# so WebKit renders in standards mode.
# The same reset the published page's skeleton provides: no body margin, and :root padded by the
# phone's safe-area insets so content clears the status bar, Dynamic Island and home indicator.
{ printf '<!doctype html>\n<html lang="en">\n'
  printf '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}</style>\n'
  # Fonts load without blocking first paint (the app works offline with system fonts)
  sed 's#<link rel="stylesheet" href="https://fonts.googleapis.com\([^"]*\)">#<link rel="stylesheet" href="https://fonts.googleapis.com\1" media="print" onload="this.media=\x27all\x27">#' "$SRC/index.html"; } > "$DST/index.html"
echo "Synced web app into $DST"
