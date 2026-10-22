// The worker host: pacing to the clock, stopping a runaway loop, the phone panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimHost } from "../../../ui/js/sim/host.js";
import { uno, esp32 } from "./helpers.js";

/** A host with a fake clock; tick() runs one frame. */
function setup() {
  let now = 0, queued = null;
  const msgs = [];
  const host = new SimHost((m) => msgs.push(m), {
    setTimeout: (fn) => { queued = fn; return 1; },
    clearTimeout: () => { queued = null; },
    now: () => now,
  });
  return {
    host, msgs,
    frames(n, ms = 16) { for (let i = 0; i < n && queued; i++) { now += ms; const f = queued; queued = null; f(); } },
    events: () => msgs.filter((m) => m.type === "events").flatMap((m) => m.events),
  };
}

test("compiles, then runs paced to the clock", () => {
  const s = setup();
  s.host.handle({ cmd: "start", board: uno, source: "void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);delay(100);digitalWrite(13,LOW);delay(100);}" });
  assert.equal(s.msgs[0].type, "compiled");
  assert.equal(s.msgs[0].result.ok, true);
  s.frames(63); // about a second
  const d = s.events().filter((e) => e.type === "digital");
  assert.ok(d.length >= 9 && d.length <= 11, String(d.length));
});

test("compile errors are reported and nothing runs", () => {
  const s = setup();
  s.host.handle({ cmd: "start", board: uno, source: "void setup() { foo(); }\nvoid loop() {}" });
  assert.equal(s.msgs[0].result.ok, false);
  assert.match(s.msgs[0].result.errors[0].message, /'foo' was not declared/);
  assert.equal(s.host.R, null);
});

test("speed: 0 pauses, 2 runs twice as fast", () => {
  const s = setup();
  s.host.handle({ cmd: "start", board: uno, source: "void setup(){} void loop(){delay(10);}" });
  s.frames(10);
  const t1 = s.host.R.us;
  s.host.handle({ cmd: "speed", speed: 0 });
  s.frames(10);
  assert.equal(s.host.R.us, t1);
  s.host.handle({ cmd: "speed", speed: 2 });
  s.frames(10);
  assert.ok(s.host.R.us - t1 > 300_000, String(s.host.R.us - t1));
});

test("a while(1) loop never blocks a frame, warns, and stops at once", () => {
  const s = setup();
  s.host.handle({ cmd: "start", board: uno, source: "void setup() {\n  long n = 0;\n  while (1) {\n    n++;\n  }\n}\nvoid loop() {}" });
  const t0 = performance.now();
  s.frames(150);
  assert.ok(performance.now() - t0 < 150 * 15, "frames stay short");
  const w = s.events().find((e) => e.type === "warning" && e.kind === "busy-loop");
  assert.ok(w, "busy-loop warning");
  assert.equal(w.line, 3);
  s.host.handle({ cmd: "stop" });
  assert.equal(s.host.R, null);
  assert.equal(s.events().at(-1).type, "stopped");
  assert.equal(s.msgs.at(-1).type, "done");
});

test("inputs by role, Serial input, runtime errors end the run", () => {
  const s = setup();
  const project = { pins: {} };
  s.host.handle({ cmd: "start", board: uno, project, source: "void setup(){Serial.begin(9600);pinMode(2,INPUT_PULLUP);} void loop(){ if (Serial.available()) { Serial.println(Serial.readStringUntil('\\n') + digitalRead(2)); } }" });
  s.host.handle({ cmd: "inputs", inputs: { digital: { BUTTON_PIN: 0 } } });
  s.host.handle({ cmd: "serial", text: "hi\n" });
  s.frames(5);
  assert.equal(s.events().filter((e) => e.type === "serial").map((e) => e.text).join(""), "hi0\r\n");
  const t = setup();
  t.host.handle({ cmd: "start", board: uno, source: "int a[2]; void setup(){} void loop(){ for (int i = 0; i < 3; i++) a[i] = 1; delay(5); }" });
  t.frames(3);
  assert.ok(t.events().some((e) => e.type === "error" && e.kind === "runtime"));
  assert.equal(t.msgs.at(-1).type, "done");
  assert.equal(t.msgs.at(-1).reason, "error");
});

test("the phone panel: http requests reach the sketch's web server", () => {
  const s = setup();
  s.host.handle({ cmd: "start", board: esp32, source: `
    #include <WiFi.h>
    #include <WebServer.h>
    WebServer server(80);
    void setup() {
      pinMode(2, OUTPUT);
      WiFi.softAP("ArduinoPath", "12345678");
      server.on("/", []() { server.send(200, "text/html", "<h1>Hi</h1>"); });
      server.on("/on", []() { digitalWrite(2, HIGH); server.send(200, "text/plain", "LED on " + server.arg("v")); });
      server.begin();
    }
    void loop() { server.handleClient(); }` });
  s.frames(3);
  s.host.handle({ cmd: "http", id: 1, req: { method: "GET", path: "/on", query: { v: "7" } } });
  s.host.handle({ cmd: "http", id: 2, req: { path: "/nope" } });
  s.frames(3);
  const res = s.msgs.filter((m) => m.type === "http");
  assert.deepEqual(res.map((m) => [m.id, m.res.status, m.res.body]), [[1, 200, "LED on 7"], [2, 404, "Not found: /nope"]]);
  assert.ok(s.events().some((e) => e.type === "digital" && e.pin === 2 && e.value === 1));
  assert.deepEqual(s.events().filter((e) => e.type === "http_route").map((e) => e.path), ["/", "/on"]);
});
