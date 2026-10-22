// Compile errors are worded like avr-gcc's, so the Coach can explain them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { err, errs, sketch, uno, esp32 } from "./helpers.js";
import { compile } from "../../../ui/js/sim/compiler.js";

test("missing semicolon: reported after the previous token", () => {
  const src = "void setup() {\n  pinMode(13, OUTPUT)\n  digitalWrite(13, HIGH);\n}\nvoid loop() {}";
  const [e] = errs(src);
  assert.equal(e.message, "expected ';' before 'digitalWrite'");
  assert.equal(e.line, 2);
  assert.equal(e.col, 22);
  assert.equal(err("void setup() { delay(10) }\nvoid loop() {}"), "expected ';' before '}' token");
});

test("missing semicolon after a global", () => {
  assert.equal(err("int ledPin = 13\nvoid setup() {}\nvoid loop() {}"), "expected ',' or ';' before 'void'");
});

test("undeclared names, with did-you-mean", () => {
  assert.equal(err(sketch("pinMode(ledPin, OUTPUT);")), "'ledPin' was not declared in this scope");
  assert.equal(err(sketch("digitalwrite(13, HIGH);")), "'digitalwrite' was not declared in this scope; did you mean 'digitalWrite'?");
  assert.equal(err(sketch("pinMode(13, output);")), "'output' was not declared in this scope; did you mean 'OUTPUT'?");
});

test("missing closing brace", () => {
  const e = errs("void setup() {\n  pinMode(13, OUTPUT);\n\nvoid loop() {\n}\n");
  assert.equal(e[0].message, "a function-definition is not allowed here before '{' token");
  assert.equal(e[0].line, 4);
  assert.equal(e[1].message, "expected '}' at end of input");
});

test("expected primary-expression", () => {
  assert.equal(err(sketch("digitalWrite(13, );")), "expected primary-expression before ')' token");
  assert.equal(err(sketch("int x = ;")), "expected primary-expression before ';' token");
});

test("missing ) and (", () => {
  assert.equal(err(sketch("delay(1000;")), "expected ')' before ';' token");
  assert.equal(err(sketch("int x = 1; if x > 5 { x = 2; }")), "expected '(' before 'x'");
});

test("wrong number of arguments", () => {
  assert.equal(err(sketch("foo();", "", "void foo(int n) {}")), "too few arguments to function 'void foo(int)'");
  assert.equal(err(sketch("foo(1, 2);", "", "void foo(int n) {}")), "too many arguments to function 'void foo(int)'");
  assert.equal(err(sketch("pinMode(13);")), "too few arguments to function 'void pinMode(uint8_t, uint8_t)'");
});

test("missing setup or loop is a link error", () => {
  assert.equal(err("void loop() {}"), "undefined reference to `setup'");
  assert.equal(err("void setup() {}"), "undefined reference to `loop'");
  assert.equal(errs("void setup() {}")[0].line, 0);
});

test("unknown header", () => {
  const [e] = errs('#include <Foo.h>\nvoid setup() {}\nvoid loop() {}');
  assert.equal(e.message, "fatal error: Foo.h: No such file or directory");
  assert.equal(e.line, 1);
  assert.equal(err('#include <ESP8266WiFi.h>\nvoid setup() {}\nvoid loop() {}', uno), "fatal error: ESP8266WiFi.h: No such file or directory");
});

test("types that don't exist", () => {
  assert.equal(err("Servo myServo;\nvoid setup() {}\nvoid loop() {}"), "'Servo' does not name a type");
  assert.equal(err("string name;\nvoid setup() {}\nvoid loop() {}"), "'string' does not name a type; did you mean 'String'?");
  assert.equal(err(sketch("Servo s;")), "'Servo' was not declared in this scope");
});

test("code outside a function", () => {
  assert.equal(err("digitalWrite(13, HIGH);\nvoid setup() {}\nvoid loop() {}"), "expected constructor, destructor, or type conversion before '(' token");
  assert.equal(err("if (1) {}\nvoid setup() {}\nvoid loop() {}"), "expected unqualified-id before 'if'");
  assert.equal(err("void setup() {}\n}\nvoid loop() {}"), "expected declaration before '}' token");
});

test("#define with a semicolon and a clashing name", () => {
  assert.equal(err(sketch("pinMode(LED, OUTPUT);", "", "#define LED 13;")), "expected ')' before ';' token");
  assert.equal(err("#define LED 13\nint LED = 5;\nvoid setup() {}\nvoid loop() {}"), "expected unqualified-id before numeric constant");
});

