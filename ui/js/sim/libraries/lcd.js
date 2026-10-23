// LiquidCrystal_I2C (16×2 or 20×4): emits lcd {addr, lines, backlight}
// and display_text {text} whenever what's on the screen changes.

const HEADER = `
#include <Wire.h>
#define LCD_5x8DOTS 0x00
#define LCD_5x10DOTS 0x04
class LiquidCrystal_I2C : public Print {
public:
  LiquidCrystal_I2C(uint8_t lcd_Addr, uint8_t lcd_cols, uint8_t lcd_rows);
  void begin(uint8_t cols, uint8_t rows, uint8_t charsize = LCD_5x8DOTS);
  void begin();
  void init();
  void clear();
  void home();
  void noDisplay();
  void display();
  void noBlink();
  void blink();
  void noCursor();
  void cursor();
  void scrollDisplayLeft();
  void scrollDisplayRight();
  void leftToRight();
  void rightToLeft();
  void autoscroll();
  void noAutoscroll();
  void createChar(uint8_t location, uint8_t charmap[]);
  void setCursor(uint8_t col, uint8_t row);
  size_t write(uint8_t c);
  void backlight();
  void noBacklight();
  void setBacklight(uint8_t value);
};
`;

export class LiquidCrystal_I2C {
  constructor(R, addr = 0x27, cols = 16, rows = 2) {
    this.R = R;
    this.addr = addr;
    this.cols = cols;
    this.rows = rows;
    this.ram = Array.from({ length: Math.max(rows, 1) }, () => new Array(40).fill(32));
    this.col = 0;
    this.row = 0;
    this.shift = 0;
    this.light = false;
    this.on = true;
    this.custom = {};
    this.last = null;
    this.lastText = null;
    this.started = false;
  }
  init() { this.begin(); }
  begin() {
    (this.R.i2cDevices ||= []).push(this.addr);
    this.started = true;
    this.R.us += 50000;
    this.clear();
  }
  clear() {
    for (const r of this.ram) r.fill(32);
    this.col = this.row = this.shift = 0;
    this.R.us += 2000;
    this.show();
  }
  home() { this.col = this.row = this.shift = 0; this.R.us += 2000; }
  display() { this.on = true; this.show(); }
  noDisplay() { this.on = false; this.show(); }
  blink() {}
  noBlink() {}
  cursor() {}
  noCursor() {}
  leftToRight() {}
  rightToLeft() {}
  autoscroll() {}
  noAutoscroll() {}
  scrollDisplayLeft() { this.shift = (this.shift + 1) % 40; this.show(); }
  scrollDisplayRight() { this.shift = (this.shift + 39) % 40; this.show(); }
  backlight() { this.light = true; this.show(); }
  noBacklight() { this.light = false; this.show(); }
  setBacklight(v) { this.light = !!v; this.show(); }
  createChar(n, map) {
    this.custom[n & 7] = Array.from({ length: 8 }, (_, i) => map.a[map.i + i] & 31);
  }
  setCursor(c, r) {
    this.col = c;
    this.row = Math.min(r, this.rows - 1);
  }
  write(c) {
    this.put(c);
    this.show();
    return 1;
  }
  put(c) {
    const row = this.ram[this.row];
    if (row && this.col < 40) row[this.col] = c & 255;
    this.col++;
    this.R.us += 50;
  }
  printStr(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 13 || c === 10) continue; // the LCD shows these as odd symbols; println's are skipped
      this.put(c);
    }
    this.show();
  }
  lines() {
    return this.ram.map((r) => {
      let s = "";
      for (let k = 0; k < this.cols; k++) s += String.fromCharCode(r[(k + this.shift) % 40]);
      return s;
    });
  }
  show() {
    const R = this.R;
    if (!this.started) {
      R.warn("lcd-init", this.addr, { line: R.ln, message: "The LCD needs lcd.init(); (or lcd.begin();) in setup() before it shows anything." });
      return;
    }
    const lines = this.on ? this.lines() : this.ram.map(() => " ".repeat(this.cols));
    const key = lines.join("\n") + this.light;
    if (key === this.last) { R.progress(); return; }
    this.last = key;
    R.emit("lcd", { addr: this.addr, lines, backlight: this.light, custom: { ...this.custom } });
    const text = lines.map((l) => l.trimEnd()).join("\n").trim();
    if (text !== this.lastText) {
      this.lastText = text;
      if (text) R.emit("display_text", { text, display: "lcd" });
    }
  }
}

export default {
  headers: { "LiquidCrystal_I2C.h": HEADER },
  classes: { LiquidCrystal_I2C },
};
