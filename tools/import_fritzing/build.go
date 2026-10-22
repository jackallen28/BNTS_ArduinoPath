package main

import (
	"bytes"
	"fmt"
	"math"
	"sort"
	"strings"
)

// PartSpec says how to make one CircuitPath part type.
type PartSpec struct {
	Type      string
	Behaviour string
	FZP       string // path in fritzing-parts; "" for CircuitPath's own art
	Legs      []LegSpec
	// OnBreadboard parts plug into the breadboard: their footprint is
	// worked out from the leg positions (which must sit on the 0.1" grid).
	OnBreadboard bool
	Colors       map[string]string
	Options      map[string]any
	Switch       [][]string // legs joined while a button is pressed
	Notes        string
	// SchScale shrinks a schematic drawn at an odd size (0 = as drawn).
	SchScale float64
	// Tweak changes the source SVGs (tag elements for the renderer,
	// recolour...) and records simulator geometry.
	Tweak func(b *partBuild) error
	// Art draws CircuitPath's own breadboard and schematic SVGs (connector
	// elements have the ids in LegSpec.Conn and LegSpec.SchConn).
	Art func() (bb, sch *Node)
}

// LegSpec is one leg: CircuitPath's id, a description, and the Fritzing
// connector id (or the element id in our own art).
type LegSpec struct {
	ID, Name, Conn string
}

// PartJSON is ui/parts/<type>/part.json.
type PartJSON struct {
	Type      string            `json:"type"`
	Title     string            `json:"title"`
	Art       string            `json:"art"`
	Fritzing  *FritzingSource   `json:"fritzing,omitempty"`
	Licence   string            `json:"licence"`
	Behaviour string            `json:"behaviour"`
	Unit      string            `json:"unit"`
	Legs      []LegJSON         `json:"legs"`
	Footprint [][2]int          `json:"footprint"`
	Buses     [][]string        `json:"buses,omitempty"`
	Switch    [][]string        `json:"switch,omitempty"`
	Colors    map[string]string `json:"colors,omitempty"`
	Options   map[string]any    `json:"options,omitempty"`
	BB        ViewJSON          `json:"breadboard"`
	Sch       ViewJSON          `json:"schematic"`
	Sim       map[string]any    `json:"sim,omitempty"`
}

// FritzingSource records where the art came from.
type FritzingSource struct {
	Commit     string `json:"commit"`
	FZP        string `json:"fzp"`
	Title      string `json:"title"`
	Breadboard string `json:"breadboard"`
	Schematic  string `json:"schematic"`
}

// LegJSON is one leg in part.json.
type LegJSON struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Fritzing string `json:"fritzing,omitempty"`
}

// ViewJSON is one view's file, size and connector positions.
type ViewJSON struct {
	File       string                `json:"file"`
	Width      float64               `json:"width"`
	Height     float64               `json:"height"`
	Connectors map[string]Connector2 `json:"connectors"`
}

// Connector2 is a connector position (and, in schematics, the side its pin points to).
type Connector2 struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Dir string  `json:"dir,omitempty"`
}

// Circle is simulator geometry: a centre and radius.
type Circle struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	R float64 `json:"r"`
}

// Box is simulator geometry: a rectangle.
type Box struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// KeyBox is one key of a keypad.
type KeyBox struct {
	Key string `json:"key"`
	Box
}

// partBuild is the working state while making one part.
type partBuild struct {
	Spec   PartSpec
	Module *Module
	BB     *SVGDoc
	Sch    *SVGDoc
	Sim    map[string]any
	bounds Rect
}

// built is a finished part: its JSON and SVG files.
type built struct {
	JSON          PartJSON
	BBSVG, SchSVG []byte
}

