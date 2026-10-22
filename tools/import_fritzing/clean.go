package main

import (
	"regexp"
	"sort"
	"strings"
)

// The page's Content-Security-Policy blocks inline styles, so every style
// attribute and <style> rule becomes a presentation attribute. Only these
// properties are kept.
var presentationProps = map[string]bool{
	"fill": true, "fill-opacity": true, "fill-rule": true, "stroke": true, "stroke-width": true,
	"stroke-opacity": true, "stroke-linecap": true, "stroke-linejoin": true, "stroke-miterlimit": true,
	"stroke-dasharray": true, "stroke-dashoffset": true, "opacity": true, "display": true,
	"visibility": true, "font-family": true, "font-size": true, "font-weight": true, "font-style": true,
	"text-anchor": true, "letter-spacing": true, "word-spacing": true, "dominant-baseline": true,
	"stop-color": true, "stop-opacity": true, "clip-path": true, "clip-rule": true, "mask": true,
	"filter": true, "color": true, "baseline-shift": true, "writing-mode": true,
	"flood-color": true, "flood-opacity": true,
}

// Attributes kept on elements (besides presentation properties).
var keptAttrs = map[string]bool{
	"id": true, "x": true, "y": true, "width": true, "height": true, "cx": true, "cy": true,
	"r": true, "rx": true, "ry": true, "x1": true, "y1": true, "x2": true, "y2": true, "d": true,
	"points": true, "transform": true, "href": true, "offset": true, "gradientUnits": true,
	"gradientTransform": true, "fx": true, "fy": true, "fr": true, "spreadMethod": true,
	"clipPathUnits": true, "maskUnits": true, "maskContentUnits": true, "patternUnits": true,
	"patternContentUnits": true, "patternTransform": true, "viewBox": true,
	"preserveAspectRatio": true, "dx": true, "dy": true, "rotate": true, "textLength": true,
	"lengthAdjust": true, "stdDeviation": true, "in": true, "in2": true, "result": true,
	"mode": true, "operator": true, "k1": true, "k2": true, "k3": true, "k4": true,
	"filterUnits": true, "primitiveUnits": true, "values": true, "type": true,
}

var keptTags = map[string]bool{
	"svg": true, "g": true, "path": true, "rect": true, "circle": true, "ellipse": true,
	"line": true, "polyline": true, "polygon": true, "text": true, "tspan": true, "defs": true,
	"linearGradient": true, "radialGradient": true, "stop": true, "clipPath": true, "mask": true,
	"pattern": true, "use": true, "image": true, "filter": true, "symbol": true,
}

var defTags = map[string]bool{
	"linearGradient": true, "radialGradient": true, "clipPath": true, "mask": true,
	"pattern": true, "filter": true, "symbol": true,
}

// cleanOptions controls clean.
type cleanOptions struct {
	Prefix    string // put before every id that is kept (unique per part type)
	Precision int    // decimals for coordinates
}

