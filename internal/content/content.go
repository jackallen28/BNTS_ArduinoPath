// Package content loads and checks ArduinoPath's data files: tiers, part
// names, the class kit, boards and projects. Every file is checked against
// its JSON schema (content/schema) and against the other files (a project's
// tier and parts must exist, and so on).
//
// A broken file is skipped and reported, never fatal: a typo in one project
// must not stop the whole class logging in.
package content

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

// Tier is a group of projects on the picker.
type Tier struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Blurb     string `json:"blurb"`
	GoodFirst bool   `json:"good_first,omitempty"`
}

// PartInfo is how a part type is named.
type PartInfo struct {
	Name    string `json:"name"`
	Plural  string `json:"plural"`
	Group   string `json:"group"`
	Needs5V bool   `json:"needs_5v,omitempty"`
}

// Kit is what one class kit holds.
type Kit struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parts       map[string]int `json:"parts"`
}

// Board is a board students can pick. Raw is the whole file, served as is.
type Board struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Family   string         `json:"family"`
	FQBN     string         `json:"fqbn"`
	Optional bool           `json:"optional"`
	Default  bool           `json:"default"`
	Order    int            `json:"order"`
	Variants []BoardVariant `json:"variants,omitempty"`
	// BuildProperties are extra arduino-cli --build-property settings.
	BuildProperties []string        `json:"build_properties,omitempty"`
	Raw             json.RawMessage `json:"-"`
}

// BoardVariant is another setting for the same board, such as the old
// bootloader on Nano clones.
type BoardVariant struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	FQBN  string `json:"fqbn"`
}

// PartUse is one line of a project's parts list.
type PartUse struct {
	Type  string `json:"type"`
	Count int    `json:"count,omitempty"`
	Note  string `json:"note,omitempty"`
}

// ProjectSummary is what the picker needs to show a project card.
type ProjectSummary struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Tier          string    `json:"tier"`
	Order         int       `json:"order,omitempty"`
	Boards        []string  `json:"boards"`
	BoardCount    int       `json:"board_count,omitempty"`
	NeedsInternet bool      `json:"needs_internet,omitempty"`
	Parts         []PartUse `json:"parts"`
	Minutes       int       `json:"minutes"`
	Concepts      []string  `json:"concepts,omitempty"`
	Curriculum    []string  `json:"curriculum,omitempty"`
	Intro         string    `json:"intro"`
	StepCount     int       `json:"step_count"`
}

// Project is a whole project: its summary plus the full file.
type Project struct {
	ProjectSummary
	Raw json.RawMessage
}

// ErrorEntry is one entry of the Coach's errors database (errors.json).
type ErrorEntry struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	Pattern       string   `json:"pattern"`
	Title         string   `json:"title"`
	Explain       string   `json:"explain"`
	Hints         []string `json:"hints"`
	Tech          string   `json:"tech"`
	Example       string   `json:"example,omitempty"`
	ExampleBoard  string   `json:"example_board,omitempty"`
	ExampleOutput string   `json:"example_output,omitempty"`

	re *regexp.Regexp
}

// MatchError finds the first entry of a kind whose pattern matches text,
// and its groups ({1}, {2}...). The web app's Coach does the same (coach.js).
func MatchError(entries []ErrorEntry, kind, text string) (*ErrorEntry, []string) {
	for i := range entries {
		e := &entries[i]
		if e.Kind != kind || e.re == nil {
			continue
		}
		if m := e.re.FindStringSubmatch(text); m != nil {
			return e, m[1:]
		}
	}
	return nil, nil
}

// Curriculum is the curriculum topics projects link to.
type Curriculum struct {
	Name   string            `json:"name"`
	Topics []CurriculumTopic `json:"topics"`
}

// CurriculumTopic is one topic: a level band, a strand and what it covers.
type CurriculumTopic struct {
	ID     string `json:"id"`
	Levels string `json:"levels"`
	Strand string `json:"strand"`
	Text   string `json:"text"`
	Code   string `json:"code,omitempty"`
}

// Catalogue is all the content.
type Catalogue struct {
	Tiers      []Tier              `json:"tiers"`
	Parts      map[string]PartInfo `json:"parts"`
	Kit        Kit                 `json:"kit"`
	Errors     []ErrorEntry        `json:"errors"`
	Curriculum Curriculum          `json:"curriculum"`
	Boards     []Board             `json:"-"`
	Projects   []Project           `json:"-"`
}

// BoardKeywords can be used in a project's boards list instead of board ids.
var BoardKeywords = []string{"all", "avr", "esp", "esp8266", "esp32"}

