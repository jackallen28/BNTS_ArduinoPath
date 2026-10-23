package arduino

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"arduinopath/internal/content"
)

// TestRealBundle unpacks a real bundle (CI sets ARDUINOPATH_BOARDS to a
// boards.zip or an ArduinoPath.exe with the tools appended) and compiles for
// every board: a blink everywhere, the whole kit check (every library) on
// the boards whose tools were trimmed when packing, and a broken sketch.
func TestRealBundle(t *testing.T) {
	path := os.Getenv("ARDUINOPATH_BOARDS")
	if path == "" {
		t.Skip("ARDUINOPATH_BOARDS isn't set")
	}
	b, err := OpenBundle(path)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if b.Manifest.Hash != Pinned().Hash() {
		t.Fatalf("the bundle has tools %s, this build pins %s", b.Manifest.Hash, Pinned().Hash())
	}
	data := t.TempDir()
	// Where the app puts them (on Windows, a short folder in the home folder).
	tools := NewTools(b, ToolsFolder(data), nil)
	// As long as go test allows (-timeout), less a minute to report.
	deadline, ok := t.Deadline()
	if !ok {
		deadline = time.Now().Add(50 * time.Minute)
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline.Add(-time.Minute))
	defer cancel()

	type board struct {
		ID       string   `json:"id"`
		FQBN     string   `json:"fqbn"`
		Props    []string `json:"build_properties"`
		Variants []struct {
			FQBN string `json:"fqbn"`
		} `json:"variants"`
	}
	files, _ := filepath.Glob("../../content/boards/*.json")
	if len(files) == 0 {
		t.Fatal("no boards")
	}
	blink := "void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n  Serial.println(\"blink\");\n}\n"
	for _, f := range files {
		raw, _ := os.ReadFile(f)
		var bd board
		if err := json.Unmarshal(raw, &bd); err != nil {
			t.Fatal(err)
		}
		fqbns := []string{bd.FQBN}
		for _, v := range bd.Variants {
			fqbns = append(fqbns, v.FQBN)
		}
		for _, fqbn := range fqbns {
			sketches := map[string]string{"blink": blink}
			if bd.ID == "uno" || strings.HasPrefix(fqbn, "esp32:") {
				sketches["kit check"] = string(kitCheckSketch)
			}
			for name, code := range sketches {
				start := time.Now()
				res, err := tools.Compile(ctx, code, fqbn, bd.Props, nil)
				if err != nil || !res.OK {
					t.Errorf("%s, %s: %v\n%s", fqbn, name, err, tail(res.Output, 40))
					continue
				}
				if res.Size == nil {
					t.Logf("%s, %s: no size reported; output starts %q", fqbn, name, firstChars(res.Output, 400))
					continue
				}
				t.Logf("%-45s %-9s ok in %s (flash %d of %d)", fqbn, name, time.Since(start).Round(time.Second), res.Size.Flash, res.Size.FlashMax)
			}
		}
	}

	res, err := tools.Compile(ctx, "void setup() {\n  pinMode(13, OUTPUT)\n}\n\nvoid loop() {\n  digitalwrite(13, HIGH);\n}\n", "arduino:avr:uno", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.OK || len(res.Diagnostics) == 0 {
		t.Fatalf("a broken sketch compiled: %+v", res)
	}
	found := map[string]bool{}
	for _, d := range res.Diagnostics {
		t.Logf("diagnostic: %+v", d)
		if d.File == "sketch.ino" && d.Severity == "error" {
			found[strings.SplitN(d.Message, " ", 2)[0]+":"+strconv.Itoa(d.Line)] = true
		}
	}
	if !found["expected:2"] && !found["expected:3"] {
		t.Errorf("no \"expected ';'\" error on line 2 or 3: %+v", res.Diagnostics)
	}
	// Every broken sketch in the Coach's errors database gives a compiler
	// message that maps to its own entry.
	cat, problems := content.Load(os.DirFS("../../content"))
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	for _, e := range cat.Errors {
		if e.Example == "" {
			continue
		}
		boardID := e.ExampleBoard
		if boardID == "" {
			boardID = "uno"
		}
		b, ok := cat.Board(boardID)
		if !ok {
			t.Errorf("%s: unknown board %s", e.ID, boardID)
			continue
		}
		res, err := tools.Compile(ctx, e.Example, b.FQBN, b.BuildProperties, nil)
		if err != nil {
			t.Errorf("%s: %v", e.ID, err)
			continue
		}
		text := CoachText(res.Diagnostics)
		got, _ := content.MatchError(cat.Errors, "compile", text)
		switch {
		case res.OK:
			t.Errorf("%s: the example compiled", e.ID)
		case got == nil || got.ID != e.ID:
			t.Errorf("%s: the compiler said %q, which maps to %v", e.ID, text, got)
		default:
			t.Logf("errors.json %-28s <- %q", e.ID, strings.SplitN(text, "\n", 2)[0])
		}
	}

	compileDemos(ctx, t, tools, cat)
	for fam, st := range tools.Status() {
		t.Logf("%s: %s", fam, st.State)
	}
}

// demoBoards are the boards every model answer is compiled for: one per
// chip (the other boards of a family share its core and libraries).
var demoBoards = []string{"uno", "nodemcu", "esp32", "esp32-c3"}

// compileDemos compiles every step's model answer for every board its
// project lists, with the pin header for that board. Boards compile side
// by side, except on Windows, where parallel ESP32 builds can run CI's
// machine out of memory; each board's sketches go one at a time (they share
// a build folder).
func compileDemos(ctx context.Context, t *testing.T, tools *Tools, cat *content.Catalogue) {
	var wg sync.WaitGroup
	for _, id := range demoBoards {
		b, ok := cat.Board(id)
		if !ok {
			t.Errorf("no board %s", id)
			continue
		}
		if runtime.GOOS == "windows" {
			wg.Wait() // one board at a time (see above)
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, start := 0, time.Now()
			for _, p := range cat.Projects {
				if !p.Supports(b) {
					continue
				}
				var full struct {
					Steps []struct {
						Title string `json:"title"`
						Demo  string `json:"demo"`
					} `json:"steps"`
				}
				json.Unmarshal(p.Raw, &full)
				for i, s := range full.Steps {
					code := content.ExpandPins(p, b, s.Demo)
					res, err := tools.Compile(ctx, code, b.FQBN, b.BuildProperties, nil)
					if err != nil || !res.OK {
						t.Errorf("%s step %d (%s) on %s: %v\n%s", p.ID, i+1, s.Title, b.ID, err, CoachText(res.Diagnostics)+tail(res.Output, 15))
						continue
					}
					n++
				}
			}
			t.Logf("%s: %d model answers compiled in %s", b.ID, n, time.Since(start).Round(time.Second))
		}()
	}
	wg.Wait()
}

func firstChars(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
