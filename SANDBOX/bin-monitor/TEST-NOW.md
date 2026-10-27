# Test the smart bin now

Two programs, two boards:

| Board | Program | What it does |
|---|---|---|
| **Arduino Uno** | `uno_bin_controller` | Runs the bin: opens the lid for a hand, closes it, measures how full it is, and sends the readings out of TX (D1). |
| **ESP32-C3** | `esp32_c3_wifi_bridge` | Makes the Wi-Fi network **BNTS-Bin-Monitor** and shows the readings on a web page at **http://192.168.4.1**. It does not control the bin. |

Test in this order: each step checks one thing, so a problem shows up where it starts.

## 1. The Uno on its own

**Upload it**, either way:

- **ArduinoPath:** open **Free Play**, select all the code and delete it, then paste in all of
  `uno_single_file.ino`. In **Settings**, choose **Arduino Uno**. Plug in the Uno and press **Upload**.
- **Arduino IDE:** open `firmware/uno_bin_controller/uno_bin_controller.ino` (its two `.h` files open as
  tabs), choose **Arduino Uno**, and upload.

**Check it:**

- [ ] At power-up the LED lights and the servo sweeps the lid closed until the closed button is pressed, then the LED goes off.
- [ ] A hand within 30 cm of the hand sensor opens the lid; it closes by itself after 5 seconds.
- [ ] The **Serial Monitor at 115200 baud** (change the speed from 9600) shows a line every half second like
      `@{"fill":0,"lidOpen":false,"sensorOk":true,...}*1A2B`. That's what the ESP32-C3 will receive.
      `sensorOk:false` is normal for about a second after the lid closes, and whenever the lid is open.

### Calibrate the fill level

The bin program says **0 %** when the fill sensor reads `BIN_EMPTY_MM` and **100 %** at `BIN_FULL_MM`
(now **220 mm** empty and **200 mm** full). To check or change them:

1. Upload `bin_calibration.ino` (Free Play or the IDE). Open the Serial Monitor at **9600**.
2. Close the lid with the bin empty: note the distance. That's EMPTY.
3. Put rubbish (or a flat card) where full should be: note the distance. That's FULL.
4. Put both numbers at the top of `bin_calibration.ino` and upload it again: check it says 0 % and 100 %.
5. Put the same numbers into `BIN_EMPTY_MM` / `BIN_FULL_MM` near the top of `uno_single_file.ino`
   and upload the bin program again.

The sensor reads to about ±5 mm, so with only 20 mm between empty and full the percentage
jumps in steps. The calibration sketch shows how steady the reading is ("last 3 s: from ... to ...").

## 2. The ESP32-C3 on its own

**Flash it**, either way:

- **In Chrome or Edge, no installing:** go to https://espressif.github.io/esptool-js/. Set **Baudrate**
  to `115200`, press **Connect** and pick the C3's port. If no port appears, hold the **BOOT** button
  while plugging the C3 in. Press **Erase Flash** and wait for it to finish. Then set **Flash Address**
  to `0x0`, choose `esp32_c3_wifi_bridge-flash-at-0x0.bin`, and press **Program**. When it finishes,
  press the C3's **RESET** button (or unplug it and plug it back in).
- **Arduino IDE** (with Espressif's *esp32* boards package installed): open
  `firmware/esp32_c3_wifi_bridge/esp32_c3_wifi_bridge.ino`. Choose board **ESP32C3 Dev Module**, set
  **USB CDC On Boot: Enabled** and **Partition Scheme: Huge APP (3MB No OTA)**, then upload.

**Check it** (no Uno needed yet):

- [ ] The **Serial Monitor at 115200** on the C3's USB shows, every 2 seconds:
      `Wi-Fi BNTS-Bin-Monitor, page http://192.168.4.1 | Uno link: NO DATA | ...` (no data yet is right).
- [ ] On a phone or laptop, join the Wi-Fi network **BNTS-Bin-Monitor** (there's no password).
      **Turn off mobile data** on a phone, and if it warns "no internet", choose to **stay connected**.
- [ ] Open **http://192.168.4.1**. Type all of it, with `http://`, because `https` won't work. The bin
      dashboard appears and says it's waiting for the Uno.

## 3. Join them

Unplug both boards first. Then wire:

```
Uno D1 (TX) ── 2.2 kΩ ──┬── ESP32-C3 GPIO4
                        └── 3.3 kΩ ── GND
Uno GND ─────────────────── ESP32-C3 GND
```

**Never** connect Uno TX straight to the C3: the Uno's 5 V damages the C3. Power both boards (two USB
cables is fine).

- [ ] The C3's Serial Monitor now says `Uno link: OK`, with the count of readings going up and the
      last reading from the Uno.
- [ ] The dashboard at http://192.168.4.1 shows **Uno · Wi-Fi live**. The fill level changes as you
      put things in the bin (after the lid closes), and the lid opens on the screen when it opens for real.

## If something doesn't work

| What you see | What to check |
|---|---|
| ArduinoPath / IDE upload to the Uno fails | Unplug the wire on D1, upload, then plug it back in. |
| The lid sweeps but never stops (LED stays on, then 90°) | The closed button on D2: it must read HIGH when the lid is shut (a 10k pull-down to GND, button to 5 V). |
| No `@{...}` lines from the Uno | The Serial Monitor speed must be **115200**. |
| Web flasher: "Failed to leave compressed flash mode" (status 196) | Writing to the C3's flash failed. Unplug the C3, hold **BOOT** while plugging it back in, press **Connect** at 115200, **Erase Flash**, then **Program** again. Use a short data cable straight into the computer (no hub). |
| No Wi-Fi network | The C3's Serial Monitor: "Wi-Fi FAILED" means press RESET; nothing at all means flash it again. |
| The page won't open | Stay joined to BNTS-Bin-Monitor, mobile data off, and type `http://192.168.4.1` exactly. |
| C3 says "Nothing on GPIO4" | The D1 → 2.2k → GPIO4 wire, and the shared GND. Is the Uno powered and running? |
| C3 says "Bytes arrive but no good readings" | The Uno program (115200 baud), and the divider resistors (2.2k and 3.3k, not swapped). |
| Fill shows "unknown" | Normal while the lid is open or moving. If it stays unknown with the lid shut, check the D6 sensor with `bin_calibration.ino`, and set `BIN_EMPTY_MM` / `BIN_FULL_MM` to your bin. |

The full wiring, the safety notes and how the readings are checked are in `dashboard/README.md`.
