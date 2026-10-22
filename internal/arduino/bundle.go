package arduino

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// The board tools are built into ArduinoPath as a zip ("the bundle"): every
// file of an installed Arduino folder (see Env), each under its family's
// prefix, so one family can be unpacked without the others:
//
//	manifest.json                       what's inside (BundleManifest)
//	common/bin/arduino-cli              arduino-cli, the indexes, the libraries,
//	common/data/...                     the serial discovery tools
//	common/user/libraries/...
//	avr/data/packages/arduino/...       Arduino Uno, Nano, Mega
//	esp8266/data/packages/esp8266/...   NodeMCU, D1 mini
//	esp32/data/packages/esp32/...       ESP32 boards
//
// On Windows the zip is appended to ArduinoPath.exe, followed by a 16-byte
// trailer (bundleMagic and the zip's offset); on macOS it's
// ArduinoPath.app/Contents/Resources/boards.zip.

// Families are the board families, in the order they're packed.
var Families = []string{"avr", "esp8266", "esp32"}

const bundleMagic = "CPBOARD1"

// BundleManifest describes a bundle.
type BundleManifest struct {
	Hash     string                      `json:"hash"` // Requirements.Hash() of the tools inside
	OS       string                      `json:"os"`
	Arch     string                      `json:"arch"`
	Families map[string]BundleFamilyInfo `json:"families"` // including "common"
}

// BundleFamilyInfo is the size of one family's files.
type BundleFamilyInfo struct {
	Files int   `json:"files"`
	Bytes int64 `json:"bytes"` // unpacked
}

// familyOf says which family a file of an Arduino folder belongs to.
func familyOf(rel string) string {
	parts := strings.Split(rel, "/")
	if len(parts) >= 3 && parts[0] == "data" && parts[1] == "packages" {
		switch parts[2] {
		case "arduino":
			return "avr"
		case "esp8266":
			return "esp8266"
		case "esp32":
			return "esp32"
		}
	}
	return "common"
}

// skipWhenPacking leaves out what a laptop doesn't need: downloads, caches,
// settings (rewritten when unpacked), and for the ESP32 the debuggers and
// the libraries of ESP32 chips ArduinoPath doesn't support. Directories are
// kept (empty) so arduino-cli still sees every tool as installed.
func skipWhenPacking(rel string) bool {
	switch rel {
	case "arduino-cli.yaml", "installed.json", "data/inventory.yaml":
		return true
	}
	for _, dir := range []string{"downloads", "build-cache", "build", "sketches", "data/staging", "data/tmp"} {
		if rel == dir || strings.HasPrefix(rel, dir+"/") {
			return true
		}
	}
	parts := strings.Split(rel, "/")
	// Documentation and translations inside the toolchains.
	for i := 0; i+1 < len(parts); i++ {
		if parts[i] == "share" && (parts[i+1] == "doc" || parts[i+1] == "man" || parts[i+1] == "info" || parts[i+1] == "locale") {
			return true
		}
	}
	// data/packages/esp32/tools/<tool>/<version>/...
	if len(parts) >= 7 && parts[0] == "data" && parts[1] == "packages" && parts[2] == "esp32" && parts[3] == "tools" {
		tool := parts[4]
		if strings.Contains(tool, "gdb") || strings.Contains(tool, "openocd") || tool == "esp-rom-elfs" {
			return true // keep <tool>/<version>/ itself, empty
		}
		// The Xtensa compiler's libraries for ESP32-S2 and S3 chips.
		if tool == "esp-x32" || strings.HasPrefix(tool, "xtensa") {
			for _, p := range parts[6:] {
				if strings.Contains(p, "esp32s2") || strings.Contains(p, "esp32s3") {
					return true
				}
			}
		}
		// <chip>-libs: the precompiled ESP-IDF for one chip. Only ours.
		if strings.HasSuffix(tool, "-libs") && strings.HasPrefix(tool, "esp32") && tool != "esp32-libs" && tool != "esp32c3-libs" && tool != "esp32-arduino-libs" {
			return true
		}
		// picolibc: another C library the toolchains carry; Arduino uses newlib.
		if (tool == "esp-x32" || tool == "esp-rv32") && parts[6] == "picolibc" {
			return true
		}
		// The RISC-V compiler's libraries for other RISC-V chips: the C3 is
		// rv32imc (the base library stays for the compiler's own use).
		if tool == "esp-rv32" {
			for _, p := range parts[6:] {
				if strings.HasPrefix(p, "rv32") && p != "rv32imc_zicsr_zifencei" && p != "rv32imc" {
					return true
				}
			}
		}
		// esp32-arduino-libs/<version>/<chip>/... (older cores): only our chips.
		if tool == "esp32-arduino-libs" {
			chip := parts[6]
			if strings.HasPrefix(chip, "esp32") && chip != "esp32" && chip != "esp32c3" {
				return true
			}
		}
	}
	return false
}

