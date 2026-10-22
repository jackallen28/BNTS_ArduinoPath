package content

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The circuits in the projects (docs/design.md §2), checked against the
// parts library in ui/parts (made by tools/import_fritzing) on every board
// each project lists. ui/js/circuit/netlist.js does the same checks in the
// browser; this test keeps the content honest in Go's CI too.

type circuitPart struct {
	ID       string                  `json:"id"`
	Type     string                  `json:"type"`
	At       string                  `json:"at"`
	Rotate   int                     `json:"rotate"`
	Offboard *struct{ X, Y float64 } `json:"offboard"`
	When     string                  `json:"when"`
	Step     int                     `json:"step"`
}

type circuitWire struct {
	From, To, When string
	Step           int
}

type projectCircuit struct {
	Pins    map[string]map[string]string `json:"pins"`
	Circuit *struct {
		Breadboard string        `json:"breadboard"`
		Parts      []circuitPart `json:"parts"`
		Wires      []circuitWire `json:"wires"`
	} `json:"circuit"`
	WiringSteps []struct{ Title, Text string } `json:"wiring_steps"`
	Steps       []struct {
		Demo string `json:"demo"`
	} `json:"steps"`
}

type partDef struct {
	Legs      []struct{ ID string } `json:"legs"`
	Footprint [][2]int              `json:"footprint"`
	Buses     [][]string            `json:"buses"`
}

type breadboardDef struct {
	Pitch float64                           `json:"pitch"`
	Holes map[string]struct{ X, Y float64 } `json:"holes"`
}

var holeRe = regexp.MustCompile(`^(?:([A-J])([1-9]|[12][0-9]|30)|([TB][PN])([1-9]|1[0-9]|2[0-5]))$`)

func loadParts(t *testing.T) (map[string]partDef, breadboardDef) {
	t.Helper()
	read := func(path string, v any) {
		data, err := os.ReadFile("../../ui/parts/" + path)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(data, v); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}
	var index struct{ Parts []string }
	read("index.json", &index)
	parts := map[string]partDef{}
	for _, typ := range index.Parts {
		var d partDef
		read(typ+"/part.json", &d)
		parts[typ] = d
	}
	var bb breadboardDef
	read("breadboard/breadboard.json", &bb)
	return parts, bb
}

// legHoles gives the hole each leg of a breadboard part goes in ("" when
// it misses every hole: off the edge or in the centre gap).
func legHoles(p circuitPart, d partDef, bb breadboardDef) map[string]string {
	out := map[string]string{}
	start, ok := bb.Holes[p.At]
	if !ok {
		return out
	}
	for i, leg := range d.Legs {
		dx, dy := float64(d.Footprint[i][0]), float64(d.Footprint[i][1])
		switch ((p.Rotate % 360) + 360) % 360 {
		case 90:
			dx, dy = -dy, dx
		case 180:
			dx, dy = -dx, -dy
		case 270:
			dx, dy = dy, -dx
		}
		x, y := start.X+dx*bb.Pitch, start.Y+dy*bb.Pitch
		out[leg.ID] = ""
		for name, h := range bb.Holes {
			if math.Hypot(h.X-x, h.Y-y) < 3 {
				out[leg.ID] = name
			}
		}
	}
	return out
}

func strip(hole string) string {
	m := holeRe.FindStringSubmatch(hole)
	if m[3] != "" {
		return "rail:" + m[3]
	}
	if m[1] <= "E" {
		return "col:" + m[2] + ":a"
	}
	return "col:" + m[2] + ":f"
}

type unionFind map[string]string

func (u unionFind) find(a string) string {
	if _, ok := u[a]; !ok {
		u[a] = a
	}
	for u[a] != a {
		u[a] = u[u[a]]
		a = u[a]
	}
	return a
}

func (u unionFind) union(a, b string) { u[u.find(a)] = u.find(b) }

// boardPower is the board pin a "board:<name>" wire uses ("" if none).
func boardPower(b Board, name string) string {
	var pw struct {
		Power struct {
			VCC  string   `json:"vcc"`
			Pins []string `json:"pins"`
		} `json:"power"`
	}
	json.Unmarshal(b.Raw, &pw)
	switch {
	case name == "VCC":
		return pw.Power.VCC
	case slices.Contains(pw.Power.Pins, name):
		return name
	case name == "5V" && slices.Contains(pw.Power.Pins, "VIN"):
		return "VIN"
	}
	return ""
}

