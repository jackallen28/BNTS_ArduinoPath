package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"

	"arduinopath/internal/arduino"
	"arduinopath/internal/content"
	"arduinopath/internal/serialmon"
	"arduinopath/internal/store"
)

// BoardTools compiles and uploads to real boards (arduino.Tools; tests use a fake).
type BoardTools interface {
	Status() map[string]arduino.FamilyStatus
	Prepare(family string)
	Compile(ctx context.Context, code, fqbn string, props []string, out func(string)) (arduino.CompileResult, error)
	Upload(ctx context.Context, buildPath, fqbn, port string, out func(string)) (string, error)
	Ports(ctx context.Context) ([]arduino.Port, error)
}

// A job is a compile or an upload, run one at a time.
type job struct {
	ID       string                 `json:"id"`
	Kind     string                 `json:"kind"`  // compile | upload
	State    string                 `json:"state"` // queued | compiling | uploading | done | failed
	Board    string                 `json:"board"`
	Port     string                 `json:"port,omitempty"`
	Output   string                 `json:"output"`
	Progress int                    `json:"progress,omitempty"` // upload, 0-100
	Result   *arduino.CompileResult `json:"result,omitempty"`
	Error    string                 `json:"error,omitempty"`
	Finished int64                  `json:"finished,omitempty"`

	code, fqbn string
	props      []string
}

const maxJobOutput = 256 << 10

type jobQueue struct {
	mu    sync.Mutex
	jobs  map[string]*job
	queue chan *job
}

func (s *Server) initJobs() {
	s.jobs = &jobQueue{jobs: map[string]*job{}, queue: make(chan *job, 32)}
	go s.runJobs()
}

func (s *Server) runJobs() {
	for j := range s.jobs.queue {
		s.runJob(j)
	}
}

func (s *Server) setJob(j *job, fn func(*job)) {
	s.jobs.mu.Lock()
	defer s.jobs.mu.Unlock()
	fn(j)
}

var percentRe = regexp.MustCompile(`(\d{1,3}) ?%`)

func (s *Server) runJob(j *job) {
	ctx := context.Background()
	appendOut := func(text string) {
		s.setJob(j, func(j *job) {
			if len(j.Output) < maxJobOutput {
				j.Output += text
			}
			if j.State == "uploading" {
				if m := percentRe.FindAllStringSubmatch(text, -1); m != nil {
					if p, _ := strconv.Atoi(m[len(m)-1][1]); p <= 100 && p > j.Progress {
						j.Progress = p
					}
				}
			}
		})
	}
	finish := func(state, errText string) {
		s.setJob(j, func(j *job) {
			j.State, j.Error, j.Finished = state, errText, time.Now().UnixMilli()
		})
	}
	s.setJob(j, func(j *job) { j.State = "compiling" })
	res, err := s.Tools.Compile(ctx, j.code, j.fqbn, j.props, nil)
	if err != nil {
		finish("failed", err.Error())
		return
	}
	s.setJob(j, func(j *job) { j.Result = &res; j.Output = res.Output })
	if !res.OK {
		finish("failed", "")
		return
	}
	if j.Kind == "compile" {
		finish("done", "")
		return
	}
	if s.Serial != nil {
		s.Serial.Close(j.Port, "Uploading your code...")
	}
	s.setJob(j, func(j *job) { j.State = "uploading"; j.Output = "" })
	if _, err := s.Tools.Upload(ctx, res.BuildPath, j.fqbn, j.Port, appendOut); err != nil {
		finish("failed", err.Error())
		return
	}
	s.setJob(j, func(j *job) { j.Progress = 100 })
	finish("done", "")
}

// forgetOldJobs drops finished jobs after a while.
func (s *Server) forgetOldJobs() {
	s.jobs.mu.Lock()
	defer s.jobs.mu.Unlock()
	cut := time.Now().Add(-15 * time.Minute).UnixMilli()
	for id, j := range s.jobs.jobs {
		if j.Finished != 0 && j.Finished < cut {
			delete(s.jobs.jobs, id)
		}
	}
}

func (s *Server) handleTools(w http.ResponseWriter, r *http.Request) {
	if s.Tools == nil {
		fam := map[string]arduino.FamilyStatus{}
		for _, f := range append([]string{"common"}, arduino.Families...) {
			fam[f] = arduino.FamilyStatus{State: "missing"}
		}
		writeJSON(w, http.StatusOK, map[string]any{"built_in": false, "families": fam})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"built_in": true, "families": s.Tools.Status()})
}

