#!/usr/bin/env bash
# Build WFIT (release) as a macOS .app bundle and install it to /Applications,
# clearing the Gatekeeper quarantine flag so the unsigned app opens normally.
# Re-run any time to update to the latest code. macOS counterpart to install.sh
# (which targets Linux: ~/.local/bin + a .desktop entry for KRunner).
#
# Your data is separate from the app (~/Library/Application Support/dev.finn.wfit),
# so reinstalling never touches inventory/sales/watchlist. For a clean slate use
# Settings → Developer → "Wipe all app data", or rm -rf that folder.
#
# Usage: scripts/install-mac.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="WFIT.app"
SRC_APP="$REPO/src-tauri/target/release/bundle/macos/$APP_NAME"
DEST_APP="/Applications/$APP_NAME"

echo "==> Building release .app bundle (this takes a few minutes)…"
cd "$REPO"
npm run tauri -- build --bundles app

if [[ ! -d "$SRC_APP" ]]; then
  echo "!! Expected bundle not found at $SRC_APP" >&2
  exit 1
fi

echo "==> Installing to /Applications …"
rm -rf "$DEST_APP"
cp -R "$SRC_APP" "$DEST_APP"

# The app is unsigned / un-notarized; clear the quarantine flag so Gatekeeper
# doesn't block first launch ("WFIT can't be opened / is damaged").
echo "==> Clearing Gatekeeper quarantine …"
xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true

echo "==> Installed. Launch it from /Applications or Spotlight (⌘-Space → \"WFIT\")."
