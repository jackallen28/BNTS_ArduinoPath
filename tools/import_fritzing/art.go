package main

// ArduinoPath's own art, for parts and boards that aren't in the Fritzing
// parts library. Drawn in the Fritzing breadboard style (flat colours, the
// real pin labels, 0.1" pitch) in ArduinoPath units (0.01 inch).

import (
	"fmt"
	"math"
	"strings"
)

const (
	fontSans = "'Droid Sans', 'Segoe UI', Arial, sans-serif"
	gold     = "#c9a640"
	goldDark = "#8f7426"
	silk     = "#ffffff"
)

func f(v float64) string { return round(v, 2) }

func svgRoot(w, h float64, title string) *Node {
	return el("svg", "xmlns", nsSVG, "width", f(w/100)+"in", "height", f(h/100)+"in",
		"viewBox", fmt.Sprintf("0 0 %s %s", f(w), f(h)), "data-title", title)
}

func rect(x, y, w, h float64, fill string, attrs ...string) *Node {
	return el("rect", append([]string{"x", f(x), "y", f(y), "width", f(w), "height", f(h), "fill", fill}, attrs...)...)
}

func circle(x, y, r float64, fill string, attrs ...string) *Node {
	return el("circle", append([]string{"cx", f(x), "cy", f(y), "r", f(r), "fill", fill}, attrs...)...)
}

func label(x, y, size float64, text, fill, anchor string, attrs ...string) *Node {
	return el("text", append([]string{"x", f(x), "y", f(y), "font-size", f(size), "fill", fill,
		"font-family", fontSans, "text-anchor", anchor}, attrs...)...).Add(textNode(text))
}

// pcb draws a board with rounded corners, a darker edge and mounting holes.
func pcb(w, h float64, fill, edge string, holes bool) []*Node {
	out := []*Node{rect(0, 0, w, h, fill, "rx", "4", "stroke", edge, "stroke-width", "1.2")}
	if holes {
		for _, p := range [][2]float64{{7, 7}, {w - 7, 7}, {7, h - 7}, {w - 7, h - 7}} {
			out = append(out, circle(p[0], p[1], 4.2, "#d9d9d9", "stroke", "#b5b5b5", "stroke-width", "1"))
		}
	}
	return out
}

// headerPin draws one male header pin seen from above at (x, y): a black
// plastic block and a gold square pin. The pin is the connector element.
func headerPin(x, y float64, id string) []*Node {
	return []*Node{
		rect(x-5, y-5, 10, 10, "#2b2b2b"),
		rect(x-2.4, y-2.4, 4.8, 4.8, gold, "id", id, "stroke", goldDark, "stroke-width", "0.6"),
	}
}

// sidePin draws a pin sticking out of an edge (dir "up", "down", "left",
// "right") from (x, y) for length l; its tip is the connector.
func sidePin(x, y, l float64, dir, id string) []*Node {
	var out []*Node
	dx, dy := 0.0, 0.0
	switch dir {
	case "up":
		dy = -1
	case "down":
		dy = 1
	case "left":
		dx = -1
	default:
		dx = 1
	}
	// plastic spacer at the edge
	if dx == 0 {
		out = append(out, rect(x-5, y+dy*1-2.5+dy*2.5, 10, 5, "#2b2b2b"))
	} else {
		out = append(out, rect(x+dx*1-2.5+dx*2.5, y-5, 5, 10, "#2b2b2b"))
	}
	x2, y2 := x+dx*l, y+dy*l
	out = append(out, el("line", "x1", f(x), "y1", f(y), "x2", f(x2), "y2", f(y2),
		"stroke", gold, "stroke-width", "2.6", "stroke-linecap", "square"))
	// the tip (connector element, invisible)
	out = append(out, rect(x2-1.5, y2-1.5, 3, 3, "none", "id", id))
	return out
}

