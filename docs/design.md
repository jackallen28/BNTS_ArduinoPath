# ArduinoPath v1: how the pieces fit

The brief is [CLAUDE.md](../CLAUDE.md). This page is the contract between the parts of the app:
the board files, the circuit format in projects, the simulator engine, the circuit renderer, the
"bench" that joins them, checks, and the native compile / upload / Serial Monitor service.
Change it when a contract changes.

```
             content/ (data)                         ui/ (the web app, in Edge / Chrome)
 boards/*.json  projects/*.json  parts/index.json   ┌────────────────────────────────────────────┐
      │               │                │            │ screens/workspace.js  screens/wizard.js    │
      ▼               ▼                ▼            │        │                    │               │
  pin plan ──► {{pins}} header   circuit layout ───►│  bench.js (netlist + electrical model)     │
                     │                              │    ▲ events        │ inputs   ▲ controls   │
                     ▼                              │ sim/ (engine,      ▼          │             │
                student code ──────────────────────►│  Web Worker)   circuit/ (renderer: SVG)    │
                     │                              │ checks.js ◄── trace                        │
                     ▼                              └───────┬────────────────────────────────────┘
          ArduinoPath.exe / .app (Go)  ◄── /api/compile, /api/upload, /api/ports, /api/serial ──┘
          arduino-cli + board tools (built in) ──► USB ──► the real board
```

## 1. Boards (`content/boards/<id>.json`)

Besides name, FQBN and upload settings, each board file has:

| Field | Meaning |
|---|---|
| `power.vcc` | the logic-voltage pin: `"5V"` (AVR) or `"3V3"` (ESP) |
| `power.pins` | power pins on the board: `5V`, `3V3`, `GND`, `VIN` |
| `analog_max`, `pwm_max` | `analogRead` maximum (1023, or 4095 on ESP32) and `analogWrite` maximum (255) |
| `int_bits` | size of `int`: 16 on AVR, 32 on ESP (the simulator wraps `int` like the real board) |
| `led_builtin` | `{pin, active_low}` |
| `i2c`, `spi` | the bus pins (`sda`, `scl`; `mosi`, `miso`, `sck`, `ss`) |
| `pins[]` | every usable pin: `code` (what goes in code: `"13"`, `"A0"`, `"D5"`, `"23"`), `number` (the Arduino pin number the code means: NodeMCU `D5` = 14, Uno `A0` = 14), `label` (printed on the board), `modes` (`digital`, `pwm`, `analog`, `input` = input only), `note` |
| `pin_plan` | the **standard pin plan**: role → pin `code`, e.g. `"LED_RED": "12"` |

Roles: `LED_PIN`, `LED_RED`, `LED_YELLOW`, `LED_GREEN`, `LED_BLUE`, `RGB_RED/GREEN/BLUE`,
`BUTTON_PIN`, `BUTTON2_PIN`, `BUTTON_RED/YELLOW/GREEN/BLUE`, `BUZZER_PIN`, `SERVO_PIN`, `POT_PIN`,
`LDR_PIN`, `SOIL_PIN`, `JOY_X_PIN`, `JOY_Y_PIN`, `JOY_SW_PIN`, `PIR_PIN`, `DHT_PIN`, `TRIG_PIN`,
`ECHO_PIN`, `NEOPIXEL_PIN`, `TM1637_CLK`, `TM1637_DIO`, `MATRIX_DIN`, `MATRIX_CLK`, `MATRIX_CS`,
`RFID_SS`, `RFID_RST`, `KEYPAD_R1..R4`, `KEYPAD_C1..C4`. A project uses the roles it needs and may
override them (§2). I²C and SPI parts use the board's bus pins, not roles.

**Constants the simulator defines for a board:** every pin `code` that isn't a plain number
(`A0`, `D5`...) = its `number`; `LED_BUILTIN`; `SDA`, `SCL`, `MOSI`, `MISO`, `SCK`, `SS`;
`HIGH`/`LOW`/`INPUT`/`OUTPUT`/`INPUT_PULLUP`, etc.

## 2. Projects: pins, circuit and wiring steps

