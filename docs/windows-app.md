# ArduinoPath on a student laptop (Windows)

ArduinoPath is one file, `ArduinoPath.exe`. It runs on the student's own laptop: no server, no
teacher page and no internet needed.

## Getting it

- **A release:** on GitHub, open **Releases** and download `ArduinoPath.exe` (most laptops) or
  `ArduinoPath-arm64.exe` (laptops with an ARM chip, such as Snapdragon).
- **The newest build:** open **Actions > CI**, pick the latest run, and download
  **ArduinoPath-exe** at the bottom of the page (a zip with `ArduinoPath.exe` inside).

Put it anywhere the student can reach: the Desktop, Documents, or a shared folder. To make it
easy to find, right-click it and choose **Pin to Start**.

## What happens when you double-click it

1. ArduinoPath opens in **Edge** as its own window (or Chrome, or the default browser if neither
   is found). There's no console window.
2. **The welcome screen** lists everyone who has a profile on this laptop. Students pick their
   name, or press **I'm new here** and type their first name(s) and school. Students sharing a
   kit can add up to 4 first names. The first time, it goes straight to making a profile.
3. They choose how much help they want and which board they have, then pick a project.

Code saves by itself about a second after typing stops. **Log out** goes back to the welcome
screen. Closing the window is fine too: ArduinoPath closes itself about 20 minutes later.
Double-clicking `ArduinoPath.exe` while it's already running just opens another window.

## Where the work is kept

In `%LOCALAPPDATA%\ArduinoPath` (for example `C:\Users\<you>\AppData\Local\ArduinoPath`):

- `arduinopath.db`: every profile on this laptop, with their code and progress
- `arduinopath.log`: what happened, for troubleshooting

The tools that compile code for each board are unpacked the first time they're needed into a
hidden folder, `C:\Users\<you>\.arduinopath` (a short path, because Windows can't open the
ESP8266 compiler's files from deeper folders). It holds no student work, and can be deleted at any
time: ArduinoPath unpacks the tools again when it next needs them.

It's inside the Windows account that ran it. If students log in to the laptop with their own
Windows accounts, each one has their own ArduinoPath with their own profiles. To move work to
another laptop: **Settings > My work > Save my work**, then **Open my work** on the other laptop.

## The WIPE page

On the welcome screen, **Wipe this laptop** (bottom of the screen) deletes every profile on this
laptop, with all their code and progress: use it at the end of a program, before the next group.

1. **Save everyone's work** (a good idea): downloads one zip holding a `.circuit` file for each
   profile. A student can open theirs later with **Settings > My work > Open my work**.
2. Type **WIPE** in capital letters, then press **Wipe this laptop**.

It can't be undone. It only wipes ArduinoPath on this laptop (in this Windows account).

## If Windows blocks it

The app isn't code-signed yet. Windows Defender SmartScreen checks files that are **marked as
downloaded from the internet**, and a new unsigned file has no "reputation" yet, so SmartScreen
stops it. Try these, in order:

1. **"Windows protected your PC" with a More info link:** press **More info**, then **Run anyway**.
2. **No Run anyway button:** remove the "downloaded" mark, then double-click the file again:
   - right-click `ArduinoPath.exe` > **Properties** > tick **Unblock** (bottom of the General
     tab) > **OK**; or
   - in PowerShell (no admin needed): `Unblock-File "$env:USERPROFILE\Downloads\ArduinoPath.exe"`; or
   - copy it to the laptop from a **USB stick** instead of downloading it there. (The mark only
     survives on NTFS drives; most USB sticks are FAT32 or exFAT, so it's dropped on the way.)
3. **"This app has been blocked by your system administrator"**, or **Smart App Control**, or still
   blocked after unblocking: the school's policy doesn't allow unsigned apps, and only IT can
   change that. Ask IT to do one of these (any one is enough):
   - **deploy it with Intune** (or put it on a school network share): files that arrive that way
     aren't marked as downloaded, so SmartScreen doesn't stop them
   - **allow it in Microsoft Defender** by its file hash (from `SHA256SUMS` on the release)
   - **sign it** with the school's code-signing certificate

A firewall question shouldn't appear: ArduinoPath only listens on the laptop itself (`127.0.0.1`),
never on the network. If one does, **Cancel** is fine.

## Good to know

- **Edge or Chrome** is needed to upload to real boards (Web Serial). Other browsers can use the
  simulator only.
- ArduinoPath uses port **47820** on the laptop (`http://localhost:47820`). If another program
  has it, ArduinoPath says so; start it with `ArduinoPath.exe -port 47900` to use another one.
- Clone boards with CH340 / CP2102 chips need their USB drivers installed (IT can push them with
  Intune), or use boards with built-in USB that need no driver.
- Uploading to a real board needs the code compiled first; that part isn't built yet. For now,
  students can use the simulator (also still being built: projects show "Coming soon").
