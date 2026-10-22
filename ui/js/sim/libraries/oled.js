// Adafruit_GFX + Adafruit_SSD1306: a 1-bit-per-pixel buffer (the SSD1306's
// own layout: byte = x + (y / 8) * width, bit = y % 8). display() emits
// oled {addr, width, height, buffer} and display_text {text}.

import { glyph } from "./font5x7.js";
import { cstr, toText } from "../values.js";

const GFX = `
#include <Wire.h>
#include <SPI.h>
class Adafruit_GFX : public Print {
public:
  void drawPixel(int16_t x, int16_t y, uint16_t color);
  void drawFastHLine(int16_t x, int16_t y, int16_t w, uint16_t color);
  void drawFastVLine(int16_t x, int16_t y, int16_t h, uint16_t color);
  void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  void drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  void fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color);
  void fillScreen(uint16_t color);
  void drawCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void fillCircle(int16_t x0, int16_t y0, int16_t r, uint16_t color);
  void drawRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  void fillRoundRect(int16_t x, int16_t y, int16_t w, int16_t h, int16_t r, uint16_t color);
  void drawTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  void fillTriangle(int16_t x0, int16_t y0, int16_t x1, int16_t y1, int16_t x2, int16_t y2, uint16_t color);
  void drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color);
  void drawBitmap(int16_t x, int16_t y, const uint8_t bitmap[], int16_t w, int16_t h, uint16_t color, uint16_t bg);
  void drawChar(int16_t x, int16_t y, unsigned char c, uint16_t color, uint16_t bg, uint8_t size);
  void setCursor(int16_t x, int16_t y);
  int16_t getCursorX();
  int16_t getCursorY();
  void setTextSize(uint8_t s);
  void setTextSize(uint8_t sx, uint8_t sy);
  void setTextColor(uint16_t c);
  void setTextColor(uint16_t c, uint16_t bg);
  void setTextWrap(bool w);
  void setRotation(uint8_t r);
  uint8_t getRotation();
  void cp437(bool x = true);
  void setFont(const void* f = NULL);
  int16_t width();
  int16_t height();
  void getTextBounds(String str, int16_t x, int16_t y, int16_t* x1, int16_t* y1, uint16_t* w, uint16_t* h);
  void invertDisplay(bool i);
  size_t write(uint8_t c);
};
`;

const SSD1306 = `
#include <Adafruit_GFX.h>
#define SSD1306_BLACK 0
#define SSD1306_WHITE 1
#define SSD1306_INVERSE 2
#define BLACK SSD1306_BLACK
#define WHITE SSD1306_WHITE
#define INVERSE SSD1306_INVERSE
#define SSD1306_SWITCHCAPVCC 0x02
#define SSD1306_EXTERNALVCC 0x01
#define SSD1306_LCDWIDTH 128
#define SSD1306_LCDHEIGHT 64
class Adafruit_SSD1306 : public Adafruit_GFX {
public:
  Adafruit_SSD1306(uint8_t w, uint8_t h, TwoWire* twi = &Wire, int8_t rst_pin = -1, uint32_t clkDuring = 400000UL, uint32_t clkAfter = 100000UL);
  Adafruit_SSD1306(int8_t rst_pin = -1);
  bool begin(uint8_t switchvcc = SSD1306_SWITCHCAPVCC, uint8_t i2caddr = 0, bool reset = true, bool periphBegin = true);
  void display();
  void clearDisplay();
  void dim(bool dim);
  bool getPixel(int16_t x, int16_t y);
  uint8_t* getBuffer();
  void startscrollright(uint8_t start, uint8_t stop);
  void startscrollleft(uint8_t start, uint8_t stop);
  void startscrolldiagright(uint8_t start, uint8_t stop);
  void startscrolldiagleft(uint8_t start, uint8_t stop);
  void stopscroll();
  void ssd1306_command(uint8_t c);
};
`;

