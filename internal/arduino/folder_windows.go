package arduino

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

// ToolsFolder is where the board tools are unpacked. On Windows it's a short
// folder in the user's home folder (C:\Users\<name>\.arduinopath), written
// with Windows' short folder names when it has them (C:\Users\OLIVIA~1\...),
// because the ESP8266 compiler builds paths longer than Windows' 260-letter
// limit under %LOCALAPPDATA%. It needs no admin rights. If the home folder
// can't be used, it's dataDir.
func ToolsFolder(dataDir string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return dataDir
	}
	dir := filepath.Join(home, ".arduinopath")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return dataDir
	}
	if p, err := syscall.UTF16PtrFromString(dir); err == nil {
		const hidden = 0x2
		syscall.NewLazyDLL("kernel32.dll").NewProc("SetFileAttributesW").Call(uintptr(unsafe.Pointer(p)), hidden)
	}
	return shortPath(dir)
}

// shortPath is p with Windows' 8.3 short names (C:\Users\OLIVIA~1), or p.
func shortPath(p string) string {
	long, err := syscall.UTF16FromString(p)
	if err != nil {
		return p
	}
	buf := make([]uint16, 260)
	n, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetShortPathNameW").
		Call(uintptr(unsafe.Pointer(&long[0])), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 || int(n) >= len(buf) {
		return p
	}
	return syscall.UTF16ToString(buf[:n])
}
