package main

import (
	"bytes"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Unit is CircuitPath's drawing unit: 0.01 inch, so the breadboard's
// 0.1" pitch is 10 units.
const unitsPerInch = 100.0

// SVGDoc is a source SVG with its mapping to CircuitPath units.
type SVGDoc struct {
	Root *Node
	VB   [4]float64 // the source viewBox
	Base Matrix     // source user space → CircuitPath units
	W, H float64    // size in CircuitPath units
}

// loadSVG parses an SVG and works out its real size.
func loadSVG(data []byte) (*SVGDoc, error) {
	root, err := parseXML(data)
	if err != nil {
		return nil, err
	}
	if root.Tag != "svg" {
		return nil, fmt.Errorf("not an SVG (root is <%s>)", root.Tag)
	}
	wIn, wOK := lengthInches(root.Get("width"))
	hIn, hOK := lengthInches(root.Get("height"))
	vb := parseNumbers(root.Get("viewBox"))
	// Styles become attributes first, so tweaks see (and win over) them.
	inlineCSS(root)
	d := &SVGDoc{Root: root}
	if len(vb) == 4 && vb[2] > 0 && vb[3] > 0 {
		copy(d.VB[:], vb)
	} else {
		if !wOK || !hOK {
			return nil, fmt.Errorf("the SVG has no viewBox and no size")
		}
		// No viewBox: user units are 90 dpi pixels (as Fritzing reads them).
		d.VB = [4]float64{0, 0, wIn * 90, hIn * 90}
	}
	if !wOK || !hOK {
		// Fritzing reads unitless sizes as 90 dpi.
		wIn, hIn = d.VB[2]/90, d.VB[3]/90
	}
	sx, sy := wIn*unitsPerInch/d.VB[2], hIn*unitsPerInch/d.VB[3]
	d.Base = Matrix{sx, 0, 0, sy, -d.VB[0] * sx, -d.VB[1] * sy}
	d.W, d.H = wIn*unitsPerInch, hIn*unitsPerInch
	return d, nil
}

// lengthInches reads "0.5in", "12.7mm", "36pt", "45px" or "45".
func lengthInches(s string) (float64, bool) {
	s = strings.TrimSpace(s)
	if s == "" || strings.HasSuffix(s, "%") {
		return 0, false
	}
	units := map[string]float64{"in": 1, "mm": 1 / 25.4, "cm": 1 / 2.54, "pt": 1.0 / 72, "pc": 1.0 / 6, "px": 1.0 / 90}
	per := 1.0 / 90
	for u, f := range units {
		if strings.HasSuffix(s, u) {
			s, per = strings.TrimSuffix(s, u), f
			break
		}
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v * per, true
}

// Point is a position in CircuitPath units.
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Box returns an element's box in CircuitPath units.
func (d *SVGDoc) Box(id string) (Rect, error) {
	e := d.Root.Find(id)
	if e == nil {
		return Rect{}, fmt.Errorf("no element with id %q", id)
	}
	r := elementBox(d.Root, e)
	if !r.OK {
		return Rect{}, fmt.Errorf("element %q has no size", id)
	}
	var out Rect
	out.addPoint(d.Base.Apply(r.X0, r.Y0))
	out.addPoint(d.Base.Apply(r.X1, r.Y1))
	out.addPoint(d.Base.Apply(r.X0, r.Y1))
	out.addPoint(d.Base.Apply(r.X1, r.Y0))
	return out, nil
}

// Centre returns the centre of an element, in CircuitPath units.
func (d *SVGDoc) Centre(id string) (Point, error) {
	r, err := d.Box(id)
	if err != nil {
		return Point{}, err
	}
	x, y := r.Centre()
	return Point{x, y}, nil
}

// LegEnd returns the far end of a bendable leg (a <line>): the end
// further from the part's body (the middle of the viewBox).
func (d *SVGDoc) LegEnd(id string) (Point, Rect, error) {
	e := d.Root.Find(id)
	if e == nil || e.Tag != "line" {
		return Point{}, Rect{}, fmt.Errorf("no leg line %q", id)
	}
	m, _ := matrixTo(d.Root, e)
	m = d.Base.Mul(m)
	ax, ay := m.Apply(num(e, "x1"), num(e, "y1"))
	bx, by := m.Apply(num(e, "x2"), num(e, "y2"))
	cx, cy := d.W/2, d.H/2
	var box Rect
	sw := num(e, "stroke-width") * math.Abs(d.Base[0]) / 2
	box.addPoint(ax-sw, ay-sw)
	box.addPoint(bx+sw, by+sw)
	box.addPoint(ax+sw, ay+sw)
	box.addPoint(bx-sw, by-sw)
	if math.Hypot(ax-cx, ay-cy) > math.Hypot(bx-cx, by-cy) {
		return Point{ax, ay}, box, nil
	}
	return Point{bx, by}, box, nil
}

// precision is how many decimals keep about 0.002" resolution.
func (d *SVGDoc) precision() int {
	s := math.Abs(d.Base[0])
	p := 0
	for p < 4 && s*math.Pow(10, -float64(p)) > 0.2 {
		p++
	}
	return p
}

// Output writes the cleaned SVG. bounds (in CircuitPath units) may be
// bigger than the viewBox (for legs drawn outside it); the result's
// viewBox starts at 0,0, and shift says how far everything moved.
func (d *SVGDoc) Output(prefix string, bounds Rect) ([]byte, Point) {
	shift := Point{-bounds.X0, -bounds.Y0}
	m := translate(shift.X, shift.Y).Mul(d.Base)
	defs, content := cleanSVG(d.Root, cleanOptions{Prefix: prefix, Precision: d.precision()})
	return assembleSVG(defs, content, m, bounds.W(), bounds.H()), shift
}

func assembleSVG(defs, content []*Node, m Matrix, w, h float64) []byte {
	svg := el("svg", "xmlns", nsSVG,
		"viewBox", fmt.Sprintf("0 0 %s %s", round(w, 2), round(h, 2)),
		"width", round(w/unitsPerInch, 4)+"in", "height", round(h/unitsPerInch, 4)+"in")
	if len(defs) > 0 {
		svg.Add(el("defs").Add(defs...))
	}
	g := el("g")
	if m != identity {
		g.Set("transform", "matrix("+formatList(m[:], 6)+")")
	}
	g.Add(content...)
	svg.Add(g)
	var b bytes.Buffer
	writeXML(&b, svg)
	b.WriteByte('\n')
	return b.Bytes()
}

// viewRect is the viewBox in CircuitPath units.
func (d *SVGDoc) viewRect() Rect {
	return Rect{0, 0, d.W, d.H, true}
}
