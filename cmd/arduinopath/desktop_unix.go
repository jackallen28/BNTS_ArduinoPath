//go:build !windows && !darwin

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// openBrowser opens url in the default browser (for development on Linux;
// Windows and macOS open an Edge / Chrome app window).
func openBrowser(url string) error {
	cmd := exec.Command("xdg-open", url)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

func showError(title, text string) {
	fmt.Fprintf(os.Stderr, "%s: %s\n", title, text)
}
