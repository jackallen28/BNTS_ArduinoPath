package savefile

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"arduinopath/internal/store"
)

func sample() File {
	return File{
		Manifest: Manifest{AppVersion: "test"},
		Profile:  Profile{Names: []string{"Mia", "Leo"}, School: "Eltham High", Settings: json.RawMessage(`{"board":"uno"}`)},
		Sketches: []store.Sketch{
			{ProjectID: "blink-traffic-lights", Code: "void setup() {}\nvoid loop() {}\n", UpdatedAt: 100},
			{ProjectID: "freeplay", Code: "// mine", UpdatedAt: 300},
		},
		Progress: []store.Progress{{ProjectID: "blink-traffic-lights", Data: json.RawMessage(`{"step":2}`), UpdatedAt: 200}},
	}
}

func TestRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := Write(&buf, sample()); err != nil {
		t.Fatal(err)
	}
	f, err := Read(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if f.Manifest.Version != Version || f.Profile.School != "Eltham High" || len(f.Profile.Names) != 2 {
		t.Fatalf("read %+v", f)
	}
	if len(f.Sketches) != 2 || f.Sketches[0].Code != "void setup() {}\nvoid loop() {}\n" || f.Sketches[1].UpdatedAt != 300 {
		t.Fatalf("sketches %+v", f.Sketches)
	}
	if len(f.Progress) != 1 || string(f.Progress[0].Data) != `{"step":2}` {
		t.Fatalf("progress %+v", f.Progress)
	}
	// The sketches are plain .ino files inside the zip.
	z, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	found := false
	for _, zf := range z.File {
		found = found || zf.Name == "sketches/freeplay.ino"
		if strings.Contains(zf.Name, "picture") {
			t.Errorf("save file contains %s", zf.Name)
		}
	}
	if !found {
		t.Error("no sketches/freeplay.ino in the zip")
	}
}

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, data := range files {
		w, _ := z.Create(name)
		w.Write([]byte(data))
	}
	z.Close()
	return buf.Bytes()
}

func TestRejectsBadFiles(t *testing.T) {
	manifest := `{"format":"arduinopath-save","version":1}`
	cases := map[string][]byte{
		"not a zip":      []byte("hello"),
		"no manifest":    makeZip(t, map[string]string{"profile.json": `{}`}),
		"wrong format":   makeZip(t, map[string]string{"manifest.json": `{"format":"pipath","version":1}`}),
		"bad progress":   makeZip(t, map[string]string{"manifest.json": manifest, "progress.json": `[{"project_id":"x","data":[1,2],"updated_at":1}]`}),
		"bad project id": makeZip(t, map[string]string{"manifest.json": manifest, "sketches.json": `[{"project_id":"../../etc","updated_at":1}]`}),
		"missing sketch": makeZip(t, map[string]string{"manifest.json": manifest, "sketches.json": `[{"project_id":"blink","updated_at":1}]`}),
		"huge sketch": makeZip(t, map[string]string{"manifest.json": manifest, "sketches.json": `[{"project_id":"blink","updated_at":1}]`,
			"sketches/blink.ino": strings.Repeat("a", store.MaxSketchBytes+1)}),
		"zip bomb": makeZip(t, map[string]string{"manifest.json": manifest, "profile.json": strings.Repeat(" ", maxEntryBytes+10)}),
	}
	for name, data := range cases {
		if _, err := Read(data); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := Read(makeZip(t, map[string]string{"manifest.json": `{"format":"arduinopath-save","version":99}`})); !errors.Is(err, ErrNewerVersion) {
		t.Errorf("newer version: %v", err)
	}
	// Unknown extra files (from a newer version) are ignored.
	if _, err := Read(makeZip(t, map[string]string{"manifest.json": manifest, "extras/thing.bin": "x"})); err != nil {
		t.Errorf("extra file: %v", err)
	}
}

func TestPlan(t *testing.T) {
	s := sample()
	f := &s
	f.Sketches = append(f.Sketches, store.Sketch{ProjectID: "digital-dice", Code: "x", UpdatedAt: 50})
	server := []store.Sketch{
		{ProjectID: "blink-traffic-lights", UpdatedAt: 150}, // file's progress (200) is newer
		{ProjectID: "digital-dice", UpdatedAt: 60},          // server is newer
	}
	got := map[string]string{}
	for _, c := range Plan(f, server, nil) {
		got[c.ProjectID] = c.Action
	}
	want := map[string]string{"blink-traffic-lights": "replace", "freeplay": "add", "digital-dice": "keep"}
	for id, a := range want {
		if got[id] != a {
			t.Errorf("%s: %q, want %q", id, got[id], a)
		}
	}
	sk, pr := Pick(f, map[string]bool{"freeplay": true})
	if len(sk) != 1 || sk[0].ProjectID != "freeplay" || len(pr) != 0 {
		t.Errorf("Pick = %+v %+v", sk, pr)
	}
}

func TestFutureTimesAreClamped(t *testing.T) {
	s := sample()
	s.Sketches[0].UpdatedAt = time.Now().Add(24 * time.Hour).UnixMilli()
	var buf bytes.Buffer
	if err := Write(&buf, s); err != nil {
		t.Fatal(err)
	}
	f, err := Read(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if f.Sketches[0].UpdatedAt > time.Now().UnixMilli() {
		t.Fatal("a save time in the future was kept")
	}
}

// Save files from CircuitPath (the app's old name) still open.
func TestOldNameStillOpens(t *testing.T) {
	var buf bytes.Buffer
	if err := Write(&buf, sample()); err != nil {
		t.Fatal(err)
	}
	z, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	files := map[string]string{}
	for _, zf := range z.File {
		r, _ := zf.Open()
		data, _ := io.ReadAll(r)
		r.Close()
		files[zf.Name] = string(data)
	}
	files["manifest.json"] = strings.Replace(files["manifest.json"], Format, OldFormat, 1)
	if !strings.Contains(files["manifest.json"], `"circuitpath-save"`) {
		t.Fatalf("manifest %s", files["manifest.json"])
	}
	f, err := Read(makeZip(t, files))
	if err != nil {
		t.Fatal(err)
	}
	if f.Profile.School != "Eltham High" {
		t.Fatalf("read %+v", f.Profile)
	}
}