func buildPart(src *Source, spec PartSpec) (*built, error) {
	b := &partBuild{Spec: spec, Sim: map[string]any{}}
	out := PartJSON{Type: spec.Type, Behaviour: spec.Behaviour, Unit: "0.01in",
		Colors: spec.Colors, Options: spec.Options, Switch: spec.Switch}
	var err error
	if spec.FZP != "" {
		data, err := src.Read(spec.FZP)
		if err != nil {
			return nil, err
		}
		if b.Module, err = parseFZP(data); err != nil {
			return nil, fmt.Errorf("%s: %w", spec.FZP, err)
		}
		bbPath := svgPath(spec.FZP, b.Module.Images["breadboard"])
		schPath := svgPath(spec.FZP, b.Module.Images["schematic"])
		if b.BB, err = loadSVGFrom(src, bbPath); err != nil {
			return nil, err
		}
		if b.Sch, err = loadSVGFrom(src, schPath); err != nil {
			return nil, err
		}
		out.Title = b.Module.Title
		out.Art = "fritzing"
		out.Licence = "CC BY-SA 3.0 (Fritzing parts library)"
		out.Fritzing = &FritzingSource{Commit: src.Commit, FZP: spec.FZP, Title: b.Module.Title,
			Breadboard: bbPath, Schematic: schPath}
	} else {
		bb, sch := spec.Art()
		if b.BB, err = loadSVG(nodeBytes(bb)); err != nil {
			return nil, err
		}
		if b.Sch, err = loadSVG(nodeBytes(sch)); err != nil {
			return nil, err
		}
		out.Title = bb.Get("data-title")
		out.Art = "circuitpath"
		out.Licence = "CircuitPath's own art (drawn in the Fritzing style)"
	}
	if spec.SchScale != 0 {
		b.Sch.Base = scale(spec.SchScale, spec.SchScale).Mul(b.Sch.Base)
		b.Sch.W *= spec.SchScale
		b.Sch.H *= spec.SchScale
	}
	b.bounds = b.BB.viewRect()

	// Connector positions.
	bbConn := map[string]Connector2{}
	schConn := map[string]Connector2{}
	for _, leg := range spec.Legs {
		p, err := b.legPoint(leg)
		if err != nil {
			return nil, fmt.Errorf("%s leg %s: %w", spec.Type, leg.ID, err)
		}
		bbConn[leg.ID] = Connector2{X: p.X, Y: p.Y}
		sp, dir, err := b.schPoint(leg)
		if err != nil {
			return nil, fmt.Errorf("%s leg %s (schematic): %w", spec.Type, leg.ID, err)
		}
		schConn[leg.ID] = Connector2{X: sp.X, Y: sp.Y, Dir: dir}
		lj := LegJSON{ID: leg.ID, Name: leg.Name}
		if spec.FZP != "" {
			lj.Fritzing = leg.Conn
		}
		out.Legs = append(out.Legs, lj)
	}
	if spec.Tweak != nil {
		if err := spec.Tweak(b); err != nil {
			return nil, fmt.Errorf("%s: %w", spec.Type, err)
		}
	}

	// Buses (connectors joined inside the part), by leg id.
	if b.Module != nil {
		legOf := map[string]string{}
		for _, l := range spec.Legs {
			legOf[l.Conn] = l.ID
		}
		for _, bus := range b.Module.Buses {
			var legs []string
			for _, c := range bus {
				if id, ok := legOf[c]; ok {
					legs = append(legs, id)
				}
			}
			if len(legs) > 1 {
				out.Buses = append(out.Buses, legs)
			}
		}
	}

	bbSVG, shift := b.BB.Output(spec.Type+"-", b.bounds)
	schBounds := b.Sch.viewRect()
	schSVG, schShift := b.Sch.Output(spec.Type+"-s-", schBounds)
	for id, c := range bbConn {
		bbConn[id] = Connector2{X: r2(c.X + shift.X), Y: r2(c.Y + shift.Y)}
	}
	for id, c := range schConn {
		schConn[id] = Connector2{X: r2(c.X + schShift.X), Y: r2(c.Y + schShift.Y), Dir: c.Dir}
	}
	out.BB = ViewJSON{File: "breadboard.svg", Width: r2(b.bounds.W()), Height: r2(b.bounds.H()), Connectors: bbConn}
	out.Sch = ViewJSON{File: "schematic.svg", Width: r2(schBounds.W()), Height: r2(schBounds.H()), Connectors: schConn}
	if len(b.Sim) > 0 {
		out.Sim = shiftSim(b.Sim, shift)
	}
	if spec.OnBreadboard {
		first := bbConn[spec.Legs[0].ID]
		for _, l := range spec.Legs {
			c := bbConn[l.ID]
			dx, dy := (c.X-first.X)/10, (c.Y-first.Y)/10
			rx, ry := math.Round(dx), math.Round(dy)
			if math.Abs(dx-rx) > 0.15 || math.Abs(dy-ry) > 0.15 {
				return nil, fmt.Errorf("%s: leg %s is not on the 0.1\" grid (%.2f, %.2f holes from the first leg)", spec.Type, l.ID, dx, dy)
			}
			out.Footprint = append(out.Footprint, [2]int{int(rx), int(ry)})
		}
	}
	return &built{JSON: out, BBSVG: bbSVG, SchSVG: schSVG}, nil
}

func loadSVGFrom(src *Source, path string) (*SVGDoc, error) {
	data, err := src.Read(path)
	if err != nil {
		return nil, err
	}
	d, err := loadSVG(data)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return d, nil
}