// cleanSVG tidies an SVG tree in place: styles become attributes, editor
// junk and invisible placeholders go, ids are made unique, definitions
// move to one <defs>, and numbers are rounded. It returns the defs (to
// put first) and the drawable children.
func cleanSVG(root *Node, opt cleanOptions) (defs []*Node, content []*Node) {
	inlineCSS(root)
	root.Walk(func(n, _ *Node) bool {
		if n.Tag == "image" && !strings.HasPrefix(n.Get("href"), "data:") {
			n.Tag = "removed"
		}
		if n.Tag == "use" && n.Get("href") == "" {
			n.Tag = "removed"
		}
		return true
	})
	root.RemoveIf(func(e *Node) bool {
		return !keptTags[e.Tag] && !strings.HasPrefix(e.Tag, "fe")
	})
	root.Walk(func(n, _ *Node) bool {
		out := n.Attrs[:0]
		for _, a := range n.Attrs {
			if keptAttrs[a.Name] || presentationProps[a.Name] || strings.HasPrefix(a.Name, "data-cp") {
				out = append(out, a)
			}
		}
		n.Attrs = out
		if f := n.Get("font-family"); f != "" {
			n.Set("font-family", fontStack(f))
		}
		return true
	})
	stripStrayText(root)
	removeInvisible(root, "black", "none")
	// <use> pointing at nothing.
	ids := map[string]bool{}
	root.Walk(func(n, _ *Node) bool {
		if id := n.Get("id"); id != "" {
			ids[id] = true
		}
		return true
	})
	root.RemoveIf(func(e *Node) bool {
		if e.Tag == "use" {
			return !ids[strings.TrimPrefix(e.Get("href"), "#")]
		}
		return false
	})
	// Hoist definitions.
	var hoist func(n *Node)
	hoist = func(n *Node) {
		out := n.Kids[:0]
		for _, k := range n.Kids {
			if k.Tag == "defs" {
				for _, d := range k.Elements() {
					defs = append(defs, d)
				}
				continue
			}
			if defTags[k.Tag] {
				defs = append(defs, k)
				continue
			}
			hoist(k)
			out = append(out, k)
		}
		n.Kids = out
	}
	hoist(root)
	removeEmptyGroups(root)
	// Ids: keep only referenced ones, with the prefix.
	refs := map[string]bool{}
	all := append(append([]*Node{}, defs...), root)
	for _, top := range all {
		top.Walk(func(n, _ *Node) bool {
			for _, a := range n.Attrs {
				for _, m := range urlRef.FindAllStringSubmatch(a.Value, -1) {
					refs[m[1]] = true
				}
				if a.Name == "href" && strings.HasPrefix(a.Value, "#") {
					refs[a.Value[1:]] = true
				}
			}
			return true
		})
	}
	// Gradients that reference other gradients pull them in; drop unused defs.
	used := func(n *Node) bool { return refs[n.Get("id")] }
	kept := defs[:0]
	for _, d := range defs {
		if used(d) {
			kept = append(kept, d)
		}
	}
	defs = kept
	for _, top := range append(append([]*Node{}, defs...), root) {
		top.Walk(func(n, _ *Node) bool {
			for i, a := range n.Attrs {
				switch {
				case a.Name == "id":
					if refs[a.Value] {
						n.Attrs[i].Value = opt.Prefix + a.Value
					} else {
						n.Attrs[i].Name = ""
					}
				case a.Name == "href" && strings.HasPrefix(a.Value, "#"):
					n.Attrs[i].Value = "#" + opt.Prefix + a.Value[1:]
				default:
					n.Attrs[i].Value = urlRef.ReplaceAllString(a.Value, "url(#"+opt.Prefix+"$1)")
				}
			}
			n.Del("")
			roundAttrs(n, opt.Precision)
			return true
		})
	}
	return defs, root.Kids
}

var urlRef = regexp.MustCompile(`url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)`)

// fontStack gives Fritzing's fonts fallbacks that exist on school laptops.
func fontStack(f string) string {
	l := strings.ToLower(strings.Trim(f, `'" `))
	switch {
	case strings.Contains(l, "ocr"):
		return "'OCR A Std', 'OCR A Extended', Consolas, monospace"
	case strings.Contains(l, "mono") || strings.Contains(l, "courier"):
		return "Consolas, 'Courier New', monospace"
	default:
		return "'Droid Sans', 'Segoe UI', Arial, sans-serif"
	}
}

