package server

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"arduinopath/internal/content"
)

const (
	maxNames      = 4
	maxNameRunes  = 30
	maxSchoolRune = 60
)

// cleanName tidies a first name: single spaces, and a capital first letter
// if it was typed all in lower case. It returns "" if the name isn't valid.
func cleanName(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if n == 0 || n > maxNameRunes {
		return ""
	}
	letters := 0
	for _, r := range s {
		switch {
		case unicode.IsLetter(r):
			letters++
		case unicode.Is(unicode.Mn, r), r == ' ' || r == '-' || r == '\'' || r == '’' || r == '.':
		default:
			return ""
		}
	}
	if letters == 0 {
		return ""
	}
	if s == strings.ToLower(s) {
		words := strings.Split(s, " ")
		for i, w := range words {
			r, size := utf8.DecodeRuneInString(w)
			words[i] = string(unicode.ToUpper(r)) + w[size:]
		}
		s = strings.Join(words, " ")
	}
	return s
}

// cleanNames checks 1 to 4 first names (students sharing a kit), with no repeats.
func cleanNames(names []string) ([]string, error) {
	if len(names) == 0 || len(names) > maxNames {
		return nil, errors.New("Type 1 to 4 first names.")
	}
	out := make([]string, 0, len(names))
	for _, n := range names {
		c := cleanName(n)
		if c == "" {
			return nil, errors.New("First names can only have letters, spaces, dashes and apostrophes (up to 30 letters).")
		}
		for _, prev := range out {
			if strings.EqualFold(prev, c) {
				return nil, errors.New("Each name only needs to be typed once.")
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// cleanSchool checks a school name.
func cleanSchool(s string) (string, error) {
	s = strings.Join(strings.Fields(s), " ")
	n := utf8.RuneCountInString(s)
	if n == 0 || n > maxSchoolRune {
		return "", errors.New("Type your school's name (up to 60 letters).")
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.Is(unicode.Mn, r) || strings.ContainsRune(" -'’.,&()/", r)) {
			return "", errors.New("A school name can only have letters, numbers, spaces and simple punctuation.")
		}
	}
	return s, nil
}

// Settings are a student's choices, changed in Settings at any time.
type Settings struct {
	HelpLevel string `json:"help_level"`              // "" until they choose, then beginner | moderate | advanced
	Board     string `json:"board"`                   // a board id
	Nudges    bool   `json:"nudges"`                  // the adaptive Coach's "stuck?" nudges
	BoardVar  string `json:"board_variant,omitempty"` // e.g. "old-bootloader" for Nano clones
	Coding    string `json:"coding,omitempty"`        // "" or text | blocks: how they like to write code
}

var helpLevels = []string{"beginner", "moderate", "advanced"}
var codingStyles = []string{"text", "blocks"}

func defaultSettings(c *content.Catalogue) Settings {
	return Settings{Board: c.DefaultBoard(), Nudges: true}
}

// storedSettings reads a student's saved settings leniently: anything that
// no longer fits the content (a board that was removed, say) falls back to
// its default instead of locking the student out or losing the rest.
func storedSettings(data []byte, c *content.Catalogue) Settings {
	st := defaultSettings(c)
	json.Unmarshal(data, &st)
	if st.HelpLevel != "" && !contains(helpLevels, st.HelpLevel) {
		st.HelpLevel = ""
	}
	if st.Coding != "" && !contains(codingStyles, st.Coding) {
		st.Coding = ""
	}
	if _, ok := c.Board(st.Board); !ok {
		st.Board, st.BoardVar = c.DefaultBoard(), ""
	}
	if checkSettings(st, c) != nil {
		st.BoardVar = ""
	}
	return st
}

func checkSettings(st Settings, c *content.Catalogue) error {
	if st.HelpLevel != "" && !contains(helpLevels, st.HelpLevel) {
		return errors.New("Pick Beginner, Moderate or Advanced.")
	}
	if st.Coding != "" && !contains(codingStyles, st.Coding) {
		return errors.New("Pick Text or Blocks.")
	}
	b, ok := c.Board(st.Board)
	if !ok {
		return errors.New("Pick one of the boards on the list.")
	}
	if st.BoardVar != "" {
		var raw struct {
			Variants []struct{ ID string } `json:"variants"`
		}
		json.Unmarshal(b.Raw, &raw)
		found := false
		for _, v := range raw.Variants {
			found = found || v.ID == st.BoardVar
		}
		if !found {
			return errors.New("That board setting doesn't match the board.")
		}
	}
	return nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
