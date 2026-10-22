package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"arduinopath/internal/arduino"
	"arduinopath/internal/serialmon"
)

type fakeTools struct {
	mu       sync.Mutex
	compiled []string // fqbns
	uploaded []string // ports
}

func (f *fakeTools) Status() map[string]arduino.FamilyStatus {
	return map[string]arduino.FamilyStatus{"avr": {State: "ready"}, "esp32": {State: "packed"}}
}
func (f *fakeTools) Prepare(string) {}
func (f *fakeTools) Compile(ctx context.Context, code, fqbn string, props []string, out func(string)) (arduino.CompileResult, error) {
	f.mu.Lock()
	f.compiled = append(f.compiled, fqbn)
	f.mu.Unlock()
	if strings.Contains(code, "BROKEN") {
		return arduino.CompileResult{Output: "sketch.ino:2:1: error: expected ';' before '}' token",
			Diagnostics: []arduino.Diagnostic{{File: "sketch.ino", Line: 2, Col: 1, Severity: "error", Message: "expected ';' before '}' token"}}}, nil
	}
	return arduino.CompileResult{OK: true, Output: "Sketch uses 924 bytes", Size: &arduino.Size{Flash: 924, FlashMax: 32256}, BuildPath: "/build"}, nil
}
func (f *fakeTools) Upload(ctx context.Context, build, fqbn, port string, out func(string)) (string, error) {
	f.mu.Lock()
	f.uploaded = append(f.uploaded, port)
	f.mu.Unlock()
	if port == "COM9" {
		out("avrdude: stk500_recv(): programmer is not responding\n")
		return "", errors.New("exit status 1")
	}
	out("Writing | ##### | 50%\n")
	out("Writing | ########## | 100%\n")
	return "", nil
}
func (f *fakeTools) Ports(ctx context.Context) ([]arduino.Port, error) {
	return []arduino.Port{{Address: "COM3", Chip: "CH340"}}, nil
}

