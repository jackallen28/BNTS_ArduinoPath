// Package arduino installs and checks the Arduino tools ArduinoPath compiles
// with: arduino-cli, the board cores (AVR, ESP8266, ESP32) and every library
// the projects use, at the exact versions in requirements.json.
//
// Setup brings a folder's tools to those versions; Check compiles the
// kit-check sketch for every board (which also fills the build cache). CI
// runs both on every board; the app doesn't use them yet (how compiling
// ships with the Windows app is still to decide).
package arduino

import (
	"archive/tar"
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed requirements.json
var requirementsJSON []byte

//go:embed kitcheck/kitcheck.ino
var kitCheckSketch []byte

// Package is a core ("esp32:esp32") or library ("Adafruit NeoPixel") at a version.
type Package struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

func (p Package) String() string { return p.Name + "@" + p.Version }

// Requirements is requirements.json.
type Requirements struct {
	CLI              string    `json:"arduino_cli"`
	BoardManagerURLs []string  `json:"board_manager_urls"`
	Cores            []Package `json:"cores"`
	Libraries        []Package `json:"libraries"`
}

// Pinned returns the versions built into this server.
func Pinned() Requirements {
	var r Requirements
	if err := json.Unmarshal(requirementsJSON, &r); err != nil {
		panic("arduino/requirements.json: " + err.Error())
	}
	return r
}

// Hash identifies a set of requirements.
func (r Requirements) Hash() string {
	b, _ := json.Marshal(r)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Board is one board to check, e.g. {"Arduino Uno R3", "arduino:avr:uno"}.
type Board struct {
	Name string
	FQBN string
}

// Env is an Arduino tools folder:
//
//	bin/arduino-cli      the pinned arduino-cli
//	arduino-cli.yaml     its settings (all paths inside this folder)
//	data/ user/ downloads/ build-cache/
//	installed.json       what Setup last installed
type Env struct {
	Dir    string
	Req    Requirements // zero: Pinned()
	Log    *slog.Logger
	Client *http.Client // nil: one that honours HTTPS_PROXY
	// DownloadBase is where arduino-cli releases come from (tests change it).
	DownloadBase string
}

func (e *Env) req() Requirements {
	if e.Req.CLI == "" {
		return Pinned()
	}
	return e.Req
}

func (e *Env) log() *slog.Logger {
	if e.Log != nil {
		return e.Log
	}
	return slog.Default()
}

// CLI is the path of arduino-cli.
func (e *Env) CLI() string { return filepath.Join(e.Dir, "bin", cliName()) }

// cliName is arduino-cli's file name on this computer.
func cliName() string {
	if runtime.GOOS == "windows" {
		return "arduino-cli.exe"
	}
	return "arduino-cli"
}

// ConfigFile is the path of arduino-cli.yaml.
func (e *Env) ConfigFile() string { return filepath.Join(e.Dir, "arduino-cli.yaml") }

func (e *Env) stampFile() string { return filepath.Join(e.Dir, "installed.json") }

type stamp struct {
	Hash         string       `json:"hash"`
	Requirements Requirements `json:"requirements"`
	InstalledAt  string       `json:"installed_at"`
}

// Ready reports whether Setup has installed exactly the pinned versions.
func (e *Env) Ready() bool {
	b, err := os.ReadFile(e.stampFile())
	if err != nil {
		return false
	}
	var s stamp
	if json.Unmarshal(b, &s) != nil || s.Hash != e.req().Hash() {
		return false
	}
	_, err = os.Stat(e.CLI())
	return err == nil
}

// Setup installs arduino-cli, the cores and the libraries at the pinned
// versions. It needs the internet (through HTTPS_PROXY if that's set).
func (e *Env) Setup(ctx context.Context) error {
	r := e.req()
	for _, d := range []string{"bin", "data", "user", "downloads", "build-cache"} {
		if err := os.MkdirAll(filepath.Join(e.Dir, d), 0o755); err != nil {
			return err
		}
	}
	if err := e.ensureCLI(ctx, r.CLI); err != nil {
		return fmt.Errorf("installing arduino-cli %s: %w", r.CLI, err)
	}
	if err := e.writeConfig(r); err != nil {
		return err
	}
	e.log().Info("updating the board and library lists")
	if _, err := e.run(ctx, "core", "update-index"); err != nil {
		return err
	}
	if _, err := e.run(ctx, "lib", "update-index"); err != nil {
		return err
	}
	for _, c := range r.Cores {
		e.log().Info("installing a board core (big ones take a while)", "core", c.String())
		if _, err := e.run(ctx, "core", "install", c.String()); err != nil {
			return err
		}
	}
	for _, l := range r.Libraries {
		e.log().Info("installing a library", "library", l.String())
		// --no-deps: every dependency is pinned in the list too.
		if _, err := e.run(ctx, "lib", "install", "--no-deps", l.String()); err != nil {
			return err
		}
	}
	if err := installOwnLibraries(filepath.Join(e.Dir, "user", "libraries")); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(stamp{Hash: r.Hash(), Requirements: r, InstalledAt: time.Now().UTC().Format(time.RFC3339)}, "", "  ")
	return os.WriteFile(e.stampFile(), b, 0o644)
}

//go:embed libraries
var ownLibraries embed.FS

// installOwnLibraries copies ArduinoPath's own small libraries (such as the
// one that makes <Servo.h> work on ESP32 boards) into the libraries folder.
func installOwnLibraries(dir string) error {
	return fs.WalkDir(ownLibraries, "libraries", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		dest := filepath.Join(dir, filepath.FromSlash(strings.TrimPrefix(p, "libraries")))
		if d.IsDir() {
			return os.MkdirAll(dest, 0o755)
		}
		data, err := ownLibraries.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, data, 0o644)
	})
}

