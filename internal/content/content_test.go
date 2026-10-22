package content

import (
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

// The real content folder must load with no problems at all.
func TestRealContentIsValid(t *testing.T) {
	c, problems := Load(os.DirFS("../../content"))
	for _, p := range problems {
		t.Error(p)
	}
	if len(c.Tiers) == 0 || len(c.Boards) == 0 || len(c.Projects) == 0 {
		t.Fatalf("loaded %d tiers, %d boards, %d projects", len(c.Tiers), len(c.Boards), len(c.Projects))
	}
	if c.DefaultBoard() != "uno" {
		t.Errorf("default board = %q, want uno", c.DefaultBoard())
	}
	if c.Projects[0].Tier != "getting-started" {
		t.Errorf("first project is in tier %q; projects should be in tier order", c.Projects[0].Tier)
	}
	for _, p := range c.Projects {
		for _, part := range p.Parts {
			if _, ok := c.Kit.Parts[part.Type]; !ok {
				t.Errorf("%s: the default kit has no %s", p.ID, part.Type)
			}
		}
	}
}

func schemaFiles(t *testing.T) fstest.MapFS {
	t.Helper()
	m := fstest.MapFS{}
	entries, err := os.ReadDir("../../content/schema")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		data, err := os.ReadFile("../../content/schema/" + e.Name())
		if err != nil {
			t.Fatal(err)
		}
		m["schema/"+e.Name()] = &fstest.MapFile{Data: data}
	}
	m["tiers.json"] = &fstest.MapFile{Data: []byte(`{"tiers":[{"id":"getting-started","name":"Getting Started","blurb":"x"}]}`)}
	m["parts/index.json"] = &fstest.MapFile{Data: []byte(`{"parts":{"led":{"name":"LED","plural":"LEDs","group":"output"}}}`)}
	m["kit.json"] = &fstest.MapFile{Data: []byte(`{"name":"Kit","parts":{"led":5}}`)}
	uno, err := os.ReadFile("../../content/boards/uno.json")
	if err != nil {
		t.Fatal(err)
	}
	m["boards/uno.json"] = &fstest.MapFile{Data: uno}
	errs, err := os.ReadFile("../../content/errors.json")
	if err != nil {
		t.Fatal(err)
	}
	m["errors.json"] = &fstest.MapFile{Data: errs}
	cur, err := os.ReadFile("../../content/curriculum.json")
	if err != nil {
		t.Fatal(err)
	}
	m["curriculum.json"] = &fstest.MapFile{Data: cur}
	return m
}

func TestBrokenFilesAreReportedNotFatal(t *testing.T) {
	m := schemaFiles(t)
	good := `{"id":"blink","title":"Blink","tier":"getting-started","boards":["all"],"parts":[{"type":"led"}],"minutes":30,"intro":"Blink.","steps":[]}`
	m["projects/blink.json"] = &fstest.MapFile{Data: []byte(good)}
	cases := map[string]string{
		"projects/typo.json":      `{"id":"typo",`,
		"projects/wrongname.json": strings.Replace(good, `"blink"`, `"other"`, 1),
		"projects/badtier.json":   strings.NewReplacer(`"blink"`, `"badtier"`, `getting-started`, `space`).Replace(good),
		"projects/badpart.json":   strings.NewReplacer(`"blink"`, `"badpart"`, `"led"`, `"laser"`).Replace(good),
		"projects/badboard.json":  strings.NewReplacer(`"blink"`, `"badboard"`, `"all"`, `"pico"`).Replace(good),
		"projects/extra.json":     strings.NewReplacer(`"blink"`, `"extra"`, `"steps"`, `"colour":"red","steps"`).Replace(good),
		"projects/nointro.json":   strings.NewReplacer(`"blink"`, `"nointro"`, `"intro":"Blink.",`, ``).Replace(good),
		"projects/freeplay.json":  strings.Replace(good, `"blink"`, `"freeplay"`, 1),
	}
	for file, data := range cases {
		m[file] = &fstest.MapFile{Data: []byte(data)}
	}
	c, problems := Load(m)
	for _, p := range problems {
		t.Log(p)
	}
	if len(c.Projects) != 1 || c.Projects[0].ID != "blink" {
		t.Fatalf("projects = %v, want just blink", c.Projects)
	}
	bad := map[string]bool{}
	for _, p := range problems {
		bad[p.File] = true
	}
	for file := range cases {
		if !bad[file] {
			t.Errorf("%s: no problem reported", file)
		}
	}
	if len(problems) != len(cases) {
		t.Errorf("problems = %v", problems)
	}
}

func TestErrorsDatabase(t *testing.T) {
	c, problems := Load(os.DirFS("../../content"))
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	if len(c.Errors) < 20 {
		t.Fatalf("only %d errors", len(c.Errors))
	}
	last := map[string]string{}
	for _, e := range c.Errors {
		last[e.Kind] = e.ID
		if e.Example == "" && e.ExampleOutput == "" {
			t.Errorf("%s has no example", e.ID)
		}
		if e.ExampleOutput != "" {
			got, _ := MatchError(c.Errors, e.Kind, e.ExampleOutput)
			if got == nil || got.ID != e.ID {
				t.Errorf("%s's example output maps to %v", e.ID, got)
			}
		}
	}
	// Each kind ends with a catch-all that matches anything.
	for kind, id := range last {
		got, _ := MatchError(c.Errors, kind, "zzz an unknown message zzz")
		if got == nil || got.ID != id {
			t.Errorf("an unknown %s message maps to %v, want the catch-all %s", kind, got, id)
		}
	}
	// Groups fill in the text.
	e, groups := MatchError(c.Errors, "compile", "'digitalwrite' was not declared in this scope\nsuggested alternative: 'digitalWrite'")
	if e == nil || e.ID != "misspelt-function" || len(groups) != 2 || groups[1] != "digitalWrite" {
		t.Fatalf("misspelt = %v %v", e, groups)
	}
}
