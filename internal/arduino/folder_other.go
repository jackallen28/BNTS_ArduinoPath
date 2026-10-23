//go:build !windows

package arduino

// ToolsFolder is where the board tools are unpacked: the data folder (only
// Windows needs somewhere shorter, see folder_windows.go).
func ToolsFolder(dataDir string) string { return dataDir }