// Board finds a board by id.
func (c *Catalogue) Board(id string) (Board, bool) {
	i := slices.IndexFunc(c.Boards, func(b Board) bool { return b.ID == id })
	if i < 0 {
		return Board{}, false
	}
	return c.Boards[i], true
}

// DefaultBoard is the board new profiles start with.
func (c *Catalogue) DefaultBoard() string {
	for _, b := range c.Boards {
		if b.Default {
			return b.ID
		}
	}
	if len(c.Boards) > 0 {
		return c.Boards[0].ID
	}
	return ""
}

// Project finds a project by id.
func (c *Catalogue) Project(id string) (Project, bool) {
	i := slices.IndexFunc(c.Projects, func(p Project) bool { return p.ID == id })
	if i < 0 {
		return Project{}, false
	}
	return c.Projects[i], true
}

// Problem is a content file that couldn't be used.
type Problem struct {
	File    string `json:"file"`
	Message string `json:"message"`
}

func (p Problem) Error() string { return p.File + ": " + p.Message }

type loader struct {
	fsys     fs.FS
	schemas  map[string]*jsonschema.Schema
	problems []Problem
}

func (l *loader) problem(file, format string, args ...any) {
	l.problems = append(l.problems, Problem{File: file, Message: fmt.Sprintf(format, args...)})
}

// Load reads every content file from fsys (the content folder). It always
// returns a catalogue, plus a list of files that had problems.
func Load(fsys fs.FS) (*Catalogue, []Problem) {
	l := &loader{fsys: fsys, schemas: map[string]*jsonschema.Schema{}}
	if err := l.compileSchemas(); err != nil {
		l.problem("schema", "%v", err)
		return &Catalogue{Parts: map[string]PartInfo{}, Kit: Kit{Parts: map[string]int{}}}, l.problems
	}
	c := &Catalogue{Parts: map[string]PartInfo{}, Kit: Kit{Name: "Class kit", Parts: map[string]int{}}}

	var tiers struct{ Tiers []Tier }
	if l.read("tiers.json", "tiers", &tiers) {
		c.Tiers = tiers.Tiers
	}
	var parts struct{ Parts map[string]PartInfo }
	if l.read("parts/index.json", "parts", &parts) {
		c.Parts = parts.Parts
	}
	var kit Kit
	if l.read("kit.json", "kit", &kit) {
		for t := range kit.Parts {
			if _, ok := c.Parts[t]; !ok {
				l.problem("kit.json", "unknown part type %q (add it to parts/index.json)", t)
			}
		}
		c.Kit = kit
	}

	var errs struct{ Errors []ErrorEntry }
	if l.read("errors.json", "errors", &errs) {
		seen := map[string]bool{}
		for i := range errs.Errors {
			e := &errs.Errors[i]
			re, err := regexp.Compile("(?i)" + e.Pattern)
			if err != nil {
				l.problem("errors.json", "%s: the pattern doesn't work: %v", e.ID, err)
				continue
			}
			if seen[e.ID] {
				l.problem("errors.json", "%s is in the list twice", e.ID)
			}
			seen[e.ID] = true
			e.re = re
		}
		c.Errors = errs.Errors
	}

	l.read("curriculum.json", "curriculum", &c.Curriculum)

	for _, file := range l.list("boards") {
		var b Board
		raw, ok := l.readRaw(file, "board", &b)
		if !ok {
			continue
		}
		if b.ID+".json" != path.Base(file) {
			l.problem(file, "the id %q must match the file name", b.ID)
			continue
		}
		b.Raw = raw
		c.Boards = append(c.Boards, b)
	}
	sort.SliceStable(c.Boards, func(i, j int) bool { return c.Boards[i].Order < c.Boards[j].Order })
	if defaults := countFunc(c.Boards, func(b Board) bool { return b.Default }); defaults != 1 {
		l.problem("boards", "exactly one board should have \"default\": true (found %d)", defaults)
	}

	for _, file := range l.list("projects") {
		var p ProjectSummary
		var steps struct{ Steps []json.RawMessage }
		raw, ok := l.readRaw(file, "project", &p)
		if !ok {
			continue
		}
		json.Unmarshal(raw, &steps)
		p.StepCount = len(steps.Steps)
		if msg := l.checkProject(c, p, file); msg != "" {
			l.problem(file, "%s", msg)
			continue
		}
		c.Projects = append(c.Projects, Project{ProjectSummary: p, Raw: raw})
	}
	tierOrder := func(id string) int { return slices.IndexFunc(c.Tiers, func(t Tier) bool { return t.ID == id }) }
	sort.SliceStable(c.Projects, func(i, j int) bool {
		a, b := c.Projects[i], c.Projects[j]
		if ta, tb := tierOrder(a.Tier), tierOrder(b.Tier); ta != tb {
			return ta < tb
		}
		if a.Order != b.Order {
			return a.Order < b.Order
		}
		return a.Title < b.Title
	})
	return c, l.problems
}

