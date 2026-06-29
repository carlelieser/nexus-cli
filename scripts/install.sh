#!/usr/bin/env sh
# Install the nexus CLI from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.sh | sh
set -eu

REPO="carlelieser/nexus-cli"
INSTALL_DIR="${NEXUS_INSTALL_DIR:-$HOME/.local/share/nexus}"
BIN_DIR="${NEXUS_BIN_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os="macos" ;;
  Linux) os="linux" ;;
  *) echo "Unsupported OS: $(uname -s). Install via npm instead." >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) echo "Unsupported architecture: $(uname -m). Install via npm instead." >&2; exit 1 ;;
esac

# Prebuilt archives exist only for these platforms (see the CI matrix). Anything
# else (Intel Mac, Linux arm64) installs via npm.
case "${os}-${arch}" in
  macos-arm64 | linux-x64) ;;
  *)
    echo "No prebuilt build for ${os}-${arch}. Install via npm instead." >&2
    exit 1
    ;;
esac

name="nexus-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${name}.tar.gz"

echo "Downloading ${name}..."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp/nexus.tar.gz"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp/nexus.tar.gz" "$url"
else
  echo "Need curl or wget to download." >&2
  exit 1
fi

# Replace any prior install so upgrades are clean.
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
tar -xzf "$tmp/nexus.tar.gz" -C "$INSTALL_DIR" --strip-components 1

# macOS quarantines downloaded binaries; strip it so the bundled node runs.
if [ "$os" = "macos" ] && command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true
fi

ln -sf "$INSTALL_DIR/nexus" "$BIN_DIR/nexus"
echo "Installed to ${INSTALL_DIR}, linked at ${BIN_DIR}/nexus"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    case "${SHELL:-}" in
      *zsh) profile="$HOME/.zshrc" ;;
      *) profile="$HOME/.bashrc" ;;
    esac
    line="export PATH=\"${BIN_DIR}:\$PATH\""
    if ! { [ -f "$profile" ] && grep -qF "$line" "$profile"; }; then
      printf '\n%s\n' "$line" >> "$profile"
      echo "Added ${BIN_DIR} to PATH in ${profile}"
    fi
    echo "Open a new shell, or run this to use it now: ${line}"
    ;;
esac

echo "Done. Run 'nexus --help' to get started."