// inlineCSS turns <style> rules and style attributes into presentation
// attributes. Simple selectors only (tag, .class, #id and combinations
// without spaces); other rules are dropped.
func inlineCSS(root *Node) {
	type rule struct {
		tag, id string
		classes []string
		decls   [][2]string
		order   int
		spec    int
	}
	var rules []rule
	order := 0
	root.Walk(func(n, _ *Node) bool {
		if n.Tag != "style" {
			return true
		}
		css := stripCSSComments(n.TextContent())
		for _, block := range strings.Split(css, "}") {
			sel, body, ok := strings.Cut(block, "{")
			if !ok {
				continue
			}
			decls := parseDecls(body)
			for _, s := range strings.Split(sel, ",") {
				s = strings.TrimSpace(s)
				if s == "" || strings.ContainsAny(s, " >+~:[*@") {
					continue
				}
				r := rule{decls: decls, order: order}
				order++
				rest := s
				// tag
				i := strings.IndexAny(rest, ".#")
				if i < 0 {
					r.tag, rest = rest, ""
				} else {
					r.tag, rest = rest[:i], rest[i:]
				}
				for rest != "" {
					kind := rest[0]
					rest = rest[1:]
					j := strings.IndexAny(rest, ".#")
					var name string
					if j < 0 {
						name, rest = rest, ""
					} else {
						name, rest = rest[:j], rest[j:]
					}
					if kind == '.' {
						r.classes = append(r.classes, name)
					} else {
						r.id = name
					}
				}
				if r.id != "" {
					r.spec += 100
				}
				r.spec += 10 * len(r.classes)
				if r.tag != "" {
					r.spec++
				}
				rules = append(rules, r)
			}
		}
		return true
	})
	sort.SliceStable(rules, func(i, j int) bool {
		if rules[i].spec != rules[j].spec {
			return rules[i].spec < rules[j].spec
		}
		return rules[i].order < rules[j].order
	})
	root.Walk(func(n, _ *Node) bool {
		if n.Tag == "style" {
			return false
		}
		if len(rules) > 0 {
			classes := strings.Fields(n.Get("class"))
			has := func(c string) bool {
				for _, x := range classes {
					if x == c {
						return true
					}
				}
				return false
			}
			for _, r := range rules {
				if r.tag != "" && r.tag != n.Tag || r.id != "" && r.id != n.Get("id") {
					continue
				}
				match := true
				for _, c := range r.classes {
					if !has(c) {
						match = false
					}
				}
				if match {
					for _, d := range r.decls {
						n.Set(d[0], d[1])
					}
				}
			}
		}
		if st := n.Get("style"); st != "" {
			for _, d := range parseDecls(st) {
				n.Set(d[0], d[1])
			}
			n.Del("style")
		}
		n.Del("class")
		return true
	})
	root.RemoveIf(func(e *Node) bool { return e.Tag == "style" })
}

func stripCSSComments(s string) string {
	for {
		i := strings.Index(s, "/*")
		if i < 0 {
			return s
		}
		j := strings.Index(s[i:], "*/")
		if j < 0 {
			return s[:i]
		}
		s = s[:i] + s[i+j+2:]
	}
}

func parseDecls(s string) [][2]string {
	var out [][2]string
	for _, d := range strings.Split(s, ";") {
		k, v, ok := strings.Cut(d, ":")
		if !ok {
			continue
		}
		k = strings.ToLower(strings.TrimSpace(k))
		v = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(v), "!important"))
		if presentationProps[k] && v != "" {
			out = append(out, [2]string{k, v})
		}
	}
	return out
}

// removeInvisible drops shapes that draw nothing (fill none and no stroke),
// such as Fritzing's connector placeholders.
func removeInvisible(n *Node, fill, stroke string) {
	out := n.Kids[:0]
	for _, k := range n.Kids {
		if k.Tag == "" {
			out = append(out, k)
			continue
		}
		f, s := fill, stroke
		if v := k.Get("fill"); v != "" {
			f = v
		}
		if v := k.Get("stroke"); v != "" {
			s = v
		}
		switch k.Tag {
		case "rect", "circle", "ellipse", "line", "polyline", "polygon", "path":
			if (f == "none" || k.Tag == "line") && (s == "none" || s == "") {
				continue
			}
			if k.Get("opacity") == "0" || k.Get("display") == "none" {
				continue
			}
		case "g":
			if k.Get("display") == "none" {
				continue
			}
		}
		if !defTags[k.Tag] && k.Tag != "defs" {
			removeInvisible(k, f, s)
		}
		out = append(out, k)
	}
	n.Kids = out
}

