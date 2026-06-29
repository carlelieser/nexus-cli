#!/usr/bin/env sh
# nexus-cli installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/carlelieser/nexus-cli/main/install.sh | sh
#
# Downloads the prebuilt `nexus` binary for this machine, puts it on PATH, and
# fetches the browser it needs. No Node, no git, no build.
set -eu

REPO="carlelieser/nexus-cli"
BIN_NAME="nexus"
# Where to install. ~/.local/bin is on PATH in most modern shells; we add it if not.
INSTALL_DIR="${NEXUS_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }

# --- detect platform --------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os_tag="darwin" ;;
  Linux)  os_tag="linux" ;;
  *) err "unsupported OS: $os (use install.ps1 on Windows)" ;;
esac
case "$arch" in
  arm64|aarch64) arch_tag="arm64" ;;
  x86_64|amd64)  arch_tag="x64" ;;
  *) err "unsupported architecture: $arch" ;;
esac

# Only darwin ships an arm64 build; linux is x64-only for now.
if [ "$os_tag" = "linux" ] && [ "$arch_tag" = "arm64" ]; then
  err "no linux-arm64 build yet; please open an issue"
fi
asset="${BIN_NAME}-${os_tag}-${arch_tag}"

# --- download ---------------------------------------------------------------
url="https://github.com/${REPO}/releases/latest/download/${asset}"
say "Downloading ${asset}…"
mkdir -p "$INSTALL_DIR"
target="$INSTALL_DIR/$BIN_NAME"
if command -v curl >/dev/null 2>&1; then
  curl -fSL --progress-bar "$url" -o "$target" || err "download failed: $url"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress "$url" -O "$target" || err "download failed: $url"
else
  err "need curl or wget to download"
fi
chmod +x "$target"

# --- PATH -------------------------------------------------------------------
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    say ""
    say "Add $INSTALL_DIR to your PATH by appending this to your shell profile"
    say "(~/.zshrc, ~/.bashrc, or ~/.profile):"
    say ""
    say "    export PATH=\"$INSTALL_DIR:\$PATH\""
    say ""
    ;;
esac

# --- fetch the browser ------------------------------------------------------
say "Setting up the browser (one-time, ~150 MB)…"
"$target" setup || err "browser setup failed; re-run later with: $BIN_NAME setup"

say ""
say "✓ Installed. Next:"
say "  1. In your browser (logged in to nexusmods.com), export cookies with the"
say "     \"Get cookies.txt LOCALLY\" extension and save the file."
say "  2. nexus import --file /path/to/nexus.cookies.txt"
say "  3. nexus download https://www.nexusmods.com/skyrimspecialedition/mods/12604"
