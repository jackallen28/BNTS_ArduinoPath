package main

import (
	"math"
	"strconv"
	"strings"
)

// Matrix is an SVG transform: [a b c d e f] maps (x, y) to
// (a·x + c·y + e, b·x + d·y + f).
type Matrix [6]float64

var identity = Matrix{1, 0, 0, 1, 0, 0}

// Mul returns m·n (apply n first, then m).
func (m Matrix) Mul(n Matrix) Matrix {
	return Matrix{
		m[0]*n[0] + m[2]*n[1],
		m[1]*n[0] + m[3]*n[1],
		m[0]*n[2] + m[2]*n[3],
		m[1]*n[2] + m[3]*n[3],
		m[0]*n[4] + m[2]*n[5] + m[4],
		m[1]*n[4] + m[3]*n[5] + m[5],
	}
}

// Apply transforms a point.
func (m Matrix) Apply(x, y float64) (float64, float64) {
	return m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]
}

// Invert returns the inverse matrix.
func (m Matrix) Invert() Matrix {
	det := m[0]*m[3] - m[1]*m[2]
	if det == 0 {
		return identity
	}
	return Matrix{
		m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
		(m[2]*m[5] - m[3]*m[4]) / det, (m[1]*m[4] - m[0]*m[5]) / det,
	}
}

func translate(x, y float64) Matrix { return Matrix{1, 0, 0, 1, x, y} }
func scale(sx, sy float64) Matrix   { return Matrix{sx, 0, 0, sy, 0, 0} }
func rotate(deg float64) Matrix {
	r := deg * math.Pi / 180
	c, s := math.Cos(r), math.Sin(r)
	return Matrix{c, s, -s, c, 0, 0}
}

// parseTransform reads an SVG transform attribute.
func parseTransform(s string) Matrix {
	m := identity
	for {
		s = strings.TrimLeft(s, " ,\t\n\r")
		open := strings.IndexByte(s, '(')
		end := strings.IndexByte(s, ')')
		if open < 0 || end < open {
			return m
		}
		name := strings.TrimSpace(s[:open])
		args := parseNumbers(s[open+1 : end])
		s = s[end+1:]
		arg := func(i int, def float64) float64 {
			if i < len(args) {
				return args[i]
			}
			return def
		}
		var t Matrix
		switch name {
		case "matrix":
			if len(args) < 6 {
				continue
			}
			t = Matrix{args[0], args[1], args[2], args[3], args[4], args[5]}
		case "translate":
			t = translate(arg(0, 0), arg(1, 0))
		case "scale":
			t = scale(arg(0, 1), arg(1, arg(0, 1)))
		case "rotate":
			cx, cy := arg(1, 0), arg(2, 0)
			t = translate(cx, cy).Mul(rotate(arg(0, 0))).Mul(translate(-cx, -cy))
		case "skewX":
			t = Matrix{1, 0, math.Tan(arg(0, 0) * math.Pi / 180), 1, 0, 0}
		case "skewY":
			t = Matrix{1, math.Tan(arg(0, 0) * math.Pi / 180), 0, 1, 0, 0}
		default:
			continue
		}
		m = m.Mul(t)
	}
}

// parseNumbers reads every number in s ("1,2 -3.5e2.5" style).
func parseNumbers(s string) []float64 {
	var out []float64
	sc := numScanner{s: s}
	for {
		v, ok := sc.next()
		if !ok {
			return out
		}
		out = append(out, v)
	}
}

type numScanner struct {
	s string
	i int
}

func (sc *numScanner) skipSep() {
	for sc.i < len(sc.s) {
		c := sc.s[sc.i]
		if c == ' ' || c == ',' || c == '\t' || c == '\n' || c == '\r' {
			sc.i++
		} else {
			return
		}
	}
}

