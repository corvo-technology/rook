#!/bin/sh
# Installs or updates Rook:
#   curl -fsSL https://github.com/corvo-technology/rook/releases/latest/download/install.sh | sh
#
# On a Mac (Apple silicon or Intel): the app goes into Applications (or ~/Applications when that is
# not writable) and opens.
# On Linux: the AppImage goes into ~/.local/bin with an entry in the applications menu.
# On Windows: use install.ps1 in PowerShell.
#
# For testing a build before it is released: CORVO_BASE_URL (a folder with the release files, a URL
# or a local path) and CORVO_DEST (another folder; then nothing is opened or added to the menu).
set -e
LATEST="${CORVO_BASE_URL:-https://github.com/corvo-technology/rook/releases/latest/download}"
DEST_OVERRIDE="${CORVO_DEST:-}"

case "${LANG:-}" in pt*) PT=1 ;; *) PT= ;; esac
say() { if [ -n "$PT" ]; then echo "$1"; else echo "$2"; fi; }
fail() { say "$1" "$2" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fetch() { # fetch <from> <to>
  case "$1" in
    http*) curl -fL --progress-bar -o "$2" "$1" ;;
    *) cp "$1" "$2" ;;
  esac
}

install_mac() {
  DEST="${DEST_OVERRIDE:-/Applications}"
  [ -w "$DEST" ] || [ -n "$DEST_OVERRIDE" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST"
  APP="$DEST/Corvo.app"

  case "$(uname -m)" in
    arm64 | x86_64) ;;
    *) fail "O Rook para Mac não roda em $(uname -m)." "Rook for Mac doesn't run on $(uname -m)." ;;
  esac
  say "Baixando o Rook…" "Downloading Rook…"
  fetch "$LATEST/corvo-mac-universal.zip" "$TMP/corvo.zip"
  ditto -x -k "$TMP/corvo.zip" "$TMP/app"
  [ -d "$TMP/app/Corvo.app" ] || fail "O arquivo baixado não tem o Corvo.app." "The download doesn't contain Corvo.app."

  # Copying over a running app leaves it unable to quit normally: close it first.
  running() { pgrep -f "$APP/Contents/MacOS/Corvo\$" >/dev/null; }
  if running; then
    say "Fechando o app aberto…" "Closing the running app…"
    osascript -e 'with timeout of 20 seconds' -e 'tell application "Corvo" to quit' -e 'end timeout' >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "O app não fechou. Feche com ⌘Q e rode de novo." "The app didn't close. Quit it with ⌘Q and run this again."
  fi

  rm -rf "$APP"
  ditto "$TMP/app/Corvo.app" "$APP"
  xattr -r -d com.apple.quarantine "$APP" >/dev/null 2>&1 || true
  say "Instalado em $APP" "Installed in $APP"
  [ -n "$DEST_OVERRIDE" ] || open "$APP"
}

install_linux() {
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x86_64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) fail "O Rook roda em Linux x64 e ARM64, não em $(uname -m)." "Rook runs on x64 and ARM64 Linux, not on $(uname -m)." ;;
  esac
  DEST="${DEST_OVERRIDE:-$HOME/.local/bin}"
  mkdir -p "$DEST"
  APP="$DEST/Corvo.AppImage"

  # Replacing a running app's file leaves it broken: close it first.
  running() { pgrep -f '^[^ ]*/Corvo\.AppImage( |$)' >/dev/null; }
  if running && [ -z "$DEST_OVERRIDE" ]; then
    say "Fechando o app aberto…" "Closing the running app…"
    pkill -TERM -f '^[^ ]*/Corvo\.AppImage( |$)' 2>/dev/null || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "O app não fechou. Encerre o Rook e rode de novo." "The app didn't close. Quit Rook and run this again."
  fi

  say "Baixando o Rook…" "Downloading Rook…"
  fetch "$LATEST/corvo-linux-$ARCH.AppImage" "$TMP/Corvo.AppImage"
  chmod +x "$TMP/Corvo.AppImage"
  mv -f "$TMP/Corvo.AppImage" "$APP"
  if [ -z "$DEST_OVERRIDE" ]; then
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/corvo.desktop" <<EOT
[Desktop Entry]
Type=Application
Name=Rook
Exec="$APP" %U
Terminal=false
Categories=Utility;
StartupWMClass=Corvo
EOT
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
  fi
  say "Instalado: $APP" "Installed: $APP"
  if [ -z "$DEST_OVERRIDE" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    nohup "$APP" >/dev/null 2>&1 &
  fi
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux) install_linux ;;
  MINGW* | MSYS* | CYGWIN*) fail "No Windows, instale pelo PowerShell: irm $LATEST/install.ps1 | iex" "On Windows, install from PowerShell: irm $LATEST/install.ps1 | iex" ;;
  *) fail "O Rook roda no macOS, no Linux e no Windows." "Rook runs on macOS, Linux and Windows." ;;
esac
