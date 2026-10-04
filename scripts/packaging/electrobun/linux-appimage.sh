#!/usr/bin/env bash
#
# Build a Linux AppImage from an Electrobun build directory.
#
# Electrobun's own Linux artifact is a self-extracting `installer` that always
# unpacks to `~/.local/share` (no path choice) and cannot register file
# associations. An AppImage is a single file the user places wherever they
# like, and its `.desktop` `MimeType=` line is what Linux uses for the
# `.md` / `.markdown` association — so this shell repacks Electrobun's payload.
#
# `hutch electrobun build` leaves `<bundle>.tar.zst` in the build root (the
# uncompressed tar is deleted, the compressed one is kept for the updater).
#
#   scripts/packaging/electrobun/linux-appimage.sh <build-root> <out.AppImage> [icon.png]
#
# Requires appimagetool on PATH (CI downloads it).
set -euo pipefail

BUILD_ROOT="${1:?usage: linux-appimage.sh <build-root> <out.AppImage> [icon.png]}"
OUT="${2:?usage: linux-appimage.sh <build-root> <out.AppImage> [icon.png]}"
ICON="${3:-}"

ARCHIVE="$(ls -t "$BUILD_ROOT"/*.tar.zst 2>/dev/null | head -n 1 || true)"
if [[ -z "$ARCHIVE" ]]; then
  echo "linux-appimage: no *.tar.zst under $BUILD_ROOT" >&2
  exit 1
fi

OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

tar --zstd -xf "$ARCHIVE" -C "$WORK"

# The tar holds a single top-level bundle directory (e.g. `Markup/`).
BUNDLE="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
if [[ -z "$BUNDLE" ]]; then
  echo "linux-appimage: unexpected archive layout in $ARCHIVE" >&2
  exit 1
fi

APP_DIR="$WORK/AppDir"
mkdir -p "$APP_DIR"
cp -a "$BUNDLE"/. "$APP_DIR"/

if [[ -z "$ICON" ]]; then
  ICON="$(find "$APP_DIR" -maxdepth 3 -name '*.png' | head -n 1 || true)"
fi
if [[ -n "$ICON" && -f "$ICON" ]]; then
  cp "$ICON" "$APP_DIR/markup.png"
fi

cat > "$APP_DIR/AppRun" <<'APPRUN'
#!/bin/sh
# Resolve through symlinks so the AppImage can be moved anywhere.
HERE="$(dirname "$(readlink -f "$0")")"
LAUNCHER="$HERE/bin/launcher"
if [ ! -x "$LAUNCHER" ]; then
  LAUNCHER="$(find "$HERE/bin" -maxdepth 1 -type f -perm -u+x | head -n 1)"
fi
exec "$LAUNCHER" "$@"
APPRUN
chmod +x "$APP_DIR/AppRun"

# Linux file association lives in the desktop entry's MimeType line.
cat > "$APP_DIR/markup.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Markup
Comment=Markdown editor
Exec=launcher %F
Icon=markup
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;
DESKTOP

ARCH=x86_64 appimagetool "$APP_DIR" "$OUT"
echo "linux-appimage: wrote $OUT"
