package main

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInstallShortcuts(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_DATA_HOME", "")
	os.MkdirAll(filepath.Join(home, "Desktop"), 0o755)
	cfg := config{dataDir: filepath.Join(home, ".config", "ArduinoPath")}
	installShortcuts(cfg, slog.Default())

	menu, err := os.ReadFile(filepath.Join(home, ".local/share/applications/arduinopath.desktop"))
	if err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	for _, want := range []string{"Name=ArduinoPath\n", `Exec="` + exe + `"`, "Categories=Education;Development;"} {
		if !strings.Contains(string(menu), want) {
			t.Errorf("menu entry has no %q:\n%s", want, menu)
		}
	}
	if _, err := os.Stat(filepath.Join(home, ".local/share/icons/hicolor/256x256/apps/arduinopath.png")); err != nil {
		t.Error("no icon")
	}
	shortcut := filepath.Join(home, "Desktop", "arduinopath.desktop")
	if _, err := os.Stat(shortcut); err != nil {
		t.Fatal("no desktop icon")
	}
	// A student deletes the desktop icon: it stays deleted.
	os.Remove(shortcut)
	installShortcuts(cfg, slog.Default())
	if _, err := os.Stat(shortcut); err == nil {
		t.Error("the desktop icon came back")
	}
}

func TestDesktopEntryQuoting(t *testing.T) {
	got := desktopEntry(`/home/pi/My "Apps"/$x/ArduinoPath`, "/icon.png")
	if !strings.Contains(got, `Exec="/home/pi/My \"Apps\"/\$x/ArduinoPath"`) {
		t.Errorf("bad quoting:\n%s", got)
	}
}
