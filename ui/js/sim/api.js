// The simulated Arduino core: pins, time, Serial, maths, C strings.
// Each function gets the runtime R first, then the sketch's arguments.
// Generator functions can make the sketch wait (delay, Serial.readString).

import { Ptr, SimError, cstr, writeCStr, itoa, dtostrf, atol, atof, format, toText, upper, lower } from "./values.js";
import { MODES } from "./runtime.js";

/** Sleeps for `us` simulated microseconds (the sketch pauses). */
export function* sleep(R, us) {
  const end = R.us + us;
  R.progress();
  while (R.us < end) {
    R.wakeAt = end;
    yield 1;
  }
  R.wakeAt = 0;
  R.progress();
}

/** Waits until cond() is true or `us` passes. Returns cond(). */
export function* waitFor(R, us, cond) {
  const end = R.us + us;
  while (!cond()) {
    if (R.us >= end) break;
    R.wakeAt = end;
    R.wakeOn = cond;
    yield 1;
  }
  R.wakeAt = 0;
  R.wakeOn = null;
  R.progress();
  return cond();
}

// ------------------------------------------------------------ pins

function analogPin(R, pin) {
  // analogRead(0) means A0 on AVR and ESP8266.
  const b = R.board;
  const a0 = b.pins.find((p) => p.code === "A0");
  if (R.family !== "esp32" && a0 && pin < a0.number) {
    const ap = b.pins.find((p) => p.code === "A" + pin);
    if (ap) return ap.number;
  }
  return pin;
}

function pwmPin(R, pin) {
  const p = R.board.pins.find((x) => x.number === pin);
  return !p || p.modes.includes("pwm");
}

