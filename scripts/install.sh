#!/usr/bin/env sh
# Install the nexus CLI from the latest GitHub release.
#   curl -fsSL https://raw.githubusercontent.com/carlelieser/nexus-cli/main/scripts/install.sh | sh
set -eu

REPO="carlelieser/nexus-cli"
BIN_NAME="nexus"
INSTALL_DIR="${NEXUS_INSTALL_DIR:-$HOME/.local/bin}"

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

# Only macOS ships an arm64 binary; Linux is x64-only.
if [ "$os" = "linux" ] && [ "$arch" = "arm64" ]; then
  echo "No prebuilt Linux arm64 binary. Install via npm instead." >&2
  exit 1
fi

asset="${BIN_NAME}-${os}-${arch}"
url="https://github.com/${REPO}/releases/latest/download/${asset}"

echo "Downloading ${asset}..."
mkdir -p "$INSTALL_DIR"
target="${INSTALL_DIR}/${BIN_NAME}"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$target"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$target" "$url"
else
  echo "Need curl or wget to download." >&2
  exit 1
fi
chmod +x "$target"

echo "Installed to ${target}"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    case "${SHELL:-}" in
      *zsh) profile="$HOME/.zshrc" ;;
      *) profile="$HOME/.bashrc" ;;
    esac
    line="export PATH=\"${INSTALL_DIR}:\$PATH\""
    if ! { [ -f "$profile" ] && grep -qF "$line" "$profile"; }; then
      printf '\n%s\n' "$line" >> "$profile"
      echo "Added ${INSTALL_DIR} to PATH in ${profile}"
    fi
    echo "Open a new shell, or run this to use it now: ${line}"
    ;;
esac

echo "Done. Run '${BIN_NAME} --help' to get started."
