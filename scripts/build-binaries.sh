#!/usr/bin/env bash
# Compile standalone `nexus` executables for every supported OS/arch with Bun.
# The Camoufox browser is NOT bundled; `nexus setup` fetches it at install time.
#
# Usage: scripts/build-binaries.sh [outdir]   (default outdir: ./release)
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${1:-release}"
ENTRY="src/cli/index.ts"

# Bun cross-compile targets → the asset name our install scripts look for.
TARGETS=(
  "bun-darwin-arm64:nexus-darwin-arm64"
  "bun-darwin-x64:nexus-darwin-x64"
  "bun-linux-x64:nexus-linux-x64"
  "bun-windows-x64:nexus-win-x64.exe"
)

command -v bun >/dev/null 2>&1 || { echo "bun is required: https://bun.sh" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

for entry in "${TARGETS[@]}"; do
  target="${entry%%:*}"
  asset="${entry##*:}"
  echo "→ building $asset ($target)"
  bun build "$ENTRY" \
    --compile \
    --target="$target" \
    --outfile "$OUT/$asset"
done

echo "✓ binaries in $OUT/"
( cd "$OUT" && command -v shasum >/dev/null 2>&1 && shasum -a 256 nexus-* > SHA256SUMS && echo "✓ wrote $OUT/SHA256SUMS" )
