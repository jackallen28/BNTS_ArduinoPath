package arduino

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakeInstall makes a small Arduino folder like Env.Setup leaves behind.
func fakeInstall(t *testing.T, cli string) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"bin/" + cliName():             cli,
		"arduino-cli.yaml":             "old settings",
		"installed.json":               "{}",
		"downloads/big.tar.bz2":        "skip me",
		"build-cache/x.o":              "skip me",
		"data/package_index.json":      "{}",
		"data/staging/tmp.zip":         "skip me",
		"user/libraries/Servo/Servo.h": "// servo",
		"data/packages/arduino/hardware/avr/1.8.7/platform.txt":                                      "avr",
		"data/packages/arduino/tools/avr-gcc/7.3/bin/avr-gcc":                                        "gcc",
		"data/packages/esp8266/hardware/esp8266/3.1.2/platform.txt":                                  "esp8266",
		"data/packages/esp32/hardware/esp32/3.3.12/platform.txt":                                     "esp32",
		"data/packages/esp32/tools/esp32-arduino-libs/3.3/esp32/a.a":                                 "keep",
		"data/packages/esp32/tools/esp32-arduino-libs/3.3/esp32c3/b.a":                               "keep",
		"data/packages/esp32/tools/esp32-arduino-libs/3.3/esp32s3/c.a":                               "drop",
		"data/packages/esp32/tools/esp32-arduino-libs/3.3/versions.txt":                              "keep",
		"data/packages/esp32/tools/xtensa-esp-elf-gdb/12.1/bin/gdb":                                  "drop",
		"data/packages/builtin/tools/serial-discovery/1.4/serial-discovery":                          "discovery",
		"data/packages/esp32/tools/esp-x32/2405/xtensa-esp-elf/lib/esp32/libc.a":                     "keep",
		"data/packages/esp32/tools/esp-x32/2405/xtensa-esp-elf/lib/esp32s3/libc.a":                   "drop",
		"data/packages/esp32/tools/esp-x32/2405/share/doc/gcc/manual.html":                           "drop",
		"data/packages/esp32/tools/esp-rom-elfs/20240305/esp32_rev0_rom.elf":                         "drop",
		"data/packages/esp32/tools/esp32s3-libs/3.3.12/lib/libx.a":                                   "drop",
		"data/packages/esp32/tools/esp32c3-libs/3.3.12/lib/liby.a":                                   "keep",
		"data/packages/esp32/tools/esp-rv32/2601/picolibc/lib/libc.a":                                "drop",
		"data/packages/esp32/tools/esp-rv32/2601/riscv32-esp-elf/lib/rv32imac_zicsr_zifencei/libc.a": "drop",
		"data/packages/esp32/tools/esp-rv32/2601/riscv32-esp-elf/lib/rv32imc_zicsr_zifencei/libc.a":  "keep",
	}
	for name, data := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(p), 0o755)
		mode := os.FileMode(0o644)
		if strings.HasPrefix(name, "bin/") || strings.Contains(name, "/bin/") || strings.HasSuffix(name, "discovery") {
			mode = 0o755
		}
		if err := os.WriteFile(p, []byte(data), mode); err != nil {
			t.Fatal(err)
		}
	}
	if runtime.GOOS != "windows" {
		os.Symlink("avr-gcc", filepath.Join(dir, "data/packages/arduino/tools/avr-gcc/7.3/bin/avr-cc"))
	}
	return dir
}

func packBundle(t *testing.T, dir string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "boards.zip")
	f, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	m, err := Pack(dir, f, "0123456789abcdef0123")
	f.Close()
	if err != nil {
		t.Fatal(err)
	}
	for _, fam := range []string{"common", "avr", "esp8266", "esp32"} {
		if m.Families[fam].Files == 0 {
			t.Errorf("no files packed for %s: %+v", fam, m.Families)
		}
	}
	return out
}

