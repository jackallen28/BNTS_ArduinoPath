package main

import (
	"debug/macho"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBuildsAUniversalApp(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the app twice")
	}
	dir := t.TempDir()
	for _, arch := range []string{"amd64", "arm64"} {
		cmd := exec.Command("go", "build", "-o", filepath.Join(dir, arch), "../../cmd/arduinopath")
		cmd.Env = append(os.Environ(), "GOOS=darwin", "GOARCH="+arch, "CGO_ENABLED=0")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%s: %v\n%s", arch, err, out)
		}
	}
	if err := build(filepath.Join(dir, "amd64"), filepath.Join(dir, "arm64"), "1.2.3", "../../cmd/arduinopath/macos/ArduinoPath.icns", dir, "main.go"); err != nil {
		t.Fatal(err)
	}
	app := filepath.Join(dir, "ArduinoPath.app", "Contents")
	fat, err := macho.OpenFat(filepath.Join(app, "MacOS", "ArduinoPath"))
	if err != nil {
		t.Fatal(err)
	}
	defer fat.Close()
	cpus := map[macho.Cpu]bool{}
	for _, a := range fat.Arches {
		cpus[a.Cpu] = true
		if a.Offset%(1<<14) != 0 {
			t.Errorf("%v slice isn't page aligned", a.Cpu)
		}
	}
	if len(fat.Arches) != 2 || !cpus[macho.CpuAmd64] || !cpus[macho.CpuArm64] {
		t.Fatalf("arches = %v", cpus)
	}
	// Windows has no "executable" mark on files; on a Mac or Linux it must be set.
	if fi, _ := os.Stat(filepath.Join(app, "MacOS", "ArduinoPath")); runtime.GOOS != "windows" && fi.Mode()&0o111 == 0 {
		t.Fatal("not executable")
	}
	plist, _ := os.ReadFile(filepath.Join(app, "Info.plist"))
	for _, want := range []string{"<string>1.2.3</string>", "<key>LSUIElement</key>", "org.bnts.arduinopath"} {
		if !strings.Contains(string(plist), want) {
			t.Errorf("Info.plist has no %s", want)
		}
	}
	if _, err := os.Stat(filepath.Join(app, "Resources", "boards.zip")); err != nil {
		t.Error("the board tools weren't built in")
	}
	if err := build("x", "y", "1.2", "", dir, ""); err == nil {
		t.Fatal("accepted a bad version")
	}
	if _, err := universal([]byte("not a program")); err == nil {
		t.Fatal("accepted a non-program")
	}
}