// schematicBox draws a Fritzing-style schematic symbol: a box with a
// title and pins on the left (each pin "s-<id>" with its end "s-<id>-end").
func schematicBox(title string, ids, labels []string, rightIDs, rightLabels []string) *Node {
	n := len(ids)
	if len(rightIDs) > n {
		n = len(rightIDs)
	}
	lines := strings.Split(title, "\n")
	h := float64(n+1) * 10
	if min := float64(len(lines))*9 + 14; h < min {
		h = min
	}
	maxLabel := 0
	for _, l := range append(append([]string{}, labels...), rightLabels...) {
		if len(l) > maxLabel {
			maxLabel = len(l)
		}
	}
	titleW := 0
	for _, l := range lines {
		if len(l) > titleW {
			titleW = len(l)
		}
	}
	bw := math.Max(60, float64(maxLabel)*4.6*2+float64(titleW)*4.4+16)
	bw = math.Ceil(bw/10) * 10
	pinL := 20.0
	w := bw + pinL
	if len(rightIDs) > 0 {
		w += pinL
	}
	root := svgRoot(w, h, title)
	g := el("g")
	g.Add(rect(pinL, 0.5, bw, h-1, "#ffffff", "stroke", "#000000", "stroke-width", "1"))
	for i, l := range lines {
		g.Add(label(pinL+bw/2, h/2-float64(len(lines)-1)*4.5+float64(i)*9+3, 8, l, "#000000", "middle"))
	}
	for i, id := range ids {
		y := float64(i+1) * 10
		g.Add(el("line", "id", "s-"+id, "x1", "0", "y1", f(y), "x2", f(pinL), "y2", f(y), "stroke", "#000000", "stroke-width", "1"))
		g.Add(rect(0, y-1, 2, 2, "none", "id", "s-"+id+"-end"))
		g.Add(label(pinL+3, y+2.5, 6.5, labels[i], "#333333", "start"))
	}
	for i, id := range rightIDs {
		y := float64(i+1) * 10
		x := pinL + bw
		g.Add(el("line", "id", "s-"+id, "x1", f(x), "y1", f(y), "x2", f(x+pinL), "y2", f(y), "stroke", "#000000", "stroke-width", "1"))
		g.Add(rect(x+pinL-2, y-1, 2, 2, "none", "id", "s-"+id+"-end"))
		g.Add(label(x-3, y+2.5, 6.5, rightLabels[i], "#333333", "end"))
	}
	return root.Add(g)
}

// ---------- parts ----------

func joystickArt() (*Node, *Node) {
	w, h := 102.0, 134.0
	root := svgRoot(w+12, h, "Joystick module (KY-023)")
	g := el("g", "transform", "translate(12 0)")
	g.Add(pcb(w, h, "#1c1c1c", "#000", true)...)
	names := []string{"GND", "+5V", "VRx", "VRy", "SW"}
	ids := []string{"gnd", "vcc", "vrx", "vry", "sw"}
	for i, id := range ids {
		y := 47 + float64(i)*10
		g.Add(sidePin(0, y, 11, "left", "pin-"+id)...)
		g.Add(label(7, y+2.3, 6, names[i], silk, "start"))
	}
	// the stick's housing and the thumb cap
	g.Add(rect(30, 34, 64, 66, "#bdbdbd", "rx", "3", "stroke", "#8a8a8a", "stroke-width", "1"))
	g.Add(circle(62, 67, 29, "#9e9e9e"))
	g.Add(circle(62, 67, 25, "#6d6d6d"))
	cap := el("g", "data-cp", "knob", "data-cx", "62", "data-cy", "67")
	cap.Add(circle(62, 67, 21, "#2a2a2a", "stroke", "#111", "stroke-width", "1.2"))
	for a := 0.0; a < 360; a += 30 {
		r := a * math.Pi / 180
		cap.Add(el("line", "x1", f(62+14*math.Cos(r)), "y1", f(67+14*math.Sin(r)), "x2", f(62+20*math.Cos(r)), "y2", f(67+20*math.Sin(r)),
			"stroke", "#444", "stroke-width", "2", "stroke-linecap", "round"))
	}
	cap.Add(circle(62, 67, 12, "#3a3a3a"))
	cap.Add(circle(58, 62, 5, "#ffffff", "opacity", "0.12"))
	g.Add(cap)
	g.Add(label(62, 124, 7, "JOYSTICK", silk, "middle"))
	root.Add(g)
	sch := schematicBox("Joystick", ids, names, nil, nil)
	return root, sch
}