// Pack writes the Arduino folder dir (set up by Env.Setup) as a bundle.
func Pack(dir string, w io.Writer, hash string) (BundleManifest, error) {
	m := BundleManifest{Hash: hash, OS: runtime.GOOS, Arch: runtime.GOARCH, Families: map[string]BundleFamilyInfo{}}
	type entry struct{ rel, family string }
	var entries []entry
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		if rel == "." {
			return nil
		}
		if skipWhenPacking(rel) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		entries = append(entries, entry{rel, familyOf(rel)})
		return nil
	})
	if err != nil {
		return m, err
	}
	// Families in a fixed order so each family's files are together.
	order := map[string]int{"common": 0, "avr": 1, "esp8266": 2, "esp32": 3}
	sort.SliceStable(entries, func(i, j int) bool { return order[entries[i].family] < order[entries[j].family] })

	zw := zip.NewWriter(w)
	for _, e := range entries {
		full := filepath.Join(dir, filepath.FromSlash(e.rel))
		fi, err := os.Lstat(full)
		if err != nil {
			return m, err
		}
		h, err := zip.FileInfoHeader(fi)
		if err != nil {
			return m, err
		}
		h.Name = e.family + "/" + e.rel
		info := m.Families[e.family]
		switch {
		case fi.IsDir():
			h.Name += "/"
			if _, err := zw.CreateHeader(h); err != nil {
				return m, err
			}
		case fi.Mode()&fs.ModeSymlink != 0:
			target, err := os.Readlink(full)
			if err != nil {
				return m, err
			}
			fw, err := zw.CreateHeader(h)
			if err != nil {
				return m, err
			}
			io.WriteString(fw, target)
			info.Files++
		default:
			h.Method = zip.Deflate
			fw, err := zw.CreateHeader(h)
			if err != nil {
				return m, err
			}
			f, err := os.Open(full)
			if err != nil {
				return m, err
			}
			n, err := io.Copy(fw, f)
			f.Close()
			if err != nil {
				return m, err
			}
			info.Files++
			info.Bytes += n
		}
		m.Families[e.family] = info
	}
	mf, err := zw.Create("manifest.json")
	if err != nil {
		return m, err
	}
	json.NewEncoder(mf).Encode(m)
	return m, zw.Close()
}

// AppendBundle adds a bundle to the end of a program (ArduinoPath.exe).
func AppendBundle(exe, bundle string) error {
	out, err := os.OpenFile(exe, os.O_WRONLY|os.O_APPEND, 0)
	if err != nil {
		return err
	}
	defer out.Close()
	fi, err := out.Stat()
	if err != nil {
		return err
	}
	in, err := os.Open(bundle)
	if err != nil {
		return err
	}
	defer in.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	var trailer [16]byte
	copy(trailer[:8], bundleMagic)
	binary.LittleEndian.PutUint64(trailer[8:], uint64(fi.Size()))
	if _, err := out.Write(trailer[:]); err != nil {
		return err
	}
	return out.Close()
}

// Bundle is an open bundle.
type Bundle struct {
	Path     string
	Manifest BundleManifest
	f        *os.File
	zr       *zip.Reader
}

// ErrNoBundle means this copy of ArduinoPath has no board tools built in.
var ErrNoBundle = errors.New("no board tools are built into this copy of ArduinoPath")

