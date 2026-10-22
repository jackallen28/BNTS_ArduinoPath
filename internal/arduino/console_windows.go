package arduino

import (
	"os/exec"
	"syscall"
)

// hideConsole stops a console window flashing up for each arduino-cli run
// (ArduinoPath.exe has no console of its own).
func hideConsole(cmd *exec.Cmd) {
	const createNoWindow = 0x08000000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}