var keypadKeys = [4][4]string{{"1", "2", "3", "A"}, {"4", "5", "6", "B"}, {"7", "8", "9", "C"}, {"*", "0", "#", "D"}}

func keypadArt() (*Node, *Node) {
	w, ph := 272.0, 300.0
	h := ph + 150
	root := svgRoot(w, h, "4×4 membrane keypad")
	g := el("g")
	// ribbon
	g.Add(rect(w/2-44, ph-4, 88, 120, "#d9d9d9", "stroke", "#b0b0b0", "stroke-width", "1"))
	for i := 0; i < 8; i++ {
		x := w/2 - 35 + float64(i)*10
		g.Add(el("line", "x1", f(x), "y1", f(ph), "x2", f(x), "y2", f(ph+114), "stroke", "#a8a8a8", "stroke-width", "1"))
	}
	g.Add(rect(w/2-44, ph+112, 88, 18, "#1e1e1e", "rx", "1.5"))
	ids := []string{"r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"}
	names := []string{"R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"}
	for i, id := range ids {
		x := w/2 - 35 + float64(i)*10
		g.Add(rect(x-2.5, ph+116, 5, 10, "#555"))
		g.Add(rect(x-1.5, ph+126, 3, 3, "none", "id", "pin-"+id))
		g.Add(label(x, ph+140, 5.5, names[i], "#333333", "middle"))
	}
	// panel
	g.Add(rect(0, 0, w, ph, "#202020", "rx", "6"))
	g.Add(rect(8, 8, w-16, ph-16, "#2c2c2c", "rx", "4"))
	kw, kh, gapX, gapY := 52.0, 56.0, 12.0, 14.0
	x0 := (w - (4*kw + 3*gapX)) / 2
	y0 := (ph - (4*kh + 3*gapY)) / 2
	for r := 0; r < 4; r++ {
		for c := 0; c < 4; c++ {
			k := keypadKeys[r][c]
			x, y := x0+float64(c)*(kw+gapX), y0+float64(r)*(kh+gapY)
			fill, text := "#f2f2f2", "#1a1a1a"
			if c == 3 {
				fill, text = "#d6342c", "#ffffff"
			} else if k == "*" || k == "#" {
				fill = "#3b7dd8"
				text = "#ffffff"
			}
			key := el("g", "data-cp", "key", "data-key", k, "data-cx", f(x+kw/2), "data-cy", f(y+kh/2))
			key.Add(rect(x, y, kw, kh, fill, "rx", "6", "stroke", "#000", "stroke-opacity", "0.35", "stroke-width", "1"))
			key.Add(rect(x+3, y+3, kw-6, 10, "#ffffff", "rx", "4", "opacity", "0.25"))
			key.Add(label(x+kw/2, y+kh/2+11, 30, k, text, "middle", "font-weight", "bold"))
			g.Add(key)
		}
	}
	root.Add(g)
	sch := schematicBox("4×4 Keypad", ids, names, nil, nil)
	return root, sch
}

// keypadBoxes is the keys' geometry (to match keypadArt).
func keypadBoxes() []KeyBox {
	w, ph := 272.0, 300.0
	kw, kh, gapX, gapY := 52.0, 56.0, 12.0, 14.0
	x0 := (w - (4*kw + 3*gapX)) / 2
	y0 := (ph - (4*kh + 3*gapY)) / 2
	var out []KeyBox
	for r := 0; r < 4; r++ {
		for c := 0; c < 4; c++ {
			out = append(out, KeyBox{keypadKeys[r][c], Box{x0 + float64(c)*(kw+gapX), y0 + float64(r)*(kh+gapY), kw, kh}})
		}
	}
	return out
}