// resolvePin finds the board pin a "pin:<name>" wire uses: a role through
// the project's pin plan, a bus name, LED_BUILTIN, or a pin code.
func resolvePin(p Project, b Board, name string) (string, bool) {
	var buses struct {
		I2C struct{ SDA, SCL string }            `json:"i2c"`
		SPI struct{ MOSI, MISO, SCK, SS string } `json:"spi"`
		LED struct{ Pin string }                 `json:"led_builtin"`
	}
	json.Unmarshal(b.Raw, &buses)
	code := name
	if c, ok := PinPlan(p, b)[name]; ok {
		code = c
	} else if c := map[string]string{"SDA": buses.I2C.SDA, "SCL": buses.I2C.SCL, "MOSI": buses.SPI.MOSI,
		"MISO": buses.SPI.MISO, "SCK": buses.SPI.SCK, "SS": buses.SPI.SS, "LED_BUILTIN": buses.LED.Pin}[name]; c != "" {
		code = c
	}
	_, ok := b.Pin(code)
	return code, ok
}

func TestProjectCircuits(t *testing.T) {
	c, problems := Load(os.DirFS("../../content"))
	for _, p := range problems {
		t.Error(p)
	}
	parts, bb := loadParts(t)
	placeholder := regexp.MustCompile(`\{\{([^}]*)\}\}`)
	for _, p := range c.Projects {
		var pc projectCircuit
		if err := json.Unmarshal(p.Raw, &pc); err != nil {
			t.Fatal(err)
		}
		if pc.Circuit == nil {
			t.Errorf("%s: no circuit", p.ID)
			continue
		}
		if len(pc.WiringSteps) == 0 {
			t.Errorf("%s: no wiring steps", p.ID)
		}
		// Steps: every wiring screen has something on it, and nothing points past the last one.
		used := map[int]bool{}
		for _, pt := range pc.Circuit.Parts {
			used[pt.Step] = true
		}
		for _, w := range pc.Circuit.Wires {
			used[w.Step] = true
		}
		for s := range used {
			if s < 1 || s > len(pc.WiringSteps) {
				t.Errorf("%s: step %d, but there are %d wiring steps", p.ID, s, len(pc.WiringSteps))
			}
		}
		if len(pc.Circuit.Parts)+len(pc.Circuit.Wires) > 0 {
			for s := 1; s <= len(pc.WiringSteps); s++ {
				if !used[s] {
					t.Errorf("%s: wiring step %d adds nothing", p.ID, s)
				}
			}
		}
		// The wizard's text: a USB safety line first, and only known placeholders.
		for i, ws := range pc.WiringSteps {
			if i == 0 && len(pc.Circuit.Parts) > 0 && !strings.Contains(ws.Text, "Unplug the USB cable") {
				t.Errorf("%s: the first wiring step should say to unplug the USB cable", p.ID)
			}
			for _, m := range placeholder.FindAllStringSubmatch(ws.Text, -1) {
				ph := m[1]
				if ph == "VCC" || ph == "5V" || ph == "3V3" || ph == "board" {
					continue
				}
				if !strings.HasPrefix(ph, "pin:") {
					t.Errorf("%s: unknown placeholder {{%s}} in wiring step %d", p.ID, ph, i+1)
				}
			}
		}
		// Every part's type exists, and it's placed on the breadboard (with a footprint) or off it.
		for _, pt := range pc.Circuit.Parts {
			d, ok := parts[pt.Type]
			switch {
			case !ok:
				t.Errorf("%s: part %s has unknown type %q", p.ID, pt.ID, pt.Type)
			case pt.At != "" && d.Footprint == nil:
				t.Errorf("%s: part %s (%s) has no footprint, so it can't go in hole %s", p.ID, pt.ID, pt.Type, pt.At)
			case pt.At == "" && pt.Offboard == nil:
				t.Errorf("%s: part %s has no place (at or offboard)", p.ID, pt.ID)
			}
		}
		var code strings.Builder
		for _, s := range pc.Steps {
			code.WriteString(s.Demo + "\n")
		}
		for _, b := range c.ProjectBoards(p.ProjectSummary) {
			checkCircuitOnBoard(t, p, pc, b, parts, bb, code.String())
		}
	}
}