/** Adafruit_GFX drawing on top of a pixel(x, y, color) function. */
export class GfxBase {
  constructor(R, w, h) {
    this.R = R;
    this.W = w;
    this.H = h;
    this.rot = 0;
    this.cx = 0;
    this.cy = 0;
    this.sx = 1;
    this.sy = 1;
    this.fg = 1;
    this.bg = 1;
    this.wrap = true;
    this.textLog = "";
  }
  width() { return this.rot & 1 ? this.H : this.W; }
  height() { return this.rot & 1 ? this.W : this.H; }
  setRotation(r) { this.rot = r & 3; }
  getRotation() { return this.rot; }
  drawPixel(x, y, c) {
    let tx = x, ty = y;
    switch (this.rot) {
      case 1: tx = this.W - 1 - y; ty = x; break;
      case 2: tx = this.W - 1 - x; ty = this.H - 1 - y; break;
      case 3: tx = y; ty = this.H - 1 - x; break;
    }
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return;
    this.pixel(tx, ty, c);
  }
  drawFastHLine(x, y, w, c) { for (let i = 0; i < w; i++) this.drawPixel(x + i, y, c); }
  drawFastVLine(x, y, h, c) { for (let i = 0; i < h; i++) this.drawPixel(x, y + i, c); }
  fillRect(x, y, w, h, c) { for (let i = 0; i < w; i++) this.drawFastVLine(x + i, y, h, c); }
  fillScreen(c) { this.fillRect(0, 0, this.width(), this.height(), c); }
  drawRect(x, y, w, h, c) {
    this.drawFastHLine(x, y, w, c); this.drawFastHLine(x, y + h - 1, w, c);
    this.drawFastVLine(x, y, h, c); this.drawFastVLine(x + w - 1, y, h, c);
  }
  drawLine(x0, y0, x1, y1, c) {
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1]; }
    if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const dx = x1 - x0, dy = Math.abs(y1 - y0);
    let err = dx >> 1;
    const ystep = y0 < y1 ? 1 : -1;
    for (; x0 <= x1; x0++) {
      if (steep) this.drawPixel(y0, x0, c); else this.drawPixel(x0, y0, c);
      err -= dy;
      if (err < 0) { y0 += ystep; err += dx; }
    }
  }
  drawCircle(x0, y0, r, c) {
    let f = 1 - r, ddx = 1, ddy = -2 * r, x = 0, y = r;
    this.drawPixel(x0, y0 + r, c); this.drawPixel(x0, y0 - r, c);
    this.drawPixel(x0 + r, y0, c); this.drawPixel(x0 - r, y0, c);
    while (x < y) {
      if (f >= 0) { y--; ddy += 2; f += ddy; }
      x++; ddx += 2; f += ddx;
      for (const [a, b] of [[x, y], [y, x]]) {
        this.drawPixel(x0 + a, y0 + b, c); this.drawPixel(x0 - a, y0 + b, c);
        this.drawPixel(x0 + a, y0 - b, c); this.drawPixel(x0 - a, y0 - b, c);
      }
    }
  }
  fillCircle(x0, y0, r, c) {
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y));
      this.drawFastHLine(x0 - w, y0 + y, 2 * w + 1, c);
    }
  }
  drawRoundRect(x, y, w, h, r, c) { this.drawRect(x, y, w, h, c); void r; }
  fillRoundRect(x, y, w, h, r, c) { this.fillRect(x, y, w, h, c); void r; }
  drawTriangle(x0, y0, x1, y1, x2, y2, c) {
    this.drawLine(x0, y0, x1, y1, c); this.drawLine(x1, y1, x2, y2, c); this.drawLine(x2, y2, x0, y0, c);
  }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
    const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (const [ax, ay, bx, by] of edges) {
        if ((y >= ay && y <= by) || (y >= by && y <= ay)) xs.push(ay === by ? ax : ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      if (xs.length) {
        const a = Math.round(Math.min(...xs)), b = Math.round(Math.max(...xs));
        this.drawFastHLine(a, y, b - a + 1, c);
      }
    }
  }
  drawBitmap(x, y, bm, w, h, c, bg) {
    const bw = (w + 7) >> 3;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const byte = bm.a[bm.i + j * bw + (i >> 3)] & 255;
        if (byte & (0x80 >> (i & 7))) this.drawPixel(x + i, y + j, c);
        else if (bg !== undefined) this.drawPixel(x + i, y + j, bg);
      }
    }
  }
  drawChar(x, y, ch, color, bg, sx, sy = sx) {
    const g = glyph(ch & 255);
    for (let i = 0; i < 5; i++) {
      let line = g[i];
      for (let j = 0; j < 8; j++, line >>= 1) {
        if (line & 1) {
          if (sx === 1 && sy === 1) this.drawPixel(x + i, y + j, color);
          else this.fillRect(x + i * sx, y + j * sy, sx, sy, color);
        } else if (bg !== color) {
          if (sx === 1 && sy === 1) this.drawPixel(x + i, y + j, bg);
          else this.fillRect(x + i * sx, y + j * sy, sx, sy, bg);
        }
      }
    }
    if (bg !== color) this.fillRect(x + 5 * sx, y, sx, 8 * sy, bg);
  }
  setCursor(x, y) {
    this.cx = x;
    this.cy = y;
    if (this.textLog && !this.textLog.endsWith("\n")) this.textLog += "\n";
  }
  getCursorX() { return this.cx; }
  getCursorY() { return this.cy; }
  setTextSize(sx, sy = sx) { this.sx = Math.max(1, sx); this.sy = Math.max(1, sy); }
  setTextColor(c, bg = c) { this.fg = c; this.bg = bg; }
  setTextWrap(w) { this.wrap = !!w; }
  cp437() {}
  setFont() {}
  write(c) {
    c &= 255;
    if (c === 10) { this.cx = 0; this.cy += this.sy * 8; }
    else if (c !== 13) {
      if (this.wrap && this.cx + this.sx * 6 > this.width()) { this.cx = 0; this.cy += this.sy * 8; }
      this.drawChar(this.cx, this.cy, c, this.fg, this.bg, this.sx, this.sy);
      this.cx += this.sx * 6;
    }
    return 1;
  }
  printStr(s) {
    for (let i = 0; i < s.length; i++) this.write(s.charCodeAt(i));
    this.textLog = (this.textLog + s.replace(/\r/g, "")).slice(-1000);
    this.R.us += 20 * s.length;
  }
  getTextBounds(str, x, y, x1, y1, w, h) {
    const s = typeof str === "string" ? str : cstr(str);
    const lines = s.split("\n");
    const width = Math.max(...lines.map((l) => l.length)) * 6 * this.sx;
    x1.a[x1.i] = x; y1.a[y1.i] = y;
    w.a[w.i] = width; h.a[h.i] = lines.length * 8 * this.sy;
  }
}