func dhtArt() (*Node, *Node) {
	w, h := 70.0, 100.0
	root := svgRoot(w, h+14, "DHT11 temperature and humidity module")
	g := el("g")
	g.Add(pcb(w, h, "#1f5fa8", "#123c6c", false)...)
	g.Add(circle(w/2, 92, 3.2, "#d9d9d9", "stroke", "#aaa", "stroke-width", "0.8"))
	// the sensor: a blue box with a grille
	g.Add(rect(10, 6, 50, 64, "#4aa3df", "rx", "3", "stroke", "#2f7fb7", "stroke-width", "1.2"))
	for r := 0; r < 5; r++ {
		for c := 0; c < 4; c++ {
			g.Add(rect(16+float64(c)*10.5, 12+float64(r)*11, 7, 7, "#24688f", "rx", "1"))
		}
	}
	ids := []string{"data", "vcc", "gnd"}
	names := []string{"S", "+", "−"}
	for i, id := range ids {
		x := 25 + float64(i)*10
		g.Add(label(x, 84, 7.5, names[i], silk, "middle", "font-weight", "bold"))
		g.Add(sidePin(x, h, 13, "down", "pin-"+id)...)
	}
	g.Add(label(w/2, 78, 5.5, "DHT11", silk, "middle"))
	root.Add(g)
	sch := schematicBox("DHT11/DHT22", ids, []string{"DATA", "VCC", "GND"}, nil, nil)
	return root, sch
}

func rfidArt() (*Node, *Node) {
	w, h := 160.0, 236.0
	root := svgRoot(w, h+14, "RFID reader (RC522)")
	g := el("g")
	g.Add(pcb(w, h, "#1d5ba6", "#123c6c", true)...)
	// antenna coil
	for i := 0; i < 4; i++ {
		d := float64(i) * 6
		g.Add(rect(14+d, 14+d, w-28-2*d, 120-2*d, "none", "rx", "10", "stroke", "#d0ad52", "stroke-width", "2.4"))
	}
	g.Add(rect(56, 150, 48, 48, "#1b1b1b", "rx", "2"))
	g.Add(label(80, 177, 7, "RC522", "#bbbbbb", "middle"))
	g.Add(rect(16, 156, 22, 13, "#9d9d9d", "rx", "2"))
	ids := []string{"sda", "sck", "mosi", "miso", "irq", "gnd", "rst", "vcc"}
	names := []string{"SDA", "SCK", "MOSI", "MISO", "IRQ", "GND", "RST", "3.3V"}
	for i, id := range ids {
		x := 45 + float64(i)*10
		g.Add(el("text", "x", f(x+2.2), "y", f(h-10), "font-size", "5.5", "fill", silk, "font-family", fontSans,
			"text-anchor", "start", "transform", fmt.Sprintf("rotate(-90 %s %s)", f(x+2.2), f(h-10))).Add(textNode(names[i])))
		g.Add(sidePin(x, h, 13, "down", "pin-"+id)...)
	}
	root.Add(g)
	sch := schematicBox("RFID\nRC522", ids, names, nil, nil)
	return root, sch
}

func oledArt() (*Node, *Node) {
	w, h := 108.0, 104.0
	root := svgRoot(w, h+13, "OLED screen 0.96\" (SSD1306, I2C)")
	g := el("g", "transform", "translate(0 13)")
	g.Add(pcb(w, h, "#163e6e", "#0d2747", true)...)
	ids := []string{"gnd", "vcc", "scl", "sda"}
	names := []string{"GND", "VCC", "SCL", "SDA"}
	for i, id := range ids {
		x := 39 + float64(i)*10
		g.Add(sidePin(x, 0, 13, "up", "pin-"+id)...)
		g.Add(label(x, 15, 4, names[i], silk, "middle"))
	}
	g.Add(rect(4, 22, w-8, 66, "#0b0b0b", "rx", "2"))
	g.Add(rect(9, 30, w-18, 45, "#101820"))
	g.Add(rect(w/2-14, 88, 28, 9, "#c7a24a"))
	root.Add(g)
	sch := schematicBox("OLED\nSSD1306", ids, names, nil, nil)
	return root, sch
}

