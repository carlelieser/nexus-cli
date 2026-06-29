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

echo "2/2 browser launch path"
out="$("$bin" import --file "$cookies" 2>&1 || true)"
echo "$out" | sed 's/^/    /'

if echo "$out" | grep -qiE "DYNAMIC_IMPORT_CALLBACK_MISSING|was not included into executable|Cannot find module|NODE_MODULE_VERSION|ERR_DLOPEN|invalid ELF|symbol not found"; then
  echo "FAIL: archive crashed on the browser-launch / native-addon path" >&2
  exit 1
fi

echo "PASS"
