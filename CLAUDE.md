# ArduinoPath: Arduino and ESP coding tutor (BNTS)

> The brief for Claude Code. Read it fully before building anything. It records every decision
> the teacher has made: what ArduinoPath is, the rules, the architecture, the wiring wizard,
> the simulator, the boards, the projects and what to build first.
>
> **This is a separate project from PiPath** (the school's Raspberry Pi Python tutor). Nothing is
> shared: no code, no files, no submodules. The ideas below carry over; the code is written fresh.

---

## 1. What ArduinoPath is

ArduinoPath teaches Arduino C++ on real boards (Arduino Uno, Arduino Nano, NodeMCU, other ESP8266 /
ESP32 boards) like a tutor sitting beside the student. It is **one app on each student's laptop:
`ArduinoPath.exe` on Windows, `ArduinoPath.app` on a Mac**, like PiPath: double-click it and the
web app opens in **Edge or Chrome** as an app window. Nothing to install, no admin rights, **no server and no teacher
controls**. Work is saved on the laptop. Everything works without the internet.

> **History:** ArduinoPath was first planned as a web app served by a Raspberry Pi 5 on the school
> network, then as a cloud server (Render + Postgres) with student codes and staff logins. The
> school network blocked the Pi, and the teacher chose a local Windows app instead. The cloud work
> is parked in the git history (the "Park the unfinished cloud version" commit).
>
> **Renamed:** the app was called **CircuitPath** until October 2026, in the `BNTS_CircuitPath`
> branch of `jackallen28/jackallen`. It is now **ArduinoPath**, in its own repository,
> **`jackallen28/BNTS_ArduinoPath`** (base branch `main`; PRs go there). The Raspberry Pi tutor
> (PiPath) has its own repository. On first start, `ArduinoPath.exe` / `.app` moves work saved
> by CircuitPath (the `CircuitPath` data folder and `circuitpath.db`) to the new name, so nothing
> is lost. Save files keep the `.circuit` extension, so old save files still open.

Audience: secondary students (Years 7–10), new to text-based coding and electronics. Content links
to the **Victorian Curriculum Digital Technologies (Levels 7–10)**. Made for the **Banyule
Nillumbik Tech School (BNTS)**.

### The student journey

1. **Login (the welcome screen, as in PiPath):** pick your name from the profiles on this
   laptop, or **I'm new here**: **first name(s) + school only** (up to 4 names when students share
   a laptop and kit). No password: it's the student's own laptop → step 2: **how much help** and
   **which board they have** (Uno, Nano, NodeMCU, ESP32...) → the **project picker**. A
   **Settings** button on every screen changes these at any time. The welcome screen also links
   to the **WIPE page** (§4).
2. **Free choice:** every project is open from day one, in any order. Tiers are a guide only (a
   colour badge, a filter, "Good to try first" tips). Nothing is locked.
3. **Free Play is the first box** on the picker ("Free Play: build anything you like! ...or pick
   one of these projects for step-by-step help"). See §9.
4. **Every project starts with the Wiring Wizard** (§5): meet the parts → wire it step by step with
   a Fritzing-style breadboard view and schematic → **Test** (a forced test sketch made for that
   project's parts) → the student confirms each part works → only then the programming screen opens.
5. **Programming, one part at a time:** each step has instructions, starter code (may contain `___`
   blanks), a **checklist** checked automatically when the student presses Run / Upload (plus "I saw
   it happen" ticks for hardware), and a **Coach** that explains compiler and runtime errors in
   plain English with tiered hints.
6. **Simulator or Real board (MakeCode-style):** every project runs on the on-screen board
   (Simulator) or the real board over USB (Upload). **Watch the goal** plays the step's model answer
   in the simulator so students see what should happen before trying it on hardware.

### Things the teacher asked for (keep all of these)

- **No AI.** All help comes from a hand-written database of common errors and per-step hints.
  The About box says: developed by BNTS and reviewed by teachers, not hosted on AI, runs locally,
  and aims to open up programming to every student by adapting to each student's needs.
- **Help level is the student's choice:** **Beginner** (full explanations, hints any time),
  **Moderate** (each project's own gradual release) or **Advanced** (Years 9–10, "tutorial off":
  goal first, real compiler messages plus a technical explanation, fewer hints, steps can be
  skipped, **Jump to the challenge**, **Level up** challenges at the end, a code review after each
  step: magic numbers, repeated code, `delay()`-blocking loops, names, global state).
- **Adaptive scaffolding** on top of the level: stuck (same error twice, a check that keeps
  failing, 4+ failed runs, a quiet spell, no Run after a few minutes) → a gentle nudge with "Show me
  a hint" / "Watch the goal" / "Show the full explanation", hints unlock early. Flying (3 steps first
  try, no hints) → "try a harder level?". Struggling → "want a bit more help?". Each nudge once per
  step; level suggestions wait 4 steps; students can switch it off in Settings.
- **Gradual release:** guided → scaffolded → brief within each project. **Independence stars**
  count hints (not speed), framed positively.
- **One part at a time:** each project adds one new part, tests it on its own, then joins it up.
- **Curriculum links live in Settings > Curriculum** (a list of projects; opened from a project, it
  starts on that one). Not on the project intro.
- **Students run their own learning; there are no teacher controls.** The only tool that affects
  everyone on a laptop is the **WIPE page** (§4). Students' Settings keep **Save my work** (a
  `.circuit` file of their own work) and **Open my work** (to move work between laptops).
- **Autosave:** code saves on the laptop about a second after typing stops, and progress saves at
  every step, so students pick up where they left off.
- **Scrolling works like a website:** the wheel / trackpad scrolls the panel under the mouse, and
  anywhere else scrolls the page's main panel. (Free in a browser; don't break it with custom
  scroll handling.)