func (l *loader) checkProject(c *Catalogue, p ProjectSummary, file string) string {
	if p.ID+".json" != path.Base(file) {
		return fmt.Sprintf("the id %q must match the file name", p.ID)
	}
	if slices.ContainsFunc(c.Projects, func(q Project) bool { return q.ID == p.ID }) {
		return fmt.Sprintf("another project already has the id %q", p.ID)
	}
	if p.ID == "freeplay" {
		return "\"freeplay\" is kept for Free Play; pick another id"
	}
	if !slices.ContainsFunc(c.Tiers, func(t Tier) bool { return t.ID == p.Tier }) {
		return fmt.Sprintf("unknown tier %q (see tiers.json)", p.Tier)
	}
	for _, b := range p.Boards {
		if _, ok := c.Board(b); !ok && !slices.Contains(BoardKeywords, b) {
			return fmt.Sprintf("unknown board %q (use a board id or one of %s)", b, strings.Join(BoardKeywords, ", "))
		}
	}
	for _, part := range p.Parts {
		if _, ok := c.Parts[part.Type]; !ok {
			return fmt.Sprintf("unknown part type %q (add it to parts/index.json)", part.Type)
		}
	}
	for _, topic := range p.Curriculum {
		if !slices.ContainsFunc(c.Curriculum.Topics, func(t CurriculumTopic) bool { return t.ID == topic }) {
			return fmt.Sprintf("unknown curriculum topic %q (see curriculum.json)", topic)
		}
	}
	return ""
}

func countFunc[T any](s []T, f func(T) bool) int {
	n := 0
	for _, v := range s {
		if f(v) {
			n++
		}
	}
	return n
}

func (l *loader) compileSchemas() error {
	files, err := fs.Glob(l.fsys, "schema/*.schema.json")
	if err != nil {
		return err
	}
	comp := jsonschema.NewCompiler()
	for _, f := range files {
		data, err := fs.ReadFile(l.fsys, f)
		if err != nil {
			return err
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
		if err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
		if err := comp.AddResource(schemaURL(path.Base(f)), doc); err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
	}
	for _, name := range []string{"tiers", "parts", "kit", "board", "project", "errors", "curriculum"} {
		s, err := comp.Compile(schemaURL(name + ".schema.json"))
		if err != nil {
			return fmt.Errorf("%s.schema.json: %w", name, err)
		}
		l.schemas[name] = s
	}
	return nil
}

// schemaURL names a schema. It is only an identifier: nothing is fetched.
func schemaURL(file string) string { return "file:///arduinopath/content/schema/" + file }

func (l *loader) list(dir string) []string {
	files, _ := fs.Glob(l.fsys, dir+"/*.json")
	return files
}

func (l *loader) read(file, schema string, v any) bool {
	_, ok := l.readRaw(file, schema, v)
	return ok
}

func (l *loader) readRaw(file, schema string, v any) (json.RawMessage, bool) {
	data, err := fs.ReadFile(l.fsys, file)
	if err != nil {
		l.problem(file, "can't read it: %v", err)
		return nil, false
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(data))
	if err != nil {
		l.problem(file, "not valid JSON: %v", err)
		return nil, false
	}
	if err := l.schemas[schema].Validate(inst); err != nil {
		l.problem(file, "%s", strings.TrimSpace(validationMessage(err)))
		return nil, false
	}
	if err := json.Unmarshal(data, v); err != nil {
		l.problem(file, "%v", err)
		return nil, false
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, data); err != nil {
		l.problem(file, "%v", err)
		return nil, false
	}
	return json.RawMessage(compact.Bytes()), true
}

func validationMessage(err error) string {
	if ve, ok := err.(*jsonschema.ValidationError); ok {
		var b strings.Builder
		p := message.NewPrinter(language.English)
		for _, leaf := range leaves(ve) {
			fmt.Fprintf(&b, "at /%s: %s\n", strings.Join(leaf.InstanceLocation, "/"), leaf.ErrorKind.LocalizedString(p))
		}
		return b.String()
	}
	return err.Error()
}

func leaves(ve *jsonschema.ValidationError) []*jsonschema.ValidationError {
	if len(ve.Causes) == 0 {
		return []*jsonschema.ValidationError{ve}
	}
	var out []*jsonschema.ValidationError
	for _, c := range ve.Causes {
		out = append(out, leaves(c)...)
	}
	return out
}