func checkCircuitOnBoard(t *testing.T, p Project, pc projectCircuit, b Board, parts map[string]partDef, bb breadboardDef, code string) {
	where := fmt.Sprintf("%s on %s", p.ID, b.ID)
	volt := "5v"
	if boardPower(b, "VCC") == "3V3" {
		volt = "3v3"
	}
	active := func(when string) bool { return when == "" || when == volt }
	uf := unionFind{}
	byID := map[string]circuitPart{}
	holeUse := map[string]string{}
	for _, pt := range pc.Circuit.Parts {
		if !active(pt.When) {
			continue
		}
		byID[pt.ID] = pt
		d, ok := parts[pt.Type]
		if !ok {
			continue
		}
		for _, bus := range d.Buses {
			for _, leg := range bus[1:] {
				uf.union("leg:"+pt.ID+":"+bus[0], "leg:"+pt.ID+":"+leg)
			}
		}
		if pt.At == "" || d.Footprint == nil {
			continue
		}
		for leg, hole := range legHoles(pt, d, bb) {
			if hole == "" {
				t.Errorf("%s: part %s leg %s misses the breadboard's holes (off the edge or in the gap)", where, pt.ID, leg)
				continue
			}
			if other, dup := holeUse[hole]; dup {
				t.Errorf("%s: hole %s has two legs in it (%s and %s:%s)", where, hole, other, pt.ID, leg)
			}
			holeUse[hole] = pt.ID + ":" + leg
			uf.union("leg:"+pt.ID+":"+leg, "strip:"+strip(hole))
		}
	}
	node := func(end string) string {
		switch {
		case holeRe.MatchString(end):
			if pc.Circuit.Breadboard == "none" {
				t.Errorf("%s: wire end %s, but the circuit has no breadboard", where, end)
			}
			return "strip:" + strip(end)
		case strings.HasPrefix(end, "pin:"):
			code, ok := resolvePin(p, b, end[4:])
			if !ok {
				t.Errorf("%s: wire end %s doesn't resolve to a pin on this board", where, end)
				return ""
			}
			return "pin:" + code
		case strings.HasPrefix(end, "board:"):
			name := boardPower(b, end[6:])
			if name == "" {
				t.Errorf("%s: wire end %s: the board has no such power pin", where, end)
				return ""
			}
			return "power:" + name
		case strings.HasPrefix(end, "part:"):
			f := strings.Split(end, ":")
			pt, ok := byID[f[1]]
			if len(f) != 3 || !ok {
				t.Errorf("%s: wire end %s: no such part on this board", where, end)
				return ""
			}
			if !slices.ContainsFunc(parts[pt.Type].Legs, func(l struct{ ID string }) bool { return l.ID == f[2] }) {
				t.Errorf("%s: wire end %s: part %s has no leg %q", where, end, pt.Type, f[2])
				return ""
			}
			return "leg:" + f[1] + ":" + f[2]
		}
		t.Errorf("%s: wire end %q isn't a hole, pin:, board: or part:", where, end)
		return ""
	}
	for _, w := range pc.Circuit.Wires {
		if !active(w.When) {
			continue
		}
		for _, end := range []string{w.From, w.To} {
			if holeRe.MatchString(end) {
				if other, dup := holeUse[end]; dup {
					t.Errorf("%s: a wire goes into hole %s, where %s already is", where, end, other)
				}
			}
		}
		a, z := node(w.From), node(w.To)
		if a != "" && z != "" {
			uf.union(a, z)
		}
	}
	// Short circuits, and 5V on an ESP pin.
	groups := map[string][]string{}
	for n := range uf {
		groups[uf.find(n)] = append(groups[uf.find(n)], n)
	}
	for _, g := range groups {
		var power, pins []string
		for _, n := range g {
			if strings.HasPrefix(n, "power:") {
				power = append(power, n[6:])
			}
			if strings.HasPrefix(n, "pin:") {
				pins = append(pins, n[4:])
			}
		}
		if slices.Contains(power, "GND") && len(power) > 1 {
			t.Errorf("%s: short circuit: %v joined", where, power)
		}
		if volt == "3v3" && (slices.Contains(power, "5V") || slices.Contains(power, "VIN")) && len(pins) > 0 {
			t.Errorf("%s: 5V reaches pin %v", where, pins)
		}
	}
	// Every role the code uses is wired to a part.
	for _, role := range RolesIn(code, PinPlan(p, b)) {
		code, _ := resolvePin(p, b, role)
		pinNode := "pin:" + code
		if _, ok := uf[pinNode]; !ok {
			t.Errorf("%s: the code uses %s (pin %s) but no wire goes to it", where, role, code)
			continue
		}
		reaches := false
		for n := range uf {
			if strings.HasPrefix(n, "leg:") && uf.find(n) == uf.find(pinNode) {
				reaches = true
			}
		}
		if !reaches {
			t.Errorf("%s: %s (pin %s) is wired, but not to a part", where, role, code)
		}
	}
}
