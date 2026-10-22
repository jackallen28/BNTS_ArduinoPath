//go:build !darwin

package main

import "log/slog"

// startsInBackground is only needed on macOS (see background_darwin.go).
func startsInBackground(cfg config) bool { return false }

func launchInBackground(cfg config, log *slog.Logger) error { return nil }
