# ArduinoPath: walkthrough timings and feature notes (for the website)

For the BNTS combined PiPath + ArduinoPath showcase site. Written 27 October 2026 by the
ArduinoPath session, from the videos themselves.

> **The website is interactive first.** The teacher wants the fun, hands-on demos from the
> PiPath plan to lead. The videos only back them up (a "see it for real" clip beside a demo).
> So section 5, the facts for building the interactive demos, matters most. Sections 1–2
> (video times) are there for when a demo wants a short clip beside it.

**When a video is used, use the clean versions (no captions).** The teacher asked for that.

| File | Length | Use on the site |
|---|---|---|
| `ArduinoPath-SmartBin-text-clean.mp4` | 9:13 (553.5 s) | Yes: Text coding |
| `ArduinoPath-SmartBin-blocks-clean.mp4` | 9:20 (560.6 s) | Yes: Block coding |
| `ArduinoPath-SmartBin-text-captions.mp4` | 11:43 | Reference only (its captions describe each moment) |
| `ArduinoPath-SmartBin-blocks-captions.mp4` | 12:01 | Reference only |

All four are 1920×1080, 30 fps, H.264, no sound.

## How these times were measured (read this first)

- The recorder kept no timeline, so every time below was **measured from the clean videos'
  own frames**: sampled 5 times a second, with screen changes detected automatically and every
  section checked by eye on contact sheets. Times are accurate to about **±0.5 s**.
- Every time is in **that video's own time**. The clean and captioned versions are separate
  recordings of the same script, not edits of each other. The clean versions shorten each
  caption pause to 55 %, and title cards to 0.8 s. So a captioned time can't be converted to a
  clean time with one sum: the gap grows through the video, from about 6 s at the start to
  about 150 s by the end. **Use only the clean times below.**
- The clean versions have no title cards: they start on the welcome screen at 0 s and end on
  the finished project.
- Everything shown is the **simulator** (the on-screen board). No real board was plugged in.

## 1. Chapters and moments

### Text, clean (`ArduinoPath-SmartBin-text-clean.mp4`)

| Start | End | What's on screen |
|---|---|---|
| 0.0 | 14.8 | **Getting started:** the welcome screen. A new student types "Mia" and the school (no password). |
| 14.8 | 35.4 | **Setup:** chooses Beginner, Arduino Uno R3 and **Text**, then "Let's go!". |
| 35.4 | 49.0 | **Picker:** every project open, with Free Play first; points at the Smart Bin and opens it. |
| 49.0 | 97.6 | **Wiring Wizard: meet the parts.** Distance sensor (49.0), servo (about 68), LED (about 79), 220 Ω resistor (about 91). |
| 97.6 | 125.0 | **Wire it, step 1** (the distance sensor): the breadboard view; new wires glow and earlier ones fade. Points at the safety note. |
| 125.0 | 136.4 | **Schematic view** of the same circuit, then back to the breadboard. |
| 136.4 | 165.4 | **Wire it, steps 2 and 3** (lid servo from about 143.6, LED from about 155). |
| 165.4 | 241.0 | **Test it** (simulator). Press Test (about 181); the sensor row asks for a hand; the student drags the distance slider (about 186–212); the servo and LED take turns and are ticked "I saw it work" (about 225–232); "Everything works" (about 234); **Start programming** (about 238). |
| 241.0 | 320.6 | **Step 1: Move the lid** (guided). Run with the blank (about 263); the **Coach's clue** "Fill in the blanks first" (about 264–280); types 90 (about 278–283); Run (about 285); the **checklist ticks** (about 287–290); stops; ticks "I saw it" (about 307); **step done, 3 stars** (about 309–318); Next step. |
| 320.6 | 389.2 | **Step 2: Measure the distance.** Types `cm` (about 333–337); Run (about 340); the slider moves to 80 then 10 cm (about 343–356) and the **Serial Monitor** fills; checks tick; step done (about 385). |
| 389.2 | 464.4 | **Step 3: Open for a hand** (scaffolded). **Show me a hint** (about 399–404); types 30 (about 413); Run (about 421); hand slider to 12 cm (about 424), and the lid opens; back to 150 cm (about 444); step done (about 460). |
| 464.4 | 553.5 | **Step 4: Light while it's open** (brief: just a goal). **Watch the goal** (about 474.6–508.6: the purple "Watching the goal" banner); types the two `digitalWrite` lines (about 492–505); Run (about 513); hand to 12 cm (about 516); all checks tick (about 520–528); ticks "I saw it" (about 547); **"Your smart bin opens for a hand… Well done!", 3 stars** (about 548–553). |

