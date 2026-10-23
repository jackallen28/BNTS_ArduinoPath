# Real hardware test day

Do this with each new release before using it with a class. It checks the parts of ArduinoPath that
only real boards can test: uploading over USB, the Serial Monitor, and the Wiring Wizard's Test.
Everything else (the simulator, every project's model answer compiling for every board, the
Wiring Wizard's test programs compiling) is checked automatically before each release.

Allow about 90 minutes. Tick each box. If anything goes wrong, see **When something goes wrong**
at the end: a note of what you clicked and the log file are all that's needed to fix it.

## What you need

- The release from the repository's **Releases** page, on the computers you'll use:
  - **Raspberry Pi 4 / 5** (64-bit Raspberry Pi OS): `ArduinoPath-RaspberryPi.tar.gz`
  - **Windows laptop** (a student account without admin rights, in Edge): `ArduinoPath.exe`
  - **Mac** (if you use them): `ArduinoPath-macOS.zip`
- Boards: a **genuine Arduino Uno**, a **Nano clone (CH340 chip)**, a **NodeMCU** and an **ESP32
  DevKit**, with **USB cables that carry data** (some cables only charge).
- One class kit: LEDs, 220Ω resistors, a button, a buzzer, jumper wires and a breadboard.

## 1. Start it (each computer)

- [ ] Start it the normal way (Pi: extract, then double-click **ArduinoPath** and choose
      **Execute**; Windows: double-click, and **More info > Run anyway** if SmartScreen asks).
      It opens in its own window within a few seconds.
- [ ] **About** (on the picker's toolbar) shows the right **version**, and the **folder** where
      the work and `arduinopath.log` are kept. Note the folder: it's where the log is.
- [ ] Pi only: ArduinoPath is in the menu (**Education**) and on the desktop.
- [ ] Make a profile (two first names and a school), choose **Beginner** and **Arduino Uno R3**.

## 2. Genuine Uno: the main path

Plug in the Uno. Wire three LEDs as the Wiring Wizard shows.

- [ ] Open **Blink & Traffic Lights**. The **Wiring Wizard** opens: the parts, then the wiring
      steps with the breadboard picture and the safety reminder on every wiring screen.
- [ ] On **Test it**, choose **On my real board**. The USB port is already chosen. On a Pi or a
      Mac the computer's own ports (like `/dev/ttyAMA0`) are listed last and marked "built into
      this computer".
- [ ] Press **Test**. The first time, unpacking the Uno's tools takes up to a minute. Then each
      LED lights in turn and its row asks "Did you see it?". Tick **I saw it work** for each,
      then **Start programming**.
- [ ] Fill in the blank, press **Run**: the LED on the screen blinks and the checklist ticks.
- [ ] Press **Upload**: "Uploading..." with a percentage, then **Uploaded ✓**. The real red LED
      blinks. The checklist now says **(on your board)**, and the LED rows have "I saw it happen"
      boxes.
- [ ] Delete a `;` and press **Check my code**: the Coach explains "A missing semicolon".
- [ ] Close the window, start ArduinoPath again and pick your name: the project opens on the same
      step, with your code.

## 3. The Serial Monitor (Uno)

- [ ] Open **Serial Chatbot**. Fill in step 1's blank and **Upload**. Your message appears in the
      **Serial Monitor** (the speed is set from `Serial.begin(9600)` by itself).
- [ ] Do step 3 (the board repeats what you type), **Upload**, then type in the Serial Monitor's
      box and press **Enter**: the board answers "You said: ...".
- [ ] Change the speed list to another speed and back to 9600: it reconnects each time.
- [ ] Unplug the board while the Serial Monitor is open: it says the board was unplugged.

## 4. Nano clone (CH340)

- [ ] **Settings**: choose **Arduino Nano**. Upload Blink. If it says the board **isn't
      responding**, tick **Old bootloader** in Settings and upload again (most clones need it).
- [ ] The Wiring Wizard's **Test** on the Nano works too, with the same setting.
- [ ] Windows only: if no port appears, the laptop needs the **CH340 driver** (IT).

## 5. NodeMCU (ESP8266)

- [ ] **Settings**: **NodeMCU**. Upload Blink. The first time, unpacking the ESP8266 tools takes a
      minute or two. If it says **Failed to connect**, hold the **FLASH** button while it starts
      uploading: the Coach says so too.
- [ ] Serial Chatbot step 1 on the NodeMCU: the message shows in the Serial Monitor.
- [ ] **Phone-controlled LED**: upload, join the board's WiFi (**ArduinoPath-...**) on a phone,
      open **192.168.4.1**, and the buttons turn the LED on and off.

## 6. ESP32 DevKit

- [ ] **Settings**: **ESP32 DevKit**. Upload Blink. The first ESP32 compile is slow (a few
      minutes on a Pi 4; much quicker after). Hold **BOOT** if it says **Failed to connect**.
- [ ] Serial Chatbot step 1: the message shows in the Serial Monitor.

## 7. Parts, with the Wiring Wizard's Test on a real board

- [ ] **Button Night Light**: pressing the real button ticks its row by itself.
- [ ] **Light Theremin** (LDR + buzzer): the LDR row shows a live bar that moves with the light;
      the buzzer beeps on its turn.
- [ ] **Servo Dial**: the servo sweeps on its turn; the pot's bar follows the knob.
- [ ] **Parking Sensor** on an ESP board: the wiring steps include the two 10kΩ resistors for the
      echo pin, and the distance reading changes with your hand.
- [ ] **Weather Station**: the OLED shows "Hello!" and the DHT row shows a temperature.

## 8. The end of a program

- [ ] **Settings > My work > Save my work** downloads a `.circuit` file; **Open my work** on
      another computer brings the work across.
- [ ] The **WIPE page** (welcome screen): **Save everyone's work** downloads a zip; typing
      **WIPE** removes every profile.

## When something goes wrong

Write down three things, and send them with the log file:

1. **What you clicked**, and on which computer and board (for example "Pi 5, Nano clone, Upload
   in Blink step 2").
2. **What it said**: the message, the Coach's clue, or the **Output** tab under the Serial
   Monitor (click in it, select all, copy).
3. **The log file**, `arduinopath.log`, in the folder the **About** box shows:
   - Raspberry Pi: `~/.config/ArduinoPath/arduinopath.log`
   - Windows: `%LOCALAPPDATA%\ArduinoPath\arduinopath.log`
   - Mac: `~/Library/Application Support/ArduinoPath/arduinopath.log`

Quick fixes to try first:

| What happens | Try this |
|---|---|
| No port in the list, or only "built into this computer" ones | Another USB cable (some only charge), another USB port. Windows: the CH340 / CP2102 driver. |
| "The board isn't responding" (Uno / Nano) | Check the board in Settings. Nano clones: tick **Old bootloader**. |
| "Failed to connect" (ESP boards) | Hold **BOOT** / **FLASH** while the upload starts. |
| "Another program is using your board" | Close the Arduino IDE or any other Serial Monitor. |
| Pi: "won't let ArduinoPath use the USB port" | `sudo usermod -aG dialout <username>`, then log out and in. See [raspberry-pi.md](raspberry-pi.md). |
| The Serial Monitor shows nothing | Check the speed matches `Serial.begin(...)`, and press the board's reset button. |