// next reads one number; false at the end or at a non-number.
func (sc *numScanner) next() (float64, bool) {
	sc.skipSep()
	start := sc.i
	i := sc.i
	if i < len(sc.s) && (sc.s[i] == '+' || sc.s[i] == '-') {
		i++
	}
	digits, dot := 0, false
	for i < len(sc.s) {
		c := sc.s[i]
		if c >= '0' && c <= '9' {
			digits++
			i++
		} else if c == '.' && !dot {
			dot = true
			i++
		} else {
			break
		}
	}
	if digits == 0 {
		return 0, false
	}
	if i < len(sc.s) && (sc.s[i] == 'e' || sc.s[i] == 'E') {
		j := i + 1
		if j < len(sc.s) && (sc.s[j] == '+' || sc.s[j] == '-') {
			j++
		}
		k := j
		for k < len(sc.s) && sc.s[k] >= '0' && sc.s[k] <= '9' {
			k++
		}
		if k > j {
			i = k
		}
	}
	v, err := strconv.ParseFloat(sc.s[start:i], 64)
	if err != nil {
		return 0, false
	}
	sc.i = i
	return v, true
}

// flag reads an arc flag (a single 0 or 1, possibly with no separator).
func (sc *numScanner) flag() (float64, bool) {
	sc.skipSep()
	if sc.i < len(sc.s) && (sc.s[sc.i] == '0' || sc.s[sc.i] == '1') {
		v := float64(sc.s[sc.i] - '0')
		sc.i++
		return v, true
	}
	return 0, false
}

// PathCmd is one path command with absolute or relative numbers as written.
type PathCmd struct {
	Op   byte
	Args []float64
}

var pathArgCount = map[byte]int{'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}

// parsePath splits path data into commands (repeated implicit commands
// become separate commands; an implicit command after M is L).
func parsePath(d string) []PathCmd {
	var cmds []PathCmd
	sc := numScanner{s: d}
	var op byte
	for {
		sc.skipSep()
		if sc.i >= len(sc.s) {
			return cmds
		}
		c := sc.s[sc.i]
		if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') && c != 'e' && c != 'E' {
			op = c
			sc.i++
			upper := op &^ 0x20
			if upper == 'Z' {
				cmds = append(cmds, PathCmd{Op: op})
				continue
			}
		} else if op == 0 {
			return cmds
		}
		upper := op &^ 0x20
		n, ok := pathArgCount[upper]
		if !ok {
			return cmds
		}
		args := make([]float64, n)
		for k := 0; k < n; k++ {
			var v float64
			var good bool
			if upper == 'A' && (k == 3 || k == 4) {
				v, good = sc.flag()
			} else {
				v, good = sc.next()
			}
			if !good {
				return cmds
			}
			args[k] = v
		}
		cmds = append(cmds, PathCmd{Op: op, Args: args})
		if upper == 'M' {
			if op == 'M' {
				op = 'L'
			} else {
				op = 'l'
			}
		}
	}
}

// pathPoints returns points that bound the path (end points, control
// points and samples along arcs), in the path's own coordinates.
func pathPoints(d string) [][2]float64 {
	var pts [][2]float64
	var x, y, sx, sy float64
	for _, c := range parsePath(d) {
		rel := c.Op >= 'a'
		up := c.Op &^ 0x20
		a := c.Args
		abs := func(i int) (float64, float64) {
			if rel {
				return x + a[i], y + a[i+1]
			}
			return a[i], a[i+1]
		}
		switch up {
		case 'M':
			x, y = abs(0)
			sx, sy = x, y
			pts = append(pts, [2]float64{x, y})
		case 'L', 'T':
			x, y = abs(0)
			pts = append(pts, [2]float64{x, y})
		case 'H':
			if rel {
				x += a[0]
			} else {
				x = a[0]
			}
			pts = append(pts, [2]float64{x, y})
		case 'V':
			if rel {
				y += a[0]
			} else {
				y = a[0]
			}
			pts = append(pts, [2]float64{x, y})
		case 'C':
			x1, y1 := abs(0)
			x2, y2 := abs(2)
			nx, ny := abs(4)
			pts = append(pts, bezierPoints(x, y, x1, y1, x2, y2, nx, ny)...)
			x, y = nx, ny
		case 'S', 'Q':
			x1, y1 := abs(0)
			nx, ny := abs(2)
			pts = append(pts, bezierPoints(x, y, x1, y1, x1, y1, nx, ny)...)
			x, y = nx, ny
		case 'A':
			nx, ny := a[5], a[6]
			if rel {
				nx, ny = x+a[5], y+a[6]
			}
			pts = append(pts, arcPoints(x, y, a[0], a[1], a[2], a[3] != 0, a[4] != 0, nx, ny)...)
			x, y = nx, ny
		case 'Z':
			x, y = sx, sy
		}
	}
	return pts
}

