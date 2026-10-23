// The simulator in a real browser: the Web Worker loads under the app's
// strict security policy (no eval), runs a sketch in real time, answers the
// phone panel, and stop() ends even a while(1) loop.
import { test, expect } from "@playwright/test";

test("the simulator runs in a Web Worker under the app's security policy", async ({ page }) => {
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
  await page.goto("/");
  const out = await page.evaluate(async () => {
    const { Simulation } = await import("/js/sim/simulation.js");
    const board = await (await fetch("/api/catalogue")).json().then((c) => c.boards.find((b) => b.id === "esp32")).catch(() => null);
    const events = [];
    const errors = [];
    const sim = new Simulation({ board, onEvents: (e) => events.push(...e), onError: (e) => errors.push(e) });
    const compiled = await sim.start(`
      #include <WiFi.h>
      #include <WebServer.h>
      WebServer server(80);
      void setup() {
        Serial.begin(115200);
        pinMode(2, OUTPUT);
        WiFi.softAP("ArduinoPath");
        server.on("/on", []() { digitalWrite(2, HIGH); server.send(200, "text/plain", "on"); });
        server.begin();
        Serial.println("ready");
      }
      void loop() { server.handleClient(); }`);
    await new Promise((r) => setTimeout(r, 400));
    const res = await sim.http({ path: "/on" });
    await new Promise((r) => setTimeout(r, 100));
    sim.stop();
    // A runaway loop still stops straight away.
    const busy = new Simulation({ board, onEvents: (e) => events.push(...e) });
    await busy.start("void setup() { while (1) { } } void loop() {}");
    await new Promise((r) => setTimeout(r, 300));
    const t0 = performance.now();
    busy.stop();
    const stopMs = performance.now() - t0;
    return { compiled, res, errors, stopMs, serial: events.filter((e) => e.type === "serial").map((e) => e.text).join(""), on: events.some((e) => e.type === "digital" && e.pin === 2 && e.value === 1) };
  });
  expect(out.compiled.ok).toBe(true);
  expect(out.errors).toEqual([]);
  expect(out.serial).toContain("ready");
  expect(out.res.status).toBe(200);
  expect(out.res.body).toBe("on");
  expect(out.on).toBe(true);
  expect(out.stopMs).toBeLessThan(100);
  expect(problems).toEqual([]);
});
