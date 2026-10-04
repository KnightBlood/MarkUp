#!/usr/bin/env bash
#
# Build a macOS `.pkg` installer from an `.app` bundle.
#
# A `.dmg` can only drag the app into /Applications — there is no install-path
# choice at all. A `.pkg` gets an installer destination page, so the user picks
# the target volume (and, with `enable_currentUserHome`, the home directory),
# which is what the "install location is selectable" requirement needs.
#
# Electron has this natively (`mac.target: pkg`); Tauri has no `pkg` bundle
# type, Electrobun only emits a dmg, and Wails only emits a dmg — so those
# three shells post-process their `.app` with this script.
#
#   scripts/packaging/macos-pkg.sh <App.app> <out.pkg> [identifier] [version]
#
# Requires macOS (pkgbuild / productbuild ship with the Xcode command line
# tools already present on GitHub's macOS runners).
set -euo pipefail

APP="${1:?usage: macos-pkg.sh <App.app> <out.pkg> [identifier] [version]}"
OUT="${2:?usage: macos-pkg.sh <App.app> <out.pkg> [identifier] [version]}"
IDENTIFIER="${3:-dev.markup.editor}"
VERSION="${4:-0.1.0}"

if [[ ! -d "$APP" ]]; then
  echo "macos-pkg: no such app bundle: $APP" >&2
  exit 1
fi

APP_NAME="$(basename "$APP" .app)"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Stage the bundle so the payload path inside the pkg stays `<volume>/Applications`.
mkdir -p "$WORK/root/Applications"
ditto "$APP" "$WORK/root/Applications/$APP_NAME.app"

pkgbuild \
  --root "$WORK/root" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location / \
  "$WORK/component.pkg"

# `domains` decides where the installer is allowed to put the app; this is the
# macOS equivalent of the Windows NSIS directory page.
cat > "$WORK/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>$APP_NAME</title>
  <options customize="never" require-scripts="false"/>
  <domains enable_anywhere="true" enable_currentUserHome="true" enable_localSystem="true"/>
  <choices-outline>
    <line choice="default">
      <line choice="$IDENTIFIER"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="$IDENTIFIER" visible="false">
    <pkg-ref id="$IDENTIFIER"/>
  </choice>
  <pkg-ref id="$IDENTIFIER" version="$VERSION" onConclusion="none">component.pkg</pkg-ref>
</installer-gui-script>
XML

productbuild --distribution "$WORK/distribution.xml" --package-path "$WORK" "$OUT"
echo "macos-pkg: wrote $OUT"
