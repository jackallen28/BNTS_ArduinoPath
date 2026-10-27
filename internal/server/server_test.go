package server

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"arduinopath/internal/content"
	"arduinopath/internal/store"
)

type env struct {
	t     *testing.T
	ts    *httptest.Server
	store *store.Store
}

func newEnv(t *testing.T, opts ...func(*Server)) *env {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "cp.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	cat, problems := content.Load(os.DirFS("../../content"))
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	s := &Server{
		Store:     st,
		Catalogue: cat,
		UI:        fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>ArduinoPath</title>")}, "js/main.js": {Data: []byte("export {}")}},
		Version:   "test",
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	for _, o := range opts {
		o(s)
	}
	ts := httptest.NewTLSServer(s.Handler())
	t.Cleanup(ts.Close)
	return &env{t: t, ts: ts, store: st}
}

// client is one browser, with its own cookies.
type client struct {
	e *env
	c *http.Client
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	c := e.ts.Client()
	c = &http.Client{Transport: c.Transport, Jar: jar}
	return &client{e: e, c: c}
}

func (c *client) do(method, path string, body any, headers ...string) (*http.Response, []byte) {
	c.e.t.Helper()
	var rd io.Reader
	ct := "application/json"
	switch b := body.(type) {
	case nil:
	case []byte:
		rd, ct = bytes.NewReader(b), "application/octet-stream"
	case string:
		rd = strings.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		rd = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, c.e.ts.URL+path, rd)
	if rd != nil {
		req.Header.Set("Content-Type", ct)
	}
	if method != http.MethodGet {
		req.Header.Set("X-ArduinoPath", "1")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		if headers[i+1] == "" {
			req.Header.Del(headers[i])
		} else {
			req.Header.Set(headers[i], headers[i+1])
		}
	}
	res, err := c.c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	return res, data
}

func (c *client) want(status int, method, path string, body any, headers ...string) []byte {
	c.e.t.Helper()
	res, data := c.do(method, path, body, headers...)
	if res.StatusCode != status {
		c.e.t.Fatalf("%s %s = %d %s, want %d", method, path, res.StatusCode, data, status)
	}
	return data
}

func (c *client) signUp(names ...string) meResponse {
	c.e.t.Helper()
	var me meResponse
	data := c.want(http.StatusCreated, "POST", "/api/students", map[string]any{
		"names": names, "school": "Eltham High",
	})
	json.Unmarshal(data, &me)
	return me
}

func TestInfoCatalogueAndStatic(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	var info map[string]any
	json.Unmarshal(c.want(200, "GET", "/api/info", nil), &info)
	if info["school"] != defaultSchool || info["app"] != "ArduinoPath" {
		t.Fatalf("info = %v", info)
	}
	var cat struct {
		Projects []map[string]any
		Boards   []map[string]any
	}
	json.Unmarshal(c.want(200, "GET", "/api/catalogue", nil), &cat)
	if len(cat.Projects) < 20 || len(cat.Boards) < 4 || cat.Projects[0]["steps"] != nil {
		t.Fatalf("catalogue: %d projects, %d boards", len(cat.Projects), len(cat.Boards))
	}
	c.want(200, "GET", "/api/projects/blink-traffic-lights", nil)
	c.want(404, "GET", "/api/projects/nope", nil)
	c.want(404, "GET", "/api/nothing-here", nil)

	res, body := c.do("GET", "/", nil)
	if res.StatusCode != 200 || !strings.Contains(string(body), "ArduinoPath") {
		t.Fatalf("GET / = %d %s", res.StatusCode, body)
	}
	if csp := res.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("CSP = %q", csp)
	}
	res, _ = c.do("GET", "/js/main.js", nil)
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("main.js Content-Type = %q", ct)
	}
	c.want(404, "GET", "/missing.js", nil)
}

