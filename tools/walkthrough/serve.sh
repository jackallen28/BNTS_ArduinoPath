#!/bin/sh
# Starts (or stops) ArduinoPath for recording a walkthrough: dev mode, a fresh
# data folder (so the student is new), port 8611.
#   tools/walkthrough/serve.sh        start it fresh
#   tools/walkthrough/serve.sh stop
set -e
cd "$(dirname "$0")/../.."
dir="${WALKTHROUGH_DIR:-$HOME/.cache/arduinopath-walkthrough}"
mkdir -p "$dir"
if [ -f "$dir/ap.pid" ]; then kill "$(cat "$dir/ap.pid")" 2>/dev/null || true; rm -f "$dir/ap.pid"; sleep 0.5; fi
[ "$1" = stop ] && exit 0
go build -o "$dir/arduinopath" ./cmd/arduinopath
rm -rf "$dir/data"
nohup "$dir/arduinopath" -dev -data "$dir/data" -port 8611 -idle-exit 0 > "$dir/arduinopath.out" 2>&1 &
echo $! > "$dir/ap.pid"
for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf http://localhost:8611/api/info >/dev/null && break; sleep 0.5; done
echo "ArduinoPath is ready on http://localhost:8611/"
