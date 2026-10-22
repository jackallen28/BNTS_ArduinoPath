// The simulated Arduino API: Serial, String, pins, time, maths.
import { test } from "node:test";
import assert from "node:assert/strict";
import { out, run, sketch, uno, esp32, nodemcu } from "./helpers.js";

const lines = (s) => s.trim().split("\n");

test("Serial.print overloads like the Arduino core", () => {
  const s = out(`
    Serial.print(42); Serial.print(' '); Serial.println(-7);
    Serial.println(255, HEX); Serial.println(255, BIN); Serial.println(8, OCT); Serial.println(-1, HEX);
    Serial.println(3.14159); Serial.println(3.14159, 4); Serial.println(2.5, 0); Serial.println(-1.25, 2);
    char c = 'A'; byte b = 65; Serial.println(c); Serial.println(b);
    bool t = true; Serial.println(t);
    String s = "str"; Serial.println(s);
    Serial.println(F("flash"));
    Serial.println(1.0 / 0.0); Serial.println(sqrt(-1)); Serial.println(5e9);
    Serial.write(66); Serial.write("CD"); Serial.println();
    unsigned long big = 4000000000UL; Serial.println(big);
  `);
  assert.deepEqual(lines(s), ["42 -7", "FF", "11111111", "10", "FFFFFFFF", "3.14", "3.1416", "3", "-1.25", "A", "65", "1", "str", "flash", "inf", "nan", "ovf", "BCD", "4000000000"]);
});

test("Serial before Serial.begin prints nothing and warns", () => {
  const r = run(sketch('Serial.println("hi");'), { ms: 10 });
  assert.equal(r.serial, "");
  assert.ok(r.events.some((e) => e.type === "warning" && e.kind === "serial-no-begin"));
});

test("Serial printf on ESP, sprintf everywhere (no %f on AVR)", () => {
  assert.equal(out('Serial.printf("%d-%s-%.2f|%5d|%-4d|%04x\\n", 7, "ok", 1.5, 42, 3, 255);', { board: esp32 }), "7-ok-1.50|   42|3   |00ff\n");
  assert.equal(out('char b[32]; sprintf(b, "t=%d %s %f", 5, "x", 1.5); Serial.println(b);'), "t=5 x ?\n");
  assert.equal(out('char b[32]; snprintf(b, sizeof(b), "%ld|%u|%c", 70000L, 65535u, 66); Serial.println(b);'), "70000|65535|B\n");
  assert.equal(out('char b[10]; dtostrf(3.14159, 6, 2, b); Serial.println(b); itoa(255, b, 16); Serial.println(b);'), "  3.14\nff\n");
});

test("String class", () => {
  const s = out(`
    String a = "Hello";
    String b = a + " world " + 42 + ' ' + 1.5;
    Serial.println(b);
    Serial.println(b.length());
    Serial.println(a.charAt(1));
    Serial.println(a.substring(1, 3));
    Serial.println(a.indexOf('l'));
    Serial.println(a.indexOf("lo"));
    a.toUpperCase(); Serial.println(a);
    String n = "  123abc "; Serial.println(n.toInt() + 1);
    n.trim(); Serial.println(n);
    Serial.println(String("3.75").toFloat() * 2);
    Serial.println(String(255, HEX));
    Serial.println(String(3.14159, 3));
    Serial.println(String(-5));
    Serial.println(a == "HELLO");
    Serial.println(a.equalsIgnoreCase("hello"));
    Serial.println(a.startsWith("HE"));
    String r = "a-b-c"; r.replace("-", "+"); Serial.println(r);
    r.remove(1, 2); Serial.println(r);
    String c = ""; c += "x"; c += 5; c += 'y'; Serial.println(c);
    c.concat(9); Serial.println(c);
    String e = "ab"; e[0] = 'X'; Serial.println(e); Serial.println(e[1]);
    char buf[8]; e.toCharArray(buf, 8); Serial.println(buf);
    Serial.println(strlen(e.c_str()));
    Serial.println(String("b") > String("a"));
    String t = "temp: " + String(21) + "C"; Serial.println(t);
  `);
  assert.deepEqual(lines(s), ["Hello world 42 1.50", "19", "e", "el", "2", "3", "HELLO", "124", "123abc", "7.50", "ff", "3.142", "-5", "1", "1", "1", "a+b+c", "a+c", "x5y", "x5y9", "Xb", "b", "Xb", "2", "1", "temp: 21C"]);
});

