#!/usr/bin/env bash
# Assemble a self-contained release archive for one platform: a Node runtime,
# the built app, and the production node_modules (with this platform's native
# addons). Run on a native runner for the target platform — native addons
# (better-sqlite3, impit, @primno/dpapi) are platform-specific and cannot be
# cross-built.
#
# Usage: scripts/build-archive.sh <os> <arch>
#   os:   macos | linux | win
#   arch: arm64 | x64
set -euo pipefail

os="${1:?os required (macos|linux|win)}"
arch="${2:?arch required (arm64|x64)}"

# Bundle the SAME Node version that compiled the native addons in node_modules.
# A different major has a different ABI (NODE_MODULE_VERSION), and the bundled
# Node would then fail to load better-sqlite3 / impit at runtime. Deriving it
# from the running Node keeps the two locked together.
NODE_VERSION="$(node -p 'process.versions.node')"
NAME="nexus-${os}-${arch}"
STAGE="dist-archive/${NAME}"
OUT_DIR="binaries"

# Map our os/arch to Node's release naming.
case "$os" in
  macos) node_os="darwin"; ext="tar.gz" ;;
  linux) node_os="linux"; ext="tar.gz" ;;
  win) node_os="win"; ext="zip" ;;
  *) echo "Unknown os: $os" >&2; exit 1 ;;
esac
node_pkg="node-v${NODE_VERSION}-${node_os}-${arch}"
node_url="https://nodejs.org/dist/v${NODE_VERSION}/${node_pkg}.${ext}"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/app" "$OUT_DIR" dist-archive/node

echo "Fetching ${node_url}"
if [ "$ext" = "zip" ]; then
  curl -fsSL "$node_url" -o dist-archive/node.zip
  unzip -q dist-archive/node.zip -d dist-archive/node
  cp "dist-archive/node/${node_pkg}/node.exe" "$STAGE/bin/node.exe"
else
  curl -fsSL "$node_url" -o dist-archive/node.tgz
  tar -xzf dist-archive/node.tgz -C dist-archive/node
  cp "dist-archive/node/${node_pkg}/bin/node" "$STAGE/bin/node"
fi

# The built ESM app plus only production deps (incl. native addons) for THIS
# platform. Copy the existing install rather than re-running npm so the native
# binaries already compiled on this runner are preserved.
cp -R dist "$STAGE/app/dist"
cp package.json "$STAGE/app/package.json"
cp -R node_modules "$STAGE/app/node_modules"

# Launcher. On *nix a shell shim; on Windows a .cmd. Both exec the bundled
# Node against the app entry, forwarding all args.
if [ "$os" = "win" ]; then
  cat > "$STAGE/nexus.cmd" <<'CMD'
@echo off
"%~dp0bin\node.exe" "%~dp0app\dist\cli\index.js" %*
CMD
else
  cat > "$STAGE/nexus" <<'SH'
#!/usr/bin/env sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$here/bin/node" "$here/app/dist/cli/index.js" "$@"
SH
  chmod +x "$STAGE/nexus" "$STAGE/bin/node"
fi

echo "Archiving ${NAME}.${ext}"
if [ "$ext" = "zip" ]; then
  (cd dist-archive && zip -qr "../${OUT_DIR}/${NAME}.zip" "${NAME}")
else
  tar -czf "${OUT_DIR}/${NAME}.tar.gz" -C dist-archive "${NAME}"
fi

echo "Built ${OUT_DIR}/${NAME}.${ext}"