### Blocks, clean (`ArduinoPath-SmartBin-blocks-clean.mp4`)

| Start | End | What's on screen |
|---|---|---|
| 0.0 | 15.6 | **Getting started:** the welcome screen; types the name and school. |
| 15.6 | 36.2 | **Setup:** Beginner, Arduino Uno R3, **Blocks**, then "Let's go!". |
| 36.2 | 49.8 | **Picker**, then opens the Smart Bin. |
| 49.8 | 61.2 | **Wiring Wizard: meet the parts** (one card, then "Skip the introductions"). |
| 61.2 | 111.2 | **Wire it, steps 1 to 3:** sensor (61.2), lid servo (about 90.6), LED (about 102). This version doesn't show the schematic. |
| 111.2 | 184.8 | **Test it** (simulator). Press Test (about 126); distance slider (about 131–160); tick servo and LED (about 168–176); "Everything works" (about 179); **Start programming** (about 183). |
| 184.8 | 287.8 | **Step 1: Move the lid, in Blocks.** The blocks view with "when the board starts" / "forever", and the C++ underneath (about 186–215); Run with the empty gap; the **Coach's "Fill in the gaps first"** (about 218–232); opens **Maths** and **drags a number block into the gap** (about 231–238); types 90 (about 239–245); Run (about 251); **checklist ticks** (about 253–262); ticks "I saw it" (about 276); **step done, 3 stars** (about 278–287). |
| 287.8 | 369.4 | **Step 2: Measure the distance.** Drags the `cm` variable block into the Serial Monitor print gap (about 304–314); Run (about 323); slider to 80 then 10 cm, and the Serial Monitor fills (about 326–352); step done (about 364). |
| 369.4 | 448.4 | **Step 3: Open for a hand.** Drags a number into the `if` and types 30 (about 383–399); Run (about 404); hand to 12 cm, and the lid opens (about 406–416); back to 150 cm (about 424); step done (about 444). |
| 448.4 | 560.6 | **Step 4: Light while it's open.** **Watch the goal** (about 458.4–515.8); opens **Pins** and drags "turn pin LED_PIN HIGH" in before the lid opens (about 478–492), then "LOW" after it closes (about 496–508); Run (about 516); hand to 12 cm; checks tick (about 528–536); ticks "I saw it"; **well done, 3 stars** (about 556–560). |

## 2. Best snippets for the website (all from the clean videos)

Each was checked at its start, middle and end frames.

| # | Video | Start | End | What it shows |
|---|---|---|---|---|
| 1 | text-clean | 50.0 | 60.0 | Wiring Wizard: meet the ultrasonic sensor card (what it does, which leg is which, "Did you know?"). |
| 2 | text-clean | 98.0 | 108.0 | Wiring the distance sensor on the Fritzing-style breadboard, with the safety note. |
| 3 | text-clean | 125.0 | 136.0 | The schematic view of the same step. |
| 4 | text-clean | 182.0 | 194.0 | The forced Test: the student drags the simulator's distance slider and the sensor row turns to "Working!". |
| 5 | text-clean | 224.0 | 236.0 | The Test passes: servo and LED ticked "I saw it work", then "Everything works", and Start programming unlocks. |
| 6 | text-clean | 262.0 | 274.0 | Run with a blank: the Coach's clue "Fill in the blanks first" (plain English, no AI). |
| 7 | text-clean | 278.0 | 290.0 | Types 90, presses Run, and the checklist ticks itself as the simulator runs. |
| 8 | text-clean | 306.0 | 316.0 | Ticks "I saw the lid open and close"; the step is done, with 3 independence stars. |
| 9 | text-clean | 342.0 | 354.0 | The ultrasonic slider moves and the Serial Monitor shows the distance changing. |
| 10 | text-clean | 474.0 | 486.0 | Watch the goal: the model answer plays in the simulator (purple banner) without showing the code. |
| 11 | blocks-clean | 186.0 | 196.0 | Blocks view: the code as blocks, with the real C++ it makes underneath. |
| 12 | blocks-clean | 230.0 | 242.0 | Drags a number block from Maths into the empty gap, and types 90. |
| 13 | blocks-clean | 410.0 | 420.0 | The finished `if` blocks run: a hand at 12 cm opens the lid. |
| 14 | blocks-clean | 480.0 | 492.0 | Brief step in Blocks: the Pins drawer opens, and "turn pin LED_PIN HIGH" is dragged into place. |

The servo is small in the drawing (to the right of the breadboard). For a snippet about the
lid moving, crop to the simulator panel on the right, about the top-right third of the frame.

