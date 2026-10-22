package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

// Node is one element (or text) of an SVG or fzp document. Attribute names
// keep a "prefix:" only for xlink (which becomes plain href) and xml.
type Node struct {
	Tag   string // "" for a text node
	Attrs []Attr
	Kids  []*Node
	Text  string
}

// Attr is one attribute.
type Attr struct{ Name, Value string }

const (
	nsSVG   = "http://www.w3.org/2000/svg"
	nsXLink = "http://www.w3.org/1999/xlink"
	nsXML   = "http://www.w3.org/XML/1998/namespace"
)

// parseXML reads a document into a tree. Elements and attributes from
// editor namespaces (Inkscape, Sodipodi, Illustrator, RDF...) are dropped.
// Whitespace-only text is dropped except inside text and style elements.
func parseXML(data []byte) (*Node, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = false
	dec.Entity = xml.HTMLEntity
	dec.CharsetReader = func(charset string, r io.Reader) (io.Reader, error) { return r, nil }
	var stack []*Node
	var root *Node
	skip := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if skip > 0 || !keepNamespace(t.Name.Space) {
				skip++
				continue
			}
			n := &Node{Tag: t.Name.Local}
			for _, a := range t.Attr {
				switch {
				case a.Name.Space == "xmlns" || a.Name.Local == "xmlns" && a.Name.Space == "":
					continue
				case a.Name.Space == nsXLink || a.Name.Space == "xlink":
					n.Attrs = append(n.Attrs, Attr{a.Name.Local, a.Value})
				case a.Name.Space == nsXML || a.Name.Space == "xml":
					continue
				case a.Name.Space == "":
					n.Attrs = append(n.Attrs, Attr{a.Name.Local, a.Value})
				}
			}
			if len(stack) > 0 {
				p := stack[len(stack)-1]
				p.Kids = append(p.Kids, n)
			} else if root == nil {
				root = n
			}
			stack = append(stack, n)
		case xml.EndElement:
			if skip > 0 {
				skip--
				continue
			}
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			if skip > 0 || len(stack) == 0 {
				continue
			}
			p := stack[len(stack)-1]
			s := string(t)
			if strings.TrimSpace(s) == "" && !keepsText(p.Tag) {
				continue
			}
			p.Kids = append(p.Kids, &Node{Text: s})
		}
	}
	if root == nil {
		return nil, fmt.Errorf("no root element")
	}
	return root, nil
}

func keepNamespace(ns string) bool {
	return ns == "" || ns == nsSVG || strings.HasSuffix(ns, "/svg") || ns == "svg"
}

func keepsText(tag string) bool {
	return tag == "text" || tag == "tspan" || tag == "style" || tag == "textPath" ||
		tag == "description" || tag == "title" || tag == "property" || tag == "label"
}

// Get returns an attribute's value ("" if missing).
func (n *Node) Get(name string) string {
	for _, a := range n.Attrs {
		if a.Name == name {
			return a.Value
		}
	}
	return ""
}

// Has reports whether the attribute is present.
func (n *Node) Has(name string) bool {
	for _, a := range n.Attrs {
		if a.Name == name {
			return true
		}
	}
	return false
}

// Set sets (or adds) an attribute.
func (n *Node) Set(name, value string) {
	for i, a := range n.Attrs {
		if a.Name == name {
			n.Attrs[i].Value = value
			return
		}
	}
	n.Attrs = append(n.Attrs, Attr{name, value})
}

// Del removes an attribute.
func (n *Node) Del(name string) {
	out := n.Attrs[:0]
	for _, a := range n.Attrs {
		if a.Name != name {
			out = append(out, a)
		}
	}
	n.Attrs = out
}

// Walk calls fn for n and every element below it, parents first. Returning
// false skips the children.
func (n *Node) Walk(fn func(n, parent *Node) bool) {
	var walk func(n, parent *Node)
	walk = func(n, parent *Node) {
		if n.Tag == "" {
			return
		}
		if !fn(n, parent) {
			return
		}
		for _, k := range n.Kids {
			walk(k, n)
		}
	}
	walk(n, nil)
}

// Find returns the first element with this id.
func (n *Node) Find(id string) *Node {
	var found *Node
	n.Walk(func(e, _ *Node) bool {
		if found != nil {
			return false
		}
		if e.Get("id") == id {
			found = e
			return false
		}
		return true
	})
	return found
}

// Elements returns the element children.
func (n *Node) Elements() []*Node {
	var out []*Node
	for _, k := range n.Kids {
		if k.Tag != "" {
			out = append(out, k)
		}
	}
	return out
}

// TextContent joins all the text below n.
func (n *Node) TextContent() string {
	var b strings.Builder
	var walk func(n *Node)
	walk = func(n *Node) {
		if n.Tag == "" {
			b.WriteString(n.Text)
			return
		}
		for _, k := range n.Kids {
			walk(k)
		}
	}
	walk(n)
	return b.String()
}

// Clone copies n deeply.
func (n *Node) Clone() *Node {
	c := &Node{Tag: n.Tag, Text: n.Text, Attrs: append([]Attr(nil), n.Attrs...)}
	for _, k := range n.Kids {
		c.Kids = append(c.Kids, k.Clone())
	}
	return c
}

// RemoveIf deletes every element below n for which fn is true.
func (n *Node) RemoveIf(fn func(e *Node) bool) {
	out := n.Kids[:0]
	for _, k := range n.Kids {
		if k.Tag != "" && fn(k) {
			continue
		}
		k.RemoveIf(fn)
		out = append(out, k)
	}
	n.Kids = out
}

// el makes an element: el("rect", "x", "1", "y", "2").
func el(tag string, attrs ...string) *Node {
	n := &Node{Tag: tag}
	for i := 0; i+1 < len(attrs); i += 2 {
		n.Attrs = append(n.Attrs, Attr{attrs[i], attrs[i+1]})
	}
	return n
}

// Add appends children and returns n.
func (n *Node) Add(kids ...*Node) *Node {
	n.Kids = append(n.Kids, kids...)
	return n
}

// textNode makes a text node.
func textNode(s string) *Node { return &Node{Text: s} }

// writeXML serialises n compactly.
func writeXML(w *bytes.Buffer, n *Node) {
	if n.Tag == "" {
		xml.EscapeText(w, []byte(n.Text))
		return
	}
	w.WriteByte('<')
	w.WriteString(n.Tag)
	for _, a := range n.Attrs {
		w.WriteByte(' ')
		w.WriteString(a.Name)
		w.WriteString(`="`)
		w.WriteString(escapeAttr(a.Value))
		w.WriteByte('"')
	}
	if len(n.Kids) == 0 {
		w.WriteString("/>")
		return
	}
	w.WriteByte('>')
	for _, k := range n.Kids {
		writeXML(w, k)
	}
	w.WriteString("</")
	w.WriteString(n.Tag)
	w.WriteByte('>')
}

func escapeAttr(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", `"`, "&quot;", "\n", " ", "\t", " ", "\r", " ")
	return r.Replace(s)
}