export const functions = {
  pinMode(R, pin, mode) {
    R.us += R.avr ? 4 : 1;
    if (!R.checkPin(pin, "pinMode()")) return;
    const s = R.pinState(pin);
    s.mode = mode;
    s.out = mode === 1;
    if (!s.out) s.value = 0;
    R.emit("pinMode", { pin, mode: MODES[mode] ?? String(mode) });
  },
  digitalWrite(R, pin, val) {
    R.us += R.avr ? 4 : 1;
    if (!R.checkPin(pin, "digitalWrite()")) return;
    const s = R.pinState(pin);
    const v = val ? 1 : 0;
    if (!s.out) {
      // Writing HIGH to an input turns on its pull-up resistor (AVR).
      if (R.avr) s.mode = v ? 2 : 0;
      R.progress();
      return;
    }
    if (s.value === v && s.written) { R.progress(); return; }
    s.value = v;
    s.written = true;
    s.pwm = null;
    R.emit("digital", { pin, value: v });
  },
  digitalRead(R, pin) {
    R.us += R.avr ? 4 : 1;
    R.progress();
    if (!R.checkPin(pin, "digitalRead()")) return 0;
    return R.readPin(pin);
  },
  analogRead(R, pin) {
    R.us += R.avr ? 112 : R.family === "esp32" ? 10 : 100;
    R.progress();
    pin = analogPin(R, pin);
    const max = R.board.analog_max ?? 1023;
    let v = R.inputs.analog[pin];
    if (v == null) {
      const d = R.inputs.digital[pin];
      v = d ? max : 0;
    }
    v = Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    if (R.adcBits) v = Math.round(v * ((2 ** R.adcBits - 1) / max));
    return v;
  },
  analogReference() {},
  analogReadResolution(R, bits) { R.adcBits = Math.max(1, Math.min(16, bits)); },
  analogReadMilliVolts(R, pin) {
    const v = functions.analogRead(R, pin);
    return Math.round((v / (R.adcBits ? 2 ** R.adcBits - 1 : R.board.analog_max)) * 3300);
  },
  analogWriteResolution(R, bits) { R.pwmMax = 2 ** bits - 1; },
  analogWriteRange(R, range) { R.pwmMax = range; },
  analogWriteFreq() {},
  analogWrite(R, pin, val) {
    R.us += R.avr ? 6 : 2;
    if (!R.checkPin(pin, "analogWrite()")) return;
    const s = R.pinState(pin);
    if (!s.out) {
      s.mode = 1; s.out = true;
      R.emit("pinMode", { pin, mode: "OUTPUT" });
    }
    const max = R.pwmMax ?? R.board.pwm_max ?? 255;
    let v = Math.max(0, Math.min(max, val));
    if (R.avr && !pwmPin(R, pin)) {
      // Not a PWM pin: the Arduino core switches it fully on or off.
      functions.digitalWrite(R, pin, v < 128 ? 0 : 1);
      return;
    }
    if (max !== 255) v = Math.round((v * 255) / max);
    if (s.pwm === v) { R.progress(); return; }
    s.pwm = v;
    s.value = v > 0 ? 1 : 0;
    s.written = false;
    R.emit("pwm", { pin, value: v });
  },
  millis(R) { R.progress(); return R.millis(); },
  micros(R) { R.progress(); return (R.avr ? Math.floor(R.us / 4) * 4 : Math.floor(R.us)) >>> 0; },
  *delay(R, ms) { yield* sleep(R, ms * 1000); },
  delayMicroseconds(R, us) { R.us += us; R.progress(); },
  yield(R) { R.progress(); },
  pulseIn(R, pin, state, timeout = 1000000) {
    R.progress();
    let v = R.inputs.pulse[pin];
    if (v == null || v <= 0 || v > timeout) {
      R.us += timeout;
      return 0;
    }
    v = Math.round(v);
    R.us += v + 50;
    void state;
    return v;
  },
  pulseInLong(R, pin, state, timeout) { return functions.pulseIn(R, pin, state, timeout); },
  shiftOut(R, dataPin, clockPin, bitOrder, val) {
    for (let i = 0; i < 8; i++) {
      const bit = bitOrder === 0 ? (val >> i) & 1 : (val >> (7 - i)) & 1;
      functions.digitalWrite(R, dataPin, bit);
      functions.digitalWrite(R, clockPin, 1);
      functions.digitalWrite(R, clockPin, 0);
    }
  },
  shiftIn(R, dataPin, clockPin, bitOrder) {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      functions.digitalWrite(R, clockPin, 1);
      const b = R.readPin(dataPin);
      v |= bitOrder === 0 ? b << i : b << (7 - i);
      functions.digitalWrite(R, clockPin, 0);
    }
    return v;
  },
  digitalPinToInterrupt(R, pin) {
    if (R.board.id === "mega") return { 2: 0, 3: 1, 18: 5, 19: 4, 20: 3, 21: 2 }[pin] ?? -1;
    return pin === 2 ? 0 : pin === 3 ? 1 : -1;
  },
  attachInterrupt(R, num, fn, mode) {
    let pin = num;
    if (R.avr) {
      const map = R.board.id === "mega" ? { 0: 2, 1: 3, 5: 18, 4: 19, 3: 20, 2: 21 } : { 0: 2, 1: 3 };
      pin = map[num];
      if (pin == null) {
        R.warn("interrupt", num, { line: R.ln, message: `Interrupt number ${num} doesn't exist on the ${R.board.name}. Use digitalPinToInterrupt(pin).` });
        return;
      }
    }
    R.isrs.set(pin, { fn, mode });
  },
  detachInterrupt(R, num) {
    if (R.avr) num = { 0: 2, 1: 3 }[num] ?? num;
    R.isrs.delete(num);
  },
  interrupts(R) {
    R.interruptsOn = true;
    const p = R.pendingIsr;
    R.pendingIsr = null;
    if (p) for (const fn of p) R.interrupt(fn);
  },
  noInterrupts(R) { R.interruptsOn = false; },
  tone(R, pin, freq, duration = 0) {
    R.us += 5;
    if (!R.checkPin(pin, "tone()")) return;
    if (R.avr && R.tonePin != null && R.tonePin !== pin) return; // one tone at a time on AVR
    if (R.toneTimer) { R.cancel(R.toneTimer); R.toneTimer = null; }
    if (R.tonePin !== pin || R.toneFreq !== freq) R.emit("tone", { pin, freq });
    R.tonePin = pin;
    R.toneFreq = freq;
    if (duration > 0) R.toneTimer = R.at(R.us + duration * 1000, () => functions.noTone(R, pin));
  },
  noTone(R, pin) {
    if (R.tonePin !== pin) { R.progress(); return; }
    if (R.toneTimer) { R.cancel(R.toneTimer); R.toneTimer = null; }
    R.tonePin = null;
    R.toneFreq = null;
    R.emit("noTone", { pin });
  },
  random(R, a, b) {
    if (b === undefined) {
      if (a === 0) return 0;
      return R.random() % a;
    }
    if (a >= b) return a;
    const diff = b - a;
    return (R.random() % diff) + a;
  },
  randomSeed(R, seed) { if (seed !== 0) R.rng = seed >>> 0; },
  map(R, x, inMin, inMax, outMin, outMax) {
    const d = (inMax - inMin) | 0;
    if (d === 0) throw new SimError("map() was asked to change a number from a range that starts and ends at the same value, which divides by zero.");
    return (Math.trunc(Math.imul((x - inMin) | 0, (outMax - outMin) | 0) / d) + outMin) | 0;
  },
  makeWord(R, h, l) { return l === undefined ? h & 0xffff : ((h & 255) << 8) | (l & 255); },

  // ESP32 LEDC (both the 2.x channel API and the 3.x pin API)
  ledcAttach(R, pin, freq, res) { (R.ledc ||= { pins: {}, ch: {} }).pins[pin] = { res }; return 1; },
  ledcAttachChannel(R, pin, freq, res, ch) { const L = (R.ledc ||= { pins: {}, ch: {} }); L.pins[pin] = { res }; L.ch[ch] = { res, pins: [pin] }; return 1; },
  ledcSetup(R, ch, freq, res) { const L = (R.ledc ||= { pins: {}, ch: {} }); L.ch[ch] = { res, pins: L.ch[ch]?.pins ?? [] }; return freq; },
  ledcAttachPin(R, pin, ch) { const L = (R.ledc ||= { pins: {}, ch: {} }); (L.ch[ch] ||= { res: 8, pins: [] }).pins.push(pin); },
  ledcDetach(R, pin) { if (R.ledc) delete R.ledc.pins[pin]; return 1; },
  ledcWrite(R, which, duty) {
    const L = R.ledc || { pins: {}, ch: {} };
    const emit = (pin, res) => {
      const v = Math.round((Math.min(duty, 2 ** res - 1) * 255) / (2 ** res - 1));
      const s = R.pinState(pin);
      s.out = true; s.mode = 1;
      if (s.pwm === v) return;
      s.pwm = v;
      R.emit("pwm", { pin, value: v });
    };
    if (L.ch[which] && !L.pins[which]) for (const p of L.ch[which].pins) emit(p, L.ch[which].res);
    else emit(which, L.pins[which]?.res ?? 8);
    return 1;
  },
  ledcWriteTone(R, pin, freq) {
    if (freq) functions.tone(R, pin, freq); else functions.noTone(R, pin);
    return freq;
  },
  touchRead() { return 60; },
  temperatureRead() { return 45; },

  // maths
  sqrt: (R, x) => Math.sqrt(x), pow: (R, x, y) => Math.pow(x, y),
  sin: (R, x) => Math.sin(x), cos: (R, x) => Math.cos(x), tan: (R, x) => Math.tan(x),
  asin: (R, x) => Math.asin(x), acos: (R, x) => Math.acos(x), atan: (R, x) => Math.atan(x),
  atan2: (R, y, x) => Math.atan2(y, x), exp: (R, x) => Math.exp(x), log: (R, x) => Math.log(x),
  log10: (R, x) => Math.log10(x), log2: (R, x) => Math.log2(x), fabs: (R, x) => Math.abs(x),
  floor: (R, x) => Math.floor(x), ceil: (R, x) => Math.ceil(x), trunc: (R, x) => Math.trunc(x),
  fmod: (R, x, y) => x % y, hypot: (R, x, y) => Math.hypot(x, y), cbrt: (R, x) => Math.cbrt(x),
  fmin: (R, x, y) => Math.min(x, y), fmax: (R, x, y) => Math.max(x, y),
  sqrtf: (R, x) => Math.sqrt(x), fabsf: (R, x) => Math.abs(x), powf: (R, x, y) => Math.pow(x, y),
  sinf: (R, x) => Math.sin(x), cosf: (R, x) => Math.cos(x),
  lround: (R, x) => Math.round(x), isnan: (R, x) => (x !== x ? 1 : 0), isinf: (R, x) => (Math.abs(x) === Infinity ? 1 : 0),

  // characters
  isAlphaNumeric: (R, c) => /[A-Za-z0-9]/.test(ch(c)) ? 1 : 0,
  isAlpha: (R, c) => /[A-Za-z]/.test(ch(c)) ? 1 : 0,
  isAscii: (R, c) => (c >= 0 && c < 128 ? 1 : 0),
  isWhitespace: (R, c) => (c === 32 || c === 9 ? 1 : 0),
  isControl: (R, c) => ((c >= 0 && c < 32) || c === 127 ? 1 : 0),
  isDigit: (R, c) => (c >= 48 && c <= 57 ? 1 : 0),
  isGraph: (R, c) => (c > 32 && c < 127 ? 1 : 0),
  isLowerCase: (R, c) => (c >= 97 && c <= 122 ? 1 : 0),
  isPrintable: (R, c) => (c >= 32 && c < 127 ? 1 : 0),
  isPunct: (R, c) => (c > 32 && c < 127 && !/[A-Za-z0-9]/.test(ch(c)) ? 1 : 0),
  isSpace: (R, c) => ((c >= 9 && c <= 13) || c === 32 ? 1 : 0),
  isUpperCase: (R, c) => (c >= 65 && c <= 90 ? 1 : 0),
  isHexadecimalDigit: (R, c) => /[0-9A-Fa-f]/.test(ch(c)) ? 1 : 0,
  toAscii: (R, c) => c & 127,
  toLowerCase: (R, c) => (c >= 65 && c <= 90 ? c + 32 : c),
  toUpperCase: (R, c) => (c >= 97 && c <= 122 ? c - 32 : c),
  isdigit: (R, c) => functions.isDigit(R, c), isalpha: (R, c) => functions.isAlpha(R, c),
  isalnum: (R, c) => functions.isAlphaNumeric(R, c), isspace: (R, c) => functions.isSpace(R, c),
  isupper: (R, c) => functions.isUpperCase(R, c), islower: (R, c) => functions.isLowerCase(R, c),
  isxdigit: (R, c) => functions.isHexadecimalDigit(R, c), ispunct: (R, c) => functions.isPunct(R, c),
  isprint: (R, c) => functions.isPrintable(R, c),
  toupper: (R, c) => functions.toUpperCase(R, c), tolower: (R, c) => functions.toLowerCase(R, c),

  // stdlib / string.h
  atoi: (R, s) => { const v = atol(cstr(s)); return R.avr ? (v << 16) >> 16 : v; },
  atol: (R, s) => atol(cstr(s)),
  atof: (R, s) => atof(cstr(s)),
  strtol: (R, s, end, base) => { const v = parseInt(cstr(s).trim(), base || 10); return Number.isNaN(v) ? 0 : v | 0; },
  strtoul: (R, s, end, base) => { const v = parseInt(cstr(s).trim(), base || 10); return Number.isNaN(v) ? 0 : v >>> 0; },
  strtod: (R, s) => atof(cstr(s)),
  itoa: (R, v, buf, radix) => writeCStr(buf, itoa(v, radix, R.T.intBits)),
  ltoa: (R, v, buf, radix) => writeCStr(buf, itoa(v, radix, 32)),
  utoa: (R, v, buf, radix) => writeCStr(buf, v.toString(radix)),
  ultoa: (R, v, buf, radix) => writeCStr(buf, v.toString(radix)),
  dtostrf: (R, v, width, prec, buf) => writeCStr(buf, dtostrf(v, width, prec)),
  strlen: (R, s) => cstr(s).length,
  strlen_P: (R, s) => cstr(s).length,
  strcmp: (R, a, b) => cmp(cstr(a), cstr(b)),
  strcmp_P: (R, a, b) => cmp(cstr(a), cstr(b)),
  strncmp: (R, a, b, n) => cmp(cstr(a).slice(0, n), cstr(b).slice(0, n)),
  strcasecmp: (R, a, b) => cmp(lower(cstr(a)), lower(cstr(b))),
  strcpy: (R, d, s) => writeCStr(d, cstr(s)),
  strcpy_P: (R, d, s) => writeCStr(d, cstr(s)),
  strncpy: (R, d, s, n) => {
    const src = cstr(s);
    for (let i = 0; i < n; i++) {
      if (d.i + i >= d.a.length) throw new SimError("strncpy() wrote past the end of the char array.");
      d.a[d.i + i] = i < src.length ? src.charCodeAt(i) : 0;
    }
    return d;
  },
  strcat: (R, d, s) => {
    const cur = cstr(d);
    writeCStr(new Ptr(d.a, d.i + cur.length), cstr(s));
    return d;
  },
  strncat: (R, d, s, n) => {
    const cur = cstr(d);
    writeCStr(new Ptr(d.a, d.i + cur.length), cstr(s).slice(0, n));
    return d;
  },
  strchr: (R, s, c) => { const i = cstr(s).indexOf(String.fromCharCode(c & 255)); return i < 0 ? null : new Ptr(s.a, s.i + i); },
  strrchr: (R, s, c) => { const i = cstr(s).lastIndexOf(String.fromCharCode(c & 255)); return i < 0 ? null : new Ptr(s.a, s.i + i); },
  strstr: (R, s, f) => { const i = cstr(s).indexOf(cstr(f)); return i < 0 ? null : new Ptr(s.a, s.i + i); },
  strtok(R, s, delim) {
    if (s) R.strtokAt = s;
    const p = R.strtokAt;
    if (!p) return null;
    const d = cstr(delim);
    let i = p.i;
    const a = p.a;
    while (a[i] && d.includes(String.fromCharCode(a[i] & 255))) i++;
    if (!a[i]) { R.strtokAt = null; return null; }
    const start = i;
    while (a[i] && !d.includes(String.fromCharCode(a[i] & 255))) i++;
    if (a[i]) { a[i] = 0; R.strtokAt = new Ptr(a, i + 1); } else R.strtokAt = null;
    return new Ptr(a, start);
  },
  memset(R, d, c, n) {
    const size = d.a.BYTES_PER_ELEMENT || 1;
    const count = Math.ceil(n / size);
    if (d.i + count > d.a.length) throw new SimError("memset() wrote past the end of the array.");
    let v = c & 255;
    if (size > 1) v = v === 255 ? -1 : v === 0 ? 0 : v * (size === 2 ? 0x0101 : 0x01010101);
    for (let i = 0; i < count; i++) d.a[d.i + i] = v;
    return d;
  },
  memcpy(R, d, s, n) {
    const size = d.a.BYTES_PER_ELEMENT || 1;
    const count = Math.ceil(n / size);
    if (d.i + count > d.a.length || s.i + count > s.a.length) throw new SimError("memcpy() went past the end of an array.");
    for (let i = 0; i < count; i++) d.a[d.i + i] = s.a[s.i + i];
    return d;
  },
  memcpy_P(R, d, s, n) { return functions.memcpy(R, d, s, n); },
  memcmp(R, a, b, n) {
    for (let i = 0; i < n; i++) { const x = a.a[a.i + i] & 255, y = b.a[b.i + i] & 255; if (x !== y) return x - y; }
    return 0;
  },
  sprintf(R, buf, fmt, args) {
    const s = format(cstr(fmt), args, { avr: R.avr });
    writeCStr(buf, s);
    return s.length;
  },
  snprintf(R, buf, n, fmt, args) {
    const s = format(cstr(fmt), args, { avr: R.avr });
    if (n > 0) writeCStr(buf, s.slice(0, n - 1));
    return s.length;
  },
  pgm_read_byte: (R, p) => p.a[p.i] & 255,
  pgm_read_byte_near: (R, p) => p.a[p.i] & 255,
  pgm_read_word: (R, p) => p.a[p.i] & 0xffff,
  pgm_read_word_near: (R, p) => p.a[p.i] & 0xffff,
  pgm_read_dword: (R, p) => p.a[p.i] >>> 0,
  pgm_read_float: (R, p) => p.a[p.i],
  exit(R) { R.stop("exit"); throw new SimError("The sketch called exit(), so it stopped.", "exit"); },
  abort(R) { R.stop("exit"); throw new SimError("The sketch called abort(), so it stopped.", "exit"); },
};