test("smart quotes are stray characters", () => {
  assert.equal(err(sketch("Serial.println(“hi”);")), "stray '\\342' in program");
  assert.equal(err(sketch('Serial.println("hi);')), 'missing terminating " character');
});

test("type errors", () => {
  assert.equal(err(sketch('int x = "hello";')), "invalid conversion from 'const char*' to 'int' [-fpermissive]");
  assert.equal(err(sketch('String s = "5"; int x = s;')), "cannot convert 'String' to 'int' in initialization");
  assert.equal(err(sketch("int x = digitalWrite(13, HIGH);")), "void value not ignored as it ought to be");
  assert.equal(err(sketch('Serial.println("a" + "b");')), "invalid operands of types 'const char [2]' and 'const char [2]' to binary 'operator+'");
  assert.equal(err(sketch("5 = 3;")), "lvalue required as left operand of assignment");
  assert.equal(err(sketch("x = 3;", "", "const int x = 1;")), "assignment of read-only variable 'x'");
  assert.equal(err(sketch("int a[3]; int b[3]; a = b;")), "invalid array assignment");
  assert.equal(err(sketch("int x; x.begin();")), "request for member 'begin' in 'x', which is of non-class type 'int'");
  assert.equal(err(sketch("int x; x[1] = 2;")), "invalid types 'int[int]' for array subscript");
  assert.equal(err(sketch("int x = 1; x(2);")), "'x' cannot be used as a function");
});

test("member names", () => {
  assert.equal(err(sketch("Serial.prinln(1);")), "'class HardwareSerial' has no member named 'prinln'; did you mean 'println'?");
  assert.equal(err(sketch('String s = "a"; int n = s.lenght();')), "'class String' has no member named 'lenght'; did you mean 'length'?");
  assert.equal(err(sketch('Serial.printf("%d", 1);')), "'class HardwareSerial' has no member named 'printf'; did you mean 'print'?");
  assert.equal(err(sketch('Serial.printf("%d", 1);'), esp32), "");
});

test("return, break, case, redeclaration", () => {
  assert.equal(err(sketch("return 5;")), "return-statement with a value, in function returning 'void' [-fpermissive]");
  assert.equal(err(sketch("", "", "int f() { return; }")), "return-statement with no value, in function returning 'int' [-fpermissive]");
  assert.equal(err(sketch("break;")), "break statement not within loop or switch");
  assert.equal(err(sketch("continue;")), "continue statement not within a loop");
  assert.equal(err(sketch("int x = 1; int x = 2;")), "redeclaration of 'int x'");
  assert.equal(err("int x;\nint x;\nvoid setup() {}\nvoid loop() {}"), "redefinition of 'int x'");
  assert.equal(err(sketch("int k = 1; switch (k) { case 1: int y = 2; break; case 2: break; }")), "jump to case label [-fpermissive]");
  assert.equal(err(sketch("int k = 1; switch (k) { case 1: break; case 1: break; }")), "duplicate case value");
  assert.equal(err("void setup() {}\nvoid setup() {}\nvoid loop() {}"), "redefinition of 'void setup()'");
  assert.equal(err(sketch("if (1) {} ; else {}")), "'else' without a previous 'if'");
});

test("unsupported C++ is a friendly message", () => {
  const r = compile("template <typename T> T twice(T x) { return x * 2; }\nvoid setup() {}\nvoid loop() {}", uno);
  assert.equal(r.ok, false);
  assert.equal(r.unsupported, true);
  assert.match(r.message, /^The simulator can't run this part of your code \(templates\), but the real board can: press Upload\.$/);
  assert.match(err(sketch("int x = 1; int* p = &x; int** pp = &p;")), /UNSUPPORTED.*pointers to pointers/);
  assert.match(err(sketch('asm("nop");')), /UNSUPPORTED.*assembly/);
  assert.match(err(sketch("int* p = new int;")), /UNSUPPORTED.*new and delete/);
  assert.match(err("class A {}; class B : public A {};\nvoid setup() {}\nvoid loop() {}"), /UNSUPPORTED.*inherit/);
  assert.match(err(sketch("void (*fp)() = 0;")), /UNSUPPORTED.*function pointers/);
});

test("reports at most a few errors and never throws", () => {
  const junk = ["", "}}}}", "void", "void setup(", "#if", "int x = (((((", "\u0000\u0001", "struct {", "Serial.println(", "a b c d e f"];
  for (const j of junk) {
    const r = compile(j, uno);
    assert.equal(r.ok, false, JSON.stringify(j));
    assert.ok(r.errors.length <= 5);
    assert.ok(!r.internal, j + ": " + r.internal);
  }
});
