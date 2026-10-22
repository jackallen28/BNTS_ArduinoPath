package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// BoardSpec says where a board's art comes from.
type BoardSpec struct {
	ID  string // as in content/boards/<id>.json
	FZP string // "" for our own art
	// Match finds the Fritzing connector for a pin code or power name
	// ("5V", "3V3", "GND", "VIN"); several connectors may match (GND).
	Match func(c Connector, code string, number int) bool
	// Art draws our own board; it fills pins (element id → code or power name).
	Art func(pins map[string]string) (bb, sch *Node)
}

// contentBoard is what the importer reads from content/boards/<id>.json.
type contentBoard struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Power struct {
		VCC  string   `json:"vcc"`
		Pins []string `json:"pins"`
	} `json:"power"`
	Pins []struct {
		Code   string `json:"code"`
		Number int    `json:"number"`
		Label  string `json:"label"`
	} `json:"pins"`
}

// BoardJSON is ui/parts/boards/<id>/board.json.
type BoardJSON struct {
	ID       string          `json:"id"`
	Title    string          `json:"title"`
	Art      string          `json:"art"`
	Fritzing *FritzingSource `json:"fritzing,omitempty"`
	Licence  string          `json:"licence"`
	Unit     string          `json:"unit"`
	BB       BoardView       `json:"breadboard"`
	Sch      BoardView       `json:"schematic"`
}

// BoardView is one view of a board: pins by code, power pins by name.
type BoardView struct {
	File   string                `json:"file"`
	Width  float64               `json:"width"`
	Height float64               `json:"height"`
	Pins   map[string]BoardPin   `json:"pins"`
	Power  map[string][]BoardPin `json:"power"`
}

// BoardPin is a pin position and the side of the board it's nearest
// (where a wire should leave).
type BoardPin struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Exit string  `json:"exit"`
}

var tokenSplit = regexp.MustCompile(`[ /,()]+`)

// avrMatch matches Arduino connector names like "D13/SCK", "A4/SDA", "5V".
func avrMatch(c Connector, code string, _ int) bool {
	name := strings.TrimPrefix(strings.TrimSpace(c.Name), "+")
	if strings.HasPrefix(strings.ToUpper(name), "ICSP") {
		return false
	}
	toks := tokenSplit.Split(name, -1)
	first := strings.ToUpper(toks[0])
	switch code {
	case "3V3":
		return first == "3V3" || first == "3.3V"
	case "5V", "GND", "VIN":
		return first == code
	}
	if code[0] >= '0' && code[0] <= '9' {
		return first == "D"+code
	}
	return first == code
}

func boardSpecs() []BoardSpec {
	return []BoardSpec{
		{ID: "uno", FZP: "core/arduino_Uno_Rev3(fix).fzp", Match: avrMatch},
		{ID: "nano", FZP: "core/Arduino Nano3(fix).fzp", Match: avrMatch},
		{ID: "mega", FZP: "core/Arduino_MEGA_2560-Rev3(fix).fzp", Match: avrMatch},
		{ID: "nodemcu", FZP: "core/Amica_NodeMCU_DEVKIT_1.0.fzp", Match: func(c Connector, code string, number int) bool {
			d := c.Description
			switch code {
			case "3V3":
				return strings.HasPrefix(d, "3.3 Volts")
			case "GND":
				return strings.HasPrefix(d, "Ground")
			case "VIN":
				return d == "Vin"
			case "A0":
				return strings.Contains(d, "ADC0")
			}
			for _, t := range tokenSplit.Split(d, -1) {
				if t == fmt.Sprintf("GPIO%d", number) {
					return true
				}
			}
			return false
		}},
		{ID: "d1-mini", FZP: "core/WeMos-D1-mini-male-headers-above_fixed.fzp", Match: func(c Connector, code string, _ int) bool {
			if code == "GND" {
				return c.Name == "G"
			}
			return c.Name == code
		}},
		{ID: "esp32", Art: esp32Art},
		{ID: "esp32-c3", Art: esp32c3Art},
	}
}

func readContentBoard(contentDir, id string) (*contentBoard, error) {
	data, err := os.ReadFile(filepath.Join(contentDir, "boards", id+".json"))
	if err != nil {
		return nil, err
	}
	var b contentBoard
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, fmt.Errorf("boards/%s.json: %w", id, err)
	}
	return &b, nil
}