test("String UTF-8 bytes count like the board", () => {
  assert.equal(out('String s = "25°C"; Serial.println(s.length()); Serial.println(s);'), "5\n25°C\n");
});

test("pins: pinMode, digitalWrite events, INPUT_PULLUP reads HIGH when floating", () => {
  const r = run(sketch("pinMode(13, OUTPUT); pinMode(2, INPUT_PULLUP); pinMode(3, INPUT); Serial.begin(9600); Serial.println(digitalRead(2)); Serial.println(digitalRead(3)); digitalWrite(13, HIGH); digitalWrite(13, HIGH); digitalWrite(13, LOW);"), { ms: 10 });
  assert.equal(r.serial, "1\n0\n");
  const ev = r.events.filter((e) => e.type === "digital");
  assert.deepEqual(ev.map((e) => [e.pin, e.value]), [[13, 1], [13, 0]]);
  assert.deepEqual(r.events.filter((e) => e.type === "pinMode").map((e) => e.mode), ["OUTPUT", "INPUT_PULLUP", "INPUT"]);
});

test("inputs: digital, analog (A0 and channel numbers), pulseIn, and events at times", () => {
  const src = sketch("Serial.begin(9600); pinMode(2, INPUT_PULLUP);", `
    Serial.print(digitalRead(2)); Serial.print(' ');
    Serial.print(analogRead(A0)); Serial.print(' ');
    Serial.print(analogRead(0)); Serial.print(' ');
    Serial.println(pulseIn(7, HIGH));
    delay(500);`);
  const r = run(src, { ms: 1200, inputs: { analog: { 14: 512 }, pulse: { 7: 300 } }, events: [{ at_ms: 700, set: { digital: { 2: 0 }, analog: { A0: 100 }, pulse: { 7: 1160 } } }] });
  assert.deepEqual(lines(r.serial), ["1 512 512 300", "1 512 512 300", "0 100 100 1160"]);
});

test("analogWrite: pwm events; non-PWM pins on AVR switch fully on or off", () => {
  const r = run(sketch("analogWrite(9, 128); analogWrite(9, 128); analogWrite(13, 200); analogWrite(13, 20);"), { ms: 10 });
  assert.deepEqual(r.events.filter((e) => e.type === "pwm").map((e) => [e.pin, e.value]), [[9, 128]]);
  assert.deepEqual(r.events.filter((e) => e.type === "digital").map((e) => [e.pin, e.value]), [[13, 1], [13, 0]]);
});

test("ESP32 analogRead is 12 bits; analogReadResolution scales", () => {
  const src = sketch("Serial.begin(115200); Serial.println(analogRead(34)); analogReadResolution(10); Serial.println(analogRead(34));");
  assert.equal(run(src, { board: esp32, ms: 10, inputs: { analog: { 34: 4095 } } }).serial, "4095\n1023\n");
});

test("tone with a duration stops by itself", () => {
  const r = run(sketch("tone(8, 440, 200);", "delay(1000);"), { ms: 500 });
  const t = r.events.filter((e) => e.type === "tone" || e.type === "noTone");
  assert.equal(t[0].type, "tone");
  assert.equal(t[0].freq, 440);
  assert.equal(t[1].type, "noTone");
  assert.ok(Math.abs(t[1].t - 200) < 1);
});

test("time: delay advances simulated time; millis busy-wait finishes", () => {
  const r = run(sketch("Serial.begin(9600); unsigned long s = millis(); while (millis() - s < 1000) { } Serial.println(millis()); delay(250); Serial.println(millis()); delayMicroseconds(1000); Serial.println(micros() / 1000);"), { ms: 2000 });
  const [a, b, c] = lines(r.serial).map(Number);
  assert.ok(a >= 1000 && a < 1010, String(a));
  assert.ok(b - a >= 250 && b - a < 255);
  assert.ok(c >= b + 1);
});

test("blink-without-delay with millis runs in real-ish time", () => {
  const src = `unsigned long last = 0; int state = LOW;
    void setup() { pinMode(13, OUTPUT); }
    void loop() { if (millis() - last >= 500) { last = millis(); state = !state; digitalWrite(13, state); } }`;
  const r = run(src, { ms: 5000 });
  const d = r.events.filter((e) => e.type === "digital");
  assert.equal(d.length, 10);
  assert.ok(Math.abs(d[3].t - 2000) < 5, String(d[3].t));
});

