package main

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
)

const breadboardFZP = "core/Half_breadboard_v2.fzp" // Fritzing's "half+" breadboard

// BreadboardJSON is ui/parts/breadboard/breadboard.json.
type BreadboardJSON struct {
	Title    string           `json:"title"`
	Art      string           `json:"art"`
	Fritzing *FritzingSource  `json:"fritzing"`
	Licence  string           `json:"licence"`
	Unit     string           `json:"unit"`
	Width    float64          `json:"width"`
	Height   float64          `json:"height"`
	Pitch    float64          `json:"pitch"`
	Holes    map[string]Point `json:"holes"`
}

var bbPin = regexp.MustCompile(`^pin(\d+)([A-Z])$`)

func buildBreadboard(src *Source) (*BreadboardJSON, []byte, error) {
	data, err := src.Read(breadboardFZP)
	if err != nil {
		return nil, nil, err
	}
	mod, err := parseFZP(data)
	if err != nil {
		return nil, nil, err
	}
	bbPath := svgPath(breadboardFZP, mod.Images["breadboard"])
	doc, err := loadSVGFrom(src, bbPath)
	if err != nil {
		return nil, nil, err
	}
	holes := map[string]Point{}
	rails := map[string][]struct {
		n int
		p Point
	}{}
	for _, c := range mod.Connectors {
		m := bbPin.FindStringSubmatch(c.ID)
		if m == nil {
			continue
		}
		p, err := doc.Centre(c.Views["breadboard"].SvgID)
		if err != nil {
			return nil, nil, err
		}
		n, _ := strconv.Atoi(m[1])
		row := m[2]
		if row >= "A" && row <= "J" {
			holes[row+m[1]] = p
			continue
		}
		rails[row] = append(rails[row], struct {
			n int
			p Point
		}{n, p})
	}
	if len(holes) != 300 || len(rails) != 4 {
		return nil, nil, fmt.Errorf("breadboard: %d holes and %d rails (want 300 and 4)", len(holes), len(rails))
	}
	// Name the rails by position: the top two (smaller y) are TN (outer,
	// by the blue line) and TP; the bottom two are BN and BP (outer, by
	// the red line), as printed on Fritzing's half+ breadboard.
	type railInfo struct {
		row string
		y   float64
	}
	var ri []railInfo
	for row, list := range rails {
		ri = append(ri, railInfo{row, list[0].p.Y})
	}
	sort.Slice(ri, func(i, j int) bool { return ri[i].y < ri[j].y })
	names := []string{"TN", "TP", "BN", "BP"}
	for i, r := range ri {
		list := rails[r.row]
		sort.Slice(list, func(a, b int) bool { return list[a].n < list[b].n })
		if len(list) != 25 {
			return nil, nil, fmt.Errorf("rail %s has %d holes", r.row, len(list))
		}
		for k, h := range list {
			holes[fmt.Sprintf("%s%d", names[i], k+1)] = h.p
		}
	}
	svg, shift := doc.Output("bb-", doc.viewRect())
	for k, p := range holes {
		holes[k] = Point{r2(p.X + shift.X), r2(p.Y + shift.Y)}
	}
	return &BreadboardJSON{
		Title: mod.Title + " (half+)", Art: "fritzing",
		Fritzing: &FritzingSource{Commit: src.Commit, FZP: breadboardFZP, Title: mod.Title, Breadboard: bbPath},
		Licence:  "CC BY-SA 3.0 (Fritzing parts library)",
		Unit:     "0.01in", Width: r2(doc.W), Height: r2(doc.H), Pitch: 10, Holes: holes,
	}, svg, nil
}