func TestPackAndExtract(t *testing.T) {
	src := fakeInstall(t, "#!/bin/sh\n")
	bundlePath := packBundle(t, src)

	zr, err := zip.OpenReader(bundlePath)
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	zr.Close()
	for _, want := range []string{
		"manifest.json",
		"common/bin/" + cliName(),
		"common/user/libraries/Servo/Servo.h",
		"common/data/packages/builtin/tools/serial-discovery/1.4/serial-discovery",
		"avr/data/packages/arduino/tools/avr-gcc/7.3/bin/avr-gcc",
		"esp32/data/packages/esp32/tools/esp32-arduino-libs/3.3/esp32c3/b.a",
		"esp32/data/packages/esp32/tools/esp32-arduino-libs/3.3/versions.txt",
		"esp32/data/packages/esp32/tools/xtensa-esp-elf-gdb/12.1/",
		"esp32/data/packages/esp32/tools/esp-x32/2405/xtensa-esp-elf/lib/esp32/libc.a",
		"esp32/data/packages/esp32/tools/esp32c3-libs/3.3.12/lib/liby.a",
		"esp32/data/packages/esp32/tools/esp32s3-libs/3.3.12/",
		"esp32/data/packages/esp32/tools/esp-rv32/2601/riscv32-esp-elf/lib/rv32imc_zicsr_zifencei/libc.a",
	} {
		if !names[want] {
			t.Errorf("%s isn't in the bundle", want)
		}
	}
	for name := range names {
		if strings.HasSuffix(name, "/") {
			continue // folders stay (empty) so arduino-cli sees every tool installed
		}
		for _, bad := range []string{"downloads", "build-cache", "staging", "esp32s3", "gdb/12.1/bin", "arduino-cli.yaml", "installed.json", "share/doc", "rom.elf", "picolibc", "rv32imac"} {
			if strings.Contains(name, bad) {
				t.Errorf("%s shouldn't be in the bundle", name)
			}
		}
	}

	b, err := OpenBundle(bundlePath)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if !b.Has("avr") || b.Manifest.Hash != "0123456789abcdef0123" {
		t.Fatalf("manifest = %+v", b.Manifest)
	}
	dest := t.TempDir()
	var progress int64
	if err := b.Extract("avr", dest, func(done int64) { progress = done }); err != nil {
		t.Fatal(err)
	}
	if progress == 0 {
		t.Error("no progress reported")
	}
	got, err := os.ReadFile(filepath.Join(dest, "data/packages/arduino/tools/avr-gcc/7.3/bin/avr-gcc"))
	if err != nil || string(got) != "gcc" {
		t.Fatalf("avr-gcc = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(dest, "data/packages/esp32")); err == nil {
		t.Fatal("unpacking avr unpacked esp32 too")
	}
	if runtime.GOOS != "windows" {
		fi, _ := os.Stat(filepath.Join(dest, "data/packages/arduino/tools/avr-gcc/7.3/bin/avr-gcc"))
		if fi.Mode()&0o111 == 0 {
			t.Error("a tool lost its executable mark")
		}
		target, err := os.Readlink(filepath.Join(dest, "data/packages/arduino/tools/avr-gcc/7.3/bin/avr-cc"))
		if err != nil || target != "avr-gcc" {
			t.Errorf("link = %q, %v", target, err)
		}
	}
}

func TestBundleAppendedToAProgram(t *testing.T) {
	bundlePath := packBundle(t, fakeInstall(t, "cli"))
	exe := filepath.Join(t.TempDir(), "ArduinoPath.exe")
	os.WriteFile(exe, bytes.Repeat([]byte("MZprogram"), 1000), 0o755)
	if _, err := OpenBundle(exe); err != ErrNoBundle {
		t.Fatalf("a plain program: %v", err)
	}
	if err := AppendBundle(exe, bundlePath); err != nil {
		t.Fatal(err)
	}
	b, err := OpenBundle(exe)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	dest := t.TempDir()
	if err := b.Extract("common", dest, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, "user/libraries/Servo/Servo.h")); err != nil {
		t.Fatal(err)
	}
}

func TestExtractRefusesEscapingNames(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("manifest.json")
	w.Write([]byte(`{"hash":"0123456789abcdef","families":{"avr":{"files":1}}}`))
	w, _ = zw.Create("avr/../../evil.txt")
	w.Write([]byte("x"))
	zw.Close()
	p := filepath.Join(t.TempDir(), "boards.zip")
	os.WriteFile(p, buf.Bytes(), 0o644)
	b, err := OpenBundle(p)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if err := b.Extract("avr", t.TempDir(), nil); err == nil {
		t.Fatal("unpacked a file outside the folder")
	}
}