test("Serial input: available, read, readString, readStringUntil, parseInt", () => {
  const src = sketch("Serial.begin(9600);", `
    if (Serial.available() > 0) {
      String line = Serial.readStringUntil('\\n');
      Serial.print("got:"); Serial.println(line);
      int n = Serial.parseInt();
      Serial.println(n * 2);
    }`);
  const r = run(src, { ms: 3000, events: [{ at_ms: 100, serial: "hello\n21" }] });
  assert.equal(r.serial, "got:hello\n42\n");
  const r2 = run(sketch("Serial.begin(9600); Serial.setTimeout(200);", "if (Serial.available()) { String s = Serial.readString(); Serial.println(s.length()); }"), { ms: 2000, events: [{ at_ms: 50, serial: "abc" }] });
  assert.equal(r2.serial, "3\n");
});

test("random is repeatable; randomSeed changes it; map and constrain", () => {
  const a = out("for (int i = 0; i < 3; i++) Serial.println(random(100));");
  const b = out("for (int i = 0; i < 3; i++) Serial.println(random(100));");
  assert.equal(a, b);
  assert.equal(a, "7\n49\n73\n", "same as avr-libc's random()");
  const c = out("randomSeed(42); Serial.println(random(10, 20));");
  assert.ok(Number(c) >= 10 && Number(c) < 20);
  assert.equal(out("Serial.println(map(512, 0, 1023, 0, 180)); Serial.println(map(50, 0, 100, 100, 0));"), "90\n50\n");
});

test("runtime errors: array out of range, divide by zero, runaway recursion", () => {
  const r = run(sketch("int a[3]; for (int i = 0; i <= 3; i++) a[i] = i;"), { allowFail: true });
  assert.equal(r.ok, false);
  const e = r.events.find((x) => x.type === "error");
  assert.equal(e.kind, "runtime");
  assert.equal(e.line, 3);
  assert.match(e.message, /box 3 of 'a', but it only has 3 boxes/);
  const z = run(sketch("int x = 0; int y = 5 / x;"), { allowFail: true });
  assert.match(z.errors[0].message, /divided by zero/);
  const s = run(sketch("down(1);", "", "int down(int n) { return down(n + 1) + 1; }"), { allowFail: true });
  assert.match(s.errors[0].message, /calls itself too many times/);
  assert.equal(s.events.at(-1).type, "stopped");
  assert.equal(s.events.at(-1).reason, "error");
});

test("busy loop without delay: a warning with the loop's line, and time keeps going", () => {
  const r = run("void setup() {\n  int x = 0;\n  while (true) {\n    x++;\n  }\n}\nvoid loop() {}", { ms: 3000 });
  const w = r.events.find((e) => e.type === "warning" && e.kind === "busy-loop");
  assert.ok(w);
  assert.equal(w.line, 3);
  assert.ok(r.stopped_at_ms >= 2999);
});

test("interrupts run when an input changes", () => {
  const src = `volatile int presses = 0;
    void onPress() { presses++; }
    void setup() { Serial.begin(9600); pinMode(2, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(2), onPress, FALLING); }
    void loop() { delay(100); }
    `;
  const r = run(src.replace("void loop() { delay(100); }", "void loop() { delay(1000); Serial.println(presses); }"), {
    ms: 1100, events: [{ at_ms: 100, set: { digital: { 2: 0 } } }, { at_ms: 200, set: { digital: { 2: 1 } } }, { at_ms: 300, set: { digital: { 2: 0 } } }],
  });
  assert.equal(r.serial, "2\n");
});

test("pin numbers and board constants on NodeMCU", () => {
  const r = run(sketch("pinMode(D5, OUTPUT); digitalWrite(D5, HIGH); pinMode(LED_BUILTIN, OUTPUT); Serial.begin(9600); Serial.println(D5); Serial.println(LED_BUILTIN); Serial.println(A0);"), { board: nodemcu, ms: 10 });
  assert.equal(r.serial, "14\n2\n17\n");
  assert.ok(r.events.some((e) => e.type === "digital" && e.pin === 14));
});

test("headless is fast: 10 s of blink well under a second", () => {
  const src = "void setup() { pinMode(13, OUTPUT); } void loop() { digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }";
  run(src, { ms: 100 });
  const t0 = performance.now();
  const r = run(src, { ms: 10000 });
  const took = performance.now() - t0;
  assert.equal(r.events.filter((e) => e.type === "digital").length, 20);
  assert.ok(took < 500, `took ${took} ms`);
});
