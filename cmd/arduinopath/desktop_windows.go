package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

// browsers are where Edge and Chrome live on Windows (Edge first: every
// Windows 10/11 laptop has it). Both can upload to boards with Web Serial.
func browsers() []string {
	var out []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		out = append(out,
			filepath.Join(base, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(base, `Google\Chrome\Application\chrome.exe`))
	}
	return out
}

// openBrowser opens url as an app window (no tabs or address bar) in Edge
// or Chrome, or in the default browser if neither is found.
func openBrowser(url string) error {
	for _, exe := range browsers() {
		if _, err := os.Stat(exe); err == nil {
			cmd := exec.Command(exe, "--app="+url)
			if err := cmd.Start(); err == nil {
				go cmd.Wait()
				return nil
			}
		}
	}
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	if err := cmd.Start(); err != nil {
		return errors.New("no browser found")
	}
	go cmd.Wait()
	return nil
}

// showError shows a message box (ArduinoPath.exe has no console window).
func showError(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	const mbIconWarning = 0x30
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").
		Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconWarning)
}