export class Adafruit_SSD1306 extends GfxBase {
  constructor(R, a, b) {
    const w = b !== undefined ? a : 128;
    const h = b !== undefined ? b : 64;
    super(R, w, h);
    this.buf = new Uint8Array((w * h) / 8);
    this.addr = h === 32 ? 0x3c : 0x3d;
    this.inverted = false;
    this.lastShown = "";
    this.lastText = null;
    this.begun = false;
  }
  begin(vcc, addr = 0) {
    if (addr) this.addr = addr;
    (this.R.i2cDevices ||= []).push(this.addr);
    this.begun = true;
    this.R.us += 20000;
    return 1;
  }
  pixel(x, y, c) {
    const i = x + (y >> 3) * this.W, bit = 1 << (y & 7);
    if (c === 1) this.buf[i] |= bit;
    else if (c === 0) this.buf[i] &= ~bit;
    else if (c === 2) this.buf[i] ^= bit;
  }
  getPixel(x, y) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return 0;
    return this.buf[x + (y >> 3) * this.W] & (1 << (y & 7)) ? 1 : 0;
  }
  clearDisplay() { this.buf.fill(0); this.textLog = ""; }
  invertDisplay(i) { this.inverted = !!i; this.lastShown = ""; }
  dim() {}
  startscrollright() {}
  startscrollleft() {}
  startscrolldiagright() {}
  startscrolldiagleft() {}
  stopscroll() {}
  ssd1306_command() {}
  getBuffer() { return null; }
  display() {
    const R = this.R;
    R.us += this.W * this.H / 8 * 25; // about 25 µs a byte over I2C at 400 kHz
    if (!this.begun) {
      R.warn("oled-begin", this.addr, { line: R.ln, message: "The OLED needs display.begin(SSD1306_SWITCHCAPVCC, 0x3C) in setup() before it shows anything." });
      return;
    }
    let key = "";
    for (let i = 0; i < this.buf.length; i += 4) key += String.fromCharCode(this.buf[i] | (this.buf[i + 1] << 8), this.buf[i + 2] | (this.buf[i + 3] << 8));
    key += this.inverted ? "i" : "";
    if (key !== this.lastShown) {
      this.lastShown = key;
      R.emit("oled", { addr: this.addr, width: this.W, height: this.H, buffer: this.buf.slice(), inverted: this.inverted });
    } else R.progress();
    const text = toText(this.textLog).trim();
    if (text !== this.lastText) {
      this.lastText = text;
      if (text) R.emit("display_text", { text, display: "oled" });
    }
  }
}

export default {
  headers: { "Adafruit_GFX.h": GFX, "Adafruit_SSD1306.h": SSD1306 },
  classes: { Adafruit_SSD1306, Adafruit_GFX: GfxBase },
};
