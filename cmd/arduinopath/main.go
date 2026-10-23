// Command arduinopath is ArduinoPath for one laptop: double-click
// ArduinoPath.exe (Windows) or ArduinoPath.app (macOS) and it opens in Edge
// or Chrome as an app window. Nothing to install and no admin rights needed.
// It serves the web app to this computer only (http://localhost:47820) and
// keeps everyone's work in %LOCALAPPDATA%\ArduinoPath (Windows) or
// ~/Library/Application Support/ArduinoPath (macOS). It closes itself a while
// after the window closes.
//
// For development:
//
//	go run ./cmd/arduinopath -dev
//
// then open http://localhost:8080 (ui/ and content/ are read live from disk).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"arduinopath"
	"arduinopath/internal/arduino"
	"arduinopath/internal/content"
	"arduinopath/internal/serialmon"
	"arduinopath/internal/server"
	"arduinopath/internal/store"
)

// defaultPort stays the same every time, so the browser keeps the same site
// (and anything it stored for it, like unsaved code waiting to save).
const defaultPort = 47820

// errStartFailed means the background server (macOS) stopped while starting;
// it has already shown its own message.
var errStartFailed = errors.New("the ArduinoPath server stopped while starting (see arduinopath.log)")

type config struct {
	dev        bool
	dataDir    string
	port       int
	uiDir      string
	contentDir string
	school     string
	noBrowser  bool
	idleExit   time.Duration
	boards     string // a boards.zip to use instead of the built-in one
	arduinoDir string // board tools already installed here (development, CI)
}

func main() {
	var cfg config
	flag.BoolVar(&cfg.dev, "dev", false, "development mode: port 8080, data in ./dev-data, ui/ and content/ read live from disk, no browser")
	flag.StringVar(&cfg.dataDir, "data", "", `folder for everyone's work (default %LOCALAPPDATA%\ArduinoPath, or ./dev-data with -dev)`)
	flag.IntVar(&cfg.port, "port", 0, "port on this computer (default 47820, or 8080 with -dev)")
	flag.StringVar(&cfg.uiDir, "ui", "", "serve the web app from this folder instead of the built-in copy")
	flag.StringVar(&cfg.contentDir, "content", "", "read content from this folder instead of the built-in copy")
	flag.StringVar(&cfg.school, "school", "", "the school name shown on the welcome screen (saved; only needed once)")
	flag.BoolVar(&cfg.noBrowser, "no-browser", false, "don't open a browser window")
	flag.DurationVar(&cfg.idleExit, "idle-exit", 20*time.Minute, "close after this long with no ArduinoPath window open (0: never)")
	flag.StringVar(&cfg.boards, "boards", "", "use the board tools in this boards.zip instead of the built-in ones")
	flag.StringVar(&cfg.arduinoDir, "arduino-dir", "", "use board tools already installed in this folder (by -setup-arduino)")
	setupArduino := flag.Bool("setup-arduino", false, "install arduino-cli, the board cores and libraries, check every board compiles, and stop (for CI)")
	checkArduino := flag.Bool("check-arduino", false, "check every board compiles the kit-check sketch, and stop")
	installArduino := flag.Bool("install-arduino", false, "install arduino-cli, the board cores and libraries (no kit check), and stop (for CI)")
	showVersion := flag.Bool("version", false, "print the version and stop")
	flag.Parse()
	cfg.applyDefaults()

	if *showVersion {
		fmt.Println("ArduinoPath", arduinopath.Version)
		return
	}
	if *setupArduino || *checkArduino || *installArduino {
		log := slog.New(slog.NewTextHandler(os.Stderr, nil))
		if err := runArduino(cfg, log, *setupArduino || *installArduino, !*installArduino); err != nil {
			log.Error("stopped", "err", err)
			os.Exit(1)
		}
		return
	}
	log, closeLog := openLog(cfg)
	defer closeLog()
	installShortcuts(cfg, log)
	if startsInBackground(cfg) {
		if err := launchInBackground(cfg, log); err != nil {
			log.Error("couldn't start", "err", err)
			if err != errStartFailed {
				showError("ArduinoPath can't start", err.Error()+"\n\nTry again, or ask your teacher for help.")
			}
			closeLog()
			os.Exit(1)
		}
		return
	}
	if err := run(cfg, log); err != nil {
		log.Error("stopped", "err", err)
		showError("ArduinoPath can't start", err.Error()+"\n\nTry again, or ask your teacher for help.")
		closeLog()
		os.Exit(1)
	}
}

// applyDefaults fills in the folders and port for a laptop (or for -dev).
func (cfg *config) applyDefaults() {
	if cfg.dev {
		if cfg.dataDir == "" {
			cfg.dataDir = "dev-data"
		}
		if cfg.port == 0 {
			cfg.port = 8080
		}
		if cfg.uiDir == "" && dirExists("ui") {
			cfg.uiDir = "ui"
		}
		if cfg.contentDir == "" && dirExists("content") {
			cfg.contentDir = "content"
		}
		cfg.noBrowser = true
		cfg.idleExit = 0
	}
	if cfg.dataDir == "" {
		cfg.dataDir = defaultDataDir()
		moveOldWork(cfg.dataDir)
	}
	if cfg.port == 0 {
		cfg.port = defaultPort
	}
}

