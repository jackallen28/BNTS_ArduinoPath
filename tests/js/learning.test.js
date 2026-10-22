import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, stepState, stepStars, projectStars, starsMessage, hintsUnlocked, Coach, STUCK_QUIET_MS, STUCK_NO_RUN_MS, harder, easier } from "../../ui/js/learning.js";

test("progress is normalised", () => {
  assert.deepEqual(normalise(null, 3), { version: 1, step: 0, wiring_done: false, finished: false, steps: {} });
  assert.equal(normalise({ step: 9 }, 3).step, 2);
  assert.equal(normalise({ step: -1 }, 3).step, 0);
  assert.equal(normalise({ step: "x", steps: null }, 3).step, 0);
  const p = normalise({}, 2);
  stepState(p, 1).hints = 2;
  assert.equal(p.steps[1].hints, 2);
});

test("stars count hints, not speed", () => {
  assert.equal(stepStars({ done: true, hints: 0 }), 3);
  assert.equal(stepStars({ done: true, hints: 1, failed: 9 }), 2);
  assert.equal(stepStars({ done: true, hints: 3 }), 1);
  assert.equal(stepStars({ done: false, hints: 0 }), 0);
  assert.equal(stepStars({ done: true, skipped: true, hints: 0 }), 0);
  const total = projectStars({ steps: { 0: { done: true, hints: 0 }, 1: { done: true, hints: 2 }, 2: { done: false } } });
  assert.deepEqual(total, { earned: 4, possible: 6 });
  assert.match(starsMessage({ earned: 6, possible: 6 }), /Brilliant/);
  assert.match(starsMessage({ earned: 2, possible: 6 }), /sticking with it/);
});

test("hints unlock by level and support", () => {
  const s = (failed, unlocked) => ({ failed, unlocked });
  assert.equal(hintsUnlocked("beginner", "brief", s(0), 3), 3);
  assert.equal(hintsUnlocked("moderate", "guided", s(0), 3), 3);
  assert.equal(hintsUnlocked("moderate", "scaffolded", s(0), 3), 0);
  assert.equal(hintsUnlocked("moderate", "scaffolded", s(1), 3), 1);
  assert.equal(hintsUnlocked("moderate", "scaffolded", s(2), 3), 3);
  assert.equal(hintsUnlocked("moderate", "brief", s(1), 3), 0);
  assert.equal(hintsUnlocked("moderate", "brief", s(2), 3), 1);
  assert.equal(hintsUnlocked("advanced", "guided", s(1), 3), 0);
  assert.equal(hintsUnlocked("advanced", "guided", s(2), 3), 1);
  assert.equal(hintsUnlocked("advanced", "brief", s(0, true), 3), 3);
  assert.equal(hintsUnlocked("beginner", "guided", s(0), 0), 0);
});

function clock() {
  let t = 1_000_000;
  return { now: () => t, add: (ms) => { t += ms; } };
}

test("stuck: same error twice, once per step", () => {
  const c = new Coach({ now: clock().now });
  assert.equal(c.ran({ errorId: "missing-semicolon" }), null);
  assert.deepEqual(c.ran({ errorId: "missing-semicolon" }), { kind: "stuck", reason: "same-error" });
  assert.equal(c.ran({ errorId: "missing-semicolon" }), null, "only one stuck nudge per step");
  c.stepDone();
  assert.equal(c.ran({ errorId: "x" }), null);
  assert.equal(c.ran({ errorId: "x" })?.kind, "stuck", "a new step can nudge again");
});

test("stuck: a check that keeps failing, many tries", () => {
  const c = new Coach({ now: clock().now });
  c.ran({ failedCheck: "LED blinks" });
  c.ran({ failedCheck: "LED blinks" });
  assert.equal(c.ran({ failedCheck: "LED blinks" })?.reason, "check-failing");
  const d = new Coach({ now: clock().now });
  ["a", "b", "c"].forEach((e) => assert.equal(d.ran({ errorId: e }), null));
  assert.equal(d.ran({ failedCheck: "z" })?.reason, "many-tries");
});

test("stuck: quiet spells", () => {
  const k = clock();
  const c = new Coach({ now: k.now });
  k.add(STUCK_NO_RUN_MS + 1);
  assert.equal(c.tick()?.reason, "no-run");
  const d = new Coach({ now: k.now });
  d.ran({ errorId: "x" });
  k.add(STUCK_QUIET_MS - 1);
  assert.equal(d.tick(), null);
  k.add(2);
  assert.equal(d.tick()?.reason, "quiet");
});

test("flying and struggling, with a 4-step wait", () => {
  const c = new Coach({ level: "beginner", now: clock().now });
  c.stepDone();
  c.stepDone();
  assert.deepEqual(c.stepDone(), { kind: "flying" });
  assert.equal(c.stepDone(), null, "waits 4 steps before the next level nudge");
  c.stepDone();
  c.stepDone();
  assert.deepEqual(c.stepDone(), { kind: "flying" });

  const s = new Coach({ level: "moderate", now: clock().now });
  s.stepDone({ hints: 2 });
  assert.deepEqual(s.stepDone({ hints: 3 }), { kind: "struggling" });

  const off = new Coach({ level: "beginner", nudges: false, now: clock().now });
  off.ran({ errorId: "x" });
  assert.equal(off.ran({ errorId: "x" }), null);
  off.stepDone();
  off.stepDone();
  assert.equal(off.stepDone(), null);
  assert.equal(harder("beginner"), "moderate");
  assert.equal(easier("advanced"), "moderate");
});
