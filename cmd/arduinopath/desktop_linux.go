package main

import (
	_ "embed"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// browserNames is what the "open a browser" message suggests.
const browserNames = "Chromium or Chrome"

// browsers are the Chromium-family browsers on a Raspberry Pi (Raspberry Pi
// OS comes with Chromium) or another Linux computer, by command name.
var browsers = []string{"chromium-browser", "chromium", "google-chrome", "google-chrome-stable", "microsoft-edge"}

// openBrowser opens url as an app window (no tabs or address bar) in
// Chromium or Chrome, or in the default browser if neither is found.
func openBrowser(url string) error {
	for _, name := range browsers {
		exe, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		cmd := exec.Command(exe, "--app="+url)
		if err := cmd.Start(); err == nil {
			go cmd.Wait()
			return nil
		}
	}
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		return errors.New("no browser found")
	}
	go cmd.Wait()
	return nil
}

// showError shows a message box when the desktop has zenity (Raspberry Pi
// OS does), and writes to the terminal too.
func showError(title, text string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", title, text)
	if zenity, err := exec.LookPath("zenity"); err == nil {
		exec.Command(zenity, "--warning", "--no-markup", "--title="+title, "--text="+text).Run()
	}
}

//go:embed winres/icon.png
var iconPNG []byte

// installShortcuts puts ArduinoPath in the Raspberry Pi's menu (under
// Education and Programming) and on the desktop, so students can start it
// without the terminal. It needs no admin rights: the files go in the
// student's own home folder. It runs at every start, so the shortcuts
// follow the app if it's moved, but it only adds the desktop icon once
// (students may delete it).
func installShortcuts(cfg config, log *slog.Logger) {
	if cfg.dev {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	data := os.Getenv("XDG_DATA_HOME")
	if data == "" {
		data = filepath.Join(home, ".local", "share")
	}
	icon := filepath.Join(data, "icons", "hicolor", "256x256", "apps", "arduinopath.png")
	entry := desktopEntry(exe, icon)
	write := func(path string, body []byte, mode os.FileMode) {
		if old, err := os.ReadFile(path); err == nil && string(old) == string(body) {
			return
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			log.Warn("couldn't add a shortcut", "path", path, "err", err)
			return
		}
		if err := os.WriteFile(path, body, mode); err != nil {
			log.Warn("couldn't add a shortcut", "path", path, "err", err)
		}
	}
	write(icon, iconPNG, 0o644)
	write(filepath.Join(data, "applications", "arduinopath.desktop"), []byte(entry), 0o755)

	desktop := desktopDir(home)
	marker := filepath.Join(cfg.dataDir, "desktop-icon-added")
	shortcut := filepath.Join(desktop, "arduinopath.desktop")
	if _, err := os.Stat(marker); err == nil {
		if _, err := os.Stat(shortcut); err == nil {
			write(shortcut, []byte(entry), 0o755) // keep it pointing at the app
		}
		return
	}
	if dirExists(desktop) {
		write(shortcut, []byte(entry), 0o755)
		os.MkdirAll(cfg.dataDir, 0o700)
		os.WriteFile(marker, nil, 0o600)
	}
}

// desktopEntry is a freedesktop.org .desktop file that starts exe.
func desktopEntry(exe, icon string) string {
	quote := func(s string) string {
		r := strings.NewReplacer(`\`, `\\\\`, `"`, `\"`, "`", "\\`", "$", `\$`)
		return `"` + r.Replace(s) + `"`
	}
	return "[Desktop Entry]\n" +
		"Type=Application\n" +
		"Name=ArduinoPath\n" +
		"Comment=Learn to code Arduino and ESP boards, step by step\n" +
		"Exec=" + quote(exe) + "\n" +
		"Icon=" + icon + "\n" +
		"Terminal=false\n" +
		"Categories=Education;Development;\n" +
		"Keywords=Arduino;ESP32;ESP8266;coding;electronics;\n"
}

// desktopDir is the student's Desktop folder (from xdg-user-dirs, if set).
func desktopDir(home string) string {
	if b, err := os.ReadFile(filepath.Join(home, ".config", "user-dirs.dirs")); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(strings.TrimSpace(line), "XDG_DESKTOP_DIR="); ok {
				v = strings.Trim(v, `"`)
				return strings.Replace(v, "$HOME", home, 1)
			}
		}
	}
	return filepath.Join(home, "Desktop")
}