func TestSignUpAndPickYourName(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	if string(c.want(200, "GET", "/api/students", nil)) != "[]\n" {
		t.Fatal("expected no profiles")
	}
	me := c.signUp("mia", "Leo")
	if me.Student.Names[0] != "Mia" || me.Settings.Board != "uno" || me.Settings.HelpLevel != "" || !me.Settings.Nudges {
		t.Fatalf("me = %+v", me)
	}
	c.want(200, "GET", "/api/me", nil)
	var list []store.StudentSummary
	json.Unmarshal(c.want(200, "GET", "/api/students", nil), &list)
	if len(list) != 1 || list[0].Names[1] != "Leo" {
		t.Fatalf("students = %+v", list)
	}
	// The same names at the same school can't be made twice.
	c2 := e.client()
	c2.want(409, "POST", "/api/students", map[string]any{"names": []string{"Leo", "Mia"}, "school": "eltham high"})

	// Picking your name logs you in (no password on your own laptop).
	c2.want(401, "GET", "/api/me", nil)
	c2.want(200, "POST", "/api/login", map[string]any{"student_id": list[0].ID})
	c2.want(200, "GET", "/api/me", nil)
	c2.want(404, "POST", "/api/login", map[string]any{"student_id": 999})
	c2.want(204, "POST", "/api/logout", nil)
	c2.want(401, "GET", "/api/me", nil)
}

func TestSignUpChecksInput(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	bad := []map[string]any{
		{"names": []string{}, "school": "Eltham High"},
		{"names": []string{"A", "B", "C", "D", "E"}, "school": "X"},
		{"names": []string{"<script>"}, "school": "X"},
		{"names": []string{"Ava", "ava"}, "school": "X"},
		{"names": []string{"Ava"}, "school": ""},
		{"names": []string{"Ava"}, "school": "X", "surname": "Smith"},
	}
	for _, b := range bad {
		if res, data := c.do("POST", "/api/students", b); res.StatusCode != 400 {
			t.Errorf("%v: %d %s", b, res.StatusCode, data)
		}
	}
	if res, _ := c.do("POST", "/api/students", "{not json"); res.StatusCode != 400 {
		t.Errorf("bad JSON = %d", res.StatusCode)
	}
	c.want(201, "POST", "/api/students", map[string]any{"names": []string{"Ava"}, "school": "Eltham High"})
}

func TestCrossSiteWritesAreBlocked(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	body := map[string]any{"names": []string{"Ava"}, "school": "X"}
	c.want(403, "POST", "/api/students", body, "X-ArduinoPath", "")
	c.want(403, "POST", "/api/students", body, "Sec-Fetch-Site", "cross-site")
	c.want(403, "POST", "/api/wipe", map[string]any{"confirm": "WIPE"}, "Sec-Fetch-Site", "cross-site")
	c.want(201, "POST", "/api/students", body, "Sec-Fetch-Site", "same-origin")
}

