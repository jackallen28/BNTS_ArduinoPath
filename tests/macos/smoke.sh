#!/bin/bash
# Starts the real ArduinoPath.app on macOS and uses it like the web app does:
# the app starts its background server and quits, then we make a profile,
# autosave some code, read it back, check a cross-site write is refused,
# and check that opening the app again just hands over. Used by CI and releases.
#   tests/macos/smoke.sh dist/ArduinoPath.app
set -euo pipefail
app="$1"
exe="$app/Contents/MacOS/ArduinoPath"
data="$(mktemp -d)/arduinopath-smoke"
base="http://localhost:47820"
jar="$(mktemp)"

cleanup() {
  pids=$(lsof -ti tcp:47820 -sTCP:LISTEN || true)
  [ -n "$pids" ] && kill $pids || true
  echo "--- arduinopath.log ---"
  tail -20 "$data/arduinopath.log" 2>/dev/null || true
}
trap cleanup EXIT

echo "Architectures: $(lipo -archs "$exe")"
codesign --verify --deep --strict "$app"
echo "Signature OK"

# The app starts the server in the background and quits once it's ready.
"$exe" -no-browser -data "$data"
info=$(curl -sf "$base/api/info")
echo "Started: $info"
grep -q '"app":"ArduinoPath"' <<<"$info"
pgrep -f "$exe" >/dev/null || { echo "the background server isn't running"; exit 1; }

curl -sf -c "$jar" -b "$jar" -H "X-ArduinoPath: 1" -H "Content-Type: application/json" \
  -d '{"names":["ava"],"school":"Test School"}' "$base/api/students" | grep -q '"names":\["Ava"\]'
curl -sf -c "$jar" -b "$jar" -X PUT -H "X-ArduinoPath: 1" -H "Content-Type: application/json" \
  -d '{"code":"// Hello from a Mac"}' "$base/api/me/sketches/freeplay" >/dev/null
curl -sf -b "$jar" "$base/api/me/sketches/freeplay" | grep -q 'Hello from a Mac'
echo "Profile made, code saved and read back"

# The board tools: built in, and they compile for a real Uno.
if [ "${ARDUINOPATH_EXPECT_TOOLS:-}" = 1 ]; then
  curl -sf "$base/api/tools" | grep -q '"built_in":true' || { echo "the board tools aren't built in"; exit 1; }
  id=$(curl -sf -b "$jar" -H "X-ArduinoPath: 1" -H "Content-Type: application/json" \
    -d '{"board":"uno","code":"void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n"}' \
    "$base/api/compile" | sed 's/.*"id":"\([0-9a-f]*\)".*/\1/')
  for i in $(seq 1 300); do
    job=$(curl -sf -b "$jar" "$base/api/jobs/$id")
    case "$job" in *'"state":"done"'*|*'"state":"failed"'*) break ;; esac
    sleep 2
  done
  case "$job" in *'"state":"done"'*) echo "Compiled for a real Uno with the built-in tools" ;; *) echo "compiling for the Uno failed: $job"; exit 1 ;; esac
fi

code=$(curl -s -o /dev/null -w '%{http_code}' -H "Content-Type: application/json" -d '{"confirm":"WIPE"}' "$base/api/wipe")
[ "$code" = 403 ] || { echo "a write without the X-ArduinoPath header got $code"; exit 1; }
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: evil.example:47820" "$base/api/info")
[ "$code" = 421 ] || { echo "another Host name got $code"; exit 1; }

# Opening it again while it's running just hands over and quits.
"$exe" -no-browser -data "$data-2"
[ "$(pgrep -f "$exe" | wc -l | tr -d ' ')" = 1 ] || { echo "a second server started"; exit 1; }
echo "Second launch handed over to the running copy"

# Opening it the Finder way (LaunchServices) works too.
pids=$(lsof -ti tcp:47820 -sTCP:LISTEN); kill $pids; sleep 1
open -W "$app" --args -no-browser -data "$data"
curl -sf "$base/api/info" >/dev/null
echo "Opened with 'open' (as from the Finder)"

[ -f "$data/arduinopath.db" ] || { echo "no database in $data"; exit 1; }
echo "macOS smoke test passed"
