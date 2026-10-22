// Pins: roles (LED_PIN, BUTTON_PIN...) → the board's pins, and the
// {{pins}} header put at the top of a step's starter code and demo.
// See docs/design.md §1 and §2.

export const ROLES = [
  "LED_PIN", "LED_RED", "LED_YELLOW", "LED_GREEN", "LED_BLUE", "RGB_RED", "RGB_GREEN", "RGB_BLUE",
  "BUTTON_PIN", "BUTTON2_PIN", "BUTTON_RED", "BUTTON_YELLOW", "BUTTON_GREEN", "BUTTON_BLUE",
  "BUZZER_PIN", "SERVO_PIN", "POT_PIN", "LDR_PIN", "SOIL_PIN", "JOY_X_PIN", "JOY_Y_PIN", "JOY_SW_PIN",
  "PIR_PIN", "DHT_PIN", "TRIG_PIN", "ECHO_PIN", "NEOPIXEL_PIN", "TM1637_CLK", "TM1637_DIO",
  "MATRIX_DIN", "MATRIX_CLK", "MATRIX_CS", "RFID_SS", "RFID_RST",
  "KEYPAD_R1", "KEYPAD_R2", "KEYPAD_R3", "KEYPAD_R4", "KEYPAD_C1", "KEYPAD_C2", "KEYPAD_C3", "KEYPAD_C4",
];

/** The pin plan for a board in a project: the board's plan with the project's overrides. */
export function pinPlan(project, board) {
  const plan = { ...(board.pin_plan || {}) };
  const o = project?.pins || {};
  for (const key of ["all", board.family, board.id]) {
    if (o[key]) Object.assign(plan, o[key]);
  }
  return plan;
}

/**
 * Resolves a role (LED_PIN), a pin code (13, A0, D5), LED_BUILTIN or a bus
 * pin name (SDA) to { code, number, label }, or null.
 * @param {string|number} name
 * @param {object} board
 * @param {object} [project]
 */
export function resolvePin(name, board, project = null) {
  if (name == null) return null;
  const s = String(name);
  const byCode = (code) => {
    const p = (board.pins || []).find((x) => x.code === String(code));
    return p ? { code: p.code, number: p.number, label: p.label } : null;
  };
  const plan = pinPlan(project, board);
  if (plan[s] != null) return byCode(plan[s]);
  if (s === "LED_BUILTIN" && board.led_builtin) return byCode(board.led_builtin.pin);
  const bus = { SDA: board.i2c?.sda, SCL: board.i2c?.scl, MOSI: board.spi?.mosi, MISO: board.spi?.miso, SCK: board.spi?.sck, SS: board.spi?.ss };
  if (bus[s] != null) return byCode(bus[s]);
  const direct = byCode(s);
  if (direct) return direct;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const p = (board.pins || []).find((x) => x.number === n);
    if (p) return { code: p.code, number: p.number, label: p.label };
  }
  return null;
}

/**
 * The pin roles a sketch uses, in the order they first appear
 * (mirrors RolesIn in internal/content/pins.go).
 * @param {string} code
 * @param {Record<string,string>} plan
 */
export function rolesIn(code, plan) {
  const roles = [];
  for (const m of String(code || "").matchAll(/\b[A-Z][A-Z0-9_]*\b/g)) {
    if (Object.hasOwn(plan, m[0]) && !roles.includes(m[0])) roles.push(m[0]);
  }
  return roles;
}

/**
 * What {{pins}} becomes: a #define for each role the code uses (and
 * ANALOG_MAX when it's used), for this board. Mirrors PinHeader in
 * internal/content/pins.go exactly.
 * @param {object} project
 * @param {object} board
 * @param {string} [code]
 */
export function pinHeader(project, board, code = "") {
  const plan = pinPlan(project, board);
  let out = `// Pins for your ${board.name} (from the Wiring Wizard)\n`;
  for (const role of rolesIn(code, plan)) out += `#define ${role} ${plan[role]}\n`;
  if (/\bANALOG_MAX\b/.test(code)) out += `#define ANALOG_MAX ${board.analog_max ?? 0}\n`;
  return out;
}

/** Replaces {{pins}} in a starter or demo with the pin header (the first one, like the Go code). */
export function expandPins(text, project, board) {
  if (!text || !text.includes("{{pins}}")) return text;
  return text.replace("{{pins}}", () => pinHeader(project, board, text));
}

/** Constants the simulator defines for a board: A0, D5, LED_BUILTIN, SDA... → pin number. */
export function boardConstants(board) {
  const out = {};
  for (const p of board.pins || []) if (!/^\d+$/.test(p.code)) out[p.code] = p.number;
  const num = (code) => resolvePin(code, board)?.number ?? Number(code);
  if (board.led_builtin) out.LED_BUILTIN = num(board.led_builtin.pin);
  if (board.i2c) { out.SDA = num(board.i2c.sda); out.SCL = num(board.i2c.scl); }
  if (board.spi) for (const k of ["mosi", "miso", "sck", "ss"]) out[k.toUpperCase()] = num(board.spi[k]);
  return out;
}

/** Does a project's boards list include this board? ("all", family, "esp", or an id) */
export function projectSuits(project, board) {
  return (project.boards || ["all"]).some((k) => k === "all" || k === board.id || k === board.family ||
    (k === "esp" && (board.family === "esp8266" || board.family === "esp32")));
}
