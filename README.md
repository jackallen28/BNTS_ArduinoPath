# ArduinoPath

A step-by-step Arduino and ESP coding tutor for secondary students, made for the
Banyule Nillumbik Tech School (BNTS).

- **One app on each student computer: `ArduinoPath.exe` (Windows), `ArduinoPath.app` (Mac) or
  ArduinoPath for Raspberry Pi** (Pi 4 / 5, 64-bit Raspberry Pi OS: see
  [docs/raspberry-pi.md](docs/raspberry-pi.md)). Double-click it and ArduinoPath opens in Edge,
  Chrome or Chromium. Nothing to install, no admin rights, no server, no internet needed.
- **Welcome screen like PiPath:** students pick their name, or make a profile with their first
  name(s) and school. Work saves on the laptop by itself.
- **A WIPE page** clears the laptop for the next group (after offering to save everyone's work).
- A **simulator** for every project, and **upload to real boards** from the browser: Arduino Uno,
  Arduino Nano, NodeMCU and other ESP8266 / ESP32 boards.
- Every project starts with a **Wiring Wizard**: meet the parts, wire them step by step with
  breadboard and schematic diagrams, then a test program checks your wiring before you start coding.
- A **Coach** explains errors in plain English, with hints that adapt to each student.
  No AI: every hint was written and reviewed by teachers.
- A Windows Vista look in the school's colours.

Status: being built. The skeleton is done: the Windows and Mac apps, profiles, autosave, save files, the
WIPE page, the Vista look, and welcome → setup → project picker. The full brief is in
[CLAUDE.md](CLAUDE.md); what's built so far is in [docs/development.md](docs/development.md).

## Trying it on a student laptop

Download from the latest release (or from a CI run's downloads):

- **Windows:** `ArduinoPath.exe`, then double-click it. See [docs/windows-app.md](docs/windows-app.md).
- **Mac:** `ArduinoPath-macOS.zip`, then drag ArduinoPath into Applications. See
  [docs/mac-app.md](docs/mac-app.md).

The guides say what to expect, where the work is kept, and what to do if Windows or macOS blocks
it the first time.

## For developers

You need Go 1.24+. Node 22 is only needed to run the JavaScript and browser tests.

```
go run ./cmd/arduinopath -dev            # then open http://localhost:8080
go test ./...                            # Go tests
npm ci && npm test                       # JavaScript tests
npm run e2e                              # GUI smoke test (Playwright)
```

Build the Windows app (from any computer):

```
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w -X arduinopath.Version=1.0.1" -o dist/ArduinoPath.exe ./cmd/arduinopath
```

Build the Mac app (from any computer; sign it on a Mac with `codesign --force --deep -s -`):

```
for a in amd64 arm64; do CGO_ENABLED=0 GOOS=darwin GOARCH=$a go build -trimpath -ldflags "-s -w" -o dist/arduinopath-$a ./cmd/arduinopath; done
go run ./tools/macapp -version 1.0.1 -amd64 dist/arduinopath-amd64 -arm64 dist/arduinopath-arm64 -out dist
```

See [docs/development.md](docs/development.md) for how it fits together. To publish a release,
change the `VERSION` file: the Release workflow tests both apps on Windows and macOS and
publishes them.

Part images come from the [Fritzing parts library](https://github.com/fritzing/fritzing-parts)
(CC BY-SA 3.0).
