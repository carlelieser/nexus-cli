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

# Run the bundled launcher. On Windows the launcher is a .cmd, which Git Bash
# can't exec directly — invoke it through cmd. Extract with the same tool that
# created the archive (Expand-Archive), since unzip mangles the backslash paths
# PowerShell's Compress-Archive writes.
if [ "$os" = "win" ]; then
  powershell -NoProfile -Command \
    "Expand-Archive -Path 'binaries/${NAME}.zip' -DestinationPath '$work' -Force"
  launcher="$work/${NAME}/nexus.cmd"
  run() { MSYS_NO_PATHCONV=1 cmd //c "$(cygpath -w "$launcher")" "$@"; }
else
  tar -xzf "binaries/${NAME}.tar.gz" -C "$work"
  launcher="$work/${NAME}/nexus"
  run() { "$launcher" "$@"; }
fi

echo "1/2 --help"
run --help

# Drive `import --file` with a fake-but-non-empty cookie file. The file source
# always succeeds (unlike `--from chrome`, which bails before launch on a CI
# runner with no Chrome installed), so importSession proceeds to validate ->
# browser.launch() -> Camoufox().launch() -> sampleWebGL -> openDatabase: the
# sqlite/native-addon path. The login check then fails on the fake cookies,
# but that is AFTER the native addon has loaded. We only assert we got past the
# launch machinery without an ABI / missing-.node / dynamic-import crash.
cookies="$work/cookies.json"
cat > "$cookies" <<'JSON'
[{ "name": "nexusmods_session", "value": "smoke", "domain": ".nexusmods.com", "path": "/" }]
JSON
# The launcher runs through cmd on Windows, so pass it a native path.
cookies_arg="$cookies"
[ "$os" = "win" ] && cookies_arg="$(cygpath -w "$cookies")"

echo "2/2 browser launch path"
out="$(run import --file "$cookies_arg" 2>&1 || true)"
echo "$out" | sed 's/^/    /'

if echo "$out" | grep -qiE "DYNAMIC_IMPORT_CALLBACK_MISSING|was not included into executable|Cannot find module|NODE_MODULE_VERSION|ERR_DLOPEN|invalid ELF|symbol not found"; then
  echo "FAIL: archive crashed on the browser-launch / native-addon path" >&2
  exit 1
fi

echo "PASS"
