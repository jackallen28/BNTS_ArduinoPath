# ArduinoPath: teacher guide

ArduinoPath teaches Arduino coding step by step, like a tutor sitting beside each student. It runs
on each student's own computer (Windows laptop, Mac or Raspberry Pi). There's no server, no
teacher login and no internet needed. Students choose their projects and how much help they get.

## Before your first lesson

1. **Download it.** From the repository's **Releases** page:
   - **Windows laptops:** `ArduinoPath.exe` (or `ArduinoPath-arm64.exe` for ARM laptops such as
     Snapdragon). See [windows-app.md](windows-app.md).
   - **Macs:** `ArduinoPath-macOS.zip`. See [mac-app.md](mac-app.md).
   - **Raspberry Pi 4 / 5:** `ArduinoPath-RaspberryPi.tar.gz`. See [raspberry-pi.md](raspberry-pi.md).
2. **Try it on one student computer first**, logged in as a student. Make a profile, open
   *Blink & Traffic Lights*, plug in a board and press **Upload**. The first upload for each kind of
   board unpacks its tools, which takes about a minute (longer for ESP32 boards).
3. **If Windows blocks it** (SmartScreen: "Windows protected your PC"), press **More info** then
   **Run anyway**. If the laptops are managed, ask IT to allow `ArduinoPath.exe` (by file hash or
   path) and, for clone boards, to install the CH340 / CP2102 USB drivers.
4. **Check your kit.** The picker says "needs a part not in your kit" using `content/kit.json`.
   To change it, edit that file in the repository; the next release includes it.
5. **Run through the hardware checklist** ([hardware-test-checklist.md](hardware-test-checklist.md))
   once with your boards and parts.

## How a lesson works

1. **Welcome screen.** Students pick their name, or press **I'm new here** and type their first
   name(s) and school. Students sharing a kit can add up to 4 names on one profile. No passwords.
2. **How much help, and which board.** Beginner, Moderate or Advanced, and the board in their kit.
   Both can be changed any time in **Settings**.
3. **The project picker.** Every project is open. Tiers (Getting Started, Sensors & Sound,
   Displays & Lights, Games, Challenge, WiFi & IoT) are only a guide. *Getting Started* projects
   are marked "Good to try first". **Free Play** is always there for students' own ideas.
4. **The Wiring Wizard** opens first in each project: meet the parts, wire them up one at a time
   with breadboard and schematic pictures, then **Test** each part before programming.
5. **Programming, one step at a time.** Each step has instructions, starter code (sometimes with
   `___` blanks to fill in), and a checklist that ticks itself.
   - **Run** tries the code in the on-screen simulator. It needs no board.
   - **Watch the goal** shows what the step should do.
   - **Upload** puts the code on the real board.
   - **Check my code** only compiles.
   - The **Coach** explains every error ("clue") in plain English, with hints.
6. **Stars** count independence (fewer hints = more stars), never speed.

## The help levels

| Level | What students get |
|---|---|
| **Beginner** | Full explanations, every hint any time, and the first hint for each clue straight away. |
| **Moderate** | Each project's gradual release: guided steps first, then fewer hints, then brief goals. |
| **Advanced** (Years 9–10) | The goal first ("tutorial off"), real compiler messages with a technical note, fewer hints, steps can be skipped, **Jump to the challenge**, a code review after each step, and **Level up** challenges at the end. |

On top of the level, the Coach notices when a student seems **stuck** (the same clue twice, a
checklist item that keeps failing, lots of tries, or a quiet spell) and offers a hint, the goal
or the full explanation. It also suggests a harder level after three steps done first try, or an
easier one when a student is struggling. Students can switch these nudges off in Settings.

## Curriculum

Every project links to the Victorian Curriculum Digital Technologies (Levels 7–10). Students and
teachers see the links in **Settings > Curriculum**.

## Safety

Every wiring screen reminds students:

- **Unplug the USB cable before changing wires**, and plug it back in after.
- **Never connect 5V to an ESP board's pins.** ESP boards (NodeMCU, D1 mini, ESP32) run on 3.3V.
  Projects with 5V parts add the right resistors automatically on those boards.
- **Always use a resistor with an LED.**

## Saving and moving work

- Code saves by itself about a second after typing stops. Progress saves at every step.
- **Settings > My work > Save my work** downloads a `.circuit` file of the student's own work, to
  keep or move to another computer (**Open my work**). It works between Windows, Mac and Pi.
- **The WIPE page** (on the welcome screen) is for the end of a program: **Save everyone's work**
  downloads everyone's files in one zip, then typing **WIPE** deletes every profile on that
  computer, ready for the next group.

## Troubleshooting

| What happens | What to do |
|---|---|
| "Plug in your board" or no port in the list | Use a USB cable that carries data (some only charge). Try another USB port. Clone boards need the CH340 / CP2102 driver on Windows. |
| Upload says the board isn't responding (Uno / Nano) | Pick the right board in Settings. Nano clones often need **Old bootloader** ticked. |
| Upload says "Failed to connect" (ESP boards) | Hold the board's **BOOT** / **FLASH** button while the upload starts. |
| Upload says another program is using the board | Close the Arduino IDE or any other Serial Monitor. |
| The window closed | Open ArduinoPath again. Unsaved code waits in the browser and saves when it's back. |
| Anything else | The log is next to the saved work: `arduinopath.log` (see the guide for your computer). |

ArduinoPath has no AI. All help comes from hints and explanations written and reviewed by
teachers, and it runs entirely on the student's computer.