```jsonc
{
  "pins": {                       // optional overrides of the standard pin plan
    "avr":     { "SERVO_PIN": "10" },          // by family, board id, or "all"
    "nodemcu": { "LED_GREEN": "D0" }
  },
  "circuit": {
    "breadboard": "half",         // "half" (Fritzing's half+ breadboard) or "none" (screen only)
    "parts": [
      // On the breadboard: "at" is the hole of the part's first leg, "rotate" 0/90/180/270.
      // The part's footprint (ui/parts/<type>/part.json) gives the other legs' holes.
      { "id": "red", "type": "led", "color": "red", "at": "E12", "rotate": 0, "step": 1 },
      { "id": "r1", "type": "resistor-220", "at": "D11", "rotate": 90, "step": 1 },
      // Off the breadboard (servo, keypad, LCD...): a position in the drawing, connected by wires.
      { "id": "servo", "type": "servo", "offboard": { "x": 620, "y": 40 }, "step": 2 },
      // Only on 3.3V boards (or only on 5V boards): "when": "3v3" / "5v"
      { "id": "div1", "type": "resistor-10k", "at": "H20", "rotate": 0, "when": "3v3", "step": 3 }
    ],
    "wires": [
      { "from": "pin:LED_RED", "to": "A12", "step": 1 },     // a role, through the pin plan
      { "from": "board:GND", "to": "TN1", "step": 1 },       // board power pin: 5V, 3V3, GND, VIN, VCC (= logic voltage)
      { "from": "part:servo:signal", "to": "pin:SERVO_PIN", "step": 2 },
      { "from": "board:VCC", "to": "part:servo:power", "step": 2, "color": "red" }
    ]
  },
  "wiring_steps": [                // the Wiring Wizard's screens, in order (step numbers above count from 1)
    { "title": "The red LED", "text": "Push the red LED into the breadboard..." }
  ]
}
```

**Breadboard holes** (Fritzing half+): terminal strips `A1`–`J30` (columns 1–30, rows A–E joined
in each column, rows F–J joined in each column, the centre gap between E and F); power rails
`TP1`–`TP25` (top +), `TN1`–`TN25` (top −), `BP1`–`BP25` (bottom +), `BN1`–`BN25` (bottom −); each
rail line is joined end to end. **Endpoints** of a wire: a hole, `pin:<ROLE>`, `pin:<code>` (a
board pin by code, e.g. `pin:LED_BUILTIN` or `pin:A0`), `board:<power>`, `part:<id>:<leg>`.
Wire colours default to: red = VCC / 5V / 3V3, black = GND, otherwise by signal.