func removeEmptyGroups(n *Node) {
	out := n.Kids[:0]
	for _, k := range n.Kids {
		if k.Tag == "g" || k.Tag == "text" {
			removeEmptyGroups(k)
			if len(k.Kids) == 0 && k.Get("data-cp") == "" {
				continue
			}
		} else if k.Tag != "" {
			removeEmptyGroups(k)
		}
		out = append(out, k)
	}
	n.Kids = out
}

var coordAttrs = map[string]bool{
	"x": true, "y": true, "width": true, "height": true, "cx": true, "cy": true, "r": true,
	"rx": true, "ry": true, "x1": true, "y1": true, "x2": true, "y2": true, "stroke-width": true,
	"font-size": true, "fx": true, "fy": true, "dx": true, "dy": true, "letter-spacing": true,
}

func roundAttrs(n *Node, p int) {
	for i, a := range n.Attrs {
		switch {
		case a.Name == "d":
			n.Attrs[i].Value = formatPath(parsePath(a.Value), p)
		case a.Name == "points":
			n.Attrs[i].Value = formatList(parseNumbers(a.Value), p)
		case a.Name == "transform" || a.Name == "gradientTransform" || a.Name == "patternTransform":
			n.Attrs[i].Value = formatTransform(a.Value, p)
		case coordAttrs[a.Name]:
			v := strings.TrimSpace(a.Value)
			unit := ""
			for _, u := range []string{"px", "%", "pt"} {
				if strings.HasSuffix(v, u) {
					unit = u
					v = strings.TrimSuffix(v, u)
				}
			}
			if unit == "px" {
				unit = ""
			}
			nums := parseNumbers(v)
			if len(nums) == 1 {
				n.Attrs[i].Value = round(nums[0], p) + unit
			} else if len(nums) > 1 && unit == "" {
				n.Attrs[i].Value = formatList(nums, p)
			}
		}
	}
}

func formatList(v []float64, p int) string {
	parts := make([]string, len(v))
	for i, x := range v {
		parts[i] = round(x, p)
	}
	return strings.Join(parts, " ")
}

func formatPath(cmds []PathCmd, p int) string {
	var b strings.Builder
	for _, c := range cmds {
		b.WriteByte(c.Op)
		for i, a := range c.Args {
			s := round(a, p)
			if c.Op&^0x20 == 'A' && (i == 3 || i == 4) {
				s = round(a, 0)
			}
			if i > 0 && !strings.HasPrefix(s, "-") {
				b.WriteByte(' ')
			}
			b.WriteString(s)
		}
	}
	return b.String()
}

var transformFn = regexp.MustCompile(`([a-zA-Z]+)\s*\(([^)]*)\)`)

func formatTransform(s string, p int) string {
	var parts []string
	for _, m := range transformFn.FindAllStringSubmatch(s, -1) {
		dec := p + 3
		if m[1] == "matrix" || m[1] == "scale" {
			dec = 6
		}
		if dec > 6 {
			dec = 6
		}
		parts = append(parts, m[1]+"("+formatList(parseNumbers(m[2]), dec)+")")
	}
	return strings.Join(parts, " ")
}

// stripStrayText drops text outside <text> (it isn't drawn anyway).
func stripStrayText(n *Node) {
	if n.Tag == "text" || n.Tag == "tspan" || n.Tag == "textPath" {
		return
	}
	out := n.Kids[:0]
	for _, k := range n.Kids {
		if k.Tag == "" {
			continue
		}
		stripStrayText(k)
		out = append(out, k)
	}
	n.Kids = out
}