func buildBoard(src *Source, spec BoardSpec, cb *contentBoard) (*BoardJSON, []byte, []byte, error) {
	b := &partBuild{Sim: map[string]any{}}
	out := &BoardJSON{ID: spec.ID, Unit: "0.01in"}
	// element id (bb) → code / power name, and the schematic element id
	type target struct{ name, conn string }
	var targets []target
	if spec.FZP != "" {
		data, err := src.Read(spec.FZP)
		if err != nil {
			return nil, nil, nil, err
		}
		if b.Module, err = parseFZP(data); err != nil {
			return nil, nil, nil, err
		}
		bbPath := svgPath(spec.FZP, b.Module.Images["breadboard"])
		schPath := svgPath(spec.FZP, b.Module.Images["schematic"])
		if b.BB, err = loadSVGFrom(src, bbPath); err != nil {
			return nil, nil, nil, err
		}
		if b.Sch, err = loadSVGFrom(src, schPath); err != nil {
			return nil, nil, nil, err
		}
		out.Title, out.Art = b.Module.Title, "fritzing"
		out.Licence = "CC BY-SA 3.0 (Fritzing parts library)"
		out.Fritzing = &FritzingSource{Commit: src.Commit, FZP: spec.FZP, Title: b.Module.Title, Breadboard: bbPath, Schematic: schPath}
		names := append([]string{}, cb.Power.Pins...)
		numbers := map[string]int{}
		for _, p := range cb.Pins {
			names = append(names, p.Code)
			numbers[p.Code] = p.Number
		}
		for _, name := range names {
			found := 0
			for _, c := range b.Module.Connectors {
				if spec.Match(c, name, numbers[name]) {
					targets = append(targets, target{name, c.ID})
					found++
					if !isPower(name) {
						break
					}
				}
			}
			if found == 0 {
				return nil, nil, nil, fmt.Errorf("%s: no connector for %q", spec.ID, name)
			}
		}
	} else {
		pins := map[string]string{}
		bb, sch := spec.Art(pins)
		var err error
		if b.BB, err = loadSVG(nodeBytes(bb)); err != nil {
			return nil, nil, nil, err
		}
		if b.Sch, err = loadSVG(nodeBytes(sch)); err != nil {
			return nil, nil, nil, err
		}
		out.Title, out.Art = bb.Get("data-title"), "arduinopath"
		out.Licence = "ArduinoPath's own art (drawn in the Fritzing style)"
		for _, id := range sortedKeys(pins) {
			targets = append(targets, target{pins[id], id})
		}
		want := append([]string{}, cb.Power.Pins...)
		for _, p := range cb.Pins {
			want = append(want, p.Code)
		}
		for _, w := range want {
			ok := false
			for _, t := range targets {
				ok = ok || t.name == w
			}
			if !ok {
				return nil, nil, nil, fmt.Errorf("%s: our art has no pin %q", spec.ID, w)
			}
		}
	}
	b.bounds = b.BB.viewRect()
	bbView := BoardView{File: "breadboard.svg", Pins: map[string]BoardPin{}, Power: map[string][]BoardPin{}}
	schView := BoardView{File: "schematic.svg", Pins: map[string]BoardPin{}, Power: map[string][]BoardPin{}}
	type pt struct {
		name string
		p    Point
		dir  string
	}
	var bbPts, schPts []pt
	for _, t := range targets {
		p, err := b.legPoint(LegSpec{ID: t.name, Conn: t.conn})
		if err != nil {
			return nil, nil, nil, fmt.Errorf("%s pin %s: %w", spec.ID, t.name, err)
		}
		bbPts = append(bbPts, pt{t.name, p, ""})
		sp, dir, err := b.schPoint(LegSpec{ID: t.name, Conn: t.conn})
		if err == nil {
			schPts = append(schPts, pt{t.name, sp, dir})
		}
	}
	bbSVG, shift := b.BB.Output("board-"+spec.ID+"-", b.bounds)
	schBounds := b.Sch.viewRect()
	schSVG, schShift := b.Sch.Output("board-"+spec.ID+"-s-", schBounds)
	w, h := b.bounds.W(), b.bounds.H()
	for _, q := range bbPts {
		x, y := q.p.X+shift.X, q.p.Y+shift.Y
		bp := BoardPin{r2(x), r2(y), nearestEdge(x, y, w, h)}
		addPin(&bbView, q.name, bp)
	}
	for _, q := range schPts {
		addPin(&schView, q.name, BoardPin{r2(q.p.X + schShift.X), r2(q.p.Y + schShift.Y), q.dir})
	}
	bbView.Width, bbView.Height = r2(w), r2(h)
	schView.Width, schView.Height = r2(schBounds.W()), r2(schBounds.H())
	out.BB, out.Sch = bbView, schView
	return out, bbSVG, schSVG, nil
}

func isPower(name string) bool {
	return name == "5V" || name == "3V3" || name == "GND" || name == "VIN"
}

func addPin(v *BoardView, name string, p BoardPin) {
	if isPower(name) {
		v.Power[name] = append(v.Power[name], p)
		return
	}
	if _, dup := v.Pins[name]; !dup {
		v.Pins[name] = p
	}
}

func nearestEdge(x, y, w, h float64) string {
	d := map[string]float64{"up": y, "down": h - y, "left": x, "right": w - x}
	best, bd := "up", math.Inf(1)
	for _, k := range []string{"up", "down", "left", "right"} {
		if d[k] < bd {
			best, bd = k, d[k]
		}
	}
	return best
}