## 3. ArduinoPath as it is now (the website must not claim more)

**Built and released (v1.0.1, October 2026):**

- **An app on the student's own computer:** `ArduinoPath.exe` (Windows, no admin rights),
  `ArduinoPath.app` (Mac) and ArduinoPath for Raspberry Pi (64-bit Pi OS). It opens in Edge,
  Chrome or Chromium as an app window. No server, no accounts, no internet needed. No AI: all
  help is written by people.
- **Boards:** Arduino Uno R3, Nano (with an old-bootloader option for clones), Mega 2560,
  NodeMCU 1.0 (ESP8266), Wemos D1 mini, ESP32 DevKit, ESP32-C3 SuperMini.
- **Compiling and uploading are built in:** arduino-cli and the board tools ship inside the app.
  It uploads over USB, has a real Serial Monitor, and "Check my code" uses the real compiler.
- **Simulator:** ArduinoPath's own Arduino C++ interpreter, running in the browser. Fritzing
  parts art, breadboard and schematic views, LEDs that glow, a servo that turns, a buzzer
  tone, sliders for sensors (distance, light, knob...), a Serial Monitor and Serial Plotter,
  and a pretend phone for WiFi web-server projects.
- **Wiring Wizard before every project:** meet the parts → wire it one part per screen
  (breadboard and schematic, safety reminder on every screen) → a **forced Test** made from the
  project's parts (simulator or real board) → each part confirmed → "Start programming".
- **22 projects in v1.0.1**, across Getting Started, Sensors & Sound, Displays & Lights, Games,
  Challenge and WiFi & IoT. Each has steps with starter code, `___` blanks, an automatic
  checklist, hints and a model answer ("Watch the goal").
- **Help levels:** Beginner, Moderate, Advanced. Gradual release within a project (guided →
  scaffolded → brief). Independence stars count hints, not speed.
- **The Coach:** explains compiler and runtime errors in plain English, from a hand-written
  errors database, with tiered hints. Adaptive nudges when a student seems stuck. A code
  review for Advanced.
- **Free Play:** a blank sketch with the simulator and real board (no steps).
- **Saving:** autosaves on the computer; "Save my work" / "Open my work" (`.circuit` files) to
  move work between computers; a WIPE page for the end of a program.
- **The look:** Windows Vista (Aero) style in the BNTS colours.

**Built, but not in a release yet** (on the `showcase` branch, shown in these videos):

- **The Smart Bin project** (distance sensor, lid servo, LED; 4 steps). It isn't in the
  released app yet.
- **Block coding:** Text or Blocks (Blockly, offline), chosen at setup, in Settings or on the
  tabs above the code. Blocks shows the C++ it makes, and that C++ is what runs, so the
  checklist, Coach and Upload work the same. Every project's starter code turns into blocks
  automatically.

**Not built yet (don't show or claim):**

- Free Play's **"Add a part"** (inserting a part's code and a mini Wiring Wizard). Free Play is
  a blank sketch for now.
- Automatic updates (students download new versions).
- A signed or notarised app (Windows may show SmartScreen; Macs need "Open anyway").
- A classroom trial on real hardware: the hardware test checklist hasn't been signed off yet.
- Real hardware in these videos: everything shown runs in the simulator.

## 4. The ultrasonic sensor's test (for the website's mini demo)

On the **Arduino Uno**, the HC-SR04's pins are **Trig = pin 6** and **Echo = pin 7**. The sensor
runs on 5V. In the Smart Bin, the lid servo is on pin 9 and the LED on pin 13.

What the Wiring Wizard's generated test does for the sensor:

```cpp
// in setup()
pinMode(6, OUTPUT);   // Trig
pinMode(7, INPUT);    // Echo
// in loop(), every 400 ms:
digitalWrite(6, LOW);  delayMicroseconds(2);
digitalWrite(6, HIGH); delayMicroseconds(10); digitalWrite(6, LOW);
long us = pulseIn(7, HIGH, 30000UL);   // wait at most 30 ms for the echo
Serial.print(F("READ:sonar:")); Serial.println(us / 58);   // centimetres
```

What the student sees:

- The row "**distance sensor**" with the instruction "**Move your hand towards the sensor and
  away.**" and a ✗ until it works.
