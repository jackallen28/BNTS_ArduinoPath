package main

import (
	"fmt"
	"strings"
)

// Module is what ArduinoPath needs from a Fritzing .fzp file.
type Module struct {
	Title      string
	Properties map[string]string
	Images     map[string]string // view ("breadboard", "schematic") → image path, e.g. "breadboard/led.svg"
	Connectors []Connector
	Buses      [][]string // connector ids joined inside the part
}

// Connector is one connection point of a part.
type Connector struct {
	ID, Name, Description string
	Views                 map[string]ConnectorView
}

// ConnectorView says which SVG elements draw a connector in one view.
type ConnectorView struct {
	Layer, SvgID, LegID, TerminalID string
}

// Connector finds a connector by id.
func (m *Module) Connector(id string) (Connector, bool) {
	for _, c := range m.Connectors {
		if c.ID == id {
			return c, true
		}
	}
	return Connector{}, false
}

// parseFZP reads a Fritzing part file.
func parseFZP(data []byte) (*Module, error) {
	root, err := parseXML(data)
	if err != nil {
		return nil, err
	}
	if root.Tag != "module" {
		return nil, fmt.Errorf("not a Fritzing part (root is <%s>)", root.Tag)
	}
	m := &Module{Properties: map[string]string{}, Images: map[string]string{}}
	for _, k := range root.Elements() {
		switch k.Tag {
		case "title":
			m.Title = strings.TrimSpace(k.TextContent())
		case "properties":
			for _, p := range k.Elements() {
				if p.Tag == "property" {
					m.Properties[p.Get("name")] = strings.TrimSpace(p.TextContent())
				}
			}
		case "views":
			for _, v := range k.Elements() {
				view := strings.TrimSuffix(v.Tag, "View")
				for _, layers := range v.Elements() {
					if layers.Tag == "layers" && layers.Get("image") != "" {
						m.Images[view] = layers.Get("image")
					}
				}
			}
		case "connectors":
			for _, c := range k.Elements() {
				if c.Tag != "connector" {
					continue
				}
				conn := Connector{ID: c.Get("id"), Name: c.Get("name"), Views: map[string]ConnectorView{}}
				for _, ck := range c.Elements() {
					switch ck.Tag {
					case "description":
						conn.Description = strings.TrimSpace(ck.TextContent())
					case "views":
						for _, v := range ck.Elements() {
							view := strings.TrimSuffix(v.Tag, "View")
							for _, p := range v.Elements() {
								if p.Tag != "p" {
									continue
								}
								if _, seen := conn.Views[view]; seen {
									continue // first layer wins (copper0/copper1 in pcb)
								}
								conn.Views[view] = ConnectorView{
									Layer: p.Get("layer"), SvgID: p.Get("svgId"),
									LegID: p.Get("legId"), TerminalID: p.Get("terminalId"),
								}
							}
						}
					}
				}
				m.Connectors = append(m.Connectors, conn)
			}
		case "buses":
			for _, b := range k.Elements() {
				var ids []string
				for _, nm := range b.Elements() {
					if nm.Tag == "nodeMember" && nm.Get("connectorId") != "" {
						ids = append(ids, nm.Get("connectorId"))
					}
				}
				if len(ids) > 1 {
					m.Buses = append(m.Buses, ids)
				}
			}
		}
	}
	if len(m.Connectors) == 0 {
		return nil, fmt.Errorf("the part has no connectors")
	}
	return m, nil
}
