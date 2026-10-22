// The C++ language subset: statements, types, arithmetic, functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { out, run, uno, esp32, nodemcu } from "./helpers.js";

const p = (expr, opts) => out(`Serial.println(${expr});`, opts).trim();

test("integer arithmetic wraps at 16 bits on AVR", () => {
  assert.equal(out("int x = 32767; x++; Serial.println(x);").trim(), "-32768");
  assert.equal(out("int x = 1000 * 60; Serial.println(x);").trim(), "-5536");
  assert.equal(out("long x = 1000L * 60; Serial.println(x);").trim(), "60000");
  assert.equal(out("unsigned int u = 0; u--; Serial.println(u);").trim(), "65535");
  assert.equal(out("byte b = 250; b += 10; Serial.println(b);").trim(), "4");
  assert.equal(out("unsigned long m = 0; m--; Serial.println(m);").trim(), "4294967295");
  assert.equal(out("long a = 2147483647; a++; Serial.println(a);").trim(), "-2147483648");
});

test("integer arithmetic is 32 bits on ESP", () => {
  assert.equal(out("int x = 32767; x++; Serial.println(x);", { board: esp32 }).trim(), "32768");
  assert.equal(out("int x = 1000 * 60; Serial.println(x);", { board: nodemcu }).trim(), "60000");
  assert.equal(out("int x = 2147483647; x++; Serial.println(x);", { board: esp32 }).trim(), "-2147483648");
});

test("division truncates toward zero, % keeps the sign", () => {
  assert.equal(p("7 / 2"), "3");
  assert.equal(p("-7 / 2"), "-3");
  assert.equal(p("-7 % 3"), "-1");
  assert.equal(p("7 / 2.0"), "3.50");
  assert.equal(p("1 / 3 * 3"), "0");
});

test("float is 32-bit and double is 32-bit on AVR, 64-bit on ESP", () => {
  assert.equal(out("double d = 16777217.0; Serial.println(d, 1);").trim(), "16777216.0");
  assert.equal(out("double d = 16777217.0; Serial.println(d, 1);", { board: esp32 }).trim(), "16777217.0");
  assert.equal(out("float f = 0.1; Serial.println(f, 9);", { board: esp32 }).trim().slice(0, 9), "0.1000000");
});

test("bitwise and shifts", () => {
  assert.equal(p("1 << 15"), "-32768");
  assert.equal(p("1UL << 31"), "2147483648");
  assert.equal(p("0xF0 | 0x0F"), "255");
  assert.equal(p("~0"), "-1");
  assert.equal(p("(byte)~0"), "255");
  assert.equal(p("-16 >> 2"), "-4");
  assert.equal(p("bitRead(5, 2)"), "1");
  assert.equal(p("highByte(0x1234)"), "18");
  assert.equal(p("lowByte(0x1234)"), "52");
  assert.equal(p("bit(3)"), "8");
});

test("signed and unsigned comparisons follow C rules", () => {
  assert.equal(p("-1 < 1u"), "0", "AVR: -1 becomes 65535u");
  assert.equal(p("-1 < 1L"), "1");
  assert.equal(p("-1 < 1u", { board: esp32 }), "0");
});

test("char arithmetic and casts", () => {
  assert.equal(p("(char)('a' + 1)"), "b");
  assert.equal(p("'a' + 1"), "98");
  assert.equal(p("(int)3.99"), "3");
  assert.equal(p("(int)-3.99"), "-3");
  assert.equal(p("int(2.5) + float(1)"), "3.00");
  assert.equal(p("static_cast<long>(40000)"), "40000");
  assert.equal(p("(byte)300"), "44");
});

test("if / else, loops, switch with fallthrough", () => {
  const s = out(`
    int total = 0;
    for (int i = 0; i < 10; i++) { if (i % 2 == 0) continue; total += i; }
    Serial.println(total);
    int n = 0; while (n < 5) n++; Serial.println(n);
    int k = 10; do { k--; } while (k > 3); Serial.println(k);
    for (int i = 0, j = 10; i < j; i++, j--) total = i; Serial.println(total);
    int x = 2;
    switch (x) { case 1: Serial.println("one"); case 2: Serial.println("two"); case 3: Serial.println("three"); break; default: Serial.println("other"); }
    switch (9) { case 1: break; default: Serial.println("dflt"); }
    int outer = 0;
    for (int a = 0; a < 3; a++) for (int b = 0; b < 3; b++) { if (b == 2) break; outer++; }
    Serial.println(outer);
  `);
  assert.equal(s, "25\n5\n3\n4\ntwo\nthree\ndflt\n6\n");
});

test("ternary, compound assignment, pre/post increment", () => {
  const s = out(`
    int a = 5; int b = a++ + ++a; Serial.println(b); Serial.println(a);
    a *= 3; a -= 1; a /= 2; a %= 7; Serial.println(a);
    a <<= 2; a |= 1; a ^= 3; a &= 0xFF; Serial.println(a);
    Serial.println(a > 3 ? "big" : "small");
  `);
  assert.equal(s, "12\n7\n3\n14\nbig\n");
});

test("functions: prototypes not needed, overloading, defaults, references, recursion", () => {
  const s = out(`
    Serial.println(twice(4));
    Serial.println(twice(1.5));
    Serial.println(add(1));
    Serial.println(add(1, 5));
    int v = 1; bump(v); bump(v); Serial.println(v);
    Serial.println(fact(6));
    int x = 3, y = 4; swap2(x, y); Serial.println(x * 10 + y);
  `, { globals: `
    int twice(int n) { return n * 2; }
    float twice(float n) { return n * 2; }
    int add(int a, int b = 10) { return a + b; }
    void bump(int &n) { n++; }
    long fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
    void swap2(int &a, int &b) { int t = a; a = b; b = t; }
  ` });
  assert.equal(s, "8\n3.00\n11\n6\n3\n720\n43\n");
});

