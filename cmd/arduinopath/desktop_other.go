//go:build !windows && !darwin && !linux

package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
)

const browserNames = "Chrome or Edge"

func openBrowser(url string) error {
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		return errors.New("no browser found")
	}
	go cmd.Wait()
	return nil
}

func showError(title, text string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", title, text)
}

func installShortcuts(cfg config, log *slog.Logger) {}
