//go:build !windows

package arduino

import "os/exec"

func hideConsole(cmd *exec.Cmd) {}