- A live bar that follows the distance (full at 200 cm or more).
- The row ticks ✓ **"Working!"** by itself once a reading changes by **more than 4 cm** from the
  first one (and isn't 0). The student doesn't tick it.
- In the simulator, the "Something in front" chip has a **Distance** slider from 2 to 400 cm,
  starting at 100 cm. On a real board, the student moves their hand.
- If it fails, "Fix it" lists: Trig and Echo might be swapped; the sensor needs 5V; on an ESP
  board, check both 10 kΩ resistors on Echo.

The servo and LED rows are outputs. Each takes a turn (the servo sweeps 0°, 90°, 180°, 90°;
the LED blinks), and the student ticks "I saw it work" during that turn. "Start programming"
unlocks when every row is ticked.

## 5. Facts for the interactive demos (taken from the real app)

Use these so a hands-on demo behaves like ArduinoPath. Keep demos playful and short.

### Smart Bin, one part at a time (the 4 steps)

Each demo step can show the starter code with one gap, let the visitor fill it, press Run, and
tick the checklist.

| Step | Help | The gap → answer | Checklist (ticks by itself) | Success message |
|---|---|---|---|---|
| 1 Move the lid | guided | `lid.write(___);` → `90` | The lid opens (0°) · The lid closes (90°) · I saw the lid open and close | "Your bin can open and close its lid. Now it needs to know when to do it." |
| 2 Measure the distance | guided | `Serial.print(___);` → `cm` | It measures 80 cm · It measures 10 cm · The distance changes when I move my hand | "Your bin can measure how far away your hand is, with sound!" |
| 3 Open for a hand | scaffolded | `if (cm > 0 && cm < ___)` → `30` | The lid starts closed (90°) · A hand opens the lid (0°) · It opens for a hand closer than 30 cm · The lid opened when my hand came close | "A hands-free bin! It decides for itself with **if**." |
| 4 Light while it's open | brief (goal only) | add `digitalWrite(LED_PIN, HIGH);` before opening and `LOW` after closing | The LED turns on · The LED turns off · The lid still opens · I saw the LED light up while the lid was open | "Your smart bin opens for a hand and shows when it's open. Well done!" |

- On the bin, **0° = lid open, 90° = lid closed**. It stays open 5 seconds.
- **Hints come one at a time.** Step 3's: "How close should a hand be? 30 cm is about a ruler
  away." → "`cm < 30` means "closer than 30 cm"." → "Type `30` in the blank."
- **The Coach's clue** for an unfilled gap: Text: **"Fill in the blanks first"** ("Your code
  still has ___ on line N. Replace each ___ with the right code, then try again.") Blocks:
  **"Fill in the gaps first"** ("A block still has an empty gap (a dark hole). Drag the right
  block into each gap, then try again.")
- **Stars count independence:** 3 stars with no hints ("All on your own!"), 2 with one hint,
  1 with more ("Hints helped you get there.").
- **Watch the goal** plays the answer in the simulator with the purple banner "Watching the
  goal: this is what your code should do." It doesn't tick the checklist.

### The distance slider

- Labelled **"Something in front"**, with a **Distance** slider from **2 to 400 cm** (starts at
  100 cm).
- The code turns echo time into centimetres with `duration / 58` (sound goes there and back,
  about 58 µs per cm). A fun fact the app uses: "Sound travels about 343 metres every second,
  so an echo from 1 metre away comes back in under a hundredth of a second."

### Block coding (for a drag-a-block demo)

- The toolbox categories and their colours: Start `#0f9aa1` (teal), Pins `#3b73c4`, Servo
  `#e07b00`, Sensors `#2e9b45`, Sound `#c2417a`, Serial Monitor `#5a6878`, Logic `#704988`
  (purple), Maths `#5b67a5`, Variables `#c2632f`, Functions `#8a5a2b`. Name and value blocks
  (like `LED_PIN`, `HIGH`) are `#4a8fa8`.
- The blocks students see: **when the board starts** (setup), **forever** (loop), **turn servo
  lid to 90°**, **wait 1000 milliseconds**, **distance in cm**, **turn pin LED_PIN HIGH**,
  **Serial Monitor: print a line**, **if … do**, and comparisons like **cm < 30**.
- Under the blocks, the real C++ they make is always shown ("Your blocks as C++ code (what
  goes on the board)"). A demo that shows blocks and code side by side matches the app.

### The Wiring Wizard (for a wiring demo)

- The order: meet each part (what it does, which leg is which, "Did you know?") → wire one
  part per screen (new wires glow, earlier ones fade, with a schematic toggle) → Test.
- The safety line on every wiring screen: unplug the USB cable before changing wires, plug it
  back in after; never connect 5V to an ESP pin; always use a resistor with an LED.
- Wire colours: red = power, black = GND, others by signal.
- Smart Bin on an Uno: sensor Trig 6, Echo 7, 5V and GND; servo signal 9 (brown −, red +,
  orange signal); LED on 13 through a 220 Ω resistor.
