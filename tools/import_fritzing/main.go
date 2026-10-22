// Command import_fritzing makes ArduinoPath's parts library (ui/parts/)
// from the official Fritzing parts library (CC BY-SA 3.0), pinned to one
// commit so the import is reproducible:
//
//	go run ./tools/import_fritzing
//
// For each part it reads the .fzp (connectors, buses, which SVGs) and the
// breadboard and schematic SVGs, and writes ui/parts/<type>/breadboard.svg,
// schematic.svg and part.json; the half+ breadboard (ui/parts/breadboard/)
// and the boards (ui/parts/boards/<id>/). Parts and boards that aren't in
// the Fritzing library are drawn by ArduinoPath (art.go). It also writes
// content/parts/LICENSE-fritzing.md.
//
// SVGs are cleaned for the web app: no editor metadata, styles turned into
// attributes (the app's Content-Security-Policy blocks inline styles),
// unique ids, rounded numbers, and one unit everywhere (0.01 inch, so the
// breadboard's 0.1" pitch is 10 units).
//
// Files are fetched from raw.githubusercontent.com (or -repo, a local
// checkout of fritzing-parts) and cached. The output is committed; run the
// tool again only to update.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// The fritzing-parts commit everything is imported from (develop, 2025).
const defaultCommit = "27535f2fd02097be9bed229b75aa8e9be282a4a0"

func main() {
	commit := flag.String("commit", defaultCommit, "fritzing-parts commit to import from")
	repo := flag.String("repo", "", "a local checkout of fritzing-parts (instead of downloading)")
	cacheDir, _ := os.UserCacheDir()
	cache := flag.String("cache", filepath.Join(cacheDir, "arduinopath-fritzing"), "folder for downloaded files")
	out := flag.String("out", "ui/parts", "where to write the parts library")
	content := flag.String("content", "content", "ArduinoPath's content folder")
	flag.Parse()
	src := &Source{Commit: *commit, Repo: *repo, Cache: *cache,
		Log: func(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...) }}
	if err := run(src, *out, *content); err != nil {
		fmt.Fprintln(os.Stderr, "import_fritzing:", err)
		os.Exit(1)
	}
}

func run(src *Source, out, content string) error {
	var fromFritzing, ours []string
	index := map[string]any{}

	bb, bbSVG, err := buildBreadboard(src)
	if err != nil {
		return err
	}
	if err := writeFiles(filepath.Join(out, "breadboard"), map[string][]byte{"breadboard.svg": bbSVG}, "breadboard.json", bb); err != nil {
		return err
	}
	fromFritzing = append(fromFritzing, fmt.Sprintf("| breadboard | %s | `%s`, `%s` |", bb.Fritzing.Title, bb.Fritzing.FZP, bb.Fritzing.Breadboard))

	known, err := readPartTypes(content)
	if err != nil {
		return err
	}
	var types []string
	for _, spec := range partSpecs() {
		if !known[spec.Type] {
			return fmt.Errorf("part type %q isn't in content/parts/index.json", spec.Type)
		}
		delete(known, spec.Type)
		p, err := buildPart(src, spec)
		if err != nil {
			return err
		}
		if err := writeFiles(filepath.Join(out, spec.Type), map[string][]byte{"breadboard.svg": p.BBSVG, "schematic.svg": p.SchSVG}, "part.json", p.JSON); err != nil {
			return err
		}
		types = append(types, spec.Type)
		if p.JSON.Fritzing != nil {
			fz := p.JSON.Fritzing
			fromFritzing = append(fromFritzing, fmt.Sprintf("| %s | %s | `%s`, `%s`, `%s` |", spec.Type, fz.Title, fz.FZP, fz.Breadboard, fz.Schematic))
		} else {
			ours = append(ours, fmt.Sprintf("| %s | %s |", spec.Type, p.JSON.Title))
		}
	}
	if len(known) > 0 {
		return fmt.Errorf("no art for part types %v", sortedKeys(known))
	}

	var boards []string
	for _, spec := range boardSpecs() {
		cb, err := readContentBoard(content, spec.ID)
		if err != nil {
			return err
		}
		bj, bbSVG, schSVG, err := buildBoard(src, spec, cb)
		if err != nil {
			return err
		}
		if err := writeFiles(filepath.Join(out, "boards", spec.ID), map[string][]byte{"breadboard.svg": bbSVG, "schematic.svg": schSVG}, "board.json", bj); err != nil {
			return err
		}
		boards = append(boards, spec.ID)
		if bj.Fritzing != nil {
			fz := bj.Fritzing
			fromFritzing = append(fromFritzing, fmt.Sprintf("| board %s | %s | `%s`, `%s`, `%s` |", spec.ID, fz.Title, fz.FZP, fz.Breadboard, fz.Schematic))
		} else {
			ours = append(ours, fmt.Sprintf("| board %s | %s |", spec.ID, bj.Title))
		}
	}
	index["commit"] = src.Commit
	index["parts"] = types
	index["boards"] = boards
	if err := writeJSON(filepath.Join(out, "index.json"), index); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(content, "parts", "LICENSE-fritzing.md"), licence(src.Commit, fromFritzing, ours), 0o644)
}

func readPartTypes(content string) (map[string]bool, error) {
	data, err := os.ReadFile(filepath.Join(content, "parts", "index.json"))
	if err != nil {
		return nil, err
	}
	var idx struct{ Parts map[string]json.RawMessage }
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, err
	}
	out := map[string]bool{}
	for k := range idx.Parts {
		out[k] = true
	}
	return out, nil
}

func writeFiles(dir string, files map[string][]byte, jsonName string, v any) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return err
		}
	}
	return writeJSON(filepath.Join(dir, jsonName), v)
}

func writeJSON(path string, v any) error {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return err
	}
	return os.WriteFile(path, b.Bytes(), 0o644)
}

func licence(commit string, fromFritzing, ours []string) []byte {
	sort.Strings(fromFritzing)
	sort.Strings(ours)
	var b strings.Builder
	fmt.Fprintf(&b, `# Parts art: Fritzing parts library (CC BY-SA 3.0)

Most of ArduinoPath's breadboard and schematic pictures come from the
**Fritzing parts library** (https://github.com/fritzing/fritzing-parts), by the
Fritzing team and contributors, used under the
**Creative Commons Attribution-ShareAlike 3.0** licence
(https://creativecommons.org/licenses/by-sa/3.0/).

They were imported from commit `+"`%s`"+` by `+"`go run ./tools/import_fritzing`"+`,
which tidies them for the web app: editor metadata removed, styles turned into
attributes, ids made unique, numbers rounded, one drawing unit (0.01 inch)
everywhere, some elements tagged or grouped so the simulator can light,
press or turn them (LED colours, resistor colour bands, the servo horn, the
button cap, the potentiometer's rotor). These changed SVG files under
`+"`ui/parts/`"+` are adaptations of the Fritzing art and are shared under the
same licence, **CC BY-SA 3.0**. The licence applies to those SVG files only:
ArduinoPath's own code, and the art ArduinoPath drew itself (listed below),
are not covered by it.

## From the Fritzing parts library

| ArduinoPath | Fritzing part | Files (in fritzing-parts) |
|---|---|---|
%s

## Drawn by ArduinoPath (not from Fritzing)

These parts and boards aren't in the Fritzing core library, so ArduinoPath
drew them in the same style (part.json says `+"`\"art\": \"arduinopath\"`"+`):

| ArduinoPath | Picture |
|---|---|
%s
`, commit, strings.Join(fromFritzing, "\n"), strings.Join(ours, "\n"))
	return []byte(b.String())
}
