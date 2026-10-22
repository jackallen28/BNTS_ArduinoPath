package main

import (
	"fmt"
	"math"
	"strings"
)

// ledColors are the LED colours students can pick (body tint in the art
// and the glow when lit).
var ledColors = map[string]string{
	"red": "#e8221b", "yellow": "#f5cf1d", "green": "#22b33a", "blue": "#2367e0", "white": "#eef2f5",
}

// recolour makes Fritzing's colourable elements (ids starting with
// "color_") use currentColor, so the renderer sets the colour per LED.
func recolour(d *SVGDoc) {
	d.Root.Walk(func(n, _ *Node) bool {
		if strings.HasPrefix(n.Get("id"), "color_") {
			n.Set("fill", "currentColor")
			n.Del("style")
		}
		return true
	})
}

// wrap moves elements (which must share a parent) into a new group tagged
// for the renderer, at the place of the first one.
func wrap(d *SVGDoc, ids []string, name string) (*Node, error) {
	var parent *Node
	var first int = -1
	set := map[*Node]bool{}
	for _, id := range ids {
		e := d.Root.Find(id)
		if e == nil {
			return nil, fmt.Errorf("no element %q", id)
		}
		set[e] = true
	}
	d.Root.Walk(func(n, _ *Node) bool {
		for i, k := range n.Kids {
			if set[k] {
				if parent == nil {
					parent, first = n, i
				} else if parent != n {
					parent = &Node{} // mismatch marker
				}
			}
		}
		return true
	})
	if parent == nil || parent.Tag == "" {
		return nil, fmt.Errorf("elements %v don't share a parent", ids)
	}
	g := el("g", "data-cp", name)
	var kids []*Node
	for i, k := range parent.Kids {
		if i == first {
			kids = append(kids, g)
		}
		if set[k] {
			g.Kids = append(g.Kids, k)
			continue
		}
		kids = append(kids, k)
	}
	parent.Kids = kids
	return g, nil
}

func setCentre(d *SVGDoc, n *Node, ref *Node) {
	x, y := localCentre(d, ref)
	n.Set("data-cx", round(x, 3))
	n.Set("data-cy", round(y, 3))
}

func boxCircle(r Rect, scale float64) Circle {
	x, y := r.Centre()
	return Circle{x, y, (r.W() + r.H()) / 4 * scale}
}

