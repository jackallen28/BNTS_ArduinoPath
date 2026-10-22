package arduino

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Tools runs the board tools for the app: unpacking them from the bundle
// the first time a family is used, compiling, uploading and finding boards.
type Tools struct {
	env    *Env
	bundle *Bundle // nil: tools already installed in env.Dir (development, CI)
	log    *slog.Logger

	mu     sync.Mutex
	status map[string]*FamilyStatus // "common" and each family
	cond   *sync.Cond

	portsMu   sync.Mutex
	portsAt   time.Time
	portsLast []Port
}

// FamilyStatus is how one family's tools are doing.
type FamilyStatus struct {
	State string `json:"state"` // missing | packed | unpacking | ready | failed
	Done  int64  `json:"done,omitempty"`
	Total int64  `json:"total,omitempty"`
	Error string `json:"error,omitempty"`
}

// NewTools uses the board tools in bundle, unpacking them into a folder
// inside dataDir (one per tools version; older ones are removed).
func NewTools(bundle *Bundle, dataDir string, log *slog.Logger) *Tools {
	if log == nil {
		log = slog.Default()
	}
	dir := filepath.Join(dataDir, "arduino-"+bundle.Manifest.Hash[:12])
	t := &Tools{env: &Env{Dir: dir, Log: log}, bundle: bundle, log: log, status: map[string]*FamilyStatus{}}
	t.cond = sync.NewCond(&t.mu)
	for _, f := range append([]string{"common"}, Families...) {
		st := &FamilyStatus{State: "missing"}
		if info, ok := bundle.Manifest.Families[f]; ok {
			st.State, st.Total = "packed", info.Bytes
			if t.unpacked(f) {
				st.State, st.Done = "ready", info.Bytes
			}
		}
		t.status[f] = st
	}
	go removeOldTools(dataDir, filepath.Base(dir), log)
	return t
}

// InstalledTools uses tools already installed by Env.Setup in dir.
func InstalledTools(dir string, log *slog.Logger) (*Tools, error) {
	env := &Env{Dir: dir, Log: log}
	if !env.Ready() {
		return nil, fmt.Errorf("no board tools in %s (run -setup-arduino first)", dir)
	}
	if log == nil {
		log = slog.Default()
	}
	t := &Tools{env: env, log: log, status: map[string]*FamilyStatus{}}
	t.cond = sync.NewCond(&t.mu)
	for _, f := range append([]string{"common"}, Families...) {
		t.status[f] = &FamilyStatus{State: "ready"}
	}
	return t, nil
}

func (t *Tools) marker(family string) string {
	return filepath.Join(t.env.Dir, ".unpacked-"+family)
}

func (t *Tools) unpacked(family string) bool {
	b, err := os.ReadFile(t.marker(family))
	return err == nil && strings.TrimSpace(string(b)) == t.bundle.Manifest.Hash
}

// removeOldTools deletes tools unpacked by older versions of ArduinoPath.
func removeOldTools(dataDir, keep string, log *slog.Logger) {
	entries, _ := os.ReadDir(dataDir)
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "arduino-") && e.Name() != keep {
			log.Info("removing old board tools", "folder", e.Name())
			os.RemoveAll(filepath.Join(dataDir, e.Name()))
		}
	}
}

// Status reports every family (and "common").
func (t *Tools) Status() map[string]FamilyStatus {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := map[string]FamilyStatus{}
	for k, v := range t.status {
		out[k] = *v
	}
	return out
}

// Prepare starts unpacking a family (and the common tools) if it isn't
// ready yet. It returns straight away.
func (t *Tools) Prepare(family string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.prepareLocked(family)
}

func (t *Tools) prepareLocked(family string) {
	st, ok := t.status[family]
	if !ok || t.bundle == nil || (st.State != "packed" && st.State != "failed") {
		return
	}
	st.State, st.Error, st.Done = "unpacking", "", 0
	go func() {
		err := t.unpack(family)
		t.mu.Lock()
		defer t.mu.Unlock()
		if err != nil {
			t.log.Error("unpacking board tools", "family", family, "err", err)
			st.State, st.Error = "failed", err.Error()
		} else {
			st.State, st.Done = "ready", st.Total
		}
		t.cond.Broadcast()
	}()
}

