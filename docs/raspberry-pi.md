# ArduinoPath on a Raspberry Pi

ArduinoPath runs on a Raspberry Pi just like on a laptop. Students sit at the Pi, plug their Arduino
or ESP board into the Pi's USB port, and code it from there. Everything runs on the Pi itself: no
server, no teacher page and no internet needed (except the Internet Clock project).

## What you need

- A **Raspberry Pi 5 or 4** with **4 GB of memory or more**, and a keyboard, mouse and screen.
  (A Pi 3 or Pi Zero 2 W running a 64-bit system works too, but compiling for ESP32 boards is
  very slow.)
- **64-bit Raspberry Pi OS with the desktop** (the normal choice in Raspberry Pi Imager for the
  last few years). To check, open the Terminal and type `uname -m`: it should say `aarch64`.
  ArduinoPath doesn't run on the older 32-bit system (`armv7l`).
- About **4 GB free** on the SD card (for ArduinoPath and the tools that compile for each board).
- **Chromium**, which comes with Raspberry Pi OS. Chrome works too.
- The **official power supply** for the Pi. The Arduino and its parts take power from the Pi's
  USB port. If a lightning bolt appears on the screen, the Pi is short of power: use the right
  supply, or give motors and long NeoPixel strips their own power.

## Getting it

- **A release:** on GitHub, open **Releases** and download `ArduinoPath-RaspberryPi.tar.gz`.
- **The newest build:** open **Actions > CI**, pick the latest run, and download
  **ArduinoPath-RaspberryPi** at the bottom of the page.

## Putting it on the Pi

1. Open the **Downloads** folder, right-click `ArduinoPath-RaspberryPi.tar.gz` and choose
   **Extract Here**. A folder called `ArduinoPath` appears. You can move it anywhere, for
   example to the home folder.
2. Open the `ArduinoPath` folder and double-click **ArduinoPath**. If the Pi asks what to do with
   it, choose **Execute**.
3. ArduinoPath opens in Chromium as its own window. The first time, it also adds itself to the
   **menu** (under Education and Programming) and puts an **ArduinoPath icon on the desktop**.
   After that, students start it from the menu or the desktop icon.

No admin password is needed. Everything goes in the user's own home folder.

With the Terminal, the same steps are:

```sh
cd ~
tar xzf ~/Downloads/ArduinoPath-RaspberryPi.tar.gz
~/ArduinoPath/ArduinoPath
```

**Setting up a class set of Pis:** set up one Pi, then copy the `ArduinoPath` folder to the others
on a USB stick (or put it on your master SD card image). Each Pi adds its own menu entry and
desktop icon the first time ArduinoPath starts.

## Plugging in a board

Plug the Arduino or ESP board into one of the Pi's USB ports. Nothing else to install: the Pi
already knows genuine Arduinos and the usual clone chips (CH340 and CP2102, on most Nano clones,
NodeMCUs and ESP32 boards). In ArduinoPath, boards show up as `/dev/ttyACM0` (genuine Uno and Mega)
or `/dev/ttyUSB0` (most clones and ESP boards).

The usual Pi user is allowed to use USB boards. If you made other user accounts and uploading
says **"This computer won't let ArduinoPath use the USB port"**, give the account permission once
in the Terminal, then log out and back in:

```sh
sudo usermod -aG dialout <username>
```

The first time a student uploads to a type of board (Arduino, ESP8266 or ESP32), ArduinoPath
unpacks that board's tools. This takes up to a minute (a few minutes for ESP32 on a Pi 4). After
that, compiling is much quicker.

## Where the work is kept

In `~/.config/ArduinoPath` in the Pi user's home folder:

- `arduinopath.db`: every profile on this Pi, with their code and progress
- `arduinopath.log`: what happened, for troubleshooting
- `arduino-...`: the unpacked board tools

To move work to another Pi or a laptop: **Settings > My work > Save my work**, then **Open my
work** on the other computer. Save files (`.circuit`) work on Windows, Mac and Raspberry Pi.

## The WIPE page

At the end of a program, open the **WIPE page** from the welcome screen to clear the Pi for the
next group (it offers **Save everyone's work** first). It only clears ArduinoPath, for that Pi user.

## Updating

Download the new `ArduinoPath-RaspberryPi.tar.gz` and extract it in the same place, replacing the
old `ArduinoPath` folder. Students' work is kept (it's in `~/.config/ArduinoPath`, not in the
folder). The menu entry and desktop icon update themselves.

## Removing it

Delete the `ArduinoPath` folder, the `~/.config/ArduinoPath` folder (this deletes everyone's work
on this Pi), `~/.local/share/applications/arduinopath.desktop` and the desktop icon.

## If something goes wrong

- **Double-clicking does nothing, or the Terminal says "cannot execute" / "Exec format error":**
  the Pi is running the 32-bit system. Install 64-bit Raspberry Pi OS.
- **It says ArduinoPath is running but no window opens:** open Chromium and go to
  `http://localhost:47820`.
- **The board isn't listed:** try another USB cable (some only charge and can't send data), then
  another USB port. Type `ls /dev/tty{ACM,USB}*` in the Terminal: the board should appear when
  it's plugged in.
- Anything else: look at `~/.config/ArduinoPath/arduinopath.log`.