func bezierPoints(x0, y0, x1, y1, x2, y2, x3, y3 float64) [][2]float64 {
	var out [][2]float64
	for i := 1; i <= 8; i++ {
		t := float64(i) / 8
		u := 1 - t
		out = append(out, [2]float64{
			u*u*u*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t*t*t*x3,
			u*u*u*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t*t*t*y3,
		})
	}
	return out
}

// arcPoints samples an elliptical arc (SVG endpoint parameterisation).
func arcPoints(x1, y1, rx, ry, phiDeg float64, large, sweep bool, x2, y2 float64) [][2]float64 {
	rx, ry = math.Abs(rx), math.Abs(ry)
	if rx == 0 || ry == 0 || (x1 == x2 && y1 == y2) {
		return [][2]float64{{x2, y2}}
	}
	phi := phiDeg * math.Pi / 180
	cos, sin := math.Cos(phi), math.Sin(phi)
	dx, dy := (x1-x2)/2, (y1-y2)/2
	x1p := cos*dx + sin*dy
	y1p := -sin*dx + cos*dy
	lam := x1p*x1p/(rx*rx) + y1p*y1p/(ry*ry)
	if lam > 1 {
		s := math.Sqrt(lam)
		rx, ry = rx*s, ry*s
	}
	num := rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p
	den := rx*rx*y1p*y1p + ry*ry*x1p*x1p
	co := 0.0
	if den != 0 && num > 0 {
		co = math.Sqrt(num / den)
	}
	if large == sweep {
		co = -co
	}
	cxp, cyp := co*rx*y1p/ry, -co*ry*x1p/rx
	cx := cos*cxp - sin*cyp + (x1+x2)/2
	cy := sin*cxp + cos*cyp + (y1+y2)/2
	ang := func(ux, uy, vx, vy float64) float64 {
		return math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)
	}
	t1 := ang(1, 0, (x1p-cxp)/rx, (y1p-cyp)/ry)
	dt := ang((x1p-cxp)/rx, (y1p-cyp)/ry, (-x1p-cxp)/rx, (-y1p-cyp)/ry)
	if !sweep && dt > 0 {
		dt -= 2 * math.Pi
	} else if sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	var out [][2]float64
	for i := 1; i <= 16; i++ {
		t := t1 + dt*float64(i)/16
		px, py := rx*math.Cos(t), ry*math.Sin(t)
		out = append(out, [2]float64{cos*px - sin*py + cx, sin*px + cos*py + cy})
	}
	return out
}

// Rect is an axis-aligned box.
type Rect struct {
	X0, Y0, X1, Y1 float64
	OK             bool
}

func (r *Rect) addPoint(x, y float64) {
	if !r.OK {
		*r = Rect{x, y, x, y, true}
		return
	}
	r.X0, r.Y0 = math.Min(r.X0, x), math.Min(r.Y0, y)
	r.X1, r.Y1 = math.Max(r.X1, x), math.Max(r.Y1, y)
}

func (r *Rect) union(o Rect) {
	if !o.OK {
		return
	}
	r.addPoint(o.X0, o.Y0)
	r.addPoint(o.X1, o.Y1)
}

// Centre of the box.
func (r Rect) Centre() (float64, float64) { return (r.X0 + r.X1) / 2, (r.Y0 + r.Y1) / 2 }

// W and H.
func (r Rect) W() float64 { return r.X1 - r.X0 }
func (r Rect) H() float64 { return r.Y1 - r.Y0 }

func num(n *Node, name string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(n.Get(name)), "px"), 64)
	return v
}