// unpackMu makes families unpack one at a time (they share "common").
var unpackMu sync.Mutex

func (t *Tools) unpack(family string) error {
	unpackMu.Lock()
	defer unpackMu.Unlock()
	start := time.Now()
	for _, f := range []string{"common", family} {
		if t.unpacked(f) {
			continue
		}
		t.mu.Lock()
		st := t.status[f]
		if f == "common" && st.State != "unpacking" {
			st.State = "unpacking"
		}
		t.mu.Unlock()
		err := t.bundle.Extract(f, t.env.Dir, func(done int64) {
			t.mu.Lock()
			st.Done = done
			t.mu.Unlock()
		})
		if err != nil {
			return err
		}
		if f == "common" {
			if err := t.env.writeConfig(t.env.req()); err != nil {
				return err
			}
			t.mu.Lock()
			st.State, st.Done = "ready", st.Total
			t.mu.Unlock()
		}
		if err := os.WriteFile(t.marker(f), []byte(t.bundle.Manifest.Hash), 0o644); err != nil {
			return err
		}
	}
	t.log.Info("board tools unpacked", "family", family, "took", time.Since(start).Round(time.Second))
	return nil
}

// waitReady waits until a family's tools are ready, starting the unpack if needed.
func (t *Tools) waitReady(ctx context.Context, family string) error {
	stop := context.AfterFunc(ctx, func() {
		t.mu.Lock()
		t.cond.Broadcast()
		t.mu.Unlock()
	})
	defer stop()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.prepareLocked(family)
	for {
		st, ok := t.status[family]
		switch {
		case !ok || st.State == "missing":
			return fmt.Errorf("the tools for these boards aren't built into this copy of ArduinoPath")
		case st.State == "ready":
			return nil
		case st.State == "failed":
			return fmt.Errorf("the board tools couldn't be unpacked: %s", st.Error)
		case ctx.Err() != nil:
			return ctx.Err()
		}
		t.cond.Wait()
	}
}

// FamilyOf says which family an FQBN belongs to.
func FamilyOf(fqbn string) string {
	switch {
	case strings.HasPrefix(fqbn, "arduino:avr:"):
		return "avr"
	case strings.HasPrefix(fqbn, "esp8266:"):
		return "esp8266"
	case strings.HasPrefix(fqbn, "esp32:"):
		return "esp32"
	}
	return ""
}

// Diagnostic is one compiler message.
type Diagnostic struct {
	File     string `json:"file"` // "sketch.ino", or a library / core file name
	Line     int    `json:"line,omitempty"`
	Col      int    `json:"col,omitempty"`
	Severity string `json:"severity"` // error | warning | note
	Message  string `json:"message"`
}

// Size is how much of the board's memory a compiled sketch uses.
type Size struct {
	Flash    int64 `json:"flash"`
	FlashMax int64 `json:"flash_max"`
	RAM      int64 `json:"ram"`
	RAMMax   int64 `json:"ram_max"`
}

// CompileResult is the outcome of a compile.
type CompileResult struct {
	OK          bool         `json:"ok"`
	Output      string       `json:"output"`
	Diagnostics []Diagnostic `json:"errors"`
	Size        *Size        `json:"size,omitempty"`
	BuildPath   string       `json:"-"`
}

const sketchName = "sketch"

