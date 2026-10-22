package server

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"arduinopath/internal/auth"
	"arduinopath/internal/savefile"
	"arduinopath/internal/store"
)

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	school, err := s.Store.Setting(r.Context(), "school", defaultSchool)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"app":     "ArduinoPath",
		"version": s.Version,
		"school":  school,
	})
}

func (s *Server) handleCatalogue(w http.ResponseWriter, r *http.Request) {
	c := s.Catalogue
	boards := make([]json.RawMessage, 0, len(c.Boards))
	for _, b := range c.Boards {
		boards = append(boards, b.Raw)
	}
	projects := make([]any, 0, len(c.Projects))
	for _, p := range c.Projects {
		projects = append(projects, p.ProjectSummary)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tiers":      c.Tiers,
		"parts":      c.Parts,
		"kit":        c.Kit,
		"boards":     boards,
		"projects":   projects,
		"errors":     c.Errors,
		"curriculum": c.Curriculum,
	})
}

func (s *Server) handleProject(w http.ResponseWriter, r *http.Request) {
	p, ok := s.Catalogue.Project(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "That project isn't here.")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(p.Raw)
}

func (s *Server) handleStudents(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListStudents(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type meResponse struct {
	Student  store.Student `json:"student"`
	Settings Settings      `json:"settings"`
}

func (s *Server) me(r *http.Request, id int64) (meResponse, error) {
	st, err := s.Store.GetStudent(r.Context(), id)
	if err != nil {
		return meResponse{}, err
	}
	return meResponse{Student: st, Settings: storedSettings(st.Settings, s.Catalogue)}, nil
}

func (s *Server) handleCreateStudent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Names  []string `json:"names"`
		School string   `json:"school"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	names, err := cleanNames(req.Names)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_names", err.Error())
		return
	}
	school, err := cleanSchool(req.School)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_school", err.Error())
		return
	}
	settings, _ := json.Marshal(defaultSettings(s.Catalogue))
	st, err := s.Store.CreateStudent(r.Context(), store.NewStudent{Names: names, School: school, Settings: settings})
	if errors.Is(err, store.ErrExists) {
		writeError(w, http.StatusConflict, "exists",
			"There's already a profile for "+joinNames(names)+" from "+school+" on this laptop. Is it you? Go back and pick your name.")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := s.startSession(r.Context(), w, st.ID); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.Log.Info("profile created", "student", st.ID)
	me, err := s.me(r, st.ID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, me)
}

// handleLogin opens a profile. There's no password: ArduinoPath runs on the
// student's own laptop, under their own Windows account.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		StudentID int64 `json:"student_id"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if _, err := s.Store.GetStudent(r.Context(), req.StudentID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "That profile isn't here any more. Go back and pick your name.")
		return
	} else if err != nil {
		s.serverError(w, r, err)
		return
	}
	if err := s.startSession(r.Context(), w, req.StudentID); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.Store.Touch(r.Context(), req.StudentID)
	me, err := s.me(r, req.StudentID)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, me)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
		if err := s.Store.DeleteSession(r.Context(), auth.HashToken(c.Value)); err != nil {
			s.serverError(w, r, err)
			return
		}
	}
	s.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, id int64) {
	me, err := s.me(r, id)
	if errors.Is(err, store.ErrNotFound) {
		s.clearCookie(w)
		writeError(w, http.StatusUnauthorized, "logged_out", "Please log in again.")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	s.Store.Touch(r.Context(), id)
	writeJSON(w, http.StatusOK, me)
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request, id int64) {
	var st Settings
	if !readJSON(w, r, &st) {
		return
	}
	if err := checkSettings(st, s.Catalogue); err != nil {
		writeError(w, http.StatusBadRequest, "bad_settings", err.Error())
		return
	}
	data, _ := json.Marshal(st)
	if err := s.Store.UpdateSettings(r.Context(), id, data); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) projectParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	p := r.PathValue("project")
	if !store.ValidProjectID(p) {
		writeError(w, http.StatusBadRequest, "bad_project", "That isn't a project name.")
		return "", false
	}
	return p, true
}

func (s *Server) handleListProgress(w http.ResponseWriter, r *http.Request, id int64) {
	list, err := s.Store.ListProgress(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handlePutProgress(w http.ResponseWriter, r *http.Request, id int64) {
	project, ok := s.projectParam(w, r)
	if !ok {
		return
	}
	var data json.RawMessage
	if !readJSON(w, r, &data) {
		return
	}
	var compact bytes.Buffer
	if json.Compact(&compact, data) != nil || !store.ValidProgress(compact.Bytes()) {
		writeError(w, http.StatusBadRequest, "bad_progress", "That progress couldn't be saved.")
		return
	}
	at, err := s.Store.PutProgress(r.Context(), id, project, compact.Bytes())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"updated_at": at})
}

func (s *Server) handleGetSketch(w http.ResponseWriter, r *http.Request, id int64) {
	project, ok := s.projectParam(w, r)
	if !ok {
		return
	}
	sk, err := s.Store.GetSketch(r.Context(), id, project)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "No code saved yet.")
		return
	}
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

func (s *Server) handlePutSketch(w http.ResponseWriter, r *http.Request, id int64) {
	project, ok := s.projectParam(w, r)
	if !ok {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !store.ValidSketch(req.Code) {
		writeError(w, http.StatusRequestEntityTooLarge, "too_big", "This sketch is too long to save (the limit is 100 KB).")
		return
	}
	at, err := s.Store.PutSketch(r.Context(), id, project, req.Code)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"updated_at": at})
}

func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

var unsafeFileChars = regexp.MustCompile(`[^A-Za-z0-9-]+`)

