// Keypad (4×4 / 4×3): keys come from sim.pressKey("5") / sim_events { key }.

import { waitFor } from "../api.js";

const HEADER = `
#define NO_KEY '\\0'
#define makeKeymap(x) ((char*)x)
typedef char KeypadEvent;
enum KeyState { IDLE, PRESSED, HOLD, RELEASED };
class Keypad {
public:
  Keypad(char* userKeymap, byte* row, byte* col, byte numRows, byte numCols);
  char getKey();
  char waitForKey();
  KeyState getState();
  bool keyStateChanged();
  bool isPressed(char keyChar);
  void setDebounceTime(uint16_t debounce);
  void setHoldTime(uint16_t hold);
  void addEventListener(callback listener);
  uint8_t numKeys();
};
`;

export class Keypad {
  constructor(R, map, rows, cols, nr, nc) {
    this.R = R;
    this.nr = nr;
    this.nc = nc;
    this.keys = new Set();
    // The keymap is a char array (often 2D): collect its characters.
    if (map && map.a) {
      const a = map.a;
      const flat = a.length && typeof a[0] === "object" ? a.flatMap((row) => Array.from(row)) : Array.from(a).slice(map.i);
      for (const c of flat.slice(0, nr * nc)) if (c) this.keys.add(String.fromCharCode(c & 255));
    }
    this.state = 0;
    this.listener = null;
    this.changed = false;
  }
  next() {
    const R = this.R;
    R.us += 200;
    R.progress();
    const q = R.keyQueue;
    if (!q.length) {
      if (this.state === 1) { this.state = 0; this.changed = true; }
      return 0;
    }
    const k = q.shift();
    if (this.keys.size && !this.keys.has(k)) {
      R.warn("keypad-key", k, { line: R.ln, message: `The key '${k}' isn't in your keypad's key map.` });
    }
    this.state = 1;
    this.changed = true;
    if (this.listener) R.runToEnd(this.listener.call(k.charCodeAt(0)), "keypad event function");
    return k.charCodeAt(0);
  }
  getKey() { return this.next(); }
  *waitForKey() {
    yield* waitFor(this.R, 3_600_000_000, () => this.R.keyQueue.length > 0);
    return this.next();
  }
  getState() { return this.state; }
  keyStateChanged() { const c = this.changed; this.changed = false; return c ? 1 : 0; }
  isPressed() { return 0; }
  setDebounceTime() {}
  setHoldTime() {}
  addEventListener(fn) { this.listener = fn; }
  numKeys() { return this.nr * this.nc; }
}

export default {
  headers: { "Keypad.h": HEADER },
  classes: { Keypad },
};
