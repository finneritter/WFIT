#!/usr/bin/env bash
# Build WFIT (release, no bundle) and install it as a launchable desktop app
# for the current user — binary on PATH, icon + .desktop so it's searchable in
# KRunner / the application menu. Re-run any time to update to the latest code.
#
# Usage: scripts/install.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$HOME/.local/bin/wfit"
ICON="$HOME/.local/share/icons/hicolor/128x128/apps/wfit.png"
DESKTOP="$HOME/.local/share/applications/wfit.desktop"

echo "==> Building release binary (this takes a minute)…"
cd "$REPO"
# Personal install keeps the dev dashboard (public release bundles are lean).
npm run tauri -- build --no-bundle --features dev-dashboard

echo "==> Installing to ~/.local …"
mkdir -p "$(dirname "$BIN")" "$(dirname "$ICON")" "$(dirname "$DESKTOP")"
install -m755 "$REPO/src-tauri/target/release/wfit" "$BIN"
install -m644 "$REPO/src-tauri/icons/128x128@2x.png" "$ICON"

# The WebKit/Wayland renderer workaround lives in main() now (Linux-only,
# override by exporting the WEBKIT_* vars yourself) — Exec stays plain.
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=WFIT
GenericName=Warframe Item Tracker
Comment=Track Warframe items, warframe.market prices, sets and sales
Exec=$BIN
Icon=wfit
Terminal=false
Categories=Utility;
StartupWMClass=wfit
EOF
chmod +x "$DESKTOP"

update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
gtk-update-icon-cache -t -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "==> Installed. Launch it by searching \"WFIT\" in App Launcher (Alt+Space)."
