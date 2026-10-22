package main

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The tests use small fixture files in testdata (laid out like the
// fritzing-parts repository) and never touch the network.
func fixtureSource(t *testing.T) *Source {
	t.Helper()
	// A server that fails every request: the tests must not download.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected download of %s", r.URL)
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return &Source{Commit: "test", Repo: "testdata", Client: srv.Client()}
}

func near(a, b float64) bool { return math.Abs(a-b) < 0.01 }

func TestParseFZP(t *testing.T) {
	src := fixtureSource(t)
	data, err := src.Read("core/tiny-led.fzp")
	if err != nil {
		t.Fatal(err)
	}
	m, err := parseFZP(data)
	if err != nil {
		t.Fatal(err)
	}
	if m.Title != "Tiny LED" || m.Properties["family"] != "LED" {
		t.Errorf("title/properties: %q %v", m.Title, m.Properties)
	}
	if m.Images["breadboard"] != "breadboard/tiny-led.svg" || m.Images["schematic"] != "schematic/tiny-led.svg" {
		t.Errorf("images: %v", m.Images)
	}
	c, ok := m.Connector("connector0")
	if !ok || c.Name != "cathode" || c.Description != "cathode pin" {
		t.Fatalf("connector0: %+v", c)
	}
	if v := c.Views["breadboard"]; v.SvgID != "connector0pin" || v.LegID != "connector0leg" {
		t.Errorf("breadboard view: %+v", v)
	}
	if v := c.Views["schematic"]; v.TerminalID != "connector0terminal" {
		t.Errorf("schematic view: %+v", v)
	}
	if len(m.Buses) != 1 || len(m.Buses[0]) != 2 {
		t.Errorf("buses (one-member buses dropped): %v", m.Buses)
	}
	if _, err := parseFZP([]byte(`<svg/>`)); err == nil {
		t.Error("an SVG was accepted as an fzp")
	}
}

func TestSVGUnits(t *testing.T) {
	for _, tc := range []struct {
		svg  string
		w, h float64
	}{
		{`<svg xmlns="http://www.w3.org/2000/svg" width="0.5in" height="1in" viewBox="0 0 5 10"/>`, 50, 100},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="25.4mm" height="12.7mm" viewBox="0 0 254 127"/>`, 100, 50},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="45" viewBox="0 0 90 45"/>`, 100, 50},
		{`<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="36pt"/>`, 100, 50},
	} {
		d, err := loadSVG([]byte(tc.svg))
		if err != nil {
			t.Fatal(err)
		}
		if !near(d.W, tc.w) || !near(d.H, tc.h) {
			t.Errorf("%s: size %v×%v, want %v×%v", tc.svg, d.W, d.H, tc.w, tc.h)
		}
	}
}

