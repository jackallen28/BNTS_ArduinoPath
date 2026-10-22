// Package arduinopath holds the web app and content that are built into the
// program, so ArduinoPath.exe is just one file.
package arduinopath

import (
	"embed"
	"io/fs"
)

// Version is set at build time: go build -ldflags "-X arduinopath.Version=1.2.3".
var Version = "dev"

//go:embed ui
var uiFiles embed.FS

//go:embed content
var contentFiles embed.FS

// UI is the web app (the ui folder).
func UI() fs.FS { return sub(uiFiles, "ui") }

// Content is the projects, boards and other data (the content folder).
func Content() fs.FS { return sub(contentFiles, "content") }

func sub(f embed.FS, dir string) fs.FS {
	s, err := fs.Sub(f, dir)
	if err != nil {
		panic(err)
	}
	return s
}