func TestOnlyThisComputerIsAnswered(t *testing.T) {
	cat, _ := content.Load(os.DirFS("../../content"))
	s := &Server{
		Catalogue: cat,
		UI:        fstest.MapFS{"index.html": {Data: []byte("hi")}},
		Hosts:     []string{"localhost", "127.0.0.1"},
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	h := s.Handler()
	for host, want := range map[string]int{
		"localhost:47820": 200, "127.0.0.1:47820": 200, "LOCALHOST": 200,
		"evil.example:47820": 421, "arduinopath.local": 421, "": 421,
	} {
		req := httptest.NewRequest("GET", "/", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("Host %q = %d, want %d", host, rec.Code, want)
		}
	}
}

func TestWipe(t *testing.T) {
	e := newEnv(t)
	ava, ben := e.client(), e.client()
	ava.signUp("Ava")
	ben.signUp("Ben")
	ava.want(200, "PUT", "/api/me/sketches/freeplay", map[string]any{"code": "// Ava's robot"})

	// Save everyone's work first: one zip with a .circuit file each.
	res, data := e.client().do("GET", "/api/everyone/export", nil)
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Disposition"), "Everyone_ArduinoPath_") {
		t.Fatalf("everyone export = %d %v", res.StatusCode, res.Header)
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(z.File) != 2 || !strings.HasPrefix(z.File[0].Name, "Ava_ArduinoPath_") {
		t.Fatalf("zip = %v, %v", z, err)
	}

	c := e.client()
	c.want(400, "POST", "/api/wipe", map[string]any{"confirm": "wipe"})
	c.want(400, "POST", "/api/wipe", map[string]any{})
	if list, _ := e.store.ListStudents(context.Background()); len(list) != 2 {
		t.Fatal("wiped without WIPE")
	}
	c.want(204, "POST", "/api/wipe", map[string]any{"confirm": "WIPE"})
	if string(c.want(200, "GET", "/api/students", nil)) != "[]\n" {
		t.Fatal("profiles left after the wipe")
	}
	ava.want(401, "GET", "/api/me", nil)
}

func TestSettings(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.signUp("Ava")
	c.want(200, "PUT", "/api/me/settings", map[string]any{"help_level": "advanced", "board": "esp32", "nudges": false})
	var me meResponse
	json.Unmarshal(c.want(200, "GET", "/api/me", nil), &me)
	if me.Settings.HelpLevel != "advanced" || me.Settings.Board != "esp32" || me.Settings.Nudges {
		t.Fatalf("settings = %+v", me.Settings)
	}
	c.want(200, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "nano", "nudges": true, "board_variant": "old-bootloader"})
	c.want(400, "PUT", "/api/me/settings", map[string]any{"help_level": "expert", "board": "uno", "nudges": true})
	c.want(400, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "pico", "nudges": true})
	c.want(400, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "uno", "nudges": true, "board_variant": "old-bootloader"})
	c.want(400, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "uno", "theme": "dark"})
	c.want(200, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "uno", "nudges": true, "coding": "blocks"})
	c.want(400, "PUT", "/api/me/settings", map[string]any{"help_level": "beginner", "board": "uno", "nudges": true, "coding": "scratch"})
}

func TestAutosaveIsPrivate(t *testing.T) {
	e := newEnv(t)
	ava, ben := e.client(), e.client()
	ava.signUp("Ava")
	ben.signUp("Ben")
	code := "void setup() {\n  pinMode(13, OUTPUT);\n}\n"
	ava.want(200, "PUT", "/api/me/sketches/blink-traffic-lights", map[string]any{"code": code})
	var sk store.Sketch
	json.Unmarshal(ava.want(200, "GET", "/api/me/sketches/blink-traffic-lights", nil), &sk)
	if sk.Code != code || sk.UpdatedAt == 0 {
		t.Fatalf("sketch = %+v", sk)
	}
	ben.want(404, "GET", "/api/me/sketches/blink-traffic-lights", nil)
	e.client().want(401, "GET", "/api/me/sketches/blink-traffic-lights", nil)

	ava.want(400, "PUT", "/api/me/sketches/..%2Fx", map[string]any{"code": "x"})
	ava.want(400, "PUT", "/api/me/sketches/Bad_Name", map[string]any{"code": "x"})
	ava.want(413, "PUT", "/api/me/sketches/freeplay", map[string]any{"code": strings.Repeat("a", store.MaxSketchBytes+1)})

	ava.want(200, "PUT", "/api/me/progress/blink-traffic-lights", map[string]any{"step": 3, "stars": 2})
	ava.want(400, "PUT", "/api/me/progress/blink-traffic-lights", []int{1, 2})
	var prog []store.Progress
	json.Unmarshal(ava.want(200, "GET", "/api/me/progress", nil), &prog)
	if len(prog) != 1 || string(prog[0].Data) != `{"stars":2,"step":3}` {
		t.Fatalf("progress = %+v", prog)
	}
	json.Unmarshal(ben.want(200, "GET", "/api/me/progress", nil), &prog)
	if len(prog) != 0 {
		t.Fatalf("Ben sees progress %+v", prog)
	}
}