func partSpecs() []PartSpec {
	return []PartSpec{
		{
			Type: "led", Behaviour: "led", FZP: "core/LED-generic-5mm_6852162_005.fzp", OnBreadboard: true,
			Legs: []LegSpec{
				{"cathode", "cathode (−): the short leg, by the flat side", "connector0"},
				{"anode", "anode (+): the long leg", "connector1"},
			},
			Colors: ledColors,
			Tweak: func(b *partBuild) error {
				recolour(b.BB)
				r, err := b.BB.Box("color_path14")
				if err != nil {
					return err
				}
				b.Sim["glow"] = Circle{(r.X0 + r.X1) / 2, r.Y0 + r.W()*0.55, r.W() * 1.15}
				return nil
			},
		},
		{
			Type: "rgb-led", Behaviour: "rgb-led", FZP: "core/led-rgb-4pin-cathode_v5.fzp", OnBreadboard: true,
			Legs: []LegSpec{
				{"red", "red (+)", "connector0"},
				{"cathode", "common cathode (−): the longest leg", "connector1"},
				{"green", "green (+)", "connector2"},
				{"blue", "blue (+)", "connector3"},
			},
			Tweak: func(b *partBuild) error {
				recolour(b.BB)
				r, err := b.BB.Box("color_path1")
				if err != nil {
					return err
				}
				b.Sim["glow"] = Circle{(r.X0 + r.X1) / 2, r.Y0 + r.W()*0.5, r.W() * 1.1}
				return nil
			},
		},
		resistorSpec("resistor-220", 220, [4]string{"#c40808", "#c40808", "#8a3d06", "#ad9f4e"}),
		resistorSpec("resistor-10k", 10000, [4]string{"#8a3d06", "#1a1a1a", "#ff7a00", "#ad9f4e"}),
		{
			Type: "button", Behaviour: "button", FZP: "core/pushbutton_4_horizontal.fzp", OnBreadboard: true,
			Legs: []LegSpec{
				{"1a", "left top leg (joined to the left bottom leg)", "connector2"},
				{"1b", "left bottom leg", "connector3"},
				{"2a", "right top leg (joined to the right bottom leg)", "connector0"},
				{"2b", "right bottom leg", "connector1"},
			},
			Switch: [][]string{{"1a", "2a"}},
			Tweak: func(b *partBuild) error {
				var capEl *Node
				b.BB.Root.Walk(func(n, _ *Node) bool {
					if n.Has("fpush") {
						capEl = n
					}
					return true
				})
				if capEl == nil {
					return fmt.Errorf("no button cap")
				}
				capEl.Set("data-cp", "cap")
				setCentre(b.BB, capEl, capEl)
				r := elementBox(b.BB.Root, capEl)
				var out Rect
				out.addPoint(b.BB.Base.Apply(r.X0, r.Y0))
				out.addPoint(b.BB.Base.Apply(r.X1, r.Y1))
				b.Sim["cap"] = boxCircle(out, 1)
				return nil
			},
		},
		{
			Type: "buzzer", Behaviour: "buzzer", FZP: "core/piezo sensor.fzp", OnBreadboard: true,
			Legs: []LegSpec{
				{"negative", "negative (−): the black wire or short leg", "connector0"},
				{"positive", "positive (+): the red wire or long leg, marked +", "connector1"},
			},
			Tweak: func(b *partBuild) error {
				b.Sim["waves"] = Circle{b.BB.W / 2, b.BB.H * 0.47, b.BB.W * 0.46}
				return nil
			},
		},
		{
			Type: "potentiometer", Behaviour: "potentiometer", FZP: "core/potentiometer_trimmer_12mm_5.fzp", OnBreadboard: true,
			Legs: []LegSpec{
				{"end1", "outside leg 1 (to GND or power)", "connector0"},
				{"wiper", "middle leg: the wiper (to an analog pin)", "connector1"},
				{"end2", "outside leg 2 (to power or GND)", "connector2"},
			},
			Tweak: func(b *partBuild) error {
				g, err := wrap(b.BB, []string{"path27", "rect31", "polygon33", "polygon37", "polygon39"}, "knob")
				if err != nil {
					return err
				}
				ref := b.BB.Root.Find("path27")
				setCentre(b.BB, g, ref)
				r, _ := b.BB.Box("path27")
				b.Sim["knob"] = boxCircle(r, 1)
				return nil
			},
		},
		{
			Type: "joystick", Behaviour: "joystick", Art: joystickArt,
			Legs: []LegSpec{{"gnd", "GND", "pin-gnd"}, {"vcc", "+5V (power)", "pin-vcc"},
				{"vrx", "VRx: left and right (analog)", "pin-vrx"}, {"vry", "VRy: up and down (analog)", "pin-vry"},
				{"sw", "SW: press the stick (a button to GND)", "pin-sw"}},
			Tweak: func(b *partBuild) error {
				b.Sim["knob"] = Circle{12 + 62, 67, 21}
				b.Sim["travel"] = 14
				return nil
			},
		},
		{
			Type: "keypad-4x4", Behaviour: "keypad", Art: keypadArt,
			Legs: []LegSpec{{"r1", "row 1", "pin-r1"}, {"r2", "row 2", "pin-r2"}, {"r3", "row 3", "pin-r3"}, {"r4", "row 4", "pin-r4"},
				{"c1", "column 1", "pin-c1"}, {"c2", "column 2", "pin-c2"}, {"c3", "column 3", "pin-c3"}, {"c4", "column 4", "pin-c4"}},
			Options: map[string]any{"keys": []string{"123A", "456B", "789C", "*0#D"}},
			Tweak: func(b *partBuild) error {
				b.Sim["keys"] = keypadBoxes()
				return nil
			},
		},
		{
			Type: "servo", Behaviour: "servo", FZP: "core/servo.fzp",
			Legs: []LegSpec{{"gnd", "brown or black wire: GND", "connector0"}, {"power", "red wire: power (5V)", "connector1"},
				{"signal", "orange or yellow wire: signal", "connector2"}},
			Tweak: func(b *partBuild) error {
				g, err := wrap(b.BB, []string{"path29", "path31", "g33"}, "horn")
				if err != nil {
					return err
				}
				pivot := b.BB.Root.Find("ellipse39")
				g.Set("data-cx", pivot.Get("cx"))
				g.Set("data-cy", pivot.Get("cy"))
				// The horn lies on the servo's top face, drawn at an angle:
				// squash says how flat that face looks, and offset is the
				// rotation that makes the drawn horn point at 90°.
				g.Set("data-squash", "0.558")
				g.Set("data-offset", "46")
				r, _ := b.BB.Box("ellipse39")
				b.Sim["horn"] = boxCircle(r, 1)
				return nil
			},
		},
		{
			Type: "ldr", Behaviour: "ldr", FZP: "core/LDR_photocell_300mil_v5.fzp", OnBreadboard: true,
			Legs: []LegSpec{{"1", "leg 1 (either way round)", "connector0"}, {"2", "leg 2 (either way round)", "connector1"}},
		},
		{
			Type: "hc-sr04", Behaviour: "hc-sr04", FZP: "core/hc-sr04_bf8299a_002.fzp", OnBreadboard: true,
			Legs: []LegSpec{{"vcc", "VCC (5V)", "connector0"}, {"trig", "Trig", "connector1"}, {"echo", "Echo (sends back 5V)", "connector2"}, {"gnd", "GND", "connector3"}},
		},
		{
			Type: "pir", Behaviour: "pir", FZP: "contrib/PIR_sensor__723e9e78d3d1bdc76f4badecd521c4cb_6B.fzp",
			SchScale: 0.4, // drawn about 2.5 times bigger than the other symbols
			Legs:     []LegSpec{{"vcc", "VCC (5V)", "connector1"}, {"out", "OUT (signal)", "connector2"}, {"gnd", "GND", "connector3"}},
			Tweak: func(b *partBuild) error {
				b.Sim["dome"] = Circle{b.BB.W / 2, b.BB.H * 0.2, b.BB.W * 0.3}
				return nil
			},
		},
		{
			Type: "dht", Behaviour: "dht", Art: dhtArt, OnBreadboard: true,
			Legs:    []LegSpec{{"data", "S: data", "pin-data"}, {"vcc", "+: power", "pin-vcc"}, {"gnd", "−: GND", "pin-gnd"}},
			Options: map[string]any{"model": "DHT11"},
		},
		{
			Type: "soil-moisture", Behaviour: "soil-moisture", FZP: "core/SparkFun_Soil_Moisture_Sensor.fzp",
			Legs: []LegSpec{{"vcc", "VCC (power)", "connector2"}, {"gnd", "GND", "connector3"}, {"sig", "SIG (analog signal)", "connector4"}},
		},
		{
			Type: "rfid-rc522", Behaviour: "rfid", Art: rfidArt,
			Legs: []LegSpec{{"sda", "SDA (SS: chip select)", "pin-sda"}, {"sck", "SCK", "pin-sck"}, {"mosi", "MOSI", "pin-mosi"},
				{"miso", "MISO", "pin-miso"}, {"irq", "IRQ (not used)", "pin-irq"}, {"gnd", "GND", "pin-gnd"},
				{"rst", "RST (reset)", "pin-rst"}, {"vcc", "3.3V (never 5V!)", "pin-vcc"}},
			Options: map[string]any{"cards": []any{
				map[string]any{"name": "Blue tag", "uid": []int{0x12, 0x34, 0x56, 0x78}},
				map[string]any{"name": "White card", "uid": []int{0xDE, 0xAD, 0xBE, 0xEF}},
			}},
		},
		{
			Type: "oled", Behaviour: "oled", Art: oledArt, OnBreadboard: true,
			Legs:    []LegSpec{{"gnd", "GND", "pin-gnd"}, {"vcc", "VCC (3.3V or 5V)", "pin-vcc"}, {"scl", "SCL (I2C clock)", "pin-scl"}, {"sda", "SDA (I2C data)", "pin-sda"}},
			Options: map[string]any{"width": 128, "height": 64, "address": 0x3C},
			Tweak: func(b *partBuild) error {
				b.Sim["screen"] = oledScreen()
				return nil
			},
		},
		{
			Type: "lcd-i2c", Behaviour: "lcd", Art: lcdArt,
			Legs:    []LegSpec{{"gnd", "GND", "pin-gnd"}, {"vcc", "VCC (5V)", "pin-vcc"}, {"sda", "SDA (I2C data)", "pin-sda"}, {"scl", "SCL (I2C clock)", "pin-scl"}},
			Options: map[string]any{"cols": 16, "rows": 2, "address": 0x27},
			Tweak: func(b *partBuild) error {
				b.Sim["screen"] = lcdScreen()
				return nil
			},
		},
		{
			Type: "tm1637", Behaviour: "tm1637", Art: tm1637Art,
			Legs: []LegSpec{{"clk", "CLK", "pin-clk"}, {"dio", "DIO", "pin-dio"}, {"vcc", "VCC", "pin-vcc"}, {"gnd", "GND", "pin-gnd"}},
		},
		{
			Type: "led-matrix", Behaviour: "led-matrix", Art: matrixArt,
			Legs: []LegSpec{{"vcc", "VCC (5V)", "pin-vcc"}, {"gnd", "GND", "pin-gnd"}, {"din", "DIN (data in)", "pin-din"}, {"cs", "CS", "pin-cs"}, {"clk", "CLK", "pin-clk"}},
		},
		{
			Type: "neopixel-ring", Behaviour: "neopixel", FZP: "contrib/adafruit_ffd51df0b5410b3e06f7e782c37b6870_1_15.fzp",
			Legs:    []LegSpec{{"vcc", "PWR (5V)", "connector19"}, {"din", "Data Input", "connector17"}, {"dout", "Data Out (to the next ring)", "connector18"}, {"gnd", "GND", "connector20"}},
			Options: map[string]any{"pixels": 12},
			Tweak: func(b *partBuild) error {
				var pts []Point
				cx, cy, r := b.BB.W/2, b.BB.H/2, b.BB.W*0.4
				for i := 0; i < 12; i++ {
					a := float64(i)/12*2*math.Pi - math.Pi/2
					pts = append(pts, Point{cx + r*math.Cos(a), cy + r*math.Sin(a)})
				}
				b.Sim["pixels"] = pts
				b.Sim["pixel_r"] = 6
				return nil
			},
		},
		{
			Type: "neopixel-strip", Behaviour: "neopixel", FZP: "contrib/adafruit_6530a5d9a89aa5dfd404e4335177b1a6_1_71.fzp",
			Legs:    []LegSpec{{"vcc", "4-7VDC (5V)", "connector21"}, {"din", "DIN (data in)", "connector25"}, {"dout", "DOUT (to the next strip)", "connector20"}, {"gnd", "GND", "connector19"}},
			Options: map[string]any{"pixels": 8},
			Tweak: func(b *partBuild) error {
				var pts []Point
				step := b.BB.W / 8
				for i := 0; i < 8; i++ {
					pts = append(pts, Point{step * (float64(i) + 0.5), b.BB.H / 2})
				}
				b.Sim["pixels"] = pts
				b.Sim["pixel_r"] = 6
				return nil
			},
		},
	}
}

func resistorSpec(typ string, ohms int, bands [4]string) PartSpec {
	return PartSpec{
		Type: typ, Behaviour: "resistor", FZP: "core/resistor.fzp", OnBreadboard: true,
		Legs:    []LegSpec{{"1", "leg 1 (either way round)", "connector0"}, {"2", "leg 2 (either way round)", "connector1"}},
		Options: map[string]any{"ohms": ohms},
		Tweak: func(b *partBuild) error {
			for i, id := range []string{"band_1_st", "band_2_nd", "band_rd_multiplier", "gold_band"} {
				e := b.BB.Root.Find(id)
				if e == nil {
					return fmt.Errorf("no %s", id)
				}
				e.Set("fill", bands[i])
			}
			return nil
		},
	}
}
