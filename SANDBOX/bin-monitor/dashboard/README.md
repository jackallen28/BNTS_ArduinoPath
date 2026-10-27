# Uno-controlled bin with an ESP32-C3-Zero Wi-Fi relay

The Arduino Uno runs the entire bin: the original Grove approach sensor, closure-button homing, servo, LED and the added internal capacity sensor. The ESP32-C3-Zero receives completed Uno readings over a one-way UART and serves them, with this dashboard, over Wi-Fi. It has no sensor connections and makes no lid or capacity decisions. The Uno keeps working without the radio board, a phone or Wi-Fi.

## Programs to upload

- **Uno:** `firmware/uno_bin_controller/uno_bin_controller.ino`. Select **Arduino Uno** and install the standard Arduino Servo library if needed. Keep the supporting headers in the sketch folder.
- **ESP32-C3-Zero:** `firmware/esp32_c3_wifi_bridge/esp32_c3_wifi_bridge.ino`. Install Espressif's Arduino ESP32 core, select the correct ESP32-C3 board (commonly ESP32C3 Dev Module), and enable USB CDC On Boot for optional USB debug. Check your board vendor's flashing instructions. Keep `relay_protocol.h` and `dashboard_assets.h` beside the sketch. The display assets use flash space: choose a 4 MB flash layout with a sufficiently large application partition (for example a supported 3 MB/no-OTA layout); the exact menu depends on the board/core. Check the reported binary size before flashing. A default small OTA app partition may be too small.

`firmware/legacy_esp32_monitor/` is the archived earlier single-ESP32 experiment. It is not the program for this two-board wiring.

The new Uno program preserves the supplied working sketch's pin assignments, 30 cm detection threshold, 0° open command, 400 ms button-release check, fixed five-second opening/hold period, closing sweep at one degree per 15 ms until the closure button is pressed, 300 ms relaxation delay, servo detach, and two-second cooldown. Startup also homes before approach detection. Scheduling these phases without multi-second delays lets telemetry and capacity sampling continue. A sweep that never finds the button retains the original 90° fallback and reports a fault; it cannot claim a verified closed lid.

## Wiring: one data signal, plus essential common ground

See [the Uno + C3 wiring diagram](assets/uno-c3-wiring.svg). This is a connection schematic, not a physical pinout.

| Uno pin | Connection |
| --- | --- |
| D2 | Existing active-HIGH closure button; INPUT, not INPUT_PULLUP |
| D3 | Existing servo signal |
| D7 | Existing Grove single-signal approach ultrasonic sensor SIG |
| D8 | Existing status LED, with its current-limiting resistor |
| D6 | New Grove single-signal capacity ultrasonic sensor SIG |
| 5 V / GND | Grove sensor supply and common ground |
| D1 / TX | One-way telemetry through the divider below to C3 GPIO4 |

For a bare closure button: connect the switch between D2 and 5 V, with a 10 kΩ pulldown from D2 to GND. An existing button module may already provide this resistor. Keep the working active-HIGH arrangement from the original program.

The default second sensor is the same Grove single-signal type. If using an HC-SR04 for capacity instead, select the documented two-pin capacity option in the Uno sketch: TRIG D5, ECHO D6, VCC 5 V and GND. Both sensors are connected to the **5 V Uno**, so their echo signals do not go into ESP32 pins. Ultrasonic bursts alternate, separated by at least 60 ms, to reduce cross-talk.

### Uno-to-C3 signal

```text
Uno D1/TX ── 2.2 kΩ ──┬── ESP32-C3-Zero GPIO4 / UART RX
                      └── 3.3 kΩ ── common GND
Uno GND ─────────────────────────── C3 GND
```

The divider reduces nominal 5 V to about 3.0 V. **Never connect Uno TX directly to the C3's 3.3 V GPIO.** Use short wires and verify actual voltages. C3 TX is not connected. “One signal wire” means one data signal; shared ground and suitable power are still necessary. No acknowledgements or commands come back from Wi-Fi to the Uno.

Power the servo from a suitable regulated 5 V supply sized for its starting/stall current, with the supply ground joined to the Uno and C3 grounds. Do not power the servo from ESP32 3V3. Follow each board's power documentation; avoid backfeeding USB from an external supply. Either board can have its own USB power, but their grounds still need joining for UART. Uno D1 is also the hardware USB serial output; bootloader/debug noise is rejected by the bridge's framing and checksum checks. Do not add a second transmitter onto this signal.

## Capacity calibration

Mount the capacity sensor inside the bin facing the contents. Set `BIN_EMPTY_MM` and `BIN_FULL_MM` at the top of the Uno sketch to real measurements (now 220 mm empty, 200 mm full); `firmware/bin_calibration` shows the live distance to measure them. The Uno computes and filters the percentage, retains the last valid value on a sensor timeout, and marks it invalid while the lid is open/moving or not confirmed closed. It waits for the closed lid to settle and collects fresh samples before trusting capacity again. The dashboard displays last-known or unknown fill instead of pretending a timeout means empty.

The closure button detects the closed stop; it does not measure the complete lid angle. `lidOpen` is the Uno's command, `closedSwitch` is the button input, and `lidFault` identifies a failed home or failed release check. Check servo direction, mechanical travel, switch placement and fallback behaviour before unattended operation. Proximity control is not safety-certified obstruction detection.

## Wi-Fi use