func waitJob(t *testing.T, c *client, id string) job {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var j job
		json.Unmarshal(c.want(200, "GET", "/api/jobs/"+id, nil), &j)
		if j.State == "done" || j.State == "failed" {
			return j
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("job never finished")
	return job{}
}

func TestCompileAndUploadJobs(t *testing.T) {
	tools := &fakeTools{}
	e := newEnv(t, func(s *Server) { s.Tools = tools; s.Serial = &serialmon.Manager{Open: fakeOpen} })
	c := e.client()

	var st map[string]any
	json.Unmarshal(c.want(200, "GET", "/api/tools", nil), &st)
	if st["built_in"] != true {
		t.Fatalf("tools = %v", st)
	}

	var started map[string]string
	json.Unmarshal(c.want(202, "POST", "/api/compile", map[string]any{"code": "void setup(){}\nvoid loop(){}", "board": "nano", "variant": "old-bootloader"}), &started)
	j := waitJob(t, c, started["id"])
	if j.State != "done" || j.Result == nil || !j.Result.OK || j.Result.Size.Flash != 924 {
		t.Fatalf("compile job = %+v", j)
	}
	if tools.compiled[0] != "arduino:avr:nano:cpu=atmega328old" {
		t.Fatalf("compiled for %v", tools.compiled)
	}

	json.Unmarshal(c.want(202, "POST", "/api/compile", map[string]any{"code": "void setup(){\nBROKEN", "board": "uno"}), &started)
	j = waitJob(t, c, started["id"])
	if j.State != "failed" || j.Result == nil || len(j.Result.Diagnostics) != 1 || j.Result.Diagnostics[0].Line != 2 {
		t.Fatalf("broken compile job = %+v", j)
	}

	json.Unmarshal(c.want(202, "POST", "/api/upload", map[string]any{"code": "void setup(){}\nvoid loop(){}", "board": "uno", "port": "COM3"}), &started)
	j = waitJob(t, c, started["id"])
	if j.State != "done" || j.Progress != 100 || !strings.Contains(j.Output, "100%") {
		t.Fatalf("upload job = %+v", j)
	}
	json.Unmarshal(c.want(202, "POST", "/api/upload", map[string]any{"code": "void setup(){}\nvoid loop(){}", "board": "uno", "port": "COM9"}), &started)
	j = waitJob(t, c, started["id"])
	if j.State != "failed" || !strings.Contains(j.Output, "not responding") {
		t.Fatalf("failed upload job = %+v", j)
	}

	for _, bad := range []map[string]any{
		{"code": "x", "board": "pico"},
		{"code": "x", "board": "nano", "variant": "nope"},
		{"code": "", "board": "uno"},
		{"code": strings.Repeat("a", 200<<10), "board": "uno"},
	} {
		if res, data := c.do("POST", "/api/compile", bad); res.StatusCode != 400 && res.StatusCode != 413 {
			t.Errorf("%v: %d %s", bad, res.StatusCode, data)
		}
	}
	for _, port := range []string{"--help", "COM3; rm -rf", "../etc", ""} {
		c.want(400, "POST", "/api/upload", map[string]any{"code": "x", "board": "uno", "port": port})
	}
	c.want(404, "GET", "/api/jobs/nope", nil)

	var ports []arduino.Port
	json.Unmarshal(c.want(200, "GET", "/api/ports", nil), &ports)
	if len(ports) != 1 || ports[0].Chip != "CH340" {
		t.Fatalf("ports = %+v", ports)
	}
	c.want(403, "GET", "/api/ports", nil, "Sec-Fetch-Site", "cross-site")
}

func TestNoToolsBuiltIn(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	var st struct {
		BuiltIn  bool                            `json:"built_in"`
		Families map[string]arduino.FamilyStatus `json:"families"`
	}
	json.Unmarshal(c.want(200, "GET", "/api/tools", nil), &st)
	if st.BuiltIn || st.Families["avr"].State != "missing" {
		t.Fatalf("tools = %+v", st)
	}
	c.want(503, "POST", "/api/compile", map[string]any{"code": "x", "board": "uno"})
	if string(c.want(200, "GET", "/api/ports", nil)) != "[]\n" {
		t.Fatal("ports without tools")
	}
}

// fakeBoard is a port whose board says "Hello" and echoes what it's sent.
type fakeBoard struct {
	r  *io.PipeReader
	w  *io.PipeWriter
	mu sync.Mutex
}

func fakeOpen(port string, baud int) (io.ReadWriteCloser, error) {
	if port == "COM7" {
		return nil, errors.New("access denied")
	}
	r, w := io.Pipe()
	b := &fakeBoard{r: r, w: w}
	go w.Write([]byte("Hello from the board\n"))
	return b, nil
}
func (b *fakeBoard) Read(p []byte) (int, error) { return b.r.Read(p) }
func (b *fakeBoard) Write(p []byte) (int, error) {
	go b.w.Write(append([]byte("echo: "), p...))
	return len(p), nil
}
func (b *fakeBoard) Close() error { return b.r.Close() }

func TestSerialMonitorStream(t *testing.T) {
	e := newEnv(t, func(s *Server) { s.Serial = &serialmon.Manager{Open: fakeOpen} })
	c := e.client()
	c.want(400, "GET", "/api/serial?port=COM3&baud=12345", nil)
	c.want(400, "GET", "/api/serial?port=--x&baud=9600", nil)
	c.want(409, "GET", "/api/serial?port=COM7&baud=9600", nil)
	c.want(403, "GET", "/api/serial?port=COM3&baud=9600", nil, "Sec-Fetch-Site", "cross-site")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", e.ts.URL+"/api/serial?port=COM3&baud=9600", nil)
	res, err := c.c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("Content-Type = %q", ct)
	}
	lines := make(chan string, 100)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	expect := func(want string) {
		t.Helper()
		timeout := time.After(3 * time.Second)
		for {
			select {
			case l, ok := <-lines:
				if !ok {
					t.Fatalf("stream ended before %q", want)
				}
				if strings.Contains(l, want) {
					return
				}
			case <-timeout:
				t.Fatalf("never got %q", want)
			}
		}
	}
	expect(`data: "Hello from the board\n"`)
	c.want(204, "POST", "/api/serial/write", map[string]any{"port": "COM3", "text": "hi\n"})
	expect(`echo: hi`)
	c.want(204, "POST", "/api/serial/close", map[string]any{"port": "COM3"})
	expect("event: closed")
	c.want(409, "POST", "/api/serial/write", map[string]any{"port": "COM3", "text": "hi\n"})
}
