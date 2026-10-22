// Command macapp builds ArduinoPath.app from two macOS builds of
// cmd/arduinopath (Intel and Apple Silicon). It runs on any computer:
//
//	GOOS=darwin GOARCH=amd64 go build -o dist/arduinopath-amd64 ./cmd/arduinopath
//	GOOS=darwin GOARCH=arm64 go build -o dist/arduinopath-arm64 ./cmd/arduinopath
//	go run ./tools/macapp -version 0.3.0 -amd64 dist/arduinopath-amd64 -arm64 dist/arduinopath-arm64 -out dist
//
// The app holds one universal program (both builds, so it runs natively on
// every Mac), Info.plist, the icon and (with -boards) the board tools. Sign it afterwards (ad hoc at least:
// Apple Silicon Macs only run signed code), e.g. codesign --force --deep -s - dist/ArduinoPath.app
package main

import (
	"bytes"
	"debug/macho"
	"encoding/binary"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
)

const bundleID = "org.bnts.arduinopath"

func main() {
	amd64 := flag.String("amd64", "", "the darwin/amd64 build of cmd/arduinopath")
	arm64 := flag.String("arm64", "", "the darwin/arm64 build of cmd/arduinopath")
	version := flag.String("version", "0.0.0", "the version (like 1.2.3)")
	icon := flag.String("icon", "cmd/arduinopath/macos/ArduinoPath.icns", "the app icon")
	out := flag.String("out", "dist", "folder to put ArduinoPath.app in")
	boards := flag.String("boards", "", "the board tools (boards.zip from tools/packboards) to build in")
	flag.Parse()
	if err := build(*amd64, *arm64, *version, *icon, *out, *boards); err != nil {
		fmt.Fprintln(os.Stderr, "macapp:", err)
		os.Exit(1)
	}
}

func build(amd64, arm64, version, icon, out, boards string) error {
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(version) {
		return fmt.Errorf("version %q isn't like 1.2.3", version)
	}
	var slices [][]byte
	for _, p := range []string{amd64, arm64} {
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		slices = append(slices, data)
	}
	fat, err := universal(slices...)
	if err != nil {
		return err
	}
	iconData, err := os.ReadFile(icon)
	if err != nil {
		return err
	}
	app := filepath.Join(out, "ArduinoPath.app")
	if err := os.RemoveAll(app); err != nil {
		return err
	}
	files := []struct {
		path string
		data []byte
		mode os.FileMode
	}{
		{"Contents/Info.plist", []byte(infoPlist(version)), 0o644},
		{"Contents/PkgInfo", []byte("APPL????"), 0o644},
		{"Contents/MacOS/ArduinoPath", fat, 0o755},
		{"Contents/Resources/ArduinoPath.icns", iconData, 0o644},
	}
	if boards != "" {
		// Copied, not read into memory: it's big.
		dest := filepath.Join(app, "Contents", "Resources", "boards.zip")
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		if err := copyFile(boards, dest); err != nil {
			return err
		}
	}
	for _, f := range files {
		p := filepath.Join(app, filepath.FromSlash(f.path))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(p, f.data, f.mode); err != nil {
			return err
		}
	}
	fmt.Println("made", app)
	return nil
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(to)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// universal joins Mach-O programs for different CPUs into one fat
// ("universal") file, as lipo -create does.
func universal(progs ...[]byte) ([]byte, error) {
	const align = 14 // 16 KB, the page size on Apple Silicon
	type arch struct {
		cpu, sub uint32
		data     []byte
	}
	var archs []arch
	for _, p := range progs {
		f, err := macho.NewFile(bytes.NewReader(p))
		if err != nil {
			return nil, fmt.Errorf("not a macOS program: %w", err)
		}
		archs = append(archs, arch{uint32(f.Cpu), f.SubCpu, p})
		f.Close()
	}
	var buf bytes.Buffer
	binary.Write(&buf, binary.BigEndian, []uint32{macho.MagicFat, uint32(len(archs))})
	offset := uint32(1 << align)
	var offsets []uint32
	for _, a := range archs {
		offsets = append(offsets, offset)
		binary.Write(&buf, binary.BigEndian, []uint32{a.cpu, a.sub, offset, uint32(len(a.data)), align})
		offset += uint32(len(a.data))
		offset = (offset + (1<<align - 1)) &^ (1<<align - 1)
	}
	for i, a := range archs {
		buf.Write(make([]byte, int(offsets[i])-buf.Len()))
		buf.Write(a.data)
	}
	return buf.Bytes(), nil
}

// infoPlist describes the app to macOS. LSUIElement: no Dock icon, since the
// app only starts the background server and opens a browser window.
func infoPlist(version string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key>
	<string>ArduinoPath</string>
	<key>CFBundleDisplayName</key>
	<string>ArduinoPath</string>
	<key>CFBundleIdentifier</key>
	<string>` + bundleID + `</string>
	<key>CFBundleVersion</key>
	<string>` + version + `</string>
	<key>CFBundleShortVersionString</key>
	<string>` + version + `</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleExecutable</key>
	<string>ArduinoPath</string>
	<key>CFBundleIconFile</key>
	<string>ArduinoPath</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>LSMinimumSystemVersion</key>
	<string>11.0</string>
	<key>LSUIElement</key>
	<true/>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.education</string>
	<key>NSHumanReadableCopyright</key>
	<string>Banyule Nillumbik Tech School. Parts art: Fritzing (CC BY-SA 3.0)</string>
</dict>
</plist>
`
}