After flashing both boards, power them and join **BNTS-Bin-Monitor** from your phone/laptop. Stay connected if the device warns there is no internet. Manually open **http://192.168.4.1** (HTTP, not HTTPS). The C3 creates the local access point and serves the dashboard from flash; no router, internet or USB data connection is needed by the viewing device. This is not an automatic captive portal.

The dashboard uses your supplied model animation frames: it plays them forward on an open command, holds the final frame while open, and reverses the same frames on a close command. It holds the first frame closed instead of looping continuously. Reduced-motion preferences show the relevant endpoint directly. The original bin/lid geometry is retained. The timber body panels are composited as translucent walls so the capacity reading can be seen as a rising pile of scrunched white paper inside the enclosure. A deterministic paper arrangement grows from the base toward the rim as the Uno percentage increases, with a short smooth transition between readings. There is no external fill bar. The frame, rear servo and animated lid remain opaque; the paper is clipped to the interior and becomes visible through the aperture when the lid opens. The paper is an illustration of capacity, not a sensor-derived count or identification of the actual rubbish. A small generated paper-ball texture is reused for the rubbish; the supplied bin is not redrawn. The currently downloadable source is your original MP4, retained at `assets/source/bin-opening.mp4`; the inline GIF messages did not expose a downloadable original GIF. `tools/prepare_bin_media.py` can pack the original `.gif` when that file is available, or reproduce the current assets from the MP4. The stored source frames are only cropped, resized and compressed; runtime transparency and paper overlays are separate.

The page polls same-origin `/api/telemetry`. The C3 forwards the original checked Uno JSON unchanged inside an envelope containing UART connection health and elapsed receive time. Missing/corrupt/stale Uno frames never become a fabricated zero-fill measurement. The dashboard shows the lid command and closure-switch/fault status. Simulation buttons are disabled while connected and do not command the real bin.

## UART and HTTP contract

UART: 115200 baud, 8N1, Uno TX only. One frame per 500 ms:

```text
@<Uno JSON>*<four uppercase CRC hex digits>\n
```

CRC-16/CCITT-FALSE covers the exact JSON bytes: polynomial 0x1021, initial 0xFFFF, no reflection or final XOR. JSON is limited to 192 bytes. Required fields: `fill` (integer 0–100), `lidOpen`, `sensorOk`, `ageMs` (unsigned milliseconds since the Uno's last valid capacity sample), `seq` (unsigned frame counter). Additional Uno booleans: `approachOk`, `lidMoving`, `closedSwitch`, `lidFault`, `homing`. This transport check is integrity checking, not encryption or authentication.

Example HTTP response:

```json
{"connected":true,"receivedAgeMs":8,"telemetry":{"fill":42,"lidOpen":false,"sensorOk":true,"ageMs":90,"seq":12,"approachOk":true,"lidMoving":false,"closedSwitch":true,"lidFault":false,"homing":false}}
```

Before any valid UART frame: `{"connected":false,"receivedAgeMs":null,"telemetry":null}`. After two seconds without a valid frame, `connected` becomes false and the last JSON is retained solely as last-known data. The C3 does not reinterpret or recompute any of its sensor fields.

Optional direct-Uno USB monitoring uses Chrome/Edge Web Serial on localhost or HTTPS. It accepts the same checksummed frames at 115200. The C3's USB port is for flashing/debug, not Uno sensor telemetry.

## Develop and validate

From the ArduinoPath repository root, install the pinned browser-test tools with `npm ci` (cloud cache: `npm ci --cache /workspace/.cache/npm`). Then:

```sh
cd SANDBOX/bin-monitor/dashboard
npm test
npm run test:firmware
python3 tools/embed_dashboard.py
python3 tools/embed_dashboard.py --check
npm start
```

With the server running, `node tests/bin-view-browser.mjs` verifies original source pixels outside the translucent interior, forward/reverse playback, endpoint holds, interrupted-motion reversal and reduced motion. `node tests/paper-fill-browser.mjs` checks empty/half/full paper, partial transparency, original frame/servo preservation, smooth simulation and mocked live Uno updates, stale-link retention, reduced motion and mobile fit, and captures the filling preview. `node tests/browser.mjs` checks simulation and direct-Uno USB framing. `node tests/wifi-browser.mjs` serves the actual embedded dashboard bytes through intercepted HTTP to test Uno-to-relay responses and Wi-Fi UI behaviour. `BIN_MONITOR_URL` overrides the server address. Cloud browser checks use Chromium at `/usr/bin/chromium`.

The embedding script writes `firmware/esp32_c3_wifi_bridge/dashboard_assets.h`; regenerate after dashboard, wiring or guide changes. The supplied source-video file and gallery GIF are kept in Git for reproducibility; only the compact frame atlas and manifest are embedded on the C3. No SD card, external CDN or separate filesystem upload is needed. The C3 serves static display assets but all bin control and capacity calculations remain on the Uno.

Host C++ tests exercise the actual controller and relay code, including serial integrity and cross-board framing. They are not AVR or ESP32-C3 target builds. Target compilation is currently blocked in this cloud environment by denied Arduino/Espressif package-download hosts. Physical tests still needed: both target builds/uploads, Uno startup/closing calibration and servo safety, two-sensor placement/cross-talk and capacity calibration, divider voltage and shared ground, C3 AP association/HTTP, unplugged-link recovery and power stability.
