# Real hardware checklist

Do this once for each new release before using it with a class, on real school equipment. Tick
each line, and note anything odd (with the `arduinopath.log` file) for a bug report.

**Equipment:** a student Windows laptop **without admin rights** (Edge), plus if you use them a Mac
and a Raspberry Pi 4 / 5. Boards: a genuine **Arduino Uno**, a **CH340 Nano clone**, a **NodeMCU**
and an **ESP32 DevKit**. Parts from one class kit.

## Every computer

- [ ] Download the release file and start it the normal way (double-click / menu). It opens in its
      own window in under a few seconds. (Windows: SmartScreen "Run anyway" if asked.)
- [ ] Make a profile with two first names and a school. Choose Beginner and the Uno.
- [ ] Open *Blink & Traffic Lights*. The Wiring Wizard opens: meet the parts, the wiring steps show
      the breadboard and schematic, the safety reminder is on every wiring screen.
- [ ] Wire the red LED and press **Test** (real board): the LED blinks and the row can be ticked.
- [ ] In the programming screen, fill in the blank, press **Run**: the checklist ticks in the
      simulator. Press **Upload**: the first time takes about a minute; the LED on the breadboard
      blinks. The Serial Monitor opens.
- [ ] Break the code (delete a `;`) and press **Check my code**: the Coach explains the clue.
- [ ] Close the window, open ArduinoPath again, pick your name: the project opens on the same step
      with your code.
- [ ] **Settings > My work > Save my work**, then **Open my work** with that file on another
      computer: the work appears.

## Each board

| Board | Upload Blink | Serial Monitor shows text | Notes |
|---|---|---|---|
| Arduino Uno (genuine) | [ ] | [ ] | |
| Nano clone (CH340) | [ ] | [ ] | Tick **Old bootloader** in Settings if upload says "not responding". |
| NodeMCU (ESP8266) | [ ] | [ ] | Hold FLASH if upload says "Failed to connect". |
| ESP32 DevKit | [ ] | [ ] | Hold BOOT if upload says "Failed to connect". The first compile is slow. |

## Parts (one project each, with the Wiring Wizard's Test)

- [ ] Button (Button Night Light): pressing it ticks the row.
- [ ] Buzzer and LDR (Light Theremin): the pitch follows the light.
- [ ] Potentiometer and servo (Servo Dial): the servo follows the knob.
- [ ] HC-SR04 (Parking Sensor), on the Uno and on an ESP board (with the two 10kΩ resistors).
- [ ] DHT and OLED (Weather Station): readings on the screen.
- [ ] NeoPixel ring (NeoPixel Mood Lamp).
- [ ] WiFi (Phone-controlled LED) on the NodeMCU: a phone joins the board's hotspot and opens
      192.168.4.1; the buttons turn the LED on and off.

## The end of a program

- [ ] The WIPE page: **Save everyone's work** downloads a zip; typing **WIPE** removes every
      profile; the welcome screen is empty afterwards.