// defaultDataDir is %LOCALAPPDATA%\ArduinoPath on Windows and
// ~/Library/Application Support/ArduinoPath on macOS: inside the student's
// own account, which needs no admin rights and isn't shared with other
// people who log in to the laptop.
func defaultDataDir() string {
	if runtime.GOOS == "windows" {
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "ArduinoPath")
		}
	}
	if d, err := os.UserConfigDir(); err == nil {
		return filepath.Join(d, "ArduinoPath")
	}
	return "ArduinoPath-data"
}

// moveOldWork moves work saved before the app was renamed: from the
// CircuitPath folder next to dir (CircuitPath.exe, versions 0.3.0 and
// before) into dir, if dir doesn't exist yet. If the move fails, the old
// folder is left as it was.
func moveOldWork(dir string) {
	old := filepath.Join(filepath.Dir(dir), "Circuit"+"Path")
	if dirExists(dir) || !dirExists(old) {
		return
	}
	if err := os.Rename(old, dir); err != nil {
		return
	}
	for _, suffix := range []string{"", "-wal", "-shm"} {
		from := filepath.Join(dir, "circuit"+"path.db"+suffix)
		if _, err := os.Stat(from); err == nil {
			os.Rename(from, filepath.Join(dir, "arduinopath.db"+suffix))
		}
	}
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

// openLog writes to arduinopath.log in the data folder (ArduinoPath.exe has
// no console window), and to the terminal too with -dev.
func openLog(cfg config) (*slog.Logger, func()) {
	var w io.Writer = os.Stderr
	closeFn := func() {}
	if err := os.MkdirAll(cfg.dataDir, 0o700); err == nil {
		path := filepath.Join(cfg.dataDir, "arduinopath.log")
		if fi, err := os.Stat(path); err == nil && fi.Size() > 1<<20 {
			os.Rename(path, path+".old")
		}
		if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			w = f
			if cfg.dev {
				w = io.MultiWriter(f, os.Stderr)
			}
			closeFn = func() { f.Close() }
		}
	}
	return slog.New(slog.NewTextHandler(w, nil)), closeFn
}

func run(cfg config, log *slog.Logger) error {
	url := fmt.Sprintf("http://localhost:%d/", cfg.port)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", cfg.port))
	if err != nil {
		// Already open? Then just open another window onto it.
		if running(cfg.port) {
			log.Info("already running; opening a window", "url", url)
			if !cfg.noBrowser {
				return openBrowser(url)
			}
			return nil
		}
		return fmt.Errorf("another program is using port %d: %w", cfg.port, err)
	}
	listeners := []net.Listener{ln}
	// Browsers may try ::1 for "localhost" first; answer there too if we can.
	if ln6, err := net.Listen("tcp", fmt.Sprintf("[::1]:%d", cfg.port)); err == nil {
		listeners = append(listeners, ln6)
	}
	defer func() {
		for _, l := range listeners {
			l.Close()
		}
	}()

	if err := os.MkdirAll(cfg.dataDir, 0o700); err != nil {
		return err
	}
	db, err := store.Open(filepath.Join(cfg.dataDir, "arduinopath.db"))
	if err != nil {
		return fmt.Errorf("opening the saved work: %w", err)
	}
	defer db.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if cfg.school != "" {
		if err := db.SetSetting(ctx, "school", cfg.school); err != nil {
			return err
		}
	}
	var uiFS, contentFS fs.FS = arduinopath.UI(), arduinopath.Content()
	if cfg.uiDir != "" {
		uiFS = os.DirFS(cfg.uiDir)
	}
	if cfg.contentDir != "" {
		contentFS = os.DirFS(cfg.contentDir)
	}
	cat, problems := content.Load(contentFS)
	for _, p := range problems {
		log.Warn("content problem (skipped)", "file", p.File, "problem", p.Message)
	}

	tools, closeTools := boardTools(cfg, log)
	defer closeTools()

	srv := &server.Server{
		Store:       db,
		Catalogue:   cat,
		Problems:    problems,
		UI:          uiFS,
		Version:     arduinopath.Version,
		DataDir:     cfg.dataDir,
		Log:         log,
		CacheStatic: cfg.uiDir == "",
		Hosts:       []string{"localhost", "127.0.0.1", "::1"},
		Serial:      serialmon.NewManager(),
	}
	if tools != nil {
		srv.Tools = tools
		tools.Prepare("avr") // the default boards: ready before the first Upload
	}
	idle := &idleTracker{}
	idle.touch()
	hs := &http.Server{
		Handler:           idle.wrap(srv.Handler()),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelDebug),
	}
	errs := make(chan error, len(listeners))
	for _, l := range listeners {
		go func() { errs <- hs.Serve(l) }()
	}
	log.Info("ArduinoPath is ready", "url", url, "version", arduinopath.Version, "data", cfg.dataDir)
	if !cfg.noBrowser {
		if err := openBrowser(url); err != nil {
			log.Warn("couldn't open a browser", "err", err)
			showError("ArduinoPath is running", "Open "+browserNames+" and go to "+url)
		}
	}

	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Info("stopping")
			return shutdown(hs)
		case err := <-errs:
			if errors.Is(err, http.ErrServerClosed) {
				return nil
			}
			return err
		case <-tick.C:
			db.DeleteExpiredSessions(ctx)
			if cfg.idleExit > 0 && idle.since() > cfg.idleExit {
				log.Info("no ArduinoPath window open for a while; closing", "idle", idle.since().Round(time.Second))
				return shutdown(hs)
			}
		}
	}
}