func TestTransformsAndBoxes(t *testing.T) {
	root, err := parseXML([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(10 20) scale(2)">
		<g transform="rotate(90)"><rect id="r" x="0" y="0" width="4" height="2"/></g>
		<circle id="c" cx="1" cy="1" r="1"/><path id="p" d="M0 0h4v4z m10 10 a2 2 0 0 1 4 0"/></g></svg>`))
	if err != nil {
		t.Fatal(err)
	}
	r := elementBox(root, root.Find("r"))
	// rotate(90): (x,y) → (-y,x); then ×2, then +(10,20)
	if !near(r.X0, 6) || !near(r.X1, 10) || !near(r.Y0, 20) || !near(r.Y1, 28) {
		t.Errorf("rotated rect box %+v", r)
	}
	c := elementBox(root, root.Find("c"))
	if !near(c.X0, 10) || !near(c.Y1, 24) {
		t.Errorf("circle box %+v", c)
	}
	p := elementBox(root, root.Find("p"))
	// the arc from (10,10) to (14,10) with radius 2 bulges to y=8 (sweep 1 = clockwise = up in SVG? no: down)
	if !near(p.X0, 10) || !near(p.X1, 10+14*2) {
		t.Errorf("path box %+v", p)
	}
	m := parseTransform("matrix(1 0 0 1 5 6) translate(1,1)")
	if x, y := m.Apply(0, 0); !near(x, 6) || !near(y, 7) {
		t.Errorf("matrix·translate: %v %v", x, y)
	}
	if x, y := m.Invert().Apply(6, 7); !near(x, 0) || !near(y, 0) {
		t.Errorf("invert: %v %v", x, y)
	}
}

func TestParsePathCompactNumbers(t *testing.T) {
	cmds := parsePath("M1.5.5l-2-3a1 1 0 011 1zM5,5 6,6")
	ops := ""
	for _, c := range cmds {
		ops += string(c.Op)
	}
	if ops != "MlazML" {
		t.Fatalf("ops %q (%v)", ops, cmds)
	}
	if cmds[0].Args[0] != 1.5 || cmds[0].Args[1] != 0.5 || cmds[1].Args[1] != -3 {
		t.Errorf("numbers: %v", cmds)
	}
	if a := cmds[2].Args; a[3] != 0 || a[4] != 1 || a[5] != 1 || a[6] != 1 {
		t.Errorf("arc flags: %v", a)
	}
	if got := formatPath(parsePath("M 1.23456 -2.0 L 3,4"), 2); got != "M1.23-2L3 4" {
		t.Errorf("formatPath = %q", got)
	}
}

func TestCleanSVG(t *testing.T) {
	root, err := parseXML([]byte(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">
	<sodipodi:namedview/><title>x</title>
	<style>.a{fill:#123456} rect.b{stroke:red} g .skip{fill:blue}</style>
	<g id="unused"><rect class="a b" id="keep" width="1" height="1" style="opacity:.5;cursor:pointer"/>
	<rect width="1" height="1" fill="none"/><circle r="1" fill="url(#gr)" font-family="OCRA"/></g>
	<linearGradient id="gr"><stop style="stop-color:#fff"/></linearGradient>
	<linearGradient id="unusedGrad"/><use href="#missing"/></svg>`))
	if err != nil {
		t.Fatal(err)
	}
	defs, content := cleanSVG(root, cleanOptions{Prefix: "p-", Precision: 2})
	var b strings.Builder
	for _, n := range append(defs, content...) {
		var buf = nodeBytes(n)
		b.Write(buf)
	}
	out := b.String()
	for _, want := range []string{`fill="#123456"`, `stroke="red"`, `opacity=".5"`, `id="p-gr"`, `fill="url(#p-gr)"`, `stop-color="#fff"`, `OCR A`} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %s in %s", want, out)
		}
	}
	for _, bad := range []string{"style", "class", "cursor", "namedview", "<title", "unusedGrad", `id="unused"`, `id="keep"`, "missing", `fill="none"`, "blue"} {
		if strings.Contains(out, bad) {
			t.Errorf("should be gone: %s in %s", bad, out)
		}
	}
	if len(defs) != 1 {
		t.Errorf("defs: %d", len(defs))
	}
}