test("arrays: 1D, 2D, initialisers, sizeof, passing to functions", () => {
  const s = out(`
    int a[5] = {1, 2, 3};
    Serial.println(a[2] + a[4]);
    Serial.println(sizeof(a) / sizeof(a[0]));
    int m[2][3] = {{1, 2, 3}, {4, 5, 6}};
    Serial.println(m[1][2]);
    int flat[2][2] = {1, 2, 3, 4};
    Serial.println(flat[1][0]);
    Serial.println(sum(a, 5));
    int leds[] = {2, 3, 4};
    Serial.println(sizeof(leds));
    char name[] = "Ada";
    Serial.println(name);
    Serial.println(sizeof(name));
    const char* words[] = {"red", "green"};
    Serial.println(words[1]);
    String names[] = {"Bo", "Cy"};
    Serial.println(names[0] + names[1]);
  `, { globals: "long sum(int arr[], int n) { long t = 0; for (int i = 0; i < n; i++) t += arr[i]; return t; }" });
  assert.equal(s, "3\n5\n6\n3\n6\n6\nAda\n4\ngreen\nBoCy\n");
});

test("struct, enum, const, static locals, global initialisers", () => {
  const s = out(`
    Point p = {3, 4};
    Point q = p; q.x = 10;
    Serial.println(p.x + p.y);
    Serial.println(q.x);
    Point pts[2] = {{1, 2}, {5, 6}};
    Serial.println(pts[1].y);
    Mode m = FAST;
    Serial.println(m);
    if (m == FAST) Serial.println("fast");
    Serial.println(counter()); Serial.println(counter()); Serial.println(counter());
    Serial.println(LIMIT * 2);
    Serial.println(start);
    Serial.println(dist(p));
  `, { globals: `
    struct Point { int x; int y; };
    enum Mode { SLOW, FAST = 5, TURBO };
    const int LIMIT = 21;
    int start = LIMIT + 1;
    int counter() { static int n = 0; n++; return n; }
    float dist(Point p) { return sqrt(p.x * p.x + p.y * p.y); }
  ` });
  assert.equal(s, "7\n10\n6\n5\nfast\n1\n2\n3\n42\n22\n5.00\n");
});

test("pointers: address-of, deref, pointer arithmetic on arrays, -> on structs", () => {
  const s = out(`
    int v = 5; int* p = &v; *p = 9; Serial.println(v);
    int arr[3] = {10, 20, 30}; int* q = arr; q++; Serial.println(*q); Serial.println(*(q + 1)); Serial.println(q[1]);
    Point pt = {1, 2}; Point* pp = &pt; pp->y = 7; Serial.println(pt.y);
    const char* msg = "Hello"; Serial.println(msg + 1);
    char buf[10]; strcpy(buf, "abc"); strcat(buf, "de"); Serial.println(buf); Serial.println(strlen(buf));
  `, { globals: "struct Point { int x; int y; };" });
  assert.equal(s, "9\n20\n30\n30\n7\nello\nabcde\n5\n");
});

test("#define constants and macros, #ifdef with board macros", () => {
  const src = `
    #define LED 13
    #define SQUARE(x) ((x) * (x))
    #define MSG "hi"
    void setup() {
      Serial.begin(9600);
      Serial.println(SQUARE(LED + 1));
    #ifdef ESP32
      Serial.println("esp32");
    #elif defined(ARDUINO_AVR_UNO)
      Serial.println("uno");
    #else
      Serial.println("other");
    #endif
    #if LED > 10 && !defined(NOPE)
      Serial.println(MSG);
    #endif
      Serial.println(F("flash"));
      Serial.println(max(3, 9) + min(3, 9) + abs(-2) + constrain(50, 0, 10));
    }
    void loop() {}
  `;
  assert.equal(run(src, { ms: 10 }).serial, "196\nuno\nhi\nflash\n24\n");
  assert.equal(run(src, { ms: 10, board: esp32 }).serial, "196\nesp32\nhi\nflash\n24\n");
});

test("lambdas, auto and range-for", () => {
  const s = out(`
    auto sq = [](int n) { return n * n; };
    Serial.println(sq(7));
    int total = 0;
    int nums[] = {1, 2, 3};
    for (int n : nums) total += n;
    for (auto &n : nums) n *= 2;
    Serial.println(total + nums[2]);
    auto t = millis();
    Serial.println(t < 100);
  `);
  assert.equal(s, "49\n12\n1\n");
});

test("struct methods and constructors", () => {
  const s = out(`
    Counter c(5);
    c.add(); c.add();
    Serial.println(c.value());
    Led led = {13, false};
    led.toggle();
    Serial.println(led.on);
  `, { globals: `
    struct Counter {
      int n;
      Counter(int start) { n = start; }
      void add() { n++; }
      int value() { return n; }
    };
    struct Led { int pin; bool on; void toggle() { on = !on; } };
  ` });
  assert.equal(s, "7\n1\n");
});

test("runs on every board", () => {
  for (const b of [uno, esp32, nodemcu]) {
    const r = run("void setup(){pinMode(LED_BUILTIN, OUTPUT);} void loop(){digitalWrite(LED_BUILTIN, HIGH); delay(100); digitalWrite(LED_BUILTIN, LOW); delay(100);}", { board: b });
    assert.ok(r.events.filter((e) => e.type === "digital").length >= 9, b.id);
  }
});