- **Student-facing text:** plain English, short sentences, about Year 7 reading level, Australian
  spelling (colour, favourite, organise, recognise). Encouraging, never sarcastic. Errors are
  "clues", not "failures".
- **Hardware safety text** on every wiring screen: unplug the USB cable before changing wires, plug
  it back in after; never connect 5V to an ESP pin (ESP boards are 3.3V); resistors with LEDs.

---

## 2. Look: Windows Vista, skeuomorphic

The whole interface looks like **Windows Vista (Aero)**, in the BNTS colours (teal `#19C1CA` /
`#04BBC1`, purple `#704988`, light purple `#CFC2E0`; the school logo's pixel squares in the corner):

- **Aero glass** window frames and title bars: translucent gradient, soft inner glow, rounded top
  corners, a big drop shadow; caption buttons (minimise style ✕ in a red glossy pill on dialogs).
- **Glossy "orb" and pill buttons** with a top highlight band, a hover glow and a pressed state; the
  default button pulses gently, like Vista.
- **Toolbars and the menu bar**: soft blue-grey vertical gradients, hairline separators with a white
  highlight, icons with reflections.
- **Panels**: white content areas inside light gradient frames; group boxes with etched borders;
  tabs like Vista's property sheets.
- **Font**: Segoe UI (on every Windows laptop), 9–11 pt equivalent, ClearType-friendly; code in
  Consolas.
- The **code editor** looks like a white Vista-era IDE (line numbers in a soft grey gutter, a glassy
  current-line highlight); the **Serial Monitor** looks like a Vista console window.
- **Balloon tips** (Vista's rounded yellow-white notification balloons) for the tour and the Coach's
  nudges.
- All of this is **CSS** (gradients, box-shadows, backdrop-filter) plus a few small PNG/SVG icons.
  No images of whole windows. It must stay fast on modest school laptops.

Keep every new screen in this style. Put colours, gradients and fonts in one stylesheet of CSS
variables (`ui/theme.css`).

---

## 3. Architecture (decided): an app on each student laptop (Windows and macOS)

```
student laptop (Windows 10/11, no admin rights)
┌──────────────────────────────────────────────────────────────────┐
│ ArduinoPath.exe (Go, one file)        Edge / Chrome app window   │
│  - serves the web app on              ┌────────────────────────┐ │
│    http://localhost:47820 ◀──────────▶│ projects, Wiring Wizard,│ │
│    (this laptop only)                 │ simulator, editor,      │ │
│  - profiles + saves (SQLite in        │ Serial Monitor          │ │
│    %LOCALAPPDATA%\ArduinoPath)        │ Upload: Web Serial → USB│ │
│  - WIPE                               └────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

- **`ArduinoPath.exe`: one Go program** (no cgo, no console window, an icon and version details).
  Double-click it and it:
  - serves the web app (`ui/`, built in) and a JSON API on **`http://localhost:47820`**, listening
    on `127.0.0.1` / `::1` only and answering only `localhost` Host names (no DNS rebinding);
    every write needs the `X-ArduinoPath: 1` header (no cross-site requests)
  - opens it as an **Edge app window** (or Chrome, or the default browser)
  - stores profiles, progress, sketches and settings in **SQLite** (one file in
    `%LOCALAPPDATA%\ArduinoPath`, WAL mode, `fsync` on save)
  - if it's already running, a second launch just opens another window; it closes itself
    20 minutes after the last window closes (open windows ping every minute)
  - writes `arduinopath.log` next to the database; shows a message box if it can't start
- **The simulator runs entirely in the browser** (§6).
- **Uploading to a real board happens in the browser** with **Web Serial** (Edge / Chrome;
  `http://localhost` counts as a secure site): STK500v1 (Optiboot) for Uno / Nano, STK500v2 for
  Mega, `esptool-js` (Apache-2.0, vendored) for ESP8266 / ESP32. The Serial Monitor and the Wiring
  Wizard's test also use Web Serial.
- **Compiling for Upload** (arduino-cli and the board cores) is **still to decide** for the local
  app: shipping them with the app is roughly 300 MB for AVR and over 1 GB with ESP32, unpacked into
  `%LOCALAPPDATA%` on first use (no admin needed). `internal/arduino` already pins and checks them.
- **The web app** is plain HTML / CSS / ES modules, no build step; third-party code is vendored
  with its licence (CodeMirror, esptool-js), never loaded from a CDN.
- **macOS: `ArduinoPath.app`**, the same program as one universal binary (Intel + Apple Silicon,
  built by `tools/macapp`, signed ad hoc, not notarised yet). Work in
  `~/Library/Application Support/ArduinoPath`. The app starts the server as a background process
  and quits (macOS won't relaunch a running app), and has no Dock icon (`LSUIElement`).
- **Releases:** changing `VERSION` publishes `ArduinoPath.exe` (+ ARM64) and `ArduinoPath-macOS.zip`
  as a GitHub release, after testing each on real Windows and macOS. No automatic updates yet
  (students download the new file).
- **Performance target:** the app window opens in under 2 s, a project in under 0.5 s.

### What IT may need to do

1. **Allow the app** if the laptops block unsigned programs (SmartScreen: More info > Run anyway;
   AppLocker / Intune: allow it by hash or path, or sign it with the school's certificate).
2. **USB drivers** for clone boards (CH340, CP2102), or boards with built-in USB.

---

## 4. The WIPE page (`#/wipe`, linked from the welcome screen)

For the end of a program, before the next group uses the laptop. It lists the profiles on the
laptop, offers **Save everyone's work** (one zip of everyone's `.circuit` files), and deletes every
profile with all their work once the student or teacher types **WIPE**. The database is compacted
afterwards so deleted work can't be read back. It only affects ArduinoPath in that Windows account.

---

## 4b. Boards

Students pick their board at setup (changeable in Settings and in the toolbar). Each board is a data
file (`content/boards/*.json`): its picture (Fritzing breadboard SVG), pin names and positions, which
pins do PWM / analog / I²C / SPI, voltage (5V or 3.3V), the arduino-cli FQBN and upload settings.

| Board | FQBN | Logic | Notes |
|---|---|---|---|
| Arduino Uno R3 | `arduino:avr:uno` | 5V | the default |
| Arduino Nano (ATmega328P, old bootloader option) | `arduino:avr:nano` | 5V | clones often need `:cpu=atmega328old` |
| Arduino Mega 2560 (optional) | `arduino:avr:mega` | 5V | |
| NodeMCU 1.0 (ESP-12E, ESP8266) | `esp8266:esp8266:nodemcuv2` | 3.3V | WiFi; pins labelled D0–D8 |
| Wemos / LOLIN D1 mini (ESP8266) | `esp8266:esp8266:d1_mini` | 3.3V | WiFi |
| ESP32 DevKit V1 (ESP32-WROOM-32) | `esp32:esp32:esp32` | 3.3V | WiFi + Bluetooth (ESP32 pack) |
| ESP32-C3 SuperMini (optional) | `esp32:esp32:esp32c3` | 3.3V | small, cheap (ESP32 pack) |

- **Projects say which boards they suit** (WiFi projects need an ESP). The picker shows "works with
  your board" or "needs an ESP board".
- **Wiring adapts to the board:** each project's parts connect to *roles* (`LED_PIN`, `BUTTON_PIN`,
  `I2C_SDA`...), and each board file maps roles to its pins (a standard pin plan per board, so one
  breadboard build carries between projects on that board). The wizard, the simulator, the test
  sketch and the starter code all use the same mapping, written as `#define`s at the top of the code.
- **3.3V boards:** parts that need 5V (HC-SR04 echo, some relays) get a level shifter or divider step
  in the wizard automatically, with a ⚠ safety note.

---

## 5. The Wiring Wizard (the big change from PiPath)

When a student opens a project (and before programming), a **Wiring Wizard** window opens over the
workspace (a Vista-style wizard: a glass frame, a title, step dots, Back / Next buttons):

1. **Meet the parts:** one card per component, with its Fritzing picture, what it does in one or two
   sentences, how to tell which leg is which (long leg = +, the flat side, the stripe), and a
   "Did you know?". The student presses **Next** for each part, or **Skip the introductions**.
2. **Wire it, step by step:** one connection or a small group per screen. Each screen shows:
   - the **breadboard view** (Fritzing style) with the new wire(s) highlighted and earlier ones faded
   - the **schematic view** (a toggle, or side by side on wide screens)
   - plain-English instructions ("Connect the LED's long leg to pin 13 through a 220Ω resistor")
   - a safety reminder (unplug USB while wiring)
   - **Back / Next**, and "Show the whole circuit"
3. **Test it (required):** the student plugs the board in and presses **Test**. ArduinoPath compiles a
   **test sketch generated for this project's parts** and the browser uploads it over USB, then
   listens on the Serial port (or it runs in the simulator in Simulator mode):
   - LEDs blink one at a time; RGB LEDs cycle red, green, blue; buzzers beep; servos sweep;
     NeoPixels run a rainbow; displays show "Hello!"
   - buttons, switches, PIR, sensors: "Press the button now" and the screen ticks ✓ when the press
     arrives over serial; pots and LDRs show a live bar; HC-SR04 / DHT show live readings
   - each part has a row with ✓ / ✗ and **"I saw it work"** confirm boxes for outputs
4. **Fix it** (when a row fails): the wizard jumps back to that part's wiring screen with the most
   likely causes for that part (LED backwards, wrong row, missing GND, resistor in the wrong place),
   then **Test again**.
5. **All parts confirmed → "Start programming"** unlocks and the programming workspace opens. The
   wiring is saved as done for that project; **Wiring** in the toolbar reopens the wizard any time
   (and adding a part later in Free Play opens a mini wizard for just that part).

Test sketches are **generated from the parts list** (each part type has a test snippet with
`{pin}` placeholders and a serial protocol: `TEST:<part-id>:OK` / `READ:<part-id>:<value>`), so a
new project gets its test for free. Every generated test must compile for every board the project
supports (tested in CI, §12).

---

## 6. Simulator and diagrams: one uniform Fritzing look

- **Parts art comes from the official Fritzing parts library** (`github.com/fritzing/fritzing-parts`,
  **CC BY-SA 3.0**). The teacher has the standard library, so nothing needs sending: a script
  (`tools/import_fritzing.py` or `.go`) pulls just the parts ArduinoPath uses (about 40) from the
  public repository: their **breadboard SVG**, **schematic SVG** and **connector positions** (from the
  `.fzp` file). Keep the attribution and licence in `content/parts/LICENSE-fritzing.md` and the About
  box (share-alike applies to these SVGs, not to ArduinoPath's own code).
- **One renderer for everything:** the wizard, the simulator, Free Play's wiring and the project
  cards all draw from the same part SVGs and the same connector data, on the same breadboard
  (Fritzing's half+ breadboard), with wires drawn as Fritzing-style bendable wires in standard
  colours (red = 5V/3.3V, black = GND, others by signal). Schematics use the Fritzing schematic
  symbols and a tidy auto-layout.
- **Simulated behaviour** is drawn on top of the same SVGs: LEDs glow (colour from the part), RGB
  LEDs mix, NeoPixels light per pixel, servos rotate their horn, the OLED / LCD show real pixels /
  characters, 7-segment digits light, the buzzer shows sound waves and plays a tone (Web Audio).
  Students click buttons, drag pots / sliders (LDR light level, distance, temperature, humidity,
  soil moisture), wave at the PIR.
- **How the simulator runs code:** ESP boards can't be emulated at chip level in a browser with free
  tools, so ArduinoPath has its own **Arduino interpreter in JavaScript** (the MakeCode approach): it
  parses the Arduino C++ subset students write (types, functions, `if`/`for`/`while`/`switch`,
  arrays, `String`, `#define`, `const`) and runs `setup()` / `loop()` in a Web Worker with a
  simulated clock, calling a **simulated Arduino API**: `pinMode`, `digitalWrite/Read`,
  `analogWrite/Read`, `delay`, `millis`, `tone`, `Serial`, `map`, `random`, and the libraries the
  projects use (Servo, Adafruit_NeoPixel, DHT, Adafruit_SSD1306 / GFX, LiquidCrystal_I2C, TM1637,
  Keypad, MFRC522, ESP8266WiFi / WiFi, WebServer / ESP8266WebServer, ESP-NOW).
  - Unsupported C++ (pointers to pointers, templates, inline asm) gives a friendly "the simulator
    can't run this part, but the real board can: press Upload" message, never a crash.
  - **WiFi in the simulator:** `WiFi.begin()` "connects" to a pretend network; a sketch's web server
    pages appear in a **phone panel** next to the board (an iframe served from the worker), so
    "control the LED from your phone" projects work fully in the simulator.
  - The real compiler is still the judge: **Upload** and **Check my code** compile with arduino-cli
    for the chosen board (§3: how it ships with the app is still to decide), so students see real
    compile errors explained by the Coach. **Run** in the simulator is instant and needs no compiler.
- **Serial Monitor + Serial Plotter** (Vista console look): shared by the simulator and real boards.

---

## 7. Saving

- **Autosave on the laptop:** code saves about a second after typing stops (and on Run / Upload /
  leaving a project); progress saves at every step. If ArduinoPath has closed, unsaved changes wait
  in the browser (IndexedDB) and are sent when it's back, with a small "Saved ✓ / Saving... /
  Offline, will save when you're back" note.
- **Changing laptops:** Save my work on one, Open my work on the other.
- **Save files** (students' Settings): **Save my work** downloads
  `<Name>_ArduinoPath_<date>.circuit` (a zip: profile, progress, sketches; versioned), to take home
  or keep. **Open my work** loads one (merging by project, newest wins, asking before replacing).
- **Per-sketch export:** download the current sketch as `.ino` for the normal Arduino IDE.
- **Everyone's work** on a laptop: Save everyone's work and WIPE are on the WIPE page (§4).
- Never break the save format: the database has a schema version and migrations.

## 8. Content is data

Projects, parts, boards, errors and Free Play ideas are data files a teacher can edit without
touching code (JSON or TOML; pick one and validate it with a schema). For each project:
`id, title, tier, boards, parts, minutes, concepts, curriculum, stretch, intro, outro, steps[]`;
each step: `title, support (guided | scaffolded | brief), starter_mode, starter, text` (with a
`**Your task:**` / `**Goal:**` line for Advanced), `hints` (max 3), `error_hints`, `checks[]`,
`success`, **`demo`** (the model answer: required, played by Watch the goal and tested), and
`sim_events` (button presses, slider moves, pretend WiFi requests for the demo).

Check types (as PiPath): code contains / regex / uses a function, serial output contains / regex,
pin state seen in the simulator (`pin 13 went HIGH`, `servo reached 90°`), runs / compiles OK, run
count, "I saw it happen" confirm.

**Errors database** (`content/errors.json`): regexes over **avr-gcc / xtensa-gcc compiler messages**
and arduino-cli / upload errors, each with a plain-English title, explanation, up to 3 tiered
hints and a `tech` explanation for Advanced. Start with the classics: missing `;`, `'x' was not
declared in this scope`, missing `}` / `expected '}' at end of input`, misspelt `digitalwrite`,
`void setup` missing, `=` vs `==`, wrong library name (`No such file or directory`), upload
"port not found / busy / access denied", `avrdude: stk500_recv(): programmer is not responding`
(wrong board / old bootloader), ESP "Failed to connect to ESP8266: Timed out" (hold BOOT / FLASH),
"Sketch too big". A catch-all last. Every entry has a test with a real broken sketch.

---

## 9. Free Play (the sandbox)

The first box on the picker, always open. No steps or checklists. **Guide me** (the Coach explains
errors, nudges when stuck, suggests a tidy-up after a working run) or **On my own** (errors are
explained, nothing else). The left panel:
- **Add a part:** LED, button, buzzer, pot, servo, NeoPixel, OLED, DHT, HC-SR04... Inserts working
  code at the cursor (includes and `#define`s at the top, setup lines into `setup()`), picks free
  pins from the board's pin plan, and opens a **mini Wiring Wizard** for that part (meet it → wire it
  → test it).
- **My wiring:** the breadboard + schematic built from the parts in the sketch, with pin clashes
  flagged.
- **Need an idea?** starter projects (some screen-only with the Serial Monitor, some hardware, some
  WiFi), plus My projects and a cheat sheet.

---

## 10. Projects (first set)

Tiers: **Getting Started** (green), **Sensors & Sound**, **Displays & Lights**, **Games**,
**WiFi & IoT** (ESP boards), **Challenge**. Each project follows "one part at a time".

| Tier | Project | Parts | Boards |
|---|---|---|---|
| Getting Started | Blink & Traffic Lights | 3 LEDs, resistors | all |
| Getting Started | Button Night Light | LED, button | all |
| Getting Started | Serial Chatbot (screen only, Serial Monitor) | none | all |
| Sensors & Sound | Light Theremin | LDR, piezo buzzer | all |
| Sensors & Sound | Servo Dial | potentiometer, servo | all |
| Sensors & Sound | Parking Sensor | HC-SR04, 3 LEDs, buzzer | all (divider on 3.3V) |
| Sensors & Sound | Motion Alarm | PIR, buzzer, LED | all |
| Displays & Lights | Weather Station | DHT11/22, OLED SSD1306 | all |
| Displays & Lights | NeoPixel Mood Lamp | WS2812 ring, pot, button | all |
| Displays & Lights | Digital Dice | TM1637 4-digit display (or 7-segment), button | all |
| Displays & Lights | Plant Buddy | soil moisture sensor, OLED, LED | all |
| Games | Reaction Race (2 players) | 2 buttons, LEDs, buzzer | all |
| Games | Simon Says | 4 LEDs, 4 buttons, buzzer | all |
| Games | Joystick Snake | joystick, 8×8 LED matrix (MAX7219) | all |
| Challenge | Keypad Safe | 4×4 keypad, servo, LCD 16×2 I2C | Uno / Mega |
| Challenge | RFID Door | RC522 RFID, servo, LEDs | all |
| WiFi & IoT | Phone-controlled LED (web server) | LED | ESP |
| WiFi & IoT | Weather Web Page | DHT, ESP web server, phone panel | ESP |
| WiFi & IoT | NeoPixel Remote (sliders on a web page) | WS2812 strip | ESP |
| WiFi & IoT | Internet Clock (NTP time on the OLED) | OLED | ESP (needs internet) |
| WiFi & IoT | ESP-NOW Messenger (two boards, no router) | button, LED, buzzer (×2) | ESP ×2 |
| WiFi & IoT | WiFi Scanner Radar | OLED | ESP |

Each project lists its Victorian Curriculum DT (Levels 7–10) links and three Level up challenges.
Classroom kits differ: keep a `content/kit.json` of what the school owns, so the picker can say
"needs a part not in your kit".

---

## 11. Rules for Claude Code

1. **Local and private.** No calls to the internet from the web app or `ArduinoPath.exe`; nothing
   about students is ever sent. No telemetry, no cloud accounts, no CDN fonts or scripts. Student
   data stays on the laptop (and in save files students download).
2. **No AI**, anywhere.
3. **Nothing to install and no admin rights**: just `ArduinoPath.exe` / `ArduinoPath.app` and Edge / Chrome. Never
   require a console, an installer or settings changes on the laptop.
4. **Content is data** (§8). A teacher can add a project without touching code.
5. **Every project step has a `demo`** that passes its own checks in the simulator, and compiles
   with arduino-cli for every board the project lists (CI, §12). Every step has a goal for Advanced.
6. **One part at a time**, and the **Wiring Wizard + Test** before programming in every project.
7. **The simulator never freezes the page:** student code runs in a Web Worker with an instruction
   budget; `while(1)` without `delay()` gets a Coach tip, not a hung tab.
8. **Student-facing text:** Year 7 reading level, Australian spelling, encouraging.
9. **Vista look** (§2) on every screen, in one theme stylesheet.
10. **Keep it quick:** first screen in under 2 s, a project opens in under 0.5 s, the simulator runs
    smoothly at 60 fps with a dozen parts on a school laptop.
13. **Security basics:** listen on localhost only and refuse other Host names; every write needs
    the `X-ArduinoPath` header; strict CSP; every API input validated; a profile's API calls only
    touch that profile's work; save files are size-limited and checked; compiles (when added) run
    in a temporary folder with a time limit.
11. **Keep the tests green** after every change.
12. **Fritzing attribution** stays with the part files (CC BY-SA 3.0).

---

## 12. Testing

- **Go:** unit tests for the API, profiles, saves (migrations), save files, WIPE, the localhost /
  Host / cross-site guards, and the launcher (single instance, closing when idle).
- **Windows and macOS (CI):** the Go tests on `windows-latest` and `macos-latest`, then
  `tests/windows/smoke.ps1` / `tests/macos/smoke.sh` start the real `ArduinoPath.exe` /
  `ArduinoPath.app` and use them (profile, autosave, cross-site refusal, second launch). Both are
  kept as CI downloads, and the Release workflow runs the same tests before publishing.
- **Interpreter + simulated API (JS):** unit tests run in headless Chromium (Playwright) or Node
  (dev-only tooling is fine; nothing runtime). Every project's every `demo` runs in the simulator
  with its `sim_events` and must pass the step's checks.
- **Compile matrix (CI):** every demo and every generated test sketch compiles with arduino-cli for
  every board it lists (GitHub Actions, caching the cores).
- **Errors database:** each entry has a real broken sketch whose compiler output must map to it.
- **GUI smoke test:** Playwright drives welcome → make a profile → picker → a project → the Wiring
  Wizard (meet parts, wire, Test in simulator, confirm) → programming → Watch the goal → Free Play
  → Save my work / Open my work → pick your name → the WIPE page, and saves screenshots at
  1366×768 and 1920×1080.
- **Real hardware checklist** (`docs/hardware-test-checklist.md`): a no-admin Windows laptop in
  Edge running `ArduinoPath.exe`, a genuine Uno, a CH340 Nano clone, a NodeMCU and an ESP32 with
  the kit's parts.

---

## 13. Build order

1. **Skeleton:** `ArduinoPath.exe` (local server, SQLite, profiles, autosave, save files, WIPE), the
   Vista theme and window chrome, welcome → picker. **Done.**
2. **Fritzing import** of the first parts (Uno, Nano, NodeMCU, ESP32, breadboard, LED, resistor,
   button, buzzer, pot, servo) and the **renderer** (breadboard + schematic, wires).
3. **Interpreter + simulated API** for the Getting Started projects; Serial Monitor (simulated).
4. **Wiring Wizard** with generated test sketches in the simulator.
5. **Compiling for Upload** (decide how arduino-cli ships with the app) + the Coach on real
   compiler errors; then **Web Serial upload** (Uno / Nano first, then ESP via esptool-js) and the
   real Serial Monitor; the wizard's Test on real boards.
6. Getting Started projects, then Free Play, then the other tiers, then WiFi & IoT (phone panel).
7. Adaptive coach, help levels, code review, curriculum in Settings.
8. Hardware checklist on real laptops, then a classroom trial.

## 14. Decisions already made (don't relitigate without reason)

- **An app on each student laptop** (`ArduinoPath.exe` on Windows, `ArduinoPath.app` on macOS), like PiPath: no server, no teacher
  controls, works offline. (The Raspberry Pi server couldn't be reached on the school network; a
  cloud server was started and parked.)
- **The web app in Edge / Chrome**, served by the exe on localhost: the same UI, and Web Serial for
  Upload (localhost is a secure site).
- **Welcome screen with names** (first name(s) + school, no password); a **WIPE page** on the
  laptop, with Save everyone's work first.
- **Work saved on the laptop** (`%LOCALAPPDATA%\ArduinoPath`, or `~/Library/Application Support/ArduinoPath`
  on a Mac) plus `.circuit` save files to move it.
- **USB drivers** for clone boards are IT's job (or buy driver-free boards).
- **Standard Fritzing parts library** for all part art (pulled from the public repository).
- **Windows Vista skeuomorphic look** in the BNTS colours.
- **Wiring Wizard with a forced, project-specific Test** before programming.
- **Own Arduino interpreter for the simulator** (works the same for AVR and ESP boards); it runs in
  the browser.
- **Separate from PiPath:** different repository, no shared code.
- Free choice of projects. Stars measure independence. Help level is the student's choice.