func (s *Server) handlePrepareTools(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Family string `json:"family"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if s.Tools != nil {
		s.Tools.Prepare(req.Family)
	}
	w.WriteHeader(http.StatusNoContent)
}

// boardFQBN finds the FQBN and build properties for a board and setting
// from the content.
func boardFQBN(c *content.Catalogue, boardID, variant string) (string, []string, bool) {
	b, ok := c.Board(boardID)
	if !ok {
		return "", nil, false
	}
	if variant == "" {
		return b.FQBN, b.BuildProperties, true
	}
	for _, v := range b.Variants {
		if v.ID == variant {
			return v.FQBN, b.BuildProperties, true
		}
	}
	return "", nil, false
}

// portRe is what a serial port name looks like (COM3, /dev/ttyUSB0,
// /dev/cu.usbserial-110): never something arduino-cli could read as an option.
var portRe = regexp.MustCompile(`^(COM[0-9]{1,3}|/dev/[A-Za-z0-9._-]{1,60})$`)

func (s *Server) handleNewJob(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Code    string `json:"code"`
			Board   string `json:"board"`
			Variant string `json:"variant"`
			Port    string `json:"port"`
		}
		if !readJSON(w, r, &req) {
			return
		}
		if s.Tools == nil {
			writeError(w, http.StatusServiceUnavailable, "no_tools", "This copy of ArduinoPath can't compile for real boards. Use the simulator, or get the full ArduinoPath.")
			return
		}
		if !store.ValidSketch(req.Code) || req.Code == "" {
			writeError(w, http.StatusBadRequest, "bad_code", "This sketch is too long (the limit is 100 KB).")
			return
		}
		fqbn, props, ok := boardFQBN(s.Catalogue, req.Board, req.Variant)
		if !ok {
			writeError(w, http.StatusBadRequest, "bad_board", "Pick one of the boards on the list.")
			return
		}
		if kind == "upload" && !portRe.MatchString(req.Port) {
			writeError(w, http.StatusBadRequest, "bad_port", "Pick the port your board is plugged into.")
			return
		}
		id := make([]byte, 8)
		rand.Read(id)
		j := &job{ID: hex.EncodeToString(id), Kind: kind, State: "queued", Board: req.Board, Port: req.Port, code: req.Code, fqbn: fqbn, props: props}
		s.forgetOldJobs()
		s.jobs.mu.Lock()
		s.jobs.jobs[j.ID] = j
		s.jobs.mu.Unlock()
		select {
		case s.jobs.queue <- j:
		default:
			s.setJob(j, func(j *job) { j.State, j.Error = "failed", "Too many compiles are waiting. Try again in a moment." })
		}
		writeJSON(w, http.StatusAccepted, map[string]string{"id": j.ID})
	}
}

func (s *Server) handleJob(w http.ResponseWriter, r *http.Request) {
	s.jobs.mu.Lock()
	j, ok := s.jobs.jobs[r.PathValue("id")]
	var snap job
	if ok {
		snap = *j
	}
	s.jobs.mu.Unlock()
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "That compile has finished and been tidied away.")
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) handlePorts(w http.ResponseWriter, r *http.Request) {
	if s.Tools == nil {
		writeJSON(w, http.StatusOK, []arduino.Port{})
		return
	}
	ports, err := s.Tools.Ports(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "ports", "ArduinoPath couldn't look for boards: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ports)
}

// handleSerial streams a port to the Serial Monitor as Server-Sent Events:
// "data" events hold JSON strings of text, a "closed" event says why it ended.
func (s *Server) handleSerial(w http.ResponseWriter, r *http.Request) {
	port := r.URL.Query().Get("port")
	baud, _ := strconv.Atoi(r.URL.Query().Get("baud"))
	if !portRe.MatchString(port) || !serialmon.ValidBaud(baud) {
		writeError(w, http.StatusBadRequest, "bad_port", "Pick a port and a speed.")
		return
	}
	if s.Serial == nil {
		writeError(w, http.StatusServiceUnavailable, "no_serial", "The Serial Monitor isn't available.")
		return
	}
	events, stop, err := s.Serial.Subscribe(port, baud)
	if err != nil {
		writeError(w, http.StatusConflict, "port_busy", "ArduinoPath couldn't open "+port+". Is another program (like the Arduino IDE) using it? Close it and try again.")
		return
	}
	defer stop()
	flusher, _ := w.(http.Flusher)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "event: open\ndata: {}\n\n")
	if flusher != nil {
		flusher.Flush()
	}
	rc := http.NewResponseController(w)
	rc.SetWriteDeadline(time.Time{})
	keepAlive := time.NewTicker(15 * time.Second)
	defer keepAlive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepAlive.C:
			fmt.Fprint(w, ": keep-alive\n\n")
		case e, ok := <-events:
			if !ok {
				return
			}
			if e.Closed {
				msg, _ := json.Marshal(e.Err)
				fmt.Fprintf(w, "event: closed\ndata: %s\n\n", msg)
				if flusher != nil {
					flusher.Flush()
				}
				return
			}
			text, _ := json.Marshal(string(e.Data))
			fmt.Fprintf(w, "event: data\ndata: %s\n\n", text)
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
}

func (s *Server) handleSerialWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Port string `json:"port"`
		Text string `json:"text"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if s.Serial == nil || !portRe.MatchString(req.Port) || len(req.Text) > 4096 {
		writeError(w, http.StatusBadRequest, "bad_port", "That couldn't be sent.")
		return
	}
	if err := s.Serial.Write(req.Port, []byte(req.Text)); err != nil {
		writeError(w, http.StatusConflict, "not_open", "Open the Serial Monitor first.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleSerialClose(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Port string `json:"port"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if s.Serial != nil && portRe.MatchString(req.Port) {
		s.Serial.Close(req.Port, "The Serial Monitor was closed.")
	}
	w.WriteHeader(http.StatusNoContent)
}
