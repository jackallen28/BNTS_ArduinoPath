// Adafruit_NeoPixel: show() emits neopixel {pin, pixels: [[r,g,b]...]}
// with the brightness applied the way the library does it.

const HEADER = `
#define NEO_RGB 0x06
#define NEO_RBG 0x09
#define NEO_GRB 0x52
#define NEO_GBR 0xA1
#define NEO_BRG 0x58
#define NEO_BGR 0xA4
#define NEO_RGBW 0x1B
#define NEO_GRBW 0xD2
#define NEO_KHZ800 0x0000
#define NEO_KHZ400 0x0100
typedef uint16_t neoPixelType;
class Adafruit_NeoPixel {
public:
  Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800);
  Adafruit_NeoPixel();
  void begin();
  void show();
  void setPin(int16_t p);
  void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b);
  void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b, uint8_t w);
  void setPixelColor(uint16_t n, uint32_t c);
  void fill(uint32_t c = 0, uint16_t first = 0, uint16_t count = 0);
  void setBrightness(uint8_t b);
  void clear();
  void updateLength(uint16_t n);
  void updateType(neoPixelType t);
  uint8_t getBrightness();
  int16_t getPin();
  uint16_t numPixels();
  uint32_t getPixelColor(uint16_t n);
  bool canShow();
  void rainbow(uint16_t first_hue = 0, int8_t reps = 1, uint8_t saturation = 255, uint8_t brightness = 255, bool gammify = true);
  static uint8_t sine8(uint8_t x);
  static uint8_t gamma8(uint8_t x);
  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b);
  static uint32_t Color(uint8_t r, uint8_t g, uint8_t b, uint8_t w);
  static uint32_t ColorHSV(uint16_t hue, uint8_t sat = 255, uint8_t val = 255);
  static uint32_t gamma32(uint32_t x);
};
`;

const GAMMA = Array.from({ length: 256 }, (_, i) => Math.floor(Math.pow(i / 255, 2.6) * 255 + 0.5));
const SINE = Array.from({ length: 256 }, (_, i) => Math.floor((Math.sin((i / 128) * Math.PI) + 1) * 127.5 + 0.5) & 255);

export class Adafruit_NeoPixel {
  constructor(R, n = 0, pin = 6, type = 0x52) {
    this.R = R;
    this.pin = pin;
    this.type = type;
    this.brightness = 0; // stored + 1, like the library (0 = full)
    this.updateLength(n);
    this.lastShown = "";
  }
  updateLength(n) { this.n = n; this.px = Array.from({ length: n }, () => [0, 0, 0, 0]); }
  updateType(t) { this.type = t; }
  begin() { this.R.checkPin(this.pin, "begin()"); }
  setPin(p) { this.pin = p; }
  getPin() { return this.pin; }
  numPixels() { return this.n; }
  canShow() { return 1; }
  setPixelColor(i, r, g, b, w = 0) {
    if (i >= this.n) return;
    if (g === undefined) { const c = r >>> 0; w = (c >>> 24) & 255; r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255; }
    if (this.brightness) {
      r = (r * this.brightness) >> 8; g = (g * this.brightness) >> 8;
      b = (b * this.brightness) >> 8; w = (w * this.brightness) >> 8;
    }
    this.px[i] = [r & 255, g & 255, b & 255, w & 255];
  }
  getPixelColor(i) {
    if (i >= this.n) return 0;
    let [r, g, b, w] = this.px[i];
    if (this.brightness) {
      r = Math.floor((r << 8) / this.brightness); g = Math.floor((g << 8) / this.brightness);
      b = Math.floor((b << 8) / this.brightness); w = Math.floor((w << 8) / this.brightness);
    }
    return (((w & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0;
  }
  fill(c = 0, first = 0, count = 0) {
    if (first >= this.n) return;
    const end = count === 0 ? this.n : Math.min(this.n, first + count);
    for (let i = first; i < end; i++) this.setPixelColor(i, c);
  }
  clear() { for (const p of this.px) p.fill(0); }
  setBrightness(b) {
    const nb = (b + 1) & 255;
    if (nb === this.brightness) return;
    const old = (this.brightness - 1) & 255;
    let scale;
    if (old === 0) scale = 0;
    else if (b === 255) scale = Math.floor(65535 / old);
    else scale = Math.floor(((nb << 8) - 1) / old);
    for (const p of this.px) for (let k = 0; k < 4; k++) p[k] = (p[k] * scale) >> 8 & 255;
    this.brightness = nb;
  }
  getBrightness() { return (this.brightness - 1) & 255; }
  rainbow(first = 0, reps = 1, sat = 255, bri = 255, gammify = 1) {
    for (let i = 0; i < this.n; i++) {
      const hue = (first + Math.floor((i * reps * 65536) / this.n)) & 0xffff;
      let c = Adafruit_NeoPixel.ColorHSV(hue, sat, bri);
      if (gammify) c = Adafruit_NeoPixel.gamma32(c);
      this.setPixelColor(i, c);
    }
  }
  show() {
    const R = this.R;
    R.us += 30 * this.n + 50;
    const pixels = this.px.map((p) => [p[0], p[1], p[2]]);
    const key = pixels.join(";");
    if (key === this.lastShown) { R.progress(); return; }
    this.lastShown = key;
    R.emit("neopixel", { pin: this.pin, pixels });
  }
  static Color(r, g, b, w = 0) { return (((w & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)) >>> 0; }
  static sine8(x) { return SINE[x & 255]; }
  static gamma8(x) { return GAMMA[x & 255]; }
  static gamma32(x) {
    const b = [(x >>> 24) & 255, (x >> 16) & 255, (x >> 8) & 255, x & 255].map((v) => GAMMA[v]);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }
  static ColorHSV(hue, sat = 255, val = 255) {
    let r, g, b;
    hue = Math.floor((hue * 1530 + 32768) / 65536);
    if (hue < 510) { b = 0; if (hue < 255) { r = 255; g = hue; } else { r = 510 - hue; g = 255; } }
    else if (hue < 1020) { r = 0; if (hue < 765) { g = 255; b = hue - 510; } else { g = 1020 - hue; b = 255; } }
    else if (hue < 1530) { g = 0; if (hue < 1275) { r = hue - 1020; b = 255; } else { r = 255; b = 1530 - hue; } }
    else { r = 255; g = b = 0; }
    const v1 = 1 + val, s1 = 1 + sat, s2 = 255 - sat;
    return ((((((r * s1) >> 8) + s2) * v1) & 0xff00) << 8 | (((((g * s1) >> 8) + s2) * v1) & 0xff00) | (((((b * s1) >> 8) + s2) * v1) >> 8)) >>> 0;
  }
}

export default {
  headers: { "Adafruit_NeoPixel.h": HEADER },
  classes: { Adafruit_NeoPixel },
};