// OpenBundle opens the bundle in path: a zip, or a program with a zip
// appended (see AppendBundle).
func OpenBundle(path string) (*Bundle, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	start, size := int64(0), fi.Size()
	var trailer [16]byte
	if size > 16 {
		if _, err := f.ReadAt(trailer[:], size-16); err == nil && string(trailer[:8]) == bundleMagic {
			start = int64(binary.LittleEndian.Uint64(trailer[8:]))
			size = size - 16 - start
			if start <= 0 || size <= 0 {
				f.Close()
				return nil, fmt.Errorf("%s: damaged board tools", path)
			}
		} else if !strings.HasSuffix(strings.ToLower(path), ".zip") {
			f.Close()
			return nil, ErrNoBundle
		}
	}
	zr, err := zip.NewReader(io.NewSectionReader(f, start, size), size)
	if err != nil {
		f.Close()
		return nil, fmt.Errorf("%s: damaged board tools: %w", path, err)
	}
	b := &Bundle{Path: path, f: f, zr: zr}
	for _, zf := range zr.File {
		if zf.Name == "manifest.json" {
			rc, err := zf.Open()
			if err == nil {
				err = json.NewDecoder(io.LimitReader(rc, 1<<20)).Decode(&b.Manifest)
				rc.Close()
			}
			if err != nil {
				f.Close()
				return nil, fmt.Errorf("%s: damaged board tools: %w", path, err)
			}
		}
	}
	if b.Manifest.Hash == "" {
		f.Close()
		return nil, fmt.Errorf("%s: no manifest in the board tools", path)
	}
	return b, nil
}

// FindBundle looks for the board tools: in the program itself (Windows),
// in the app's Resources folder (macOS), or as boards.zip beside the program.
func FindBundle() (*Bundle, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	dir := filepath.Dir(exe)
	for _, p := range []string{exe, filepath.Join(dir, "..", "Resources", "boards.zip"), filepath.Join(dir, "boards.zip")} {
		b, err := OpenBundle(p)
		if err == nil {
			return b, nil
		}
		if !errors.Is(err, ErrNoBundle) && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
	}
	return nil, ErrNoBundle
}

// Close closes the bundle.
func (b *Bundle) Close() error { return b.f.Close() }

// Has reports whether the bundle holds a family.
func (b *Bundle) Has(family string) bool {
	_, ok := b.Manifest.Families[family]
	return ok
}

// Extract unpacks one family into dir (an Arduino folder, see Env),
// calling progress with the bytes done so far. Files are written beside
// their final name and renamed, so a stopped unpack is simply redone.
func (b *Bundle) Extract(family, dir string, progress func(done int64)) error {
	prefix := family + "/"
	var done int64
	type link struct{ path, target string }
	var links []link
	for _, zf := range b.zr.File {
		if !strings.HasPrefix(zf.Name, prefix) {
			continue
		}
		rel := strings.TrimPrefix(zf.Name, prefix)
		if rel == "" || !fs.ValidPath(strings.TrimSuffix(rel, "/")) {
			return fmt.Errorf("bad file name in the board tools: %q", zf.Name)
		}
		dest := filepath.Join(dir, filepath.FromSlash(rel))
		mode := zf.Mode()
		switch {
		case mode.IsDir():
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return err
			}
		case mode&fs.ModeSymlink != 0:
			target, err := readSmall(zf)
			if err != nil {
				return err
			}
			if path.IsAbs(target) || !withinDir(rel, target) {
				return fmt.Errorf("unsafe link in the board tools: %q -> %q", rel, target)
			}
			links = append(links, link{dest, target})
		default:
			if err := extractOne(zf, dest, mode); err != nil {
				return err
			}
			done += int64(zf.UncompressedSize64)
			if progress != nil {
				progress(done)
			}
		}
	}
	// Links last, once the files they point at exist.
	for _, l := range links {
		os.Remove(l.path)
		if err := os.MkdirAll(filepath.Dir(l.path), 0o755); err != nil {
			return err
		}
		if err := os.Symlink(l.target, l.path); err != nil {
			return err
		}
	}
	return nil
}

// withinDir reports whether a link at rel pointing at target stays inside the bundle.
func withinDir(rel, target string) bool {
	joined := path.Clean(path.Join(path.Dir(rel), target))
	return !strings.HasPrefix(joined, "../") && joined != ".."
}

func readSmall(zf *zip.File) (string, error) {
	rc, err := zf.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, 4096))
	return string(bytes.TrimSpace(b)), err
}

func extractOne(zf *zip.File, dest string, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	rc, err := zf.Open()
	if err != nil {
		return err
	}
	defer rc.Close()
	perm := fs.FileMode(0o644)
	if mode&0o111 != 0 {
		perm = 0o755
	}
	tmp := dest + ".cpnew"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, rc); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	os.Remove(dest)
	return os.Rename(tmp, dest)
}