const ch = (c) => String.fromCharCode(c & 255);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ------------------------------------------------------------ Serial

/** HardwareSerial: text out (with the baud rate's timing) and in. */
export class HardwareSerial {
  constructor(R, port = 0) {
    this.R = R;
    this.port = port;
    this.baud = 0;
    this.rx = "";
    this.timeout = 1000;
    this.txFree = 0;
    this.decoder = new TextDecoder();
    this.out = "";
    if (port === 0) R.serial = this;
  }

  begin(baud) { this.baud = baud; this.R.progress(); }
  end() { this.baud = 0; }
  setDebugOutput() {}
  available() { this.R.progress(); return this.rx.length; }
  availableForWrite() { return 63; }
  peek() { this.R.progress(); return this.rx.length ? this.rx.charCodeAt(0) : -1; }
  read() {
    this.R.progress();
    if (!this.rx.length) return -1;
    const c = this.rx.charCodeAt(0);
    this.rx = this.rx.slice(1);
    return c;
  }
  flush() {
    const R = this.R;
    if (this.txFree > R.us) R.us = this.txFree;
  }
  setTimeout(ms) { this.timeout = ms; }
  getTimeout() { return this.timeout; }
  write(x, n) {
    let s;
    if (typeof x === "number") s = String.fromCharCode(x & 255);
    else if (n !== undefined) { s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(x.a[x.i + i] & 255); }
    else s = cstr(x);
    this.printStr(s);
    return s.length;
  }