// Result is how one board did in the kit check.
type Result struct {
	Board    Board
	OK       bool
	Duration time.Duration
	Output   string // compiler output when it failed
}

// Check compiles the kit-check sketch for each board.
func (e *Env) Check(ctx context.Context, boards []Board) ([]Result, error) {
	tmp, err := os.MkdirTemp("", "arduinopath-kitcheck-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	sketch := filepath.Join(tmp, "kitcheck")
	if err := os.MkdirAll(sketch, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(sketch, "kitcheck.ino"), kitCheckSketch, 0o644); err != nil {
		return nil, err
	}
	var results []Result
	for i, b := range boards {
		start := time.Now()
		out, err := e.run(ctx, "compile", "--fqbn", b.FQBN, "--build-path", filepath.Join(tmp, fmt.Sprintf("build-%d", i)), sketch)
		res := Result{Board: b, OK: err == nil, Duration: time.Since(start).Round(time.Second)}
		if err != nil {
			res.Output = out
		}
		e.log().Info("kit check", "board", b.Name, "fqbn", b.FQBN, "ok", res.OK, "took", res.Duration)
		results = append(results, res)
	}
	return results, nil
}

// run runs arduino-cli with this folder's settings and returns its output.
func (e *Env) run(ctx context.Context, args ...string) (string, error) {
	args = append([]string{"--config-file", e.ConfigFile(), "--no-color"}, args...)
	cmd := exec.CommandContext(ctx, e.CLI(), args...)
	cmd.Env = append(os.Environ(), "HOME="+e.Dir)
	hideConsole(cmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("arduino-cli %s: %w\n%s", strings.Join(args[3:], " "), err, tail(string(out), 40))
	}
	return string(out), nil
}

func tail(s string, lines int) string {
	parts := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(parts) > lines {
		parts = parts[len(parts)-lines:]
	}
	return strings.Join(parts, "\n")
}

func (e *Env) writeConfig(r Requirements) error {
	var b strings.Builder
	b.WriteString("# Written by ArduinoPath (internal/arduino). Changes are overwritten.\n")
	b.WriteString("board_manager:\n  additional_urls:\n")
	for _, u := range r.BoardManagerURLs {
		fmt.Fprintf(&b, "    - %s\n", u)
	}
	fmt.Fprintf(&b, "directories:\n  data: %s\n  downloads: %s\n  user: %s\n",
		filepath.Join(e.Dir, "data"), filepath.Join(e.Dir, "downloads"), filepath.Join(e.Dir, "user"))
	fmt.Fprintf(&b, "build_cache:\n  path: %s\n", filepath.Join(e.Dir, "build-cache"))
	b.WriteString("updater:\n  enable_notification: false\n")
	if p := proxyFromEnv(); p != "" {
		fmt.Fprintf(&b, "network:\n  proxy: %s\n", p)
	}
	return os.WriteFile(e.ConfigFile(), []byte(b.String()), 0o644)
}

func proxyFromEnv() string {
	for _, k := range []string{"HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"} {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

// cliPlatform names arduino-cli's download for this computer.
func cliPlatform() (string, error) {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "linux/arm64":
		return "Linux_ARM64", nil
	case "linux/amd64":
		return "Linux_64bit", nil
	case "darwin/arm64":
		return "macOS_ARM64", nil
	case "darwin/amd64":
		return "macOS_64bit", nil
	case "windows/amd64":
		return "Windows_64bit", nil
	case "windows/arm64":
		return "Windows_ARM64", nil
	}
	return "", fmt.Errorf("no arduino-cli download for %s/%s: install arduino-cli %s at %s yourself", runtime.GOOS, runtime.GOARCH, Pinned().CLI, "bin/arduino-cli")
}

// installedCLIVersion asks bin/arduino-cli for its version ("" if missing).
func (e *Env) installedCLIVersion(ctx context.Context) string {
	out, err := exec.CommandContext(ctx, e.CLI(), "version", "--json").Output()
	if err != nil {
		return ""
	}
	var v struct {
		VersionString string `json:"VersionString"`
	}
	json.Unmarshal(out, &v)
	return v.VersionString
}

// ensureCLI downloads the pinned arduino-cli, checked against Arduino's
// published SHA-256 checksums.
func (e *Env) ensureCLI(ctx context.Context, version string) error {
	if e.installedCLIVersion(ctx) == version {
		return nil
	}
	plat, err := cliPlatform()
	if err != nil {
		return err
	}
	base := e.DownloadBase
	if base == "" {
		base = "https://downloads.arduino.cc/arduino-cli"
	}
	ext := ".tar.gz"
	if runtime.GOOS == "windows" {
		ext = ".zip"
	}
	name := fmt.Sprintf("arduino-cli_%s_%s%s", version, plat, ext)
	sums, err := e.get(ctx, fmt.Sprintf("%s/%s-checksums.txt", base, version), 64<<10)
	if err != nil {
		return err
	}
	want := ""
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		if f := strings.Fields(sc.Text()); len(f) == 2 && f[1] == name {
			want = f[0]
		}
	}
	if want == "" {
		return fmt.Errorf("%s isn't in arduino-cli's checksums", name)
	}
	archive, err := e.get(ctx, base+"/"+name, 200<<20)
	if err != nil {
		return err
	}
	if sum := sha256.Sum256(archive); hex.EncodeToString(sum[:]) != want {
		return fmt.Errorf("%s doesn't match its checksum", name)
	}
	bin, err := extractFile(archive, cliName())
	if err != nil {
		return err
	}
	tmp := e.CLI() + ".new"
	if err := os.WriteFile(tmp, bin, 0o755); err != nil {
		return err
	}
	return os.Rename(tmp, e.CLI())
}

func (e *Env) get(ctx context.Context, rawURL string, limit int64) ([]byte, error) {
	if u, err := url.Parse(rawURL); err != nil || (u.Scheme != "https" && u.Hostname() != "127.0.0.1") {
		return nil, fmt.Errorf("refusing to download %q", rawURL)
	}
	client := e.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Minute, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment}}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", rawURL, res.Status)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("%s is too big", rawURL)
	}
	return b, nil
}

// extractFile pulls one file out of a .tar.gz or .zip.
func extractFile(archive []byte, name string) ([]byte, error) {
	if bytes.HasPrefix(archive, []byte("PK\x03\x04")) {
		zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if path.Base(f.Name) == name && !f.FileInfo().IsDir() {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(io.LimitReader(rc, 200<<20))
			}
		}
		return nil, fmt.Errorf("%s isn't in the archive", name)
	}
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return nil, err
	}
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil, fmt.Errorf("%s isn't in the archive", name)
		}
		if err != nil {
			return nil, err
		}
		if filepath.Base(h.Name) == name && h.Typeflag == tar.TypeReg {
			return io.ReadAll(io.LimitReader(tr, 200<<20))
		}
	}
}