`board:5V` on a board without a 5V pin (NodeMCU, ESP32 DevKit) means VIN (the USB's 5V). 5V parts
(servo, HC-SR04, PIR, NeoPixels, the LED matrix) take the + rail on 5V boards and `board:5V` on 3.3V
boards (`when`), and the HC-SR04's echo goes through a 10k/10k divider on 3.3V boards.

**Wiring step text** may say `{{pin:ROLE}}` (becomes "pin 12" / "pin D5", the label on the student's
board), `{{VCC}}` ("5V" / "3V3"), `{{5V}}` ("5V", or "VIN"), `{{3V3}}` and `{{board}}`:
`fillWiringText(text, board, pins)` in `ui/js/circuit/wiring-text.js`. The first step starts with
the USB safety line. `internal/content/circuit_test.go` checks every circuit on every board.

**`{{pins}}`** in a step's `starter` or `demo` becomes the pin header for the student's board:

```cpp
// Pins for your Arduino Uno (from the Wiring Wizard)
#define LED_RED 12
#define LED_YELLOW 11
```

(only the roles the project's circuit and code use, in the order they first appear in the circuit).

## 3. Parts (`content/parts/index.json` + `ui/parts/`)

- `content/parts/index.json` (teacher-editable text): per type `name`, `plural`, `group`,
  `needs_5v`, and for the Wiring Wizard's **Meet the parts**: `what` (one or two sentences),
  `legs` (how to tell which leg is which), `did_you_know`.
- `ui/parts/<type>/part.json` (generated by `tools/import_fritzing`, from the Fritzing parts
  library, CC BY-SA 3.0): `legs` (leg names, e.g. `anode`, `cathode`), `footprint` (each leg's
  offset in holes from the first leg, at `rotate: 0`, or `null` for off-board parts), connector
  coordinates in the breadboard and schematic SVGs, `colors` (LED colours), and `behaviour`
  (`led`, `rgb-led`, `resistor`, `button`, `buzzer`, `potentiometer`, `ldr`, `servo`, ...: what the
  bench simulates). Art: `ui/parts/<type>/breadboard.svg`, `schematic.svg`; boards in
  `ui/parts/boards/<board id>/`; the breadboard in `ui/parts/breadboard/`.

## 4. Simulator engine (`ui/js/sim/`)

Runs the student's sketch. No DOM: the same code runs in a Web Worker in the browser and in
Node for tests.

```js
import { compile } from "./sim/compiler.js";
compile(source, board) // → { ok: true, program } | { ok: false, errors: [{ line, col, message }] }
```

Error messages are worded like avr-gcc's (`expected ';' before '}' token`, `'ledPin' was not
declared in this scope`, `'digitalwrite' was not declared in this scope; did you mean
'digitalWrite'?`, `expected '}' at end of input`, `fatal error: Foo.h: No such file or directory`),
so the Coach's errors database (`content/errors.json`) explains simulator and real-compiler errors
the same way. C++ the simulator can't run gives `{ unsupported: true, message }` ("the simulator
can't run this part, but the real board can: press Upload").

```js
import { Simulation } from "./sim/simulation.js";     // browser: wraps the worker
const sim = new Simulation({ board, onEvents: (events) => {}, onError, onStop });
sim.start(source); sim.stop(); sim.setSpeed(1);
sim.setInputs({ digital: { 2: 0 }, analog: { 14: 512 }, pulse: { 7: 1160 }, dht: { 4: { t: 22.5, h: 40 } } });
sim.serialWrite("hello\n"); sim.pressKey("5"); sim.tapCard([0xde, 0xad, 0xbe, 0xef]);
sim.http({ method: "GET", path: "/on", query: {} }).then((res) => {});   // the phone panel

import { runHeadless } from "./sim/headless.js";       // Node / tests: as fast as possible
runHeadless(source, { board, ms: 5000, events: simEvents, inputs })
  // → { ok, errors, events: [...], serial: "...", stopped_at_ms }
```

- **Inputs** (`setInputs`, merged): `digital[pinNumber]` = 0 / 1 / `null` (floating: reads HIGH
  with `INPUT_PULLUP`, else LOW), `analog[pinNumber]` = 0..`analog_max`, `pulse[echoPin]` = µs
  that `pulseIn` returns, `dht[pin]` = `{ t, h }`.
- **Events** (batched, each with `t` = simulated ms): `pinMode {pin, mode}`, `digital {pin, value}`,
  `pwm {pin, value}`, `tone {pin, freq}`, `noTone {pin}`, `serial {text}`, `servo {pin, angle}`,
  `neopixel {pin, pixels: [[r,g,b]...]}`, `oled {addr, width, height, buffer}` (1 bit per pixel),
  `lcd {addr, lines, backlight}`, `tm1637 {clk, dio, segments}`, `matrix {cs, rows}`,
  `display_text {text}` (any text drawn to a display, for checks), `wifi {status, ip}`,
  `http_route {method, path}`, `error {kind: "runtime" | "unsupported", line, message}`,
  `warning {kind: "busy-loop", line}` (stuck in a loop without `delay()` for 2 s of real time),
  `stopped {reason}`.
- **Timing:** simulated time. `delay()` advances it; each executed statement costs a little
  (so `while (millis() - start < 1000)` finishes). The worker paces simulated time to the real
  clock (`setSpeed`), with an instruction budget per frame, so the page never freezes.
- **Faithful details:** `int` wraps at `int_bits`, integer division truncates, `double` is a
  `float` on AVR, `String`, arrays, `#define` (with arguments), `const`, `enum`, `struct`,
  `switch`, functions, `static` locals, `F()`, `PROGMEM` (ignored).
- **Libraries:** Servo, Adafruit_NeoPixel, DHT, Wire, SPI, Adafruit_SSD1306 + Adafruit_GFX,
  LiquidCrystal_I2C, TM1637Display, Keypad, MFRC522, MD_MAX72XX, ESP8266WiFi / WiFi,
  ESP8266WebServer / WebServer, time / NTP (`configTime`, `getLocalTime`: the laptop's clock).

## 5. Checks (`ui/js/sim/checks.js`)

A step's `checks[]`, each with a `label` (the checklist line). Evaluated after a Run (simulator)
or an Upload (real board: code checks, compiles, and the student's "I saw it happen" ticks).

| `type` | fields | passes when |
|---|---|---|
| `code_contains` | `text` | the code contains it (comments ignored) |
| `code_regex` | `pattern`, `flags` | the code matches |
| `uses_function` | `name` | the code calls it |
| `compiles` | | it compiles (simulator, or the real compiler for Upload) |
| `runs` | `ms` | runs that long without an error |
| `serial_contains` / `serial_regex` | `text` / `pattern` | in the Serial Monitor output |
| `pin_seen` | `pin` (role or code), `value` (`HIGH`/`LOW`), `times` | the pin was set to it at least `times` |
| `pwm_seen` | `pin`, `min`, `max` | an `analogWrite` in range |
| `tone_seen` | `pin`, `min_hz`, `max_hz` | a tone in range |
| `servo_angle` | `pin`, `angle`, `tolerance` | the servo reached it |
| `display_text` | `text` | any display showed it |
| `neopixel_lit` | `pin`, `count` | at least `count` pixels lit |
| `run_count` | `min` | the student has run the step that many times |
| `confirm` | `text` | the student ticks "I saw it happen" (real board) |

`checks.evaluate(checks, { code, board, project, result, runs, confirmed }) → [{ ok, label }]`.

**CI:** every step's `demo` (with `{{pins}}` filled in for every board the project lists) runs
headless with its `sim_events` (`[{ at_ms, set: { digital|analog|pulse|dht: {...} } }]`,
`{ at_ms, serial }`, `{ at_ms, key }`, `{ at_ms, card }`, `{ at_ms, http: {...} }`, with role
names allowed for pins) and must pass every automatic check; and compiles with arduino-cli for
every board (the CI boards job).

## 6. Circuit renderer (`ui/js/circuit/`)

```js
import { drawBreadboard, drawSchematic } from "./circuit/render.js";
const view = drawBreadboard(container, { board, circuit, parts, pins, step, showAll });
view.setStep(n);                 // new parts/wires of step n highlighted, earlier ones faded, later hidden
view.setState({ led: { red: 0.8 }, rgb: { rgb1: [255, 0, 0] }, servo: { servo: 90 }, buzzer: { bz: 440 },
  neopixel: { ring: [[r,g,b], ...] }, oled: { oled: buffer }, lcd: { lcd: ["Hello", ""] },
  tm1637: { disp: segments }, matrix: { m: rows }, button: { b1: true } });
view.onControl((partId, control, value) => {});   // button press/release, pot 0..1, sliders
view.destroy();
import { buildNetlist, validateCircuit } from "./circuit/netlist.js";
```

Units are 0.01 inch (the breadboard pitch is 10); offboard positions are measured from the
breadboard's top-left corner, and the board sits to its left (tall boards turned on their side).
`loadParts({types, boards})` / `loadCircuitParts(circuit, board)` (`./parts.js`) fetch the part
catalogue the renderer and netlist take. `buildNetlist(...)` returns `nets` and helpers
(`legNet`, `pinNet`, `powerNet`, `pinsForLeg`, `powerForLeg`, `legsOnNet`, `joined`, `legHoles`).

Controls drawn on parts: buttons (press with the mouse), a knob on pots and joysticks, sliders
for LDR light, distance (HC-SR04), temperature and humidity (DHT), soil moisture, a "wave" button
on the PIR, keys on the keypad, a card to tap on the RFID reader.

## 7. The bench (`ui/js/bench.js`)

Joins a running simulation to the drawing: builds the netlist (breadboard strips, rails, wires,
resistors and pressed buttons as connections), turns engine events into part states (an LED
lights when its anode net is driven HIGH or PWM and its cathode net reaches GND), and part
controls into engine inputs (a pressed button joining a pin's net to GND reads LOW; a pot's wiper
gives `analog_max` × position; an LDR divider gives a value from the light slider; an HC-SR04
echo gives `pulse` = cm × 58 µs).

## 8. Real boards (Go: `/api/...`)

The board tools (arduino-cli, the AVR, ESP8266 and ESP32 cores and every library, pinned in
`internal/arduino/requirements.json`) are **built into** ArduinoPath.exe / ArduinoPath.app and
unpacked to the data folder the first time a family is used (with a progress bar).

| API | |
|---|---|
| `GET /api/tools` | each family: `ready`, `unpacking` (progress), `missing` |
| `POST /api/compile {code, board, variant}` | → job id; one compile at a time per laptop |
| `POST /api/upload {code, board, variant, port}` | → job id: compile, then upload |
| `GET /api/jobs/{id}` | `{state: queued|compiling|uploading|done|failed, output, errors: [{file, line, col, message}], size: {flash, flash_max, ram, ram_max}}` |
| `GET /api/ports` | serial ports with a board guess: `[{port, label, vid, pid, board}]` |
| `GET /api/serial?port=&baud=` | Server-Sent Events of text from the port (the Serial Monitor) |
| `POST /api/serial/write {port, text}`, `POST /api/serial/close {port}` | |

Uploading closes the Serial Monitor on that port first and reopens it after. Compiles run in a
temporary folder with a time limit. The Coach maps `errors` (and upload failures) through
`content/errors.json`.