// Compile compiles code for a board, with extra build properties (from the
// board's file, such as defining LED_BUILTIN). out is called with output as
// it arrives (it may be nil).
func (t *Tools) Compile(ctx context.Context, code, fqbn string, props []string, out func(string)) (CompileResult, error) {
	family := FamilyOf(fqbn)
	if family == "" {
		return CompileResult{}, fmt.Errorf("unknown board %q", fqbn)
	}
	if err := t.waitReady(ctx, family); err != nil {
		return CompileResult{}, err
	}
	work := filepath.Join(t.env.Dir, "sketches", randomName())
	sketchDir := filepath.Join(work, sketchName)
	if err := os.MkdirAll(sketchDir, 0o755); err != nil {
		return CompileResult{}, err
	}
	defer os.RemoveAll(work)
	if err := os.WriteFile(filepath.Join(sketchDir, sketchName+".ino"), []byte(code), 0o644); err != nil {
		return CompileResult{}, err
	}
	// One build folder per board, so the board's core is compiled once.
	build := filepath.Join(t.env.Dir, "build", safeName(fqbn))
	if err := os.MkdirAll(build, 0o755); err != nil {
		return CompileResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	args := []string{"compile", "--fqbn", fqbn, "--build-path", build, "--warnings", "default", "--format", "json"}
	for _, p := range props {
		args = append(args, "--build-property", p)
	}
	text, err := t.stream(ctx, out, append(args, sketchDir)...)
	if err != nil && strings.TrimSpace(text) == "" {
		return CompileResult{}, fmt.Errorf("the compiler didn't run: %w", err)
	}
	res := parseCompileJSON(text)
	res.BuildPath = build
	if ctx.Err() == context.DeadlineExceeded {
		return res, errors.New("compiling took too long and was stopped")
	}
	if err != nil && res.OK {
		res.OK = false
	}
	if !res.OK && len(res.Diagnostics) == 0 {
		res.Diagnostics = ParseDiagnostics(res.Output)
	}
	return res, nil
}

// parseCompileJSON reads arduino-cli's --format json result.
func parseCompileJSON(text string) (res CompileResult) {
	var j struct {
		CompilerOut   string `json:"compiler_out"`
		CompilerErr   string `json:"compiler_err"`
		Success       bool   `json:"success"`
		Error         string `json:"error"`
		BuilderResult struct {
			Sections []struct {
				Name    string `json:"name"`
				Size    int64  `json:"size"`
				MaxSize int64  `json:"max_size"`
			} `json:"executable_sections_size"`
		} `json:"builder_result"`
	}
	start := strings.Index(text, "{")
	if start < 0 || json.Unmarshal([]byte(text[start:]), &j) != nil {
		res.Output = text
		return res
	}
	res.OK = j.Success
	res.Output = strings.TrimSpace(j.CompilerOut + "\n" + j.CompilerErr + "\n" + j.Error)
	res.Diagnostics = ParseDiagnostics(j.CompilerErr + "\n" + j.Error)
	defer func() {
		if res.Size == nil && res.OK {
			res.Size = sizeFromText(res.Output)
		}
	}()
	for _, s := range j.BuilderResult.Sections {
		if res.Size == nil {
			res.Size = &Size{}
		}
		switch s.Name {
		case "text":
			res.Size.Flash, res.Size.FlashMax = s.Size, s.MaxSize
		case "data":
			res.Size.RAM, res.Size.RAMMax = s.Size, s.MaxSize
		}
	}
	return res
}

var (
	flashRe = regexp.MustCompile(`Sketch uses (\d+) bytes .*?Maximum is (\d+) bytes`)
	ramRe   = regexp.MustCompile(`Global variables use (\d+) bytes .*?Maximum is (\d+) bytes`)

	esp8266FlashRe = regexp.MustCompile(`Code in flash \(default, ICACHE_FLASH_ATTR\), used (\d+) / (\d+) bytes`)
	esp8266RAMRe   = regexp.MustCompile(`Variables and constants in RAM \(global, static\), used (\d+) / (\d+) bytes`)
)

// sizeFromText reads "Sketch uses 924 bytes (2%) of program storage space.
// Maximum is 32256 bytes." (and the same for RAM) from compiler output.
func sizeFromText(out string) *Size {
	m := flashRe.FindStringSubmatch(out)
	if m == nil {
		// ESP8266: ". Code in flash (default, ICACHE_FLASH_ATTR), used 231884 / 1048576 bytes"
		if e := esp8266FlashRe.FindStringSubmatch(out); e != nil {
			sz := &Size{}
			sz.Flash, _ = strconv.ParseInt(e[1], 10, 64)
			sz.FlashMax, _ = strconv.ParseInt(e[2], 10, 64)
			if r := esp8266RAMRe.FindStringSubmatch(out); r != nil {
				sz.RAM, _ = strconv.ParseInt(r[1], 10, 64)
				sz.RAMMax, _ = strconv.ParseInt(r[2], 10, 64)
			}
			return sz
		}
		return nil
	}
	sz := &Size{}
	sz.Flash, _ = strconv.ParseInt(m[1], 10, 64)
	sz.FlashMax, _ = strconv.ParseInt(m[2], 10, 64)
	if r := ramRe.FindStringSubmatch(out); r != nil {
		sz.RAM, _ = strconv.ParseInt(r[1], 10, 64)
		sz.RAMMax, _ = strconv.ParseInt(r[2], 10, 64)
	}
	return sz
}

var (
	diagRe   = regexp.MustCompile(`^(.*?):(\d+):(?:(\d+):)? (fatal error|error|warning|note): (.*)$`)
	linkerRe = regexp.MustCompile("undefined reference to `([^']+)'")
)

// ParseDiagnostics reads gcc-style messages ("file:line:col: error: msg")
// and linker errors out of compiler output. File names are shortened to
// their base name; the sketch is "sketch.ino".
func ParseDiagnostics(output string) []Diagnostic {
	var out []Diagnostic
	seen := map[string]bool{}
	sc := bufio.NewScanner(strings.NewReader(output))
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		var d Diagnostic
		if m := diagRe.FindStringSubmatch(line); m != nil {
			d.File = filepath.Base(strings.ReplaceAll(m[1], `\`, "/"))
			d.Line, _ = strconv.Atoi(m[2])
			d.Col, _ = strconv.Atoi(m[3])
			d.Severity = m[4]
			if d.Severity == "fatal error" {
				d.Severity = "error"
				d.Message = "fatal error: " + m[5]
			} else {
				d.Message = m[5]
			}
		} else if m := linkerRe.FindStringSubmatch(line); m != nil {
			d = Diagnostic{File: "sketch.ino", Severity: "error", Message: "undefined reference to `" + m[1] + "'"}
		} else {
			continue
		}
		key := fmt.Sprint(d.File, d.Line, d.Col, d.Severity, d.Message)
		if !seen[key] {
			seen[key] = true
			out = append(out, d)
		}
	}
	return out
}

// CoachText is what the Coach matches against the errors database: the
// first error in the sketch (or anywhere, if none is in the sketch) and the
// notes right after it ("suggested alternative: ..."). coach.js does the same.
func CoachText(ds []Diagnostic) string {
	first := -1
	for i, d := range ds {
		if d.Severity == "error" && d.File == "sketch.ino" {
			first = i
			break
		}
	}
	if first < 0 {
		for i, d := range ds {
			if d.Severity == "error" {
				first = i
				break
			}
		}
	}
	if first < 0 {
		return ""
	}
	parts := []string{ds[first].Message}
	for _, d := range ds[first+1:] {
		if d.Severity != "note" {
			break
		}
		parts = append(parts, d.Message)
	}
	return strings.Join(parts, "\n")
}

// Upload sends a compiled sketch (from Compile's build folder) to a board.
func (t *Tools) Upload(ctx context.Context, buildPath, fqbn, port string, out func(string)) (string, error) {
	if err := t.waitReady(ctx, FamilyOf(fqbn)); err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	text, err := t.stream(ctx, out, "upload", "--fqbn", fqbn, "--port", port, "--input-dir", buildPath)
	if ctx.Err() == context.DeadlineExceeded {
		return text, errors.New("uploading took too long and was stopped")
	}
	return text, err
}

// Port is a serial port, with the board on it if arduino-cli recognises it.
type Port struct {
	Address string `json:"port"`
	Label   string `json:"label"`
	VID     string `json:"vid,omitempty"`
	PID     string `json:"pid,omitempty"`
	Chip    string `json:"chip,omitempty"`  // the USB chip, e.g. "CH340"
	Board   string `json:"board,omitempty"` // a matching board name
	FQBN    string `json:"fqbn,omitempty"`
}

// Ports lists serial ports (cached for a moment: finding them takes a second).
func (t *Tools) Ports(ctx context.Context) ([]Port, error) {
	t.portsMu.Lock()
	defer t.portsMu.Unlock()
	if time.Since(t.portsAt) < 1500*time.Millisecond {
		return t.portsLast, nil
	}
	if err := t.waitReady(ctx, "common"); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	text, err := t.stream(ctx, nil, "board", "list", "--discovery-timeout", "1s", "--format", "json")
	if err != nil {
		return nil, err
	}
	ports, err := parsePorts(text)
	if err != nil {
		return nil, err
	}
	t.portsAt, t.portsLast = time.Now(), ports
	return ports, nil
}

func parsePorts(text string) ([]Port, error) {
	var j struct {
		Detected []struct {
			Port struct {
				Address    string            `json:"address"`
				Label      string            `json:"label"`
				Protocol   string            `json:"protocol"`
				Properties map[string]string `json:"properties"`
			} `json:"port"`
			Boards []struct {
				Name string `json:"name"`
				FQBN string `json:"fqbn"`
			} `json:"matching_boards"`
		} `json:"detected_ports"`
	}
	start := strings.Index(text, "{")
	if start < 0 {
		return []Port{}, nil
	}
	if err := json.Unmarshal([]byte(text[start:]), &j); err != nil {
		return nil, fmt.Errorf("reading the port list: %w", err)
	}
	out := []Port{}
	for _, d := range j.Detected {
		if d.Port.Protocol != "serial" {
			continue
		}
		p := Port{Address: d.Port.Address, Label: d.Port.Label, VID: strings.ToLower(d.Port.Properties["vid"]), PID: strings.ToLower(d.Port.Properties["pid"])}
		p.Chip = usbChip(p.VID, p.PID)
		if len(d.Boards) > 0 {
			p.Board, p.FQBN = d.Boards[0].Name, d.Boards[0].FQBN
		}
		out = append(out, p)
	}
	return out, nil
}

// usbChip names the USB-to-serial chip from its USB ids.
func usbChip(vid, pid string) string {
	vid = strings.TrimPrefix(vid, "0x")
	pid = strings.TrimPrefix(pid, "0x")
	switch vid {
	case "1a86":
		return "CH340"
	case "10c4":
		return "CP2102"
	case "0403":
		return "FTDI"
	case "2341", "2a03":
		return "Arduino"
	case "303a":
		return "ESP32 USB"
	}
	return ""
}

// stream runs arduino-cli, passing its output to out as it arrives, and
// returns all of it.
func (t *Tools) stream(ctx context.Context, out func(string), args ...string) (string, error) {
	args = append([]string{"--config-file", t.env.ConfigFile(), "--no-color"}, args...)
	cmd := exec.CommandContext(ctx, t.env.CLI(), args...)
	cmd.Env = append(os.Environ(), "HOME="+t.env.Dir)
	hideConsole(cmd)
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	if err := cmd.Start(); err != nil {
		return "", err
	}
	var all strings.Builder
	done := make(chan struct{})
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := pr.Read(buf)
			if n > 0 {
				chunk := string(buf[:n])
				all.WriteString(chunk)
				if out != nil {
					out(chunk)
				}
			}
			if err != nil {
				return
			}
		}
	}()
	err := cmd.Wait()
	pw.Close()
	<-done
	return all.String(), err
}

func randomName() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func safeName(s string) string { return unsafeChars.ReplaceAllString(s, "_") }