func TestSaveMyWorkAndOpenMyWork(t *testing.T) {
	e := newEnv(t)
	ava := e.client()
	ava.signUp("Ava", "Zoë")
	ava.want(200, "PUT", "/api/me/sketches/freeplay", map[string]any{"code": "// Ava's"})
	ava.want(200, "PUT", "/api/me/sketches/blink-traffic-lights", map[string]any{"code": "// blink"})
	ava.want(200, "PUT", "/api/me/progress/blink-traffic-lights", map[string]any{"step": 2})

	res, file := ava.do("GET", "/api/me/export", nil)
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("export = %d", res.StatusCode)
	}
	if cd := res.Header.Get("Content-Disposition"); !strings.Contains(cd, `filename="Ava-Zo-_ArduinoPath_`) && !strings.Contains(cd, `filename="Ava-Zo_ArduinoPath_`) {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if _, err := zip.NewReader(bytes.NewReader(file), int64(len(file))); err != nil {
		t.Fatal(err)
	}

	// Ben has an older blink of his own.
	ben := e.client()
	ben.signUp("Ben")
	ben.want(200, "PUT", "/api/me/sketches/blink-traffic-lights", map[string]any{"code": "// Ben's newer blink"})

	var preview struct {
		SameName bool `json:"same_name"`
		Changes  []struct {
			ProjectID string `json:"project_id"`
			Action    string
		}
	}
	json.Unmarshal(ben.want(200, "POST", "/api/me/import?mode=preview", file), &preview)
	actions := map[string]string{}
	for _, c := range preview.Changes {
		actions[c.ProjectID] = c.Action
	}
	if preview.SameName || actions["freeplay"] != "add" || actions["blink-traffic-lights"] != "keep" {
		t.Fatalf("preview = %+v", preview)
	}
	var applied map[string]int
	json.Unmarshal(ben.want(200, "POST", "/api/me/import?mode=apply&replace=true", file), &applied)
	if applied["added"] != 1 || applied["replaced"] != 0 {
		t.Fatalf("applied = %v", applied)
	}
	var sk store.Sketch
	json.Unmarshal(ben.want(200, "GET", "/api/me/sketches/blink-traffic-lights", nil), &sk)
	if sk.Code != "// Ben's newer blink" {
		t.Fatal("an older copy replaced newer work")
	}
	json.Unmarshal(ben.want(200, "GET", "/api/me/sketches/freeplay", nil), &sk)
	if sk.Code != "// Ava's" {
		t.Fatal("Free Play wasn't added")
	}

	ben.want(400, "POST", "/api/me/import?mode=preview", []byte("not a zip"))
	ben.want(400, "POST", "/api/me/import?mode=sideways", file)
	ben.want(413, "POST", "/api/me/import?mode=preview", make([]byte, 9<<20))
}

func TestStoredSettingsAreLenient(t *testing.T) {
	cat, _ := content.Load(os.DirFS("../../content"))
	cases := map[string]Settings{
		`{"help_level":"advanced","board":"esp32","nudges":false,"theme":"from a newer version"}`: {HelpLevel: "advanced", Board: "esp32"},
		`{"help_level":"advanced","board":"a-removed-board","nudges":true}`:                       {HelpLevel: "advanced", Board: "uno", Nudges: true},
		`{"help_level":"guru","board":"nano","board_variant":"nope","nudges":true}`:               {Board: "nano", Nudges: true},
		`not json`: {Board: "uno", Nudges: true},
	}
	for in, want := range cases {
		if got := storedSettings([]byte(in), cat); got != want {
			t.Errorf("%s: got %+v, want %+v", in, got, want)
		}
	}
}

func TestNameCleaning(t *testing.T) {
	cases := map[string]string{
		"mia":                             "Mia",
		"  mary   jane ":                  "Mary Jane",
		"O'Brien":                         "O'Brien",
		"zoë":                             "Zoë",
		"McDonald":                        "McDonald",
		"Ngọc":                            "Ngọc",
		"123":                             "",
		"\u0301\u0301":                    "",
		"<b>":                             "",
		"":                                "",
		"abcdefghijklmnopqrstuvwxyzabcde": "",
	}
	for in, want := range cases {
		if got := cleanName(in); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}