func TestBuildPartFromFixture(t *testing.T) {
	src := fixtureSource(t)
	spec := PartSpec{
		Type: "tiny-led", Behaviour: "led", FZP: "core/tiny-led.fzp", OnBreadboard: true,
		Legs:  []LegSpec{{"cathode", "cathode", "connector0"}, {"anode", "anode", "connector1"}},
		Tweak: func(b *partBuild) error { recolour(b.BB); return nil },
	}
	p, err := buildPart(src, spec)
	if err != nil {
		t.Fatal(err)
	}
	j := p.JSON
	if j.Art != "fritzing" || j.Fritzing.Breadboard != "svg/core/breadboard/tiny-led.svg" {
		t.Errorf("source: %+v", j.Fritzing)
	}
	// Legs end at y=60 (0.6in): the bounds grow to include them (+ half the stroke).
	if !near(j.BB.Height, 61) || !near(j.BB.Width, 20) {
		t.Errorf("breadboard size %v×%v", j.BB.Width, j.BB.Height)
	}
	if c := j.BB.Connectors["anode"]; !near(c.X, 15) || !near(c.Y, 60) {
		t.Errorf("anode at %+v", c)
	}
	if len(j.Footprint) != 2 || j.Footprint[1] != [2]int{1, 0} {
		t.Errorf("footprint %v", j.Footprint)
	}
	if len(j.Buses) != 1 {
		t.Errorf("buses %v", j.Buses)
	}
	// Schematic: 90 dpi; cathode uses its terminal (x=0.05 → 0.06 units), anode the far end of its pin.
	if c := j.Sch.Connectors["cathode"]; !near(c.X, 0.06) || c.Dir != "left" {
		t.Errorf("cathode (schematic) %+v", c)
	}
	if c := j.Sch.Connectors["anode"]; !near(c.X, 30) || !near(c.Y, 10) || c.Dir != "right" {
		t.Errorf("anode (schematic) %+v", c)
	}
	svg := string(p.BBSVG)
	if !strings.Contains(svg, `fill="currentColor"`) || strings.Contains(svg, "stray") || strings.Contains(svg, "metadata") {
		t.Errorf("breadboard svg: %s", svg)
	}
	if !strings.Contains(svg, `viewBox="0 0 20 61"`) {
		t.Errorf("viewBox: %s", svg)
	}
	if !strings.Contains(svg, `cx="10.1"`) {
		t.Errorf("numbers aren't rounded: %s", svg)
	}
}

func TestFootprintOffGrid(t *testing.T) {
	art := func(x2 float64) func() (*Node, *Node) {
		return func() (*Node, *Node) {
			bb := svgRoot(40, 20, "t").Add(rect(0, 0, 2, 2, "#000", "id", "a"), rect(x2, 0, 2, 2, "#000", "id", "b"))
			return bb, schematicBox("T", []string{"a", "b"}, []string{"A", "B"}, nil, nil)
		}
	}
	spec := PartSpec{Type: "t", Behaviour: "x", OnBreadboard: true, Legs: []LegSpec{{"a", "", "a"}, {"b", "", "b"}}}
	spec.Art = art(20)
	p, err := buildPart(&Source{}, spec)
	if err != nil || p.JSON.Footprint[1] != [2]int{2, 0} {
		t.Fatalf("on the grid: %v %v", err, p)
	}
	spec.Art = art(15)
	if _, err := buildPart(&Source{}, spec); err == nil || !strings.Contains(err.Error(), "grid") {
		t.Errorf("off the grid: %v", err)
	}
}

func TestBreadboardNamesAndArt(t *testing.T) {
	// Own art: every part drawn by CircuitPath loads and has its connectors.
	for _, spec := range partSpecs() {
		if spec.Art == nil {
			continue
		}
		p, err := buildPart(&Source{}, spec)
		if err != nil {
			t.Errorf("%s: %v", spec.Type, err)
			continue
		}
		if len(p.JSON.BB.Connectors) != len(spec.Legs) || len(p.JSON.Sch.Connectors) != len(spec.Legs) {
			t.Errorf("%s: connectors %v", spec.Type, p.JSON.BB.Connectors)
		}
		if spec.OnBreadboard && len(p.JSON.Footprint) != len(spec.Legs) {
			t.Errorf("%s: footprint %v", spec.Type, p.JSON.Footprint)
		}
	}
	if nearestEdge(1, 50, 100, 100) != "left" || nearestEdge(50, 99, 100, 100) != "down" {
		t.Error("nearestEdge")
	}
	if !avrMatch(Connector{Name: "D13/SCK"}, "13", 13) || avrMatch(Connector{Name: "ICSP MISO"}, "12", 12) ||
		!avrMatch(Connector{Name: "A4/SDA"}, "A4", 18) || !avrMatch(Connector{Name: "+3V3"}, "3V3", 0) {
		t.Error("avrMatch")
	}
}
