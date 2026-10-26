# BNTS Bin Monitor

Existing SANDBOX dashboard, extended with Wi-Fi and a timber-box bin matching the supplied CAD reference. The illustration has honey-coloured wooden panels, charcoal top/base frames, a rear micro-servo and an independently hinged lid. It uses ArduinoPath's actual vanilla ES modules (`h`, `appWindow`), Vista theme and icon sprite, copied unchanged to `vendor/` from `BNTS_ArduinoPath/ui/`. The official school logo comes from `BNTS_PIPath/data/brand/logo_full_300.png`. The main ArduinoPath application stays separate from this experiment under SANDBOX.

## Preview and simulation

From the ArduinoPath repository, run `cd SANDBOX/bin-monitor/dashboard` then `npm start` (Python 3). The cloud working copy at `/workspace/SANDBOX` supports the same commands. This serves the existing dashboard on port 8090 with no application dependency install. Use the fill slider, add waste, empty bin and open/close lid buttons. Auto demo updates every 1.5 seconds. The lid rotates continuously about its rear hinge rather than swapping open/closed images. A separate teal fill indicator visualises the reading while the timber walls stay opaque. The illustrated servo matches the reference hardware; the current sketch reports lid-switch state and does not actuate a servo. Warnings start at 70% and 90%; reduced-motion preferences disable transitions. The activity list keeps the latest 15 events in memory. No student data is stored.

The generated `wifi-preview.png` shows this same dashboard with explicitly labeled **simulated ESP32 readings**. It is not proof of hardware connectivity.

## Wi-Fi: open the dashboard directly from the ESP32

1. Generate the embedded dashboard with `python3 tools/embed_dashboard.py` after any UI, guide, logo or diagram changes. This writes `firmware/bin_monitor/dashboard_assets.h`; no SD card, external website, CDN or separate filesystem upload is needed.
2. Open `firmware/bin_monitor/bin_monitor.ino` in Arduino IDE. Install the official Espressif ESP32 core, select the correct **classic ESP32 DevKit** model and port, then compile and upload. The sketch uses only bundled `WiFi.h` and `WebServer.h` libraries. Firmware target compilation is currently unverified in this cloud environment: the core installation was blocked by HTTP 403 from `downloads.arduino.cc` and `espressif.github.io`.
3. After this initial flash, power the ESP32 from a suitable regulated supply or USB charger/power bank. A USB data connection to the viewing device is **not required**. Do not connect an external supply and USB together without checking the board's power schematic.
4. In the phone/laptop Wi-Fi settings, join **BNTS-Bin-Monitor**. It is an open classroom demonstration network with no password. If prompted that there is no internet, choose to stay connected. The AP supplies its own local network; it does not need a router or internet. This is not an automatic captive portal.
5. Manually open **http://192.168.4.1** (HTTP, not HTTPS). The ESP32 serves the same dashboard, theme, logo and scripts from flash. It automatically starts same-origin `/api/telemetry` polling, approximately twice a second. It never requests USB access in this mode. This avoids browser mixed-content, CORS and Web Serial secure-context restrictions. Opening the cloud/local development page does not join the ESP Wi-Fi; open the board address after joining its network.
6. Fill changes animate the bin level; reed-switch changes animate the lid. Simulation controls are locked while live. **Return to simulation** pauses monitoring; **Connect via Wi-Fi** resumes. Disconnects, malformed telemetry and stale/failed sensor readings are identified rather than presented as live. The dashboard retries failed HTTP requests automatically.

## Wiring and calibration

See [the wiring diagram](assets/esp32-wiring.svg). It is a connection schematic, not a physical board pinout; check your board's labels. GPIO assignments below are for classic ESP32 DevKit, not ESP32-C3/S3 or ESP8266.

| ESP32 connection | Peripheral |
| --- | --- |
| 5V/VIN board supply, check board documentation | HC-SR04 VCC (5 V) |
| GND | HC-SR04 GND and shared ground |
| GPIO5 | HC-SR04 TRIG |
| GPIO18 | Divider junction: HC-SR04 ECHO → 1 kΩ → junction; junction → 2 kΩ → GND |
| GPIO19 | Reed switch to GND, switch closed when lid closed; internal INPUT_PULLUP |

**Never connect HC-SR04's 5 V ECHO directly to the ESP32's 3.3 V GPIO.** The divider shown reduces nominal 5 V to about 3.33 V; check actual voltage and resistor tolerances on your hardware. Mount the ultrasonic sensor facing into the bin, away from the moving lid. Set `EMPTY_CM` and `FULL_CM` to measured distances (defaults 40 cm and 5 cm). Opening the lid is visual feedback from the switch; the sketch does not drive a servo or motor.

## Telemetry and optional USB

`GET /api/telemetry` returns uncached JSON:

```json
{"fill":42,"lidOpen":false,"sensorOk":true,"ageMs":0}
```

`fill`: finite 0–100, `lidOpen`: boolean, `sensorOk`: last distance measurement succeeded, `ageMs`: milliseconds since the last good distance sample. Sampling runs every 500 ms. On timeout the firmware retains the previous fill, marks `sensorOk:false` and keeps sampling the lid. The dashboard continues lid animation and labels the fill as last known. Data older than five seconds is not displayed as live. Before the first valid reading the fill is unknown, not a simulated measurement.

Optional desktop USB mode still accepts newline-delimited JSON at 115200 baud via Chrome/Edge Web Serial on localhost or HTTPS. Close Arduino IDE's Serial Monitor first. Both the updated extended payload and the original `{fill,lidOpen}` format work. Web Serial is optional and is not used by Wi-Fi access at the board's HTTP address.

## Validation

- `npm test`: telemetry ranges, sensor health, stale metadata and serial framing.
- `node --check app.js`: module syntax.
- `python3 tools/embed_dashboard.py --check`: embedded firmware assets match the dashboard sources.
- `node tests/bin-view-browser.mjs`: actual open/closed browser captures and animated GIF; checks intermediate lid positions, fixed hinge, fill indicator, mobile fit and reduced motion. Requires the development server.
- `node tests/browser.mjs`: simulation, fill/lid controls, mocked USB and mobile layout; requires the development server.
- `node tests/wifi-browser.mjs`: intercepts browser requests to `http://192.168.4.1` with packaged dashboard assets and simulated telemetry. Checks automatic Wi-Fi connection, no USB calls, live fill/lid animation, timeouts, stale data, recovery and mobile layout. It does not contact a physical board.

Browser tests use the existing pinned Playwright dependency in the ArduinoPath repository (run `npm ci` at the repository root) and `/usr/bin/chromium`. In this cloud workspace use `npm ci --cache /workspace/.cache/npm` to keep the cache writable. `BIN_MONITOR_URL` overrides the local development-server address for screenshot/USB tests. Node 22+ is needed for tests. Browser tests generate preview screenshots in SANDBOX. Regenerate embedded assets before flashing whenever dashboard files change.

Still requiring real hardware: compile/upload for the selected board, power stability, actual AP association and DHCP/address access from a phone/laptop, real on-board HTTP serving and polling, RF range/reconnection, divider voltage, sensor readings/calibration, and lid-switch orientation/bounce. Cloud browser tests demonstrate the dashboard protocol and animation, not those physical results.
