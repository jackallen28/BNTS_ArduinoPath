# ArduinoPath on a Mac

`ArduinoPath.app` is the same as the Windows app: it runs on the student's own Mac, with no
server, no teacher page and no internet needed. One app works on both Intel and Apple Silicon
(M1, M2, M3...) Macs, on macOS 11 Big Sur or newer.

## Getting it

- **A release:** on GitHub, open **Releases** and download `ArduinoPath-macOS.zip`.
- **The newest build:** open **Actions > CI**, pick the latest run, and download
  **ArduinoPath-macOS** at the bottom of the page.

Open the zip (Safari usually does this by itself) and drag **ArduinoPath** into **Applications**.
If the Mac won't let you (no admin rights), put it in your own **Applications** folder in your home
folder, or anywhere else: it works from any folder.

## The first time: getting past "Apple could not verify"

The app isn't notarised by Apple yet, so the first time it's opened macOS stops it. Do this once:

- **macOS 15 Sequoia or newer:** double-click ArduinoPath and press **Done** on the message. Open
  **System Settings > Privacy & Security**, scroll down to *"ArduinoPath" was blocked to protect
  your Mac*, press **Open Anyway**, and type your Mac login password. Then press **Open**.
- **macOS 14 Sonoma or older:** hold **Control** and click ArduinoPath, choose **Open**, then
  press **Open** again.
- **Or in Terminal** (any version): `xattr -dr com.apple.quarantine /Applications/ArduinoPath.app`

After that it opens with a normal double-click. If the school manages its Macs (with Jamf or
similar) and there's no Open Anyway button, IT has to allow it.

## What happens when you open it

ArduinoPath opens in **Chrome** (or Edge) as its own window, at the same welcome screen as on
Windows: pick your name, or **I'm new here**. There's no Dock icon for ArduinoPath itself: it
runs quietly in the background and closes itself about 20 minutes after the window is closed.
Opening the app again while it's running just opens another window.

**Use Chrome or Edge.** Safari can't upload to boards (it has no Web Serial). If neither is
installed, ArduinoPath opens in the default browser and the simulator still works.

## Where the work is kept

In `~/Library/Application Support/ArduinoPath` (in Finder: **Go > Go to Folder...** and paste
it): `arduinopath.db` holds every profile on this Mac with their code and progress, and
`arduinopath.log` says what happened. It belongs to the Mac account that opened it.
Save files (`.circuit`) move between Macs and Windows laptops both ways.

The **WIPE page** works the same as on Windows (see [windows-app.md](windows-app.md#the-wipe-page)).

## Good to know

- Most clone boards (CH340 chips) work without installing a driver on recent macOS.
- To stop ArduinoPath straight away: close its window, then in **Activity Monitor** quit
  **ArduinoPath**. It's fine to leave it: it closes itself.
- Notarising the app (an Apple Developer account, about A$150 a year) would remove the
  "could not verify" step.