  /** Sends a byte string (Print). Takes as long as the baud rate needs once the buffer fills. */
  printStr(s) {
    const R = this.R;
    if (!s.length) return;
    if (!this.baud) {
      R.warn("serial-no-begin", this.port, { line: R.ln, message: "Your code printed to the Serial Monitor before Serial.begin(), so nothing appears. Add Serial.begin(9600); to setup()." });
      return;
    }
    const byteUs = 10e6 / this.baud;
    this.txFree = Math.max(this.txFree, R.us) + s.length * byteUs;
    const buffer = 64 * byteUs;
    if (this.txFree - R.us > buffer) R.us = this.txFree - buffer;
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    const text = this.decoder.decode(bytes, { stream: true });
    if (!text) return;
    if (this.port === 0) R.serialText = (R.serialText ?? "") + text;
    R.emit("serial", this.port ? { text, port: this.port } : { text });
  }

  /** Text typed into the Serial Monitor. */
  input(bytes) {
    const max = this.R.avr ? 64 : 256;
    this.rx = (this.rx + bytes).slice(0, Math.max(max, this.rx.length));
  }

  *timedRead() {
    if (!this.rx.length) {
      yield* waitFor(this.R, this.timeout * 1000, () => this.rx.length > 0);
    }
    return this.read();
  }
  *timedPeek() {
    if (!this.rx.length) yield* waitFor(this.R, this.timeout * 1000, () => this.rx.length > 0);
    return this.peek();
  }
  *readString() {
    let s = "";
    for (;;) {
      const c = yield* this.timedRead();
      if (c < 0) return s;
      s += String.fromCharCode(c);
    }
  }
  *readStringUntil(t) {
    let s = "";
    for (;;) {
      const c = yield* this.timedRead();
      if (c < 0 || c === (t & 255)) return s;
      s += String.fromCharCode(c);
    }
  }
  *readBytes(buf, len) {
    let n = 0;
    while (n < len) {
      const c = yield* this.timedRead();
      if (c < 0) break;
      buf.a[buf.i + n++] = c;
    }
    return n;
  }
  *readBytesUntil(t, buf, len) {
    let n = 0;
    while (n < len) {
      const c = yield* this.timedRead();
      if (c < 0 || c === (t & 255)) break;
      buf.a[buf.i + n++] = c;
    }
    return n;
  }
  *find(target) {
    const t = cstr(target);
    let got = "";
    for (;;) {
      const c = yield* this.timedRead();
      if (c < 0) return 0;
      got += String.fromCharCode(c);
      if (got.endsWith(t)) return 1;
    }
  }
  *findUntil(target, term) {
    const t = cstr(target), e = cstr(term);
    let got = "";
    for (;;) {
      const c = yield* this.timedRead();
      if (c < 0) return 0;
      got += String.fromCharCode(c);
      if (got.endsWith(t)) return 1;
      if (e && got.endsWith(e)) return 0;
    }
  }
  /** Skips to the next digit or '-', like Stream::peekNextDigit. */
  *peekNext(float) {
    for (;;) {
      const c = yield* this.timedPeek();
      if (c < 0) return -1;
      if ((c >= 48 && c <= 57) || c === 45 || (float && c === 46)) return c;
      this.read();
    }
  }
  *parseInt() {
    let c = yield* this.peekNext(false);
    if (c < 0) return 0;
    let neg = false, v = 0;
    for (;;) {
      if (c === 45) neg = true;
      else if (c >= 48 && c <= 57) v = v * 10 + c - 48;
      else break;
      this.read();
      c = yield* this.timedPeek();
      if (c < 0) break;
    }
    return neg ? -v : v;
  }
  *parseFloat() {
    let c = yield* this.peekNext(true);
    if (c < 0) return 0;
    let s = "";
    while (c >= 0 && ((c >= 48 && c <= 57) || c === 45 || c === 46)) {
      s += String.fromCharCode(c);
      this.read();
      c = yield* this.timedPeek();
    }
    return Math.fround(parseFloat(s) || 0);
  }
  toBool() { return 1; }
}