// shapePoints returns the outline points of one shape element in its own
// coordinates (no children, no transform).
func shapePoints(n *Node) [][2]float64 {
	switch n.Tag {
	case "rect", "image", "use":
		if n.Tag == "use" && !n.Has("width") {
			return nil
		}
		x, y, w, h := num(n, "x"), num(n, "y"), num(n, "width"), num(n, "height")
		return [][2]float64{{x, y}, {x + w, y}, {x, y + h}, {x + w, y + h}}
	case "circle":
		cx, cy, r := num(n, "cx"), num(n, "cy"), num(n, "r")
		return [][2]float64{{cx - r, cy - r}, {cx + r, cy + r}, {cx - r, cy + r}, {cx + r, cy - r}}
	case "ellipse":
		cx, cy, rx, ry := num(n, "cx"), num(n, "cy"), num(n, "rx"), num(n, "ry")
		return [][2]float64{{cx - rx, cy - ry}, {cx + rx, cy + ry}, {cx - rx, cy + ry}, {cx + rx, cy - ry}}
	case "line":
		return [][2]float64{{num(n, "x1"), num(n, "y1")}, {num(n, "x2"), num(n, "y2")}}
	case "polygon", "polyline":
		v := parseNumbers(n.Get("points"))
		var pts [][2]float64
		for i := 0; i+1 < len(v); i += 2 {
			pts = append(pts, [2]float64{v[i], v[i+1]})
		}
		return pts
	case "path":
		return pathPoints(n.Get("d"))
	}
	return nil
}

// isDef reports elements that are never drawn where they stand.
func isDef(tag string) bool {
	switch tag {
	case "defs", "linearGradient", "radialGradient", "clipPath", "mask", "pattern", "filter",
		"symbol", "marker", "style", "title", "desc", "metadata", "script":
		return true
	}
	return false
}

// bbox returns the box of n and its children, after transform m (the
// transform of n's parent coordinate system). Text is skipped.
func bbox(n *Node, m Matrix) Rect {
	var r Rect
	if n.Tag == "" || isDef(n.Tag) || n.Get("display") == "none" {
		return r
	}
	if t := n.Get("transform"); t != "" {
		m = m.Mul(parseTransform(t))
	}
	if n.Tag == "use" && !n.Has("width") {
		return r
	}
	for _, p := range shapePoints(n) {
		r.addPoint(m.Apply(p[0], p[1]))
	}
	if n.Tag == "svg" && n.Has("x") {
		m = m.Mul(translate(num(n, "x"), num(n, "y")))
	}
	for _, k := range n.Kids {
		r.union(bbox(k, m))
	}
	return r
}

// matrixTo returns the transform from target's own coordinates to the
// coordinates of root (root's own transform not included), and false if
// target isn't below root.
func matrixTo(root, target *Node) (Matrix, bool) {
	var walk func(n *Node, m Matrix) (Matrix, bool)
	walk = func(n *Node, m Matrix) (Matrix, bool) {
		if n == target {
			return m, true
		}
		for _, k := range n.Kids {
			if k.Tag == "" {
				continue
			}
			km := m
			if t := k.Get("transform"); t != "" {
				km = m.Mul(parseTransform(t))
			}
			if res, ok := walk(k, km); ok {
				return res, true
			}
		}
		return Matrix{}, false
	}
	return walk(root, identity)
}

// elementBox is the box of an element in root's coordinates (including
// the element's own transform).
func elementBox(root, target *Node) Rect {
	m, ok := matrixTo(root, target)
	if !ok {
		return Rect{}
	}
	// matrixTo includes target's own transform; bbox applies it again, so undo it.
	if t := target.Get("transform"); t != "" {
		m = m.Mul(parseTransform(t).Invert())
	}
	return bbox(target, m)
}

// round formats v with at most p decimals, trimming zeros.
func round(v float64, p int) string {
	s := strconv.FormatFloat(v, 'f', p, 64)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	if s == "-0" {
		s = "0"
	}
	return s
}

// r2 rounds to 2 decimals as a number (for JSON).
func r2(v float64) float64 { return math.Round(v*100) / 100 }
