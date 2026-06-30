#!/usr/bin/env bash
# Assembles a self-contained release archive: bundled Node + built app + deps.
set -euo pipefail

os="${1:?os required (macos|linux|win)}"
arch="${2:?arch required (arm64|x64)}"

NODE_VERSION="$(node -p 'process.versions.node')"
NAME="nexus-${os}-${arch}"
BUILD_DIR="build"
STAGE="${BUILD_DIR}/${NAME}"
OUT_DIR="binaries"

case "$os" in
  macos) node_os="darwin"; ext="tar.gz" ;;
  linux) node_os="linux"; ext="tar.gz" ;;
  win) node_os="win"; ext="zip" ;;
  *) echo "Unknown os: $os" >&2; exit 1 ;;
esac
node_pkg="node-v${NODE_VERSION}-${node_os}-${arch}"
node_url="https://nodejs.org/dist/v${NODE_VERSION}/${node_pkg}.${ext}"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$STAGE/app" "$OUT_DIR" "${BUILD_DIR}/node"

echo "Fetching ${node_url}"
if [ "$ext" = "zip" ]; then
  curl -fsSL "$node_url" -o "${BUILD_DIR}/node.zip"
  powershell -NoProfile -Command \
    "Expand-Archive -Path '${BUILD_DIR}/node.zip' -DestinationPath '${BUILD_DIR}/node' -Force"
  cp "${BUILD_DIR}/node/${node_pkg}/node.exe" "$STAGE/bin/node.exe"
else
  curl -fsSL "$node_url" -o "${BUILD_DIR}/node.tgz"
  tar -xzf "${BUILD_DIR}/node.tgz" -C "${BUILD_DIR}/node"
  cp "${BUILD_DIR}/node/${node_pkg}/bin/node" "$STAGE/bin/node"
fi

cp -R dist "$STAGE/app/dist"
cp -R electron "$STAGE/app/electron"
cp package.json "$STAGE/app/package.json"
cp -R node_modules "$STAGE/app/node_modules"

if [ "$os" = "win" ]; then
  cat > "$STAGE/nexus.cmd" <<'CMD'
@echo off
"%~dp0bin\node.exe" "%~dp0app\dist\cli\index.js" %*
CMD
else
  cat > "$STAGE/nexus" <<'SH'
#!/usr/bin/env sh
# Resolve symlinks so `here` is the install dir even when run via a linked name.
self=$0
while [ -L "$self" ]; do
  link=$(readlink -- "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname -- "$self")/$link ;;
  esac
done
here=$(CDPATH= cd -- "$(dirname -- "$self")" && pwd)
exec "$here/bin/node" "$here/app/dist/cli/index.js" "$@"
SH
  chmod +x "$STAGE/nexus" "$STAGE/bin/node"
fi

echo "Archiving ${NAME}.${ext}"
if [ "$ext" = "zip" ]; then
  powershell -NoProfile -Command \
    "Compress-Archive -Path '${BUILD_DIR}/${NAME}' -DestinationPath '${OUT_DIR}/${NAME}.zip' -Force"
else
  tar -czf "${OUT_DIR}/${NAME}.tar.gz" -C "$BUILD_DIR" "${NAME}"
fi

echo "Built ${OUT_DIR}/${NAME}.${ext}"