func lcdArt() (*Node, *Node) {
	w, h := 316.0, 142.0
	root := svgRoot(w+34, h, "16×2 LCD screen with I2C backpack")
	g := el("g", "transform", "translate(34 0)")
	// the I2C backpack peeking out on the left, with its 4 pins
	g.Add(rect(-22, 34, 30, 72, "#1b1b1b", "rx", "2"))
	ids := []string{"gnd", "vcc", "sda", "scl"}
	names := []string{"GND", "VCC", "SDA", "SCL"}
	for i, id := range ids {
		y := 55 + float64(i)*10
		g.Add(sidePin(-22, y, 12, "left", "pin-"+id)...)
		g.Add(label(-17, y+2, 5.2, names[i], silk, "start"))
	}
	g.Add(pcb(w, h, "#2e7d32", "#1b5e20", true)...)
	g.Add(rect(20, 22, w-40, 98, "#151515", "rx", "3"))
	g.Add(rect(32, 36, w-64, 70, "#2a64e8", "rx", "2"))
	for i := 0; i < 16; i++ {
		g.Add(circle(38+float64(i)*9, 10, 2.6, "#d9d9d9", "stroke", gold, "stroke-width", "1"))
	}
	root.Add(g)
	sch := schematicBox("LCD 16×2\nI2C", ids, names, nil, nil)
	return root, sch
}

// lcdScreen and friends must match lcdArt (in its own units, before the shift).
func lcdScreen() Box  { return Box{34 + 32, 36, 316 - 64, 70} }
func oledScreen() Box { return Box{9 + 2, 13 + 30 + 1.5, 108 - 22, 42} }

// Seven-segment digit geometry (TM1637).
func segmentPolys(x, y, w, h, t float64) map[byte]string {
	// a: top, b: top right, c: bottom right, d: bottom, e: bottom left, f: top left, g: middle
	sk := 0.12 * h // slant
	pt := func(px, py float64) string {
		return f(px+sk*(1-(py-y)/h)) + "," + f(py)
	}
	hs := func(x0, yc float64) string {
		return strings.Join([]string{pt(x0+t/2, yc), pt(x0+t, yc-t/2), pt(x0+w-t, yc-t/2), pt(x0+w-t/2, yc), pt(x0+w-t, yc+t/2), pt(x0+t, yc+t/2)}, " ")
	}
	vs := func(xc, y0, y1 float64) string {
		return strings.Join([]string{pt(xc, y0+t/2), pt(xc+t/2, y0+t), pt(xc+t/2, y1-t), pt(xc, y1-t/2), pt(xc-t/2, y1-t), pt(xc-t/2, y0+t)}, " ")
	}
	m := y + h/2
	return map[byte]string{
		'a': hs(x, y+t/2), 'g': hs(x, m), 'd': hs(x, y+h-t/2),
		'f': vs(x+t/2, y, m), 'b': vs(x+w-t/2, y, m), 'e': vs(x+t/2, m, y+h), 'c': vs(x+w-t/2, m, y+h),
	}
}

func tm1637Art() (*Node, *Node) {
	w, h := 166.0, 76.0
	root := svgRoot(w+12, h, "4-digit display (TM1637)")
	g := el("g", "transform", "translate(12 0)")
	g.Add(pcb(w, h, "#1b4f9c", "#0f3263", true)...)
	g.Add(rect(28, 10, 122, 56, "#111111", "rx", "2"))
	for d := 0; d < 4; d++ {
		x := 36 + float64(d)*28
		if d >= 2 {
			x += 6
		}
		for _, s := range "abcdefg" {
			pts := segmentPolys(x, 18, 18, 40, 4.2)[byte(s)]
			g.Add(el("polygon", "points", pts, "fill", "#3a1616", "data-cp", "seg", "data-d", fmt.Sprint(d), "data-s", string(s)))
		}
	}
	g.Add(circle(90, 31, 2.4, "#3a1616", "data-cp", "colon"))
	g.Add(circle(90, 45, 2.4, "#3a1616", "data-cp", "colon"))
	ids := []string{"clk", "dio", "vcc", "gnd"}
	names := []string{"CLK", "DIO", "VCC", "GND"}
	for i, id := range ids {
		y := 23 + float64(i)*10
		g.Add(sidePin(0, y, 12, "left", "pin-"+id)...)
		g.Add(label(4, y+2, 5, names[i], silk, "start"))
	}
	root.Add(g)
	sch := schematicBox("TM1637\n4 digits", ids, names, nil, nil)
	return root, sch
}