// legPoint is where a leg connects in the breadboard view: the end of a
// bendable leg, else the connector's terminal point, else its centre.
func (b *partBuild) legPoint(leg LegSpec) (Point, error) {
	ids := []string{leg.Conn}
	if b.Module != nil {
		c, ok := b.Module.Connector(leg.Conn)
		if !ok {
			return Point{}, fmt.Errorf("the part has no connector %q", leg.Conn)
		}
		v := c.Views["breadboard"]
		if v.LegID != "" && b.BB.Root.Find(v.LegID) != nil {
			p, box, err := b.BB.LegEnd(v.LegID)
			if err == nil {
				b.bounds.union(box)
			}
			return p, err
		}
		ids = nil
		if v.TerminalID != "" {
			ids = append(ids, v.TerminalID)
		}
		ids = append(ids, v.SvgID+"terminal", strings.TrimSuffix(v.SvgID, "pin")+"terminal", v.SvgID)
	}
	for _, id := range ids {
		if id != "" && b.BB.Root.Find(id) != nil {
			return b.BB.Centre(id)
		}
	}
	return Point{}, fmt.Errorf("no breadboard element for %v", ids)
}

// schPoint is the outer end of a leg's pin in the schematic view, and the
// side the pin points to.
func (b *partBuild) schPoint(leg LegSpec) (Point, string, error) {
	var pinID, termID string
	if b.Module != nil {
		c, _ := b.Module.Connector(leg.Conn)
		v := c.Views["schematic"]
		pinID, termID = v.SvgID, v.TerminalID
		if termID == "" && b.Sch.Root.Find(pinID+"terminal") == nil {
			termID = strings.TrimSuffix(pinID, "pin") + "terminal"
		} else if termID == "" {
			termID = pinID + "terminal"
		}
	} else {
		pinID, termID = "s-"+leg.Conn, "s-"+leg.Conn+"-end"
		if b.Sch.Root.Find(pinID) == nil {
			pinID, termID = "s-"+leg.ID, "s-"+leg.ID+"-end"
		}
	}
	pin, err := b.Sch.Box(pinID)
	if err != nil {
		return Point{}, "", err
	}
	cx, cy := b.Sch.W/2, b.Sch.H/2
	px, py := pin.Centre()
	var p Point
	if b.Sch.Root.Find(termID) != nil {
		if p, err = b.Sch.Centre(termID); err != nil {
			return Point{}, "", err
		}
	} else if pin.W() >= pin.H() { // a horizontal pin: the end away from the body
		if px < cx {
			p = Point{pin.X0, py}
		} else {
			p = Point{pin.X1, py}
		}
	} else {
		if py < cy {
			p = Point{px, pin.Y0}
		} else {
			p = Point{px, pin.Y1}
		}
	}
	// Which side does the pin stick out of?
	dx, dy := (p.X-cx)/math.Max(b.Sch.W, 1), (p.Y-cy)/math.Max(b.Sch.H, 1)
	dir := "left"
	switch {
	case math.Abs(dx) >= math.Abs(dy) && dx > 0:
		dir = "right"
	case math.Abs(dx) >= math.Abs(dy):
		dir = "left"
	case dy > 0:
		dir = "down"
	default:
		dir = "up"
	}
	return p, dir, nil
}

// tag marks the element with this id (in a view's source) for the renderer.
func tag(d *SVGDoc, id, name string, extra ...string) error {
	e := d.Root.Find(id)
	if e == nil {
		return fmt.Errorf("no element %q to tag", id)
	}
	e.Set("data-cp", name)
	for i := 0; i+1 < len(extra); i += 2 {
		e.Set(extra[i], extra[i+1])
	}
	return nil
}

// localCentre is the centre of an element in its own parent's coordinates
// (what a transform on the element rotates about).
func localCentre(d *SVGDoc, e *Node) (float64, float64) {
	m, _ := matrixTo(d.Root, e)
	if t := e.Get("transform"); t != "" {
		m = m.Mul(parseTransform(t).Invert())
	}
	r := elementBox(d.Root, e)
	x, y := r.Centre()
	return m.Invert().Apply(x, y)
}

func shiftSim(v map[string]any, s Point) map[string]any {
	out := map[string]any{}
	for k, x := range v {
		out[k] = shiftAny(x, s)
	}
	return out
}

func shiftAny(x any, s Point) any {
	switch t := x.(type) {
	case Point:
		return Point{r2(t.X + s.X), r2(t.Y + s.Y)}
	case Circle:
		return Circle{r2(t.X + s.X), r2(t.Y + s.Y), r2(t.R)}
	case Box:
		return Box{r2(t.X + s.X), r2(t.Y + s.Y), r2(t.W), r2(t.H)}
	case []Point:
		out := make([]Point, len(t))
		for i, p := range t {
			out[i] = shiftAny(p, s).(Point)
		}
		return out
	case []KeyBox:
		out := make([]KeyBox, len(t))
		for i, k := range t {
			out[i] = KeyBox{k.Key, shiftAny(k.Box, s).(Box)}
		}
		return out
	case map[string]any:
		return shiftSim(t, s)
	}
	return x
}

func nodeBytes(n *Node) []byte {
	var b bytes.Buffer
	writeXML(&b, n)
	return b.Bytes()
}

// sortedKeys returns a map's keys in order.
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