/** The ESP object: ESP.restart(), ESP.getFreeHeap()... */
export class EspClass {
  constructor(R) { this.R = R; }
  restart() { this.R.stop("restart"); throw new SimError("The sketch restarted the board (ESP.restart()). Press Run to start again.", "exit"); }
  deepSleep() { this.R.stop("sleep"); throw new SimError("The board went into deep sleep (ESP.deepSleep()). Press Run to start again.", "exit"); }
  getFreeHeap() { return this.R.family === "esp32" ? 250000 : 45000; }
  getChipId() { return 0x00c0ffee; }
  getCpuFreqMHz() { return this.R.family === "esp32" ? 240 : 80; }
  getEfuseMac() { return 0x24a160c0ffee; }
  getChipModel() { return this.R.board.id === "esp32-c3" ? "ESP32-C3" : "ESP32-D0WD-V3"; }
  getFlashChipSize() { return 4194304; }
  getSdkVersion() { return "v5.1"; }
  getCycleCount() { return Math.floor(this.R.us * 240) >>> 0; }
}

export const objects = {
  Serial: (R) => new HardwareSerial(R, 0),
  Serial1: (R) => new HardwareSerial(R, 1),
  Serial2: (R) => new HardwareSerial(R, 2),
  ESP: (R) => new EspClass(R),
};

export const classes = { HardwareSerial, EspClass };

export { toText, upper };