func matrixArt() (*Node, *Node) {
	w, h := 200.0, 132.0
	root := svgRoot(w+24, h, "8×8 LED matrix (MAX7219)")
	g := el("g", "transform", "translate(12 0)")
	g.Add(pcb(w, h, "#1d6b3a", "#114524", false)...)
	g.Add(rect(36, 2, 128, 128, "#141414", "rx", "2"))
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			g.Add(circle(44+float64(c)*16, 10+float64(r)*16, 5.6, "#3a1414", "data-cp", "dot", "data-r", fmt.Sprint(r), "data-c", fmt.Sprint(c)))
		}
	}
	ids := []string{"vcc", "gnd", "din", "cs", "clk"}
	names := []string{"VCC", "GND", "DIN", "CS", "CLK"}
	out := []string{"VCC", "GND", "DOUT", "CS", "CLK"}
	for i, id := range ids {
		y := 46 + float64(i)*10
		g.Add(sidePin(0, y, 12, "left", "pin-"+id)...)
		g.Add(label(5, y+2, 5, names[i], silk, "start"))
		g.Add(sidePin(w, y, 12, "right", "")...)
		g.Add(label(w-5, y+2, 5, out[i], silk, "end"))
	}
	root.Add(g)
	sch := schematicBox("MAX7219\n8×8 matrix", ids, names, nil, nil)
	return root, sch
}

// ---------- boards ----------

// BoardArtPin is one pin of a board we draw ourselves.
type BoardArtPin struct {
	Label string
	ID    string // connector element id ("" = drawn only)
}

// devBoardArt draws a breadboard-friendly dev board standing upright: two
// columns of pins, USB at the bottom or top.
func devBoardArt(title string, w, h, colL, colR, y0 float64, left, right []BoardArtPin, body func(g *Node)) *Node {
	root := svgRoot(w, h, title)
	g := el("g")
	g.Add(rect(0, 0, w, h, "#1f2a33", "rx", "4", "stroke", "#0c1116", "stroke-width", "1.2"))
	body(g)
	for side, pins := range [][]BoardArtPin{left, right} {
		x := colL
		anchor, lx := "start", colL+7
		if side == 1 {
			x, anchor, lx = colR, "end", colR-7
		}
		for i, p := range pins {
			y := y0 + float64(i)*10
			attrs := []string{"stroke", "#9b7d2c", "stroke-width", "1"}
			if p.ID != "" {
				attrs = append(attrs, "id", p.ID)
			}
			g.Add(circle(x, y, 4, gold, attrs...))
			g.Add(circle(x, y, 1.8, "#1a1a1a"))
			g.Add(label(lx, y+2.1, 5.6, p.Label, silk, anchor))
		}
	}
	return root.Add(g)
}

