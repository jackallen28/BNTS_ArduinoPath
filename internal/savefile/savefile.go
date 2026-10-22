// Package savefile reads and writes .circuit save files: a zip of a
// student's profile, progress and sketches that they can take home or open
// on another ArduinoPath server.
//
// Format version 1:
//
//	manifest.json        {"format": "arduinopath-save", "version": 1, ...}
//	profile.json         names, school, settings (never the picture password)
//	progress.json        [{project_id, data, updated_at}]
//	sketches.json        [{project_id, updated_at}]
//	sketches/<id>.ino    the code, so the zip opens in the Arduino IDE too
//
// Never break this format: bump the version and keep reading the old ones.
package savefile

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"arduinopath/internal/store"
)

// Format and Version identify a save file.
const (
	Format = "arduinopath-save"
	// OldFormat is what CircuitPath (the app's old name) wrote. Those files
	// still open.
	OldFormat = "circuit" + "path-save"
	Version   = 1
)

// Limits for files being opened.
const (
	MaxFileBytes  = 8 << 20  // the .circuit file itself
	maxEntries    = 1000     // files inside it
	maxEntryBytes = 1 << 20  // one file inside it, unzipped
	maxTotalBytes = 32 << 20 // everything inside it, unzipped
)

var (
	// ErrNotSaveFile means the file isn't an ArduinoPath save file.
	ErrNotSaveFile = errors.New("this isn't an ArduinoPath save file")
	// ErrNewerVersion means the file was made by a newer ArduinoPath.
	ErrNewerVersion = errors.New("this save file is from a newer version of ArduinoPath")
)

// Manifest describes a save file.
type Manifest struct {
	Format     string `json:"format"`
	Version    int    `json:"version"`
	ExportedAt int64  `json:"exported_at"`
	AppVersion string `json:"app_version"`
}

// Profile is the part of a student's profile that is saved.
type Profile struct {
	Names    []string        `json:"names"`
	School   string          `json:"school"`
	Settings json.RawMessage `json:"settings,omitempty"`
}

// File is the contents of a save file.
type File struct {
	Manifest Manifest
	Profile  Profile
	Sketches []store.Sketch
	Progress []store.Progress
}

type sketchMeta struct {
	ProjectID string `json:"project_id"`
	UpdatedAt int64  `json:"updated_at"`
}

// Write writes f as a .circuit zip.
func Write(w io.Writer, f File) error {
	f.Manifest.Format, f.Manifest.Version = Format, Version
	if f.Manifest.ExportedAt == 0 {
		f.Manifest.ExportedAt = time.Now().UnixMilli()
	}
	z := zip.NewWriter(w)
	put := func(name string, data []byte) error {
		fw, err := z.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.UnixMilli(f.Manifest.ExportedAt)})
		if err != nil {
			return err
		}
		_, err = fw.Write(data)
		return err
	}
	putJSON := func(name string, v any) error {
		data, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		return put(name, append(data, '\n'))
	}
	progress := f.Progress
	if progress == nil {
		progress = []store.Progress{}
	}
	meta := []sketchMeta{}
	for _, sk := range f.Sketches {
		meta = append(meta, sketchMeta{ProjectID: sk.ProjectID, UpdatedAt: sk.UpdatedAt})
	}
	if err := putJSON("manifest.json", f.Manifest); err != nil {
		return err
	}
	if err := putJSON("profile.json", f.Profile); err != nil {
		return err
	}
	if err := putJSON("progress.json", progress); err != nil {
		return err
	}
	if err := putJSON("sketches.json", meta); err != nil {
		return err
	}
	for _, sk := range f.Sketches {
		if err := put("sketches/"+sk.ProjectID+".ino", []byte(sk.Code)); err != nil {
			return err
		}
	}
	return z.Close()
}

