// Command packboards builds the board tools bundle for ArduinoPath (CI runs
// it after -setup-arduino on each operating system):
//
//	go run ./tools/packboards -in $RUNNER_TEMP/cp/arduino -out dist/boards.zip
//	go run ./tools/packboards -append dist/ArduinoPath.exe -bundle dist/boards.zip
//
// The first packs an installed Arduino folder (see internal/arduino); the
// second adds the bundle to the end of ArduinoPath.exe.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"arduinopath/internal/arduino"
)

func main() {
	in := flag.String("in", "", "the Arduino folder made by -setup-arduino")
	out := flag.String("out", "boards.zip", "the bundle to write")
	appendTo := flag.String("append", "", "add -bundle to the end of this program instead")
	bundle := flag.String("bundle", "boards.zip", "the bundle to add (with -append)")
	flag.Parse()
	if err := run(*in, *out, *appendTo, *bundle); err != nil {
		fmt.Fprintln(os.Stderr, "packboards:", err)
		os.Exit(1)
	}
}

func run(in, out, appendTo, bundle string) error {
	if appendTo != "" {
		if err := arduino.AppendBundle(appendTo, bundle); err != nil {
			return err
		}
		b, err := arduino.OpenBundle(appendTo)
		if err != nil {
			return fmt.Errorf("checking %s: %w", appendTo, err)
		}
		defer b.Close()
		fmt.Printf("added the board tools to %s (%d families)\n", appendTo, len(b.Manifest.Families))
		return nil
	}
	env := &arduino.Env{Dir: in}
	if !env.Ready() {
		return fmt.Errorf("%s has no board tools installed at the pinned versions (run -setup-arduino)", in)
	}
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	m, err := arduino.Pack(in, f, arduino.Pinned().Hash())
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	fi, _ := os.Stat(out)
	fmt.Printf("wrote %s (%.0f MB) for %s/%s\n", out, float64(fi.Size())/1e6, m.OS, m.Arch)
	biggest(in)
	for _, fam := range append([]string{"common"}, arduino.Families...) {
		info := m.Families[fam]
		fmt.Printf("  %-8s %6d files %8.0f MB unpacked\n", fam, info.Files, float64(info.Bytes)/1e6)
	}
	return nil
}

// biggest prints the largest folders in the packages (to see what to trim).
func biggest(dir string) {
	sizes := map[string]int64{}
	filepath.WalkDir(filepath.Join(dir, "data", "packages"), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		parts := strings.Split(filepath.ToSlash(rel), "/")
		for depth := 5; depth <= 9 && depth < len(parts); depth++ {
			sizes[strings.Join(parts[:depth], "/")] += info.Size()
		}
		return nil
	})
	type kv struct {
		k string
		v int64
	}
	var all []kv
	for k, v := range sizes {
		if v > 50e6 {
			all = append(all, kv{k, v})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].v > all[j].v })
	if len(all) > 60 {
		all = all[:60]
	}
	fmt.Println("largest folders:")
	for _, e := range all {
		fmt.Printf("  %8.0f MB  %s\n", float64(e.v)/1e6, e.k)
	}
}
