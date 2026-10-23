// TM1637Display (4-digit 7-segment): emits tm1637 {clk, dio, segments, brightness, on}
// and display_text with the digits it shows.

const HEADER = `
#define SEG_A 0b00000001
#define SEG_B 0b00000010
#define SEG_C 0b00000100
#define SEG_D 0b00001000
#define SEG_E 0b00010000
#define SEG_F 0b00100000
#define SEG_G 0b01000000
#define SEG_DP 0b10000000
#define DEFAULT_BIT_DELAY 100
class TM1637Display {
public:
  TM1637Display(uint8_t pinClk, uint8_t pinDIO, unsigned int bitDelay = DEFAULT_BIT_DELAY);
  void setBrightness(uint8_t brightness, bool on = true);
  void setSegments(const uint8_t segments[], uint8_t length = 4, uint8_t pos = 0);
  void clear();
  void showNumberDec(int num, bool leading_zero = false, uint8_t length = 4, uint8_t pos = 0);
  void showNumberDecEx(int num, uint8_t dots = 0, bool leading_zero = false, uint8_t length = 4, uint8_t pos = 0);
  void showNumberHexEx(uint16_t num, uint8_t dots = 0, bool leading_zero = false, uint8_t length = 4, uint8_t pos = 0);
  uint8_t encodeDigit(uint8_t digit);
};
`;

const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
const MINUS = 0x40;
const LETTERS = { 0x00: " ", 0x40: "-", 0x08: "_", 0x76: "H", 0x38: "L", 0x73: "P", 0x3e: "U", 0x1c: "u", 0x5c: "o", 0x54: "n", 0x50: "r", 0x78: "t", 0x6e: "y", 0x63: "°", 0x37: "N", 0x3d: "G", 0x30: "I", 0x1e: "J", 0x74: "h", 0x58: "c" };
const DECODE = new Map(DIGITS.map((s, i) => [s, i.toString(16).toUpperCase().replace("B", "b").replace("D", "d")]));
for (const [k, v] of Object.entries(LETTERS)) if (!DECODE.has(Number(k))) DECODE.set(Number(k), v);

/** The text a set of segments shows, as near as letters allow. */
export function segmentsText(segs) {
  return segs.map((s) => (DECODE.get(s & 0x7f) ?? "?") + (s & 0x80 ? ":" : "")).join("");
}

export class TM1637Display {
  constructor(R, clk, dio) {
    this.R = R;
    this.clk = clk;
    this.dio = dio;
    this.segs = [0, 0, 0, 0];
    this.brightness = 7;
    this.pendingBrightness = 7;
    this.on = true;
    this.last = null;
    this.lastText = null;
  }
  setBrightness(b, on = 1) { this.pendingBrightness = b & 7; this.pendingOn = !!on; }
  encodeDigit(d) { return DIGITS[d & 15]; }
  clear() { this.setSegments([0, 0, 0, 0]); }
  setSegments(segs, length = 4, pos = 0) {
    const arr = Array.isArray(segs) ? segs : Array.from({ length }, (_, i) => segs.a[segs.i + i] & 255);
    for (let i = 0; i < length && pos + i < 4; i++) this.segs[pos + i] = arr[i] & 255;
    this.brightness = this.pendingBrightness;
    if (this.pendingOn !== undefined) this.on = this.pendingOn;
    this.show();
  }
  showNumberDec(num, lz = 0, length = 4, pos = 0) { this.showNumberDecEx(num, 0, lz, length, pos); }
  showNumberDecEx(num, dots = 0, lz = 0, length = 4, pos = 0) {
    this.showNumberBaseEx(num < 0 ? -10 : 10, num < 0 ? -num : num, dots, lz, length, pos);
  }
  showNumberHexEx(num, dots = 0, lz = 0, length = 4, pos = 0) { this.showNumberBaseEx(16, num & 0xffff, dots, lz, length, pos); }
  showNumberBaseEx(base, num, dots, lz, length, pos) {
    let neg = false;
    if (base < 0) { base = -base; neg = true; }
    num &= 0xffff;
    const digits = new Array(length).fill(0);
    if (num === 0 && !lz) {
      digits[length - 1] = DIGITS[0];
    } else {
      for (let i = length - 1; i >= 0; i--) {
        const d = num % base;
        if (d === 0 && num === 0 && !lz) digits[i] = 0;
        else digits[i] = DIGITS[d];
        if (d === 0 && num === 0 && neg) { digits[i] = MINUS; neg = false; }
        num = Math.floor(num / base);
      }
    }
    if (dots) for (let i = 0; i < 4 && i < length; i++) { digits[i] |= dots & 0x80; dots = (dots << 1) & 255; }
    this.setSegments(digits, length, pos);
  }
  show() {
    const R = this.R;
    R.us += 400;
    const key = this.segs.join(",") + "/" + this.brightness + this.on;
    if (key === this.last) { R.progress(); return; }
    this.last = key;
    R.emit("tm1637", { clk: this.clk, dio: this.dio, segments: this.segs.slice(), brightness: this.brightness, on: this.on });
    const text = segmentsText(this.segs).trim();
    if (text !== this.lastText) {
      this.lastText = text;
      R.emit("display_text", { text, display: "tm1637" });
    }
  }
}

export default {
  headers: { "TM1637Display.h": HEADER },
  classes: { TM1637Display },
};