// Read reads and checks a save file. data must already be size-limited
// (MaxFileBytes).
func Read(data []byte) (*File, error) {
	if len(data) > MaxFileBytes {
		return nil, fmt.Errorf("the file is too big (the limit is %d MB)", MaxFileBytes>>20)
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, ErrNotSaveFile
	}
	if len(z.File) > maxEntries {
		return nil, fmt.Errorf("%w: too many files inside", ErrNotSaveFile)
	}
	entries := map[string][]byte{}
	total := 0
	for _, zf := range z.File {
		name := zf.Name
		known := name == "manifest.json" || name == "profile.json" || name == "progress.json" || name == "sketches.json" ||
			(strings.HasPrefix(name, "sketches/") && path.Ext(name) == ".ino" && store.ValidProjectID(strings.TrimSuffix(path.Base(name), ".ino")) && path.Dir(name) == "sketches")
		if !known || zf.FileInfo().IsDir() {
			continue // ignore anything else, such as files a newer version adds
		}
		if _, dup := entries[name]; dup {
			return nil, fmt.Errorf("%w: %s appears twice", ErrNotSaveFile, name)
		}
		rc, err := zf.Open()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrNotSaveFile, err)
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxEntryBytes+1))
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrNotSaveFile, err)
		}
		if len(b) > maxEntryBytes {
			return nil, fmt.Errorf("%w: %s is too big", ErrNotSaveFile, name)
		}
		if total += len(b); total > maxTotalBytes {
			return nil, fmt.Errorf("%w: too much inside", ErrNotSaveFile)
		}
		entries[name] = b
	}

	f := &File{}
	if err := json.Unmarshal(entries["manifest.json"], &f.Manifest); err != nil || (f.Manifest.Format != Format && f.Manifest.Format != OldFormat) {
		return nil, ErrNotSaveFile
	}
	if f.Manifest.Version > Version {
		return nil, ErrNewerVersion
	}
	if f.Manifest.Version < 1 {
		return nil, ErrNotSaveFile
	}
	if b, ok := entries["profile.json"]; ok {
		if err := json.Unmarshal(b, &f.Profile); err != nil {
			return nil, fmt.Errorf("%w: profile.json: %v", ErrNotSaveFile, err)
		}
	}
	if b, ok := entries["progress.json"]; ok {
		if err := json.Unmarshal(b, &f.Progress); err != nil {
			return nil, fmt.Errorf("%w: progress.json: %v", ErrNotSaveFile, err)
		}
	}
	seen := map[string]bool{}
	for i, p := range f.Progress {
		var compact bytes.Buffer
		if json.Compact(&compact, p.Data) != nil || !store.ValidProjectID(p.ProjectID) || !store.ValidProgress(compact.Bytes()) || seen[p.ProjectID] {
			return nil, fmt.Errorf("%w: progress for %q is damaged", ErrNotSaveFile, p.ProjectID)
		}
		f.Progress[i].Data = compact.Bytes()
		seen[p.ProjectID] = true
	}
	var meta []sketchMeta
	if b, ok := entries["sketches.json"]; ok {
		if err := json.Unmarshal(b, &meta); err != nil {
			return nil, fmt.Errorf("%w: sketches.json: %v", ErrNotSaveFile, err)
		}
	}
	seen = map[string]bool{}
	for _, m := range meta {
		code, ok := entries["sketches/"+m.ProjectID+".ino"]
		if !store.ValidProjectID(m.ProjectID) || !ok || seen[m.ProjectID] || !store.ValidSketch(string(code)) {
			return nil, fmt.Errorf("%w: the sketch for %q is damaged", ErrNotSaveFile, m.ProjectID)
		}
		seen[m.ProjectID] = true
		f.Sketches = append(f.Sketches, store.Sketch{ProjectID: m.ProjectID, Code: string(code), UpdatedAt: m.UpdatedAt})
	}
	// Times can't be in the future, or this copy would beat every later save.
	now := time.Now().UnixMilli()
	for i := range f.Sketches {
		f.Sketches[i].UpdatedAt = min(max(f.Sketches[i].UpdatedAt, 0), now)
	}
	for i := range f.Progress {
		f.Progress[i].UpdatedAt = min(max(f.Progress[i].UpdatedAt, 0), now)
	}
	return f, nil
}

// Change says what opening a save file would do to one project.
type Change struct {
	ProjectID     string `json:"project_id"`
	Action        string `json:"action"` // "add", "replace" (file is newer), "keep" (server is newer or the same)
	FileUpdated   int64  `json:"file_updated"`
	ServerUpdated int64  `json:"server_updated,omitempty"`
}

// Plan compares a save file with a student's current work, project by
// project: new projects are added, newer copies replace older ones (after
// asking), and older copies never replace newer work.
func Plan(f *File, sketches []store.Sketch, progress []store.Progress) []Change {
	server := map[string]int64{}
	for _, s := range sketches {
		server[s.ProjectID] = max(server[s.ProjectID], s.UpdatedAt)
	}
	for _, p := range progress {
		server[p.ProjectID] = max(server[p.ProjectID], p.UpdatedAt)
	}
	inFile := map[string]int64{}
	var order []string
	note := func(id string, t int64) {
		if _, ok := inFile[id]; !ok {
			order = append(order, id)
		}
		inFile[id] = max(inFile[id], t)
	}
	for _, s := range f.Sketches {
		note(s.ProjectID, s.UpdatedAt)
	}
	for _, p := range f.Progress {
		note(p.ProjectID, p.UpdatedAt)
	}
	changes := []Change{}
	for _, id := range order {
		c := Change{ProjectID: id, FileUpdated: inFile[id]}
		st, ok := server[id]
		switch {
		case !ok:
			c.Action = "add"
		case inFile[id] > st:
			c.Action, c.ServerUpdated = "replace", st
		default:
			c.Action, c.ServerUpdated = "keep", st
		}
		changes = append(changes, c)
	}
	return changes
}

// Pick returns the sketches and progress from f for the given projects.
func Pick(f *File, projects map[string]bool) ([]store.Sketch, []store.Progress) {
	var sk []store.Sketch
	var pr []store.Progress
	for _, s := range f.Sketches {
		if projects[s.ProjectID] {
			sk = append(sk, s)
		}
	}
	for _, p := range f.Progress {
		if projects[p.ProjectID] {
			pr = append(pr, p)
		}
	}
	return sk, pr
}
