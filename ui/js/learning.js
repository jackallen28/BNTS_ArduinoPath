// How a student moves through a project: their saved progress, independence
// stars, which hints are unlocked, and the adaptive Coach's nudges. Pure
// logic (tested in Node); the workspace shows what it decides.
//
// Progress (saved per project at /api/me/progress/<id>):
//   { version: 1, step, wiring_done, finished, started_at,
//     steps: { "<i>": { done, hints, runs, failed, first_try, skipped, nudged } } }

export const STUCK_QUIET_MS = 3 * 60_000; // no change after a failed run
export const STUCK_NO_RUN_MS = 5 * 60_000; // on a step without pressing Run

/** A progress object with every field, whatever was saved before. */
export function normalise(saved, stepCount) {
  const p = { version: 1, step: 0, wiring_done: false, finished: false, steps: {}, ...(saved && typeof saved === "object" ? saved : {}) };
  if (typeof p.steps !== "object" || p.steps === null) p.steps = {};
  p.step = Math.max(0, Math.min(Number.isInteger(p.step) ? p.step : 0, Math.max(0, stepCount - 1)));
  return p;
}

/** One step's record, created if needed. */
export function stepState(p, i) {
  if (!p.steps[i]) p.steps[i] = { done: false, hints: 0, runs: 0, failed: 0, first_try: false, skipped: false };
  return p.steps[i];
}

/** Independence stars for a finished step: fewer hints, more stars (1-3). */
export function stepStars(s) {
  if (!s?.done || s.skipped) return 0;
  return s.hints === 0 ? 3 : s.hints === 1 ? 2 : 1;
}

/** Stars for the project so far: { earned, possible }. */
export function projectStars(p) {
  let earned = 0;
  let possible = 0;
  for (const s of Object.values(p.steps)) {
    if (!s.done || s.skipped) continue;
    earned += stepStars(s);
    possible += 3;
  }
  return { earned, possible };
}

/** A kind word about stars (never about speed). */
export function starsMessage({ earned, possible }) {
  if (possible === 0) return "";
  const ratio = earned / possible;
  if (ratio === 1) return "Every step on your own. Brilliant independence!";
  if (ratio >= 0.7) return "You worked most of it out yourself. Great work!";
  return "You used hints to get there, and that's how you learn. Well done for sticking with it!";
}

/**
 * How many of a step's hints the student can open now.
 * Beginner: all of them, any time. Moderate: by the step's support
 * (guided: all; scaffolded: one after a clue, all after two; brief: one
 * after two clues). Advanced: one hint, after two clues. A stuck nudge
 * ("unlocked") opens them all early.
 */
export function hintsUnlocked(level, support, s, total) {
  if (total === 0) return 0;
  if (s?.unlocked || level === "beginner") return total;
  const failed = s?.failed ?? 0;
  if (level === "advanced") return failed >= 2 ? 1 : 0;
  switch (support) {
    case "guided":
      return total;
    case "scaffolded":
      return failed >= 2 ? total : failed >= 1 ? 1 : 0;
    default:
      return failed >= 2 ? 1 : 0;
  }
}

/**
 * The adaptive Coach. Feed it what happens; it returns at most one nudge
 * each time, or null:
 *   { kind: "stuck", reason }       → "Show me a hint" / "Watch the goal" / "Show the full explanation"
 *   { kind: "flying" }              → "Try a harder level?"
 *   { kind: "struggling" }          → "Want a bit more help?"
 * Each step gets at most one stuck nudge; level suggestions wait 4 steps
 * after the last one; nothing when the student turned nudges off.
 */
export class Coach {
  constructor({ level = "beginner", nudges = true, now = () => Date.now() } = {}) {
    this.level = level;
    this.nudges = nudges;
    this.now = now;
    this.history = []; // finished steps: { firstTry, hints, failed }
    this.stepsSinceLevelNudge = 4;
    this.startStep();
  }

  startStep() {
    this.lastError = null;
    this.sameError = 0;
    this.failingCheck = null;
    this.sameCheck = 0;
    this.failed = 0;
    this.stuckNudged = false;
    this.stepStarted = this.now();
    this.lastRun = 0;
    this.lastFailAt = 0;
    this.lastChange = this.now();
  }

  stuck(reason) {
    if (!this.nudges || this.stuckNudged) return null;
    this.stuckNudged = true;
    return { kind: "stuck", reason };
  }

  /** The student edited the code. */
  changed() {
    this.lastChange = this.now();
  }

  /**
   * A run (simulator or upload) finished. errorId: the Coach's errors.json
   * id for a clue (or null); failedCheck: the first check that failed (its
   * label) or null when everything passed.
   */
  ran({ errorId = null, failedCheck = null } = {}) {
    this.lastRun = this.now();
    const failed = Boolean(errorId || failedCheck);
    if (!failed) return null;
    this.failed++;
    this.lastFailAt = this.now();
    if (errorId) {
      this.sameError = errorId === this.lastError ? this.sameError + 1 : 1;
      this.lastError = errorId;
      if (this.sameError >= 2) return this.stuck("same-error");
    }
    if (failedCheck) {
      this.sameCheck = failedCheck === this.failingCheck ? this.sameCheck + 1 : 1;
      this.failingCheck = failedCheck;
      if (this.sameCheck >= 3) return this.stuck("check-failing");
    }
    if (this.failed >= 4) return this.stuck("many-tries");
    return null;
  }

  /** Called every so often: quiet spells. */
  tick() {
    const t = this.now();
    if (this.lastFailAt && t - this.lastChange >= STUCK_QUIET_MS && t - this.lastFailAt >= STUCK_QUIET_MS) return this.stuck("quiet");
    if (!this.lastRun && t - this.stepStarted >= STUCK_NO_RUN_MS && t - this.lastChange >= 60_000) return this.stuck("no-run");
    return null;
  }

  /** The step's checks all passed. */
  stepDone({ hints = 0 } = {}) {
    this.history.push({ firstTry: this.failed === 0, hints, failed: this.failed });
    this.stepsSinceLevelNudge++;
    this.startStep();
    if (!this.nudges || this.stepsSinceLevelNudge < 4) return null;
    const last = (n) => this.history.slice(-n);
    if (this.level !== "advanced" && this.history.length >= 3 && last(3).every((s) => s.firstTry && s.hints === 0)) {
      this.stepsSinceLevelNudge = 0;
      return { kind: "flying" };
    }
    if (this.level !== "beginner" && this.history.length >= 2 && last(2).every((s) => s.failed >= 4 || s.hints >= 2)) {
      this.stepsSinceLevelNudge = 0;
      return { kind: "struggling" };
    }
    return null;
  }
}

/** The help level one step up or down. */
export function harder(level) {
  return level === "beginner" ? "moderate" : "advanced";
}
export function easier(level) {
  return level === "advanced" ? "moderate" : "beginner";
}
