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

# Run the bundled Node against the app entry directly. Git Bash can exec the
# .exe but not the .cmd wrapper (and routing through cmd mangles args), so we
# bypass the launcher here — it's the same runtime + app the launcher invokes.
# Extract the Windows zip with Expand-Archive (it was made by Compress-Archive;
# unzip mangles its backslash paths).
if [ "$os" = "win" ]; then
  powershell -NoProfile -Command \
    "Expand-Archive -Path 'binaries/${NAME}.zip' -DestinationPath '$work' -Force"
  app="$work/${NAME}"
  run() { "$app/bin/node.exe" "$app/app/dist/cli/index.js" "$@"; }
else
  tar -xzf "binaries/${NAME}.tar.gz" -C "$work"
  app="$work/${NAME}"
  run() { "$app/bin/node" "$app/app/dist/cli/index.js" "$@"; }
fi

echo "1/2 --help"
help_out="$(run --help 2>&1 || true)"
echo "$help_out" | sed 's/^/    /'
# Assert nexus actually ran — guards against a launcher/exec quirk that exits
# 0 without running the app (a silent false pass).
if ! echo "$help_out" | grep -q "nexus <command>"; then
  echo "FAIL: --help did not produce nexus help output" >&2
  exit 1
fi

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
cookies_arg="$cookies"
[ "$os" = "win" ] && cookies_arg="$(cygpath -w "$cookies")"

echo "2/2 browser launch path"
out="$(run import --file "$cookies_arg" 2>&1 || true)"
echo "$out" | sed 's/^/    /'

if echo "$out" | grep -qiE "DYNAMIC_IMPORT_CALLBACK_MISSING|was not included into executable|Cannot find module|NODE_MODULE_VERSION|ERR_DLOPEN|invalid ELF|symbol not found"; then
  echo "FAIL: archive crashed on the browser-launch / native-addon path" >&2
  exit 1
fi

# Assert the run actually reached the app: it read the cookie file (so it got
# into importSession), rather than failing to start. Without this, an exec
# quirk that prints nothing would pass.
if ! echo "$out" | grep -qiE "cookie|nexus|logged in|auth"; then
  echo "FAIL: launch path produced no recognizable nexus output" >&2
  exit 1
fi

echo "PASS"
