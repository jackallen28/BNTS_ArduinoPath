package main

import (
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
)

// browsers are Chrome and Edge on a Mac (both can upload to boards with Web
// Serial; Safari can't).
func browsers() []string {
	var out []string
	home, _ := os.UserHomeDir()
	for _, base := range []string{"/Applications", filepath.Join(home, "Applications")} {
		out = append(out,
			filepath.Join(base, "Google Chrome.app/Contents/MacOS/Google Chrome"),
			filepath.Join(base, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"))
	}
	return out
}

// openBrowser opens url as an app window in Chrome or Edge, or in the
// default browser if neither is installed.
func openBrowser(url string) error {
	for _, exe := range browsers() {
		if _, err := os.Stat(exe); err == nil {
			cmd := exec.Command(exe, "--app="+url)
			if err := cmd.Start(); err == nil {
				cmd.Process.Release()
				return nil
			}
		}
	}
	if err := exec.Command("open", url).Run(); err != nil {
		return errors.New("no browser found")
	}
	return nil
}

// showError shows a dialog (ArduinoPath.app has no window of its own).
func showError(title, text string) {
	exec.Command("osascript",
		"-e", "on run argv",
		"-e", `display dialog (item 2 of argv) with title (item 1 of argv) buttons {"OK"} default button 1 with icon caution`,
		"-e", "end run",
		title, text).Run()
}

// browserNames is what the "open a browser" message suggests.
const browserNames = "Edge or Chrome"

// installShortcuts is only needed on Linux (see desktop_linux.go).
func installShortcuts(cfg config, log *slog.Logger) {}
