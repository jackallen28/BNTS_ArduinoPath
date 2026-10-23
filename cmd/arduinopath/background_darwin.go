package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// On macOS, double-clicking an app that is still running only brings it to
// the front; it doesn't start it again. So ArduinoPath.app starts the server
// as a separate background process, opens the window, and quits straight
// away. Double-clicking it again then finds the running server and just
// opens another window, as on Windows.

const serverEnv = "ARDUINOPATH_SERVER"

// startsInBackground reports whether this launch should hand the server to a
// background process (always on a Mac, except with -dev or in that process).
func startsInBackground(cfg config) bool {
	return !cfg.dev && os.Getenv(serverEnv) == ""
}

func launchInBackground(cfg config, log *slog.Logger) error {
	url := fmt.Sprintf("http://localhost:%d/", cfg.port)
	if running(cfg.port) {
		log.Info("already running; opening a window", "url", url)
		if cfg.noBrowser {
			return nil
		}
		return openBrowser(url)
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, append(os.Args[1:], "-no-browser")...)
	cmd.Env = append(os.Environ(), serverEnv+"=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} // keeps running after the app quits
	if err := cmd.Start(); err != nil {
		return err
	}
	stopped := make(chan error, 1)
	go func() { stopped <- cmd.Wait() }()
	deadline := time.After(30 * time.Second)
	for !running(cfg.port) {
		select {
		case <-stopped:
			return errStartFailed
		case <-deadline:
			return errors.New("ArduinoPath took too long to start")
		case <-time.After(200 * time.Millisecond):
		}
	}
	log.Info("started in the background", "pid", cmd.Process.Pid, "url", url)
	if cfg.noBrowser {
		return nil
	}
	return openBrowser(url)
}