func esp32Art(pins map[string]string) (*Node, *Node) {
	// DOIT ESP32 DevKit V1 (30 pins), antenna at the top, USB at the bottom.
	leftLabels := []string{"EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"}
	leftCodes := []string{"", "36", "39", "34", "35", "32", "33", "25", "26", "27", "14", "12", "13", "GND", "VIN"}
	rightLabels := []string{"D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2", "D4", "D2", "D15", "GND", "3V3"}
	rightCodes := []string{"23", "22", "", "", "21", "19", "18", "5", "17", "16", "4", "2", "15", "GND", "3V3"}
	mk := func(labels, codes []string, side string) []BoardArtPin {
		var out []BoardArtPin
		for i, l := range labels {
			id := ""
			if codes[i] != "" {
				id = "pin-" + codes[i] + "-" + side
				pins[id] = codes[i]
			}
			out = append(out, BoardArtPin{l, id})
		}
		return out
	}
	left, right := mk(leftLabels, leftCodes, "l"), mk(rightLabels, rightCodes, "r")
	w, h := 112.0, 206.0
	bb := devBoardArt("ESP32 DevKit V1 (30 pins)", w, h, 11, 101, 38, left, right, func(g *Node) {
		// the WROOM module: antenna strip and metal can
		g.Add(rect(22, 2, 68, 108, "#2a2a2a", "rx", "1.5"))
		zig := "M30 8h50v8h-44v6h44v6h-44"
		g.Add(el("path", "d", zig, "fill", "none", "stroke", gold, "stroke-width", "1.6"))
		g.Add(rect(26, 34, 60, 72, "#bfc3c7", "rx", "2", "stroke", "#8d9196", "stroke-width", "1"))
		g.Add(label(56, 64, 7, "ESP32", "#555", "middle", "font-weight", "bold"))
		g.Add(label(56, 74, 5, "WROOM-32", "#666", "middle"))
		// buttons and USB
		g.Add(rect(22, 170, 14, 10, "#d0d0d0", "rx", "1"), circle(29, 175, 3, "#333"))
		g.Add(rect(76, 170, 14, 10, "#d0d0d0", "rx", "1"), circle(83, 175, 3, "#333"))
		g.Add(label(29, 188, 5, "EN", silk, "middle"), label(83, 188, 5, "BOOT", silk, "middle"))
		g.Add(rect(42, 186, 28, 20, "#c4c4c4", "rx", "1.5", "stroke", "#8a8a8a", "stroke-width", "1"))
		g.Add(rect(50, 146, 12, 12, "#141414"))
		g.Add(circle(56, 134, 2, "#e53935"))
	})
	var ids, labels, rids, rlabels []string
	for i, c := range leftCodes {
		if c != "" {
			ids, labels = append(ids, "pin-"+c+"-l"), append(labels, leftLabels[i])
		}
	}
	for i, c := range rightCodes {
		if c != "" {
			rids, rlabels = append(rids, "pin-"+c+"-r"), append(rlabels, rightLabels[i])
		}
	}
	return bb, schematicBox("ESP32\nDevKit V1", ids, labels, rids, rlabels)
}

func esp32c3Art(pins map[string]string) (*Node, *Node) {
	// ESP32-C3 SuperMini, USB-C at the top.
	leftLabels := []string{"5V", "GND", "3V3", "4", "3", "2", "1", "0"}
	rightLabels := []string{"5", "6", "7", "8", "9", "10", "20", "21"}
	mk := func(labels []string, side string) []BoardArtPin {
		var out []BoardArtPin
		for _, l := range labels {
			id := "pin-" + l + "-" + side
			pins[id] = l
			out = append(out, BoardArtPin{l, id})
		}
		return out
	}
	left, right := mk(leftLabels, "l"), mk(rightLabels, "r")
	w, h := 72.0, 92.0
	bb := devBoardArt("ESP32-C3 SuperMini", w, h, 6, 66, 16, left, right, func(g *Node) {
		g.Add(rect(24, -2, 24, 12, "#c4c4c4", "rx", "3", "stroke", "#8a8a8a", "stroke-width", "1"))
		g.Add(rect(22, 30, 28, 28, "#141414", "rx", "1"))
		g.Add(label(36, 46, 5, "C3", "#aaa", "middle"))
		g.Add(el("path", "d", "M24 72h24v5h-20v5h20", "fill", "none", "stroke", gold, "stroke-width", "1.4"))
		g.Add(rect(16, 14, 9, 6, "#d0d0d0", "rx", "1"), rect(47, 14, 9, 6, "#d0d0d0", "rx", "1"))
	})
	var ids, rids []string
	for _, l := range leftLabels {
		ids = append(ids, "pin-"+l+"-l")
	}
	for _, l := range rightLabels {
		rids = append(rids, "pin-"+l+"-r")
	}
	return bb, schematicBox("ESP32-C3\nSuperMini", ids, leftLabels, rids, rightLabels)
}