func TestParseDiagnostics(t *testing.T) {
	out := `C:\Users\ava\AppData\Local\ArduinoPath\arduino-x\sketches\ab\sketch\sketch.ino: In function 'void loop()':
C:\Users\ava\AppData\Local\ArduinoPath\arduino-x\sketches\ab\sketch\sketch.ino:7:3: error: expected ';' before '}' token
   }
   ^
/tmp/sketch/sketch.ino:3:10: fatal error: Servo2.h: No such file or directory
/tmp/sketch/sketch.ino:9:5: warning: unused variable 'x' [-Wunused-variable]
/tmp/sketch/sketch.ino:7:3: error: expected ';' before '}' token
(.text.startup.main+0x84): undefined reference to ` + "`setup'" + `
collect2.exe: error: ld returned 1 exit status`
	got := ParseDiagnostics(out)
	want := []Diagnostic{
		{File: "sketch.ino", Line: 7, Col: 3, Severity: "error", Message: "expected ';' before '}' token"},
		{File: "sketch.ino", Line: 3, Col: 10, Severity: "error", Message: "fatal error: Servo2.h: No such file or directory"},
		{File: "sketch.ino", Line: 9, Col: 5, Severity: "warning", Message: "unused variable 'x' [-Wunused-variable]"},
		{File: "sketch.ino", Severity: "error", Message: "undefined reference to `setup'"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %+v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestParseCompileJSON(t *testing.T) {
	ok := parseCompileJSON(`{"compiler_out":"Sketch uses 924 bytes","compiler_err":"","builder_result":{"executable_sections_size":[{"name":"text","size":924,"max_size":32256},{"name":"data","size":9,"max_size":2048}]},"success":true}`)
	if !ok.OK || ok.Size == nil || ok.Size.Flash != 924 || ok.Size.RAMMax != 2048 {
		t.Fatalf("ok = %+v %+v", ok, ok.Size)
	}
	bad := parseCompileJSON(`{"compiler_out":"","compiler_err":"/x/sketch.ino:2:1: error: 'foo' was not declared in this scope","success":false}`)
	if bad.OK || len(bad.Diagnostics) != 1 || bad.Diagnostics[0].Line != 2 {
		t.Fatalf("bad = %+v", bad)
	}
	text := parseCompileJSON(`{"compiler_out":"Sketch uses 265413 bytes (25%) of program storage space. Maximum is 1044464 bytes.\nGlobal variables use 28104 bytes (34%) of dynamic memory, leaving 53816 bytes for local variables. Maximum is 81920 bytes.","success":true}`)
	if text.Size == nil || text.Size.Flash != 265413 || text.Size.RAMMax != 81920 {
		t.Fatalf("size from text = %+v", text.Size)
	}
	junk := parseCompileJSON("Error: no JSON here")
	if junk.OK || junk.Output != "Error: no JSON here" {
		t.Fatalf("junk = %+v", junk)
	}
}

func TestParsePorts(t *testing.T) {
	ports, err := parsePorts(`{"detected_ports":[
	 {"port":{"address":"COM3","label":"COM3","protocol":"serial","properties":{"vid":"0x1A86","pid":"0x7523"}}},
	 {"port":{"address":"COM4","label":"COM4","protocol":"serial","properties":{"vid":"0x2341","pid":"0x0043"}},"matching_boards":[{"name":"Arduino Uno","fqbn":"arduino:avr:uno"}]},
	 {"port":{"address":"192.168.1.5","protocol":"network"}}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(ports) != 2 || ports[0].Chip != "CH340" || ports[1].FQBN != "arduino:avr:uno" || ports[1].Chip != "Arduino" {
		t.Fatalf("ports = %+v", ports)
	}
	if ports, _ := parsePorts("{}"); len(ports) != 0 {
		t.Fatal(ports)
	}
}

// A stand-in arduino-cli: compile succeeds unless the sketch has "BROKEN".
const fakeToolsCLI = `#!/bin/sh
for last; do :; done
case "$*" in
  *" compile "*)
    if grep -q BROKEN "$last/sketch.ino"; then
      echo '{"compiler_err":"'"$last"'/sketch.ino:4:1: error: expected '"';'"' before '"'}'"' token","success":false}'
      exit 1
    fi
    echo '{"compiler_out":"done","builder_result":{"executable_sections_size":[{"name":"text","size":1000,"max_size":32256}]},"success":true}' ;;
  *" upload "*) echo "Writing | ################ | 100%"; echo "avrdude done" ;;
  *" board list "*) echo '{"detected_ports":[{"port":{"address":"/dev/ttyUSB0","protocol":"serial","properties":{"vid":"0x1a86","pid":"0x7523"}}}]}' ;;
esac
`

func TestToolsUnpackCompileUpload(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script")
	}
	b, err := OpenBundle(packBundle(t, fakeInstall(t, fakeToolsCLI)))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	data := t.TempDir()
	os.MkdirAll(filepath.Join(data, "arduino-oldversion1"), 0o755)
	tools := NewTools(b, data, nil)
	if st := tools.Status(); st["avr"].State != "packed" || st["esp32"].State != "packed" {
		t.Fatalf("status = %+v", st)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var streamed strings.Builder
	res, err := tools.Compile(ctx, "void setup(){}\nvoid loop(){}\n", "arduino:avr:uno", []string{"compiler.cpp.extra_flags=-DX=1"}, func(s string) { streamed.WriteString(s) })
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || res.Size.Flash != 1000 || !strings.Contains(streamed.String(), "success") {
		t.Fatalf("compile = %+v", res)
	}
	st := tools.Status()
	if st["avr"].State != "ready" || st["common"].State != "ready" || st["esp32"].State != "packed" {
		t.Fatalf("after compiling for avr: %+v", st)
	}
	cfg, _ := os.ReadFile(tools.env.ConfigFile())
	if !strings.Contains(string(cfg), tools.env.Dir) {
		t.Fatalf("settings don't point at the unpacked tools:\n%s", cfg)
	}

	bad, err := tools.Compile(ctx, "void setup(){\nBROKEN\n", "arduino:avr:uno", nil, nil)
	if err != nil || bad.OK || len(bad.Diagnostics) != 1 || bad.Diagnostics[0].Line != 4 {
		t.Fatalf("broken compile = %+v, %v", bad, err)
	}

	out, err := tools.Upload(ctx, res.BuildPath, "arduino:avr:uno", "/dev/ttyUSB0", nil)
	if err != nil || !strings.Contains(out, "100%") {
		t.Fatalf("upload = %q, %v", out, err)
	}
	ports, err := tools.Ports(ctx)
	if err != nil || len(ports) != 1 || ports[0].Chip != "CH340" {
		t.Fatalf("ports = %+v, %v", ports, err)
	}

	// A second Tools (the app started again) finds avr already unpacked.
	again := NewTools(b, data, nil)
	if again.Status()["avr"].State != "ready" {
		t.Fatal("unpacked tools weren't remembered")
	}
	time.Sleep(100 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(data, "arduino-oldversion1")); err == nil {
		t.Error("old tools weren't removed")
	}
	if _, err := tools.Compile(ctx, "x", "pico:rp2040:pico", nil, nil); err == nil {
		t.Error("compiled for an unknown board")
	}
}

func TestCoachText(t *testing.T) {
	ds := []Diagnostic{
		{File: "Servo.cpp", Severity: "error", Message: "in a library"},
		{File: "sketch.ino", Line: 6, Severity: "warning", Message: "unused"},
		{File: "sketch.ino", Line: 7, Severity: "error", Message: "'digitalwrite' was not declared in this scope"},
		{File: "sketch.ino", Line: 7, Severity: "note", Message: "suggested alternative: 'digitalWrite'"},
		{File: "sketch.ino", Line: 9, Severity: "error", Message: "expected ';' before '}' token"},
	}
	want := "'digitalwrite' was not declared in this scope\nsuggested alternative: 'digitalWrite'"
	if got := CoachText(ds); got != want {
		t.Fatalf("got %q", got)
	}
	if got := CoachText(ds[:1]); got != "in a library" {
		t.Fatalf("library only: %q", got)
	}
	if CoachText(nil) != "" {
		t.Fatal("empty")
	}
}
