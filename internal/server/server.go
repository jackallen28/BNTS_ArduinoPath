// Package server is ArduinoPath's local web server: the web app's files and
// the JSON API for profiles, logins, autosave, progress, save files and the
// WIPE page. It runs on the student's own laptop and only answers that
// laptop (see Hosts).
package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"arduinopath/internal/auth"
	"arduinopath/internal/content"
	"arduinopath/internal/serialmon"
	"arduinopath/internal/store"
)

const (
	cookieName    = "cp_session"
	maxJSONBytes  = 256 << 10
	csrfHeader    = "X-ArduinoPath"
	defaultSchool = "Banyule Nillumbik Tech School"
	sessionTTL    = 12 * time.Hour
)

// Server holds everything the handlers need.
type Server struct {
	Store     *store.Store
	Catalogue *content.Catalogue
	Problems  []content.Problem
	UI        fs.FS
	Version   string
	Log       *slog.Logger
	// CacheStatic lets browsers cache the web app's files (they are checked
	// with an ETag on every load). Turn it off when editing ui/ live.
	CacheStatic bool
	// SecureCookies marks the login cookie Secure (only when served over HTTPS).
	SecureCookies bool
	// Hosts are the Host names (without port) the server answers, e.g.
	// "localhost" and "127.0.0.1". Anything else is refused, so a website
	// can't reach the server by pointing its own name at 127.0.0.1 (DNS
	// rebinding). Empty: answer any host (tests).
	Hosts []string
	// Tools compiles and uploads to real boards (nil: not built in).
	Tools BoardTools
	// Serial is the Serial Monitor for real boards (nil: none).
	Serial *serialmon.Manager

	once   sync.Once
	jobs   *jobQueue
	static http.Handler
}

func (s *Server) init() {
	s.once.Do(func() {
		if s.Log == nil {
			s.Log = slog.Default()
		}
		s.static = newStatic(s.UI, s.CacheStatic)
		s.initJobs()
	})
}

