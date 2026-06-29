#!/usr/bin/env bash
# Extract a built archive and exercise the real browser-launch path — the code
# pkg-based binaries failed on (camoufox's native sqlite + dynamic import).
# `--help` alone is NOT a sufficient test; it never touches camoufox.
set -euo pipefail

os="${1:?os required}"
arch="${2:?arch required}"
NAME="nexus-${os}-${arch}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ "$os" = "win" ]; then
  unzip -q "binaries/${NAME}.zip" -d "$work"
  bin="$work/${NAME}/nexus.cmd"
else
  tar -xzf "binaries/${NAME}.tar.gz" -C "$work"
  bin="$work/${NAME}/nexus"
fi

echo "1/2 --help"
"$bin" --help >/dev/null

# `import --from <browser>` runs restoreSession → browser.launch(), which calls
# Camoufox().launch() → sampleWebGL → openDatabase (the sqlite/native path).
# We don't need a real session: we only need to get PAST the launch machinery
# without an ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING / missing-.node crash.
# A launch that proceeds to download a browser or fail on auth is a PASS;
# a crash inside launchOptions/openDatabase is a FAIL.
echo "2/2 browser launch path"
out="$("$bin" import --from chrome 2>&1 || true)"
echo "$out" | sed 's/^/    /'

if echo "$out" | grep -qiE "DYNAMIC_IMPORT_CALLBACK_MISSING|was not included into executable|Cannot find module.*\.node|ERR_DLOPEN"; then
  echo "FAIL: archive crashed on the browser-launch path" >&2
  exit 1
fi

echo "PASS"
