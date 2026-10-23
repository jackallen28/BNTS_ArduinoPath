package content

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// BoardPin is one usable pin on a board.
type BoardPin struct {
	Code   string   `json:"code"`
	Number int      `json:"number"`
	Label  string   `json:"label"`
	Modes  []string `json:"modes"`
}

type boardPins struct {
	Pins      []BoardPin        `json:"pins"`
	PinPlan   map[string]string `json:"pin_plan"`
	AnalogMax int               `json:"analog_max"`
}

func (b Board) pins() boardPins {
	var p boardPins
	json.Unmarshal(b.Raw, &p)
	return p
}

// Pin finds a pin by its code ("13", "A0", "D5").
func (b Board) Pin(code string) (BoardPin, bool) {
	pins := b.pins().Pins
	i := slices.IndexFunc(pins, func(p BoardPin) bool { return p.Code == code })
	if i < 0 {
		return BoardPin{}, false
	}
	return pins[i], true
}

// Supports says whether a project lists a board (by id or keyword).
func (p ProjectSummary) Supports(b Board) bool {
	for _, k := range p.Boards {
		switch k {
		case "all":
			return true
		case "esp":
			if strings.HasPrefix(b.Family, "esp") {
				return true
			}
		default:
			if k == b.ID || k == b.Family {
				return true
			}
		}
	}
	return false
}

// ProjectBoards is the boards a project works with.
func (c *Catalogue) ProjectBoards(p ProjectSummary) []Board {
	var out []Board
	for _, b := range c.Boards {
		if p.Supports(b) {
			out = append(out, b)
		}
	}
	return out
}

// PinPlan is the role → pin code map for a project on a board: the board's
// standard pin plan, then the project's overrides for "all", the board's
// family and the board itself.
func PinPlan(p Project, b Board) map[string]string {
	plan := map[string]string{}
	for role, code := range b.pins().PinPlan {
		plan[role] = code
	}
	var over struct {
		Pins map[string]map[string]string `json:"pins"`
	}
	json.Unmarshal(p.Raw, &over)
	for _, key := range []string{"all", b.Family, b.ID} {
		for role, code := range over.Pins[key] {
			plan[role] = code
		}
	}
	return plan
}

var wordRe = regexp.MustCompile(`\b[A-Z][A-Z0-9_]*\b`)

// RolesIn lists the pin roles a sketch uses, in the order they first appear.
func RolesIn(code string, plan map[string]string) []string {
	var roles []string
	for _, w := range wordRe.FindAllString(code, -1) {
		if _, ok := plan[w]; ok && !slices.Contains(roles, w) {
			roles = append(roles, w)
		}
	}
	return roles
}

// PinHeader is what {{pins}} becomes: a #define for each role the code
// uses (and ANALOG_MAX when it's used), for this board.
func PinHeader(p Project, b Board, code string) string {
	plan := PinPlan(p, b)
	var sb strings.Builder
	fmt.Fprintf(&sb, "// Pins for your %s (from the Wiring Wizard)\n", b.Name)
	for _, role := range RolesIn(code, plan) {
		fmt.Fprintf(&sb, "#define %s %s\n", role, plan[role])
	}
	if regexp.MustCompile(`\bANALOG_MAX\b`).MatchString(code) {
		fmt.Fprintf(&sb, "#define ANALOG_MAX %s\n", strconv.Itoa(b.pins().AnalogMax))
	}
	return sb.String()
}

// ExpandPins replaces {{pins}} in a starter or demo with the pin header.
func ExpandPins(p Project, b Board, code string) string {
	if !strings.Contains(code, "{{pins}}") {
		return code
	}
	return strings.Replace(code, "{{pins}}", PinHeader(p, b, code), 1)
}