// Handler returns the server's routes wrapped in its middleware.
func (s *Server) Handler() http.Handler {
	s.init()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/info", s.handleInfo)
	mux.HandleFunc("GET /api/catalogue", s.handleCatalogue)
	mux.HandleFunc("GET /api/projects/{id}", s.handleProject)
	mux.HandleFunc("GET /api/ping", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /api/students", s.handleStudents)
	mux.HandleFunc("POST /api/students", s.handleCreateStudent)
	mux.HandleFunc("POST /api/login", s.handleLogin)
	mux.HandleFunc("POST /api/logout", s.handleLogout)
	mux.HandleFunc("GET /api/me", s.withStudent(s.handleMe))
	mux.HandleFunc("PUT /api/me/settings", s.withStudent(s.handleSettings))
	mux.HandleFunc("GET /api/me/progress", s.withStudent(s.handleListProgress))
	mux.HandleFunc("PUT /api/me/progress/{project}", s.withStudent(s.handlePutProgress))
	mux.HandleFunc("GET /api/me/sketches/{project}", s.withStudent(s.handleGetSketch))
	mux.HandleFunc("PUT /api/me/sketches/{project}", s.withStudent(s.handlePutSketch))
	mux.HandleFunc("GET /api/me/export", s.withStudent(s.handleExport))
	mux.HandleFunc("POST /api/me/import", s.withStudent(s.handleImport))
	mux.HandleFunc("GET /api/tools", s.handleTools)
	mux.HandleFunc("POST /api/tools/prepare", s.handlePrepareTools)
	mux.HandleFunc("POST /api/compile", s.handleNewJob("compile"))
	mux.HandleFunc("POST /api/upload", s.handleNewJob("upload"))
	mux.HandleFunc("GET /api/jobs/{id}", s.handleJob)
	mux.HandleFunc("GET /api/ports", s.handlePorts)
	mux.HandleFunc("GET /api/serial", s.handleSerial)
	mux.HandleFunc("POST /api/serial/write", s.handleSerialWrite)
	mux.HandleFunc("POST /api/serial/close", s.handleSerialClose)
	mux.HandleFunc("GET /api/everyone/export", s.handleExportEveryone)
	mux.HandleFunc("POST /api/wipe", s.handleWipe)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "There's nothing here.")
	})
	mux.Handle("/", s.static)
	return s.middleware(mux)
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; "+
			"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if !s.hostAllowed(r.Host) {
			http.Error(w, "ArduinoPath only answers this computer.", http.StatusMisdirectedRequest)
			return
		}
		defer func() {
			if v := recover(); v != nil {
				s.Log.Error("panic", "path", r.URL.Path, "err", v)
				writeError(w, http.StatusInternalServerError, "server", "Something went wrong on the server. Try again.")
			}
		}()
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
			// Reads that open the hardware (the Serial Monitor resets an Uno)
			// mustn't come from another website. EventSource can't add our
			// header, so the browser's own Sec-Fetch-Site is the check.
			hardware := r.URL.Path == "/api/serial" || r.URL.Path == "/api/ports"
			if hardware && !notCrossSite(r) {
				writeError(w, http.StatusForbidden, "cross_site", "That request came from another website.")
				return
			}
			if r.Method != http.MethodGet && r.Method != http.MethodHead && !sameOrigin(r) {
				writeError(w, http.StatusForbidden, "cross_site", "That request came from another website.")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) hostAllowed(hostport string) bool {
	if len(s.Hosts) == 0 {
		return true
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.TrimSuffix(strings.Trim(host, "[]"), ".")
	for _, ok := range s.Hosts {
		if strings.EqualFold(host, ok) {
			return true
		}
	}
	return false
}

// sameOrigin blocks cross-site requests: every write must carry our custom
// header (which a browser won't let another site add without CORS, and we
// allow no CORS), and must not be marked cross-site by the browser.
func sameOrigin(r *http.Request) bool {
	return r.Header.Get(csrfHeader) == "1" && notCrossSite(r)
}

// notCrossSite: the browser didn't mark the request as from another site.
func notCrossSite(r *http.Request) bool {
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

// apiError is the JSON body of every error response.
type apiError struct {
	Error      string `json:"error"`
	Message    string `json:"message"`
	RetryAfter int    `json:"retry_after,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiError{Error: code, Message: msg})
}

func (s *Server) serverError(w http.ResponseWriter, r *http.Request, err error) {
	s.Log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
	writeError(w, http.StatusInternalServerError, "server", "Something went wrong on the server. Try again.")
}

// readJSON decodes a size-limited JSON body, refusing unknown fields.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if ct != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "bad_request", "Send JSON.")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_big", "That's too big to save.")
		} else {
			writeError(w, http.StatusBadRequest, "bad_request", "The server couldn't read that request.")
		}
		return false
	}
	if dec.More() {
		writeError(w, http.StatusBadRequest, "bad_request", "The server couldn't read that request.")
		return false
	}
	return true
}

// withStudent runs h only for a logged-in student, passing their id.
func (s *Server) withStudent(h func(http.ResponseWriter, *http.Request, int64)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil || c.Value == "" {
			writeError(w, http.StatusUnauthorized, "logged_out", "Please log in again.")
			return
		}
		id, err := s.Store.SessionStudent(r.Context(), auth.HashToken(c.Value))
		if errors.Is(err, store.ErrNotFound) {
			s.clearCookie(w)
			writeError(w, http.StatusUnauthorized, "logged_out", "Please log in again.")
			return
		}
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		h(w, r, id)
	}
}

func (s *Server) startSession(ctx context.Context, w http.ResponseWriter, studentID int64) error {
	token, hash, err := auth.NewToken()
	if err != nil {
		return err
	}
	if err := s.Store.CreateSession(ctx, hash, studentID, sessionTTL); err != nil {
		return err
	}
	// A session cookie (no expiry): it goes when the browser closes, so the
	// next person on the laptop starts at the welcome screen. The server also
	// ends it after sessionTTL.
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/",
		HttpOnly: true, Secure: s.SecureCookies, SameSite: http.SameSiteStrictMode,
	})
	return nil
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.SecureCookies, SameSite: http.SameSiteStrictMode,
	})
}

// static serves the web app's files with ETags, and index.html for "/".
type static struct {
	fsys  fs.FS
	cache bool
	mu    sync.Mutex
	etags map[string]string
}

func newStatic(fsys fs.FS, cache bool) http.Handler {
	return &static{fsys: fsys, cache: cache, etags: map[string]string{}}
}

func (st *static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	if strings.HasPrefix(path.Base(name), ".") {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(st.fsys, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	etag := st.etag(name, data)
	w.Header().Set("ETag", etag)
	if st.cache {
		w.Header().Set("Cache-Control", "no-cache")
	} else {
		w.Header().Set("Cache-Control", "no-store")
	}
	if ct := contentType(path.Ext(name)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
}

func (st *static) etag(name string, data []byte) string {
	if !st.cache {
		sum := sha256.Sum256(data)
		return `"` + hex.EncodeToString(sum[:8]) + `"`
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if e, ok := st.etags[name]; ok {
		return e
	}
	sum := sha256.Sum256(data)
	e := `"` + hex.EncodeToString(sum[:8]) + `"`
	st.etags[name] = e
	return e
}

// contentType gives the web app's file types without relying on the
// system's MIME table (Windows' registry sometimes calls .js "text/plain",
// which stops ES modules loading).
func contentType(ext string) string {
	switch strings.ToLower(ext) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".ico":
		return "image/x-icon"
	case ".woff2":
		return "font/woff2"
	case ".md", ".txt":
		return "text/plain; charset=utf-8"
	}
	return mime.TypeByExtension(ext)
}