// boardTools finds the board tools: installed in -arduino-dir, a -boards
// zip, or built into ArduinoPath itself. None is fine: the simulator works
// without them.
func boardTools(cfg config, log *slog.Logger) (*arduino.Tools, func()) {
	if cfg.arduinoDir != "" {
		t, err := arduino.InstalledTools(cfg.arduinoDir, log)
		if err != nil {
			log.Warn("no board tools", "err", err)
			return nil, func() {}
		}
		return t, func() {}
	}
	var b *arduino.Bundle
	var err error
	if cfg.boards != "" {
		b, err = arduino.OpenBundle(cfg.boards)
	} else {
		b, err = arduino.FindBundle()
	}
	if err != nil {
		log.Info("no board tools: compiling for real boards is off", "err", err)
		return nil, func() {}
	}
	log.Info("board tools found", "in", b.Path, "families", len(b.Manifest.Families))
	folder := arduino.ToolsFolder(cfg.dataDir)
	if folder != cfg.dataDir {
		go arduino.RemoveOldTools(cfg.dataDir, "", log) // tools unpacked here by older versions
	}
	return arduino.NewTools(b, folder, log), func() { b.Close() }
}

func shutdown(hs *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return hs.Shutdown(ctx)
}

// idleTracker notes when the web app last asked for anything (an open
// window pings every minute).
type idleTracker struct{ last atomic.Int64 }

func (t *idleTracker) touch()               { t.last.Store(time.Now().UnixNano()) }
func (t *idleTracker) since() time.Duration { return time.Since(time.Unix(0, t.last.Load())) }

func (t *idleTracker) wrap(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.touch()
		h.ServeHTTP(w, r)
	})
}

// running reports whether ArduinoPath is already answering on port.
func running(port int) bool {
	c := &http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("GET", "http://127.0.0.1:"+strconv.Itoa(port)+"/api/info", nil)
	req.Host = "localhost:" + strconv.Itoa(port)
	res, err := c.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var info struct{ App string }
	return json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&info) == nil && info.App == "ArduinoPath"
}

// boardsToCheck lists every board and board setting students can pick.
func boardsToCheck(cat *content.Catalogue) []arduino.Board {
	var boards []arduino.Board
	for _, b := range cat.Boards {
		boards = append(boards, arduino.Board{Name: b.Name, FQBN: b.FQBN})
		for _, v := range b.Variants {
			boards = append(boards, arduino.Board{Name: b.Name + " (" + v.Label + ")", FQBN: v.FQBN})
		}
	}
	return boards
}

// runArduino is -setup-arduino / -check-arduino / -install-arduino: install
// the pinned tools (if setup) and compile the kit check for every board (if
// check), printing a table.
func runArduino(cfg config, log *slog.Logger, setup, check bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	contentFS := arduinopath.Content()
	if cfg.contentDir != "" {
		contentFS = os.DirFS(cfg.contentDir)
	}
	cat, problems := content.Load(contentFS)
	for _, p := range problems {
		log.Warn("content problem (skipped)", "file", p.File, "problem", p.Message)
	}
	env := &arduino.Env{Dir: filepath.Join(cfg.dataDir, "arduino"), Log: log}
	if setup {
		start := time.Now()
		if err := env.Setup(ctx); err != nil {
			return err
		}
		log.Info("board cores and libraries installed", "took", time.Since(start).Round(time.Second))
	}
	if !check {
		return nil
	}
	results, err := env.Check(ctx, boardsToCheck(cat))
	if err != nil {
		return err
	}
	failed := 0
	fmt.Println("\nKit check (every library the projects use, on every board):")
	for _, r := range results {
		mark := "✓"
		if !r.OK {
			mark = "✗"
			failed++
		}
		fmt.Printf("  %s %-45s %-40s %s\n", mark, r.Board.Name, r.Board.FQBN, r.Duration)
	}
	for _, r := range results {
		if !r.OK {
			fmt.Printf("\n--- %s (%s) ---\n%s\n", r.Board.Name, r.Board.FQBN, tailLines(r.Output, 30))
		}
	}
	if failed > 0 {
		return fmt.Errorf("%d of %d boards failed the kit check", failed, len(results))
	}
	fmt.Printf("\nAll %d boards are ready.\n", len(results))
	return nil
}

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
