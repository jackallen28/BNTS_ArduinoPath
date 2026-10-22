#!/bin/bash
# Starts the real ArduinoPath for Raspberry Pi (64-bit Linux on ARM) and uses
# it like the web app does: make a profile, autosave some code and read it
# back, compile for an Uno with the built-in tools, check a cross-site write
# is refused, check a second start just hands over, and check the menu and
# desktop shortcuts were added. Used by CI and releases.
#   tests/linux/smoke.sh dist/ArduinoPath/ArduinoPath
set -euo pipefail
exe="$(realpath "$1")"
home="$(mktemp -d)"
data="$home/.config/ArduinoPath"
base="http://localhost:47820"
jar="$(mktemp)"
mkdir -p "$home/Desktop"

cleanup() {
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null || true
  echo "--- arduinopath.log ---"
  tail -20 "$data/arduinopath.log" 2>/dev/null || true
}
trap cleanup EXIT

echo "File: $(file -b "$exe" | cut -c1-80)"
# The default data folder (~/.config/ArduinoPath), as on a real Pi.
HOME="$home" XDG_CONFIG_HOME= XDG_DATA_HOME= "$exe" -no-browser &
pid=$!
for i in $(seq 1 100); do
  curl -sf "$base/api/info" >/dev/null && break
  sleep 0.2
done
info=$(curl -sf "$base/api/info")
echo "Started: $info"
grep -q '"app":"ArduinoPath"' <<<"$info"

curl -sf -c "$jar" -b "$jar" -H "X-ArduinoPath: 1" -H "Content-Type: application/json" \
  -d '{"names":["ava"],"school":"Test School"}' "$base/api/students" | grep -q '"names":\["Ava"\]'
curl -sf -c "$jar" -b "$jar" -X PUT -H "X-ArduinoPath: 1" -H "Content-Type: application/json" \
  -d '{"code":"// Hello from a Pi"}' "$base/api/me/sketches/freeplay" >/dev/null
curl -sf -b "$jar" "$base/api/me/sketches/freeplay" | grep -q 'Hello from a Pi'
echo "Profile made, code saved and read back"

# Looking for boards plugged in works (there are none on CI).
curl -sf "$base/api/ports" | grep -q '^\['
echo "Port list OK"

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

# Starting it again while it's running just hands over and stops.
HOME="$home" timeout 20 "$exe" -no-browser -data "$home/second"
kill -0 "$pid" || { echo "the first copy stopped"; exit 1; }
echo "Second start handed over to the running copy"

# The Raspberry Pi menu entry and desktop icon point at this app.
grep -q "Exec=\"$exe\"" "$home/.local/share/applications/arduinopath.desktop"
grep -q "Exec=\"$exe\"" "$home/Desktop/arduinopath.desktop"
[ -s "$home/.local/share/icons/hicolor/256x256/apps/arduinopath.png" ]
echo "Menu entry and desktop icon added"

[ -f "$data/arduinopath.db" ] || { echo "no database in $data"; exit 1; }
echo "Raspberry Pi smoke test passed"