// saveFileName is <Name>_ArduinoPath_<date>.circuit, with an ASCII fallback
// for browsers that need one.
func saveFileName(names []string, now time.Time) (ascii, utf string) {
	date := now.Format("2006-01-02")
	utf = strings.Join(names, "-") + "_ArduinoPath_" + date + ".circuit"
	a := strings.Trim(unsafeFileChars.ReplaceAllString(strings.Join(names, "-"), "-"), "-")
	if a == "" {
		a = "My"
	}
	return a + "_ArduinoPath_" + date + ".circuit", utf
}

// saveFile makes a student's .circuit file and its name.
func (s *Server) saveFile(r *http.Request, id int64, now time.Time) (data []byte, ascii, utf string, err error) {
	st, err := s.Store.GetStudent(r.Context(), id)
	if err != nil {
		return nil, "", "", err
	}
	sketches, err := s.Store.ListSketches(r.Context(), id)
	if err != nil {
		return nil, "", "", err
	}
	progress, err := s.Store.ListProgress(r.Context(), id)
	if err != nil {
		return nil, "", "", err
	}
	var buf bytes.Buffer
	err = savefile.Write(&buf, savefile.File{
		Manifest: savefile.Manifest{AppVersion: s.Version},
		Profile:  savefile.Profile{Names: st.Names, School: st.School, Settings: st.Settings},
		Sketches: sketches,
		Progress: progress,
	})
	ascii, utf = saveFileName(st.Names, now)
	return buf.Bytes(), ascii, utf, err
}

func attachment(w http.ResponseWriter, contentType, ascii, utf string, size int) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, ascii, url.PathEscape(utf)))
	w.Header().Set("Content-Length", strconv.Itoa(size))
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request, id int64) {
	data, ascii, utf, err := s.saveFile(r, id, time.Now())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	attachment(w, "application/zip", ascii, utf, len(data))
	w.Write(data)
}

// handleExportEveryone downloads one zip holding every profile's .circuit
// file (offered on the WIPE page before wiping).
func (s *Server) handleExportEveryone(w http.ResponseWriter, r *http.Request) {
	list, err := s.Store.ListStudents(r.Context())
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	now := time.Now()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	used := map[string]int{}
	for _, st := range list {
		data, _, utf, err := s.saveFile(r, st.ID, now)
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		name := utf
		if used[strings.ToLower(name)]++; used[strings.ToLower(name)] > 1 {
			name = strings.TrimSuffix(name, ".circuit") + fmt.Sprintf("_%d.circuit", used[strings.ToLower(name)])
		}
		f, err := z.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store, Modified: now})
		if err != nil {
			s.serverError(w, r, err)
			return
		}
		f.Write(data)
	}
	if err := z.Close(); err != nil {
		s.serverError(w, r, err)
		return
	}
	date := now.Format("2006-01-02")
	attachment(w, "application/zip", "Everyone_ArduinoPath_"+date+".zip", "Everyone_ArduinoPath_"+date+".zip", buf.Len())
	w.Write(buf.Bytes())
}

// handleWipe deletes every profile on this laptop and everything they saved
// (the WIPE page). The request must say {"confirm": "WIPE"}.
func (s *Server) handleWipe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Confirm string `json:"confirm"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if req.Confirm != "WIPE" {
		writeError(w, http.StatusBadRequest, "not_confirmed", "Type WIPE in capital letters to wipe this laptop.")
		return
	}
	if err := s.Store.WipeAll(r.Context()); err != nil {
		s.serverError(w, r, err)
		return
	}
	s.Log.Info("wiped every profile")
	s.clearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// handleImport opens a .circuit file. With mode=preview it only says what
// would change; with mode=apply it adds projects that aren't here yet, and
// replaces older copies with newer ones from the file if replace=true.
func (s *Server) handleImport(w http.ResponseWriter, r *http.Request, id int64) {
	mode := r.URL.Query().Get("mode")
	if mode != "preview" && mode != "apply" {
		writeError(w, http.StatusBadRequest, "bad_request", "mode must be preview or apply.")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, savefile.MaxFileBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "too_big", "That file is too big to be an ArduinoPath save file.")
		return
	}
	f, err := savefile.Read(data)
	if errors.Is(err, savefile.ErrNewerVersion) {
		writeError(w, http.StatusBadRequest, "newer_version", "This file was saved by a newer ArduinoPath. Ask your teacher to update this one.")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "not_save_file", "This file can't be opened. Pick a .circuit file saved by ArduinoPath.")
		return
	}
	st, err := s.Store.GetStudent(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	sketches, err := s.Store.ListSketches(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	progress, err := s.Store.ListProgress(r.Context(), id)
	if err != nil {
		s.serverError(w, r, err)
		return
	}
	changes := savefile.Plan(f, sketches, progress)
	if mode == "preview" {
		writeJSON(w, http.StatusOK, map[string]any{
			"names":     f.Profile.Names,
			"school":    f.Profile.School,
			"same_name": store.NameKey(f.Profile.Names, "") == store.NameKey(st.Names, ""),
			"changes":   changes,
		})
		return
	}
	replace := r.URL.Query().Get("replace") == "true"
	pick := map[string]bool{}
	added, replaced := 0, 0
	for _, c := range changes {
		switch {
		case c.Action == "add":
			pick[c.ProjectID] = true
			added++
		case c.Action == "replace" && replace:
			pick[c.ProjectID] = true
			replaced++
		}
	}
	sk, pr := savefile.Pick(f, pick)
	if err := s.Store.ImportWork(r.Context(), id, sk, pr); err != nil {
		s.serverError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"added": added, "replaced": replaced})
}
