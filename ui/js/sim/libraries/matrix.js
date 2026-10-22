// MD_MAX72XX (8×8 LED matrix modules): emits matrix {cs, rows, devices, intensity}.
// rows[r] is a number whose bit c is getPoint(r, c) (column 0 is the
// library's column 0, on the right of the first module).

const HEADER = `
#include <SPI.h>
class MD_MAX72XX {
public:
  enum moduleType_t { PAROLA_HW, GENERIC_HW, ICSTATION_HW, FC16_HW, DR0CR0RR0_HW, DR0CR0RR1_HW, DR0CR1RR0_HW, DR0CR1RR1_HW, DR1CR0RR0_HW, DR1CR0RR1_HW, DR1CR1RR0_HW, DR1CR1RR1_HW };
  enum controlRequest_t { SHUTDOWN, SCANLIMIT, INTENSITY, TEST, DECODE, WRAPAROUND, UPDATE };
  enum controlValue_t { OFF = 0, ON = 1 };
  MD_MAX72XX(moduleType_t mod, uint8_t dataPin, uint8_t clkPin, uint8_t csPin, uint8_t numDevices = 1);
  MD_MAX72XX(moduleType_t mod, uint8_t csPin, uint8_t numDevices = 1);
  bool begin();
  void clear();
  void clear(uint8_t buf);
  bool control(controlRequest_t mode, int value);
  bool control(uint8_t buf, controlRequest_t mode, int value);
  bool getPoint(uint8_t r, uint16_t c);
  bool setPoint(uint8_t r, uint16_t c, bool state);
  bool setRow(uint8_t r, uint8_t value);
  bool setRow(uint8_t buf, uint8_t r, uint8_t value);
  bool setColumn(uint16_t c, uint8_t value);
  bool setColumn(uint8_t buf, uint8_t c, uint8_t value);
  uint8_t getColumn(uint16_t c);
  uint16_t getColumnCount();
  uint8_t getDeviceCount();
  void update();
  void update(controlValue_t mode);
};
`;

export class MD_MAX72XX {
  constructor(R, mod, a, b, c, d) {
    this.R = R;
    let n;
    if (d !== undefined) { this.cs = c; n = d; }
    else { this.cs = a; n = b ?? 1; }
    this.n = Math.max(1, n);
    this.cols = 8 * this.n;
    this.grid = Array.from({ length: 8 }, () => new Uint8Array(this.cols));
    this.auto = true;
    this.intensity = 7;
    this.last = null;
    this.started = false;
  }
  begin() { this.started = true; this.show(); return 1; }
  clear(buf) {
    for (const row of this.grid) {
      if (buf === undefined) row.fill(0);
      else row.fill(0, buf * 8, buf * 8 + 8);
    }
    this.changed();
  }
  control(a, b, c) {
    const [mode, value] = c === undefined ? [a, b] : [b, c];
    if (mode === 2) this.intensity = Math.max(0, Math.min(15, value));
    if (mode === 6) { this.auto = value === 1; if (this.auto) this.show(); return 1; }
    this.changed();
    return 1;
  }
  getPoint(r, c) { return r < 8 && c < this.cols ? this.grid[r][c] : 0; }
  setPoint(r, c, s) {
    if (r >= 8 || c >= this.cols) return 0;
    this.grid[r][c] = s ? 1 : 0;
    this.changed();
    return 1;
  }
  setRow(a, b, c) {
    const devs = c === undefined ? [...Array(this.n).keys()] : [a];
    const [r, v] = c === undefined ? [a, b] : [b, c];
    if (r >= 8) return 0;
    for (const d of devs) for (let j = 0; j < 8; j++) this.grid[r][d * 8 + j] = (v >> j) & 1;
    this.changed();
    return 1;
  }
  setColumn(a, b, c) {
    const col = c === undefined ? a : a * 8 + b;
    const v = c === undefined ? b : c;
    if (col >= this.cols) return 0;
    for (let r = 0; r < 8; r++) this.grid[r][col] = (v >> r) & 1;
    this.changed();
    return 1;
  }
  getColumn(c) {
    let v = 0;
    for (let r = 0; r < 8; r++) v |= (this.grid[r][c] ?? 0) << r;
    return v;
  }
  getColumnCount() { return this.cols; }
  getDeviceCount() { return this.n; }
  update() { this.show(); }
  changed() { this.R.us += 20; if (this.auto) this.show(); }
  show() {
    const R = this.R;
    if (!this.started) return;
    const rows = this.grid.map((row) => row.reduce((v, bit, c) => v + (bit ? 2 ** c : 0), 0));
    const key = rows.join(",") + "/" + this.intensity;
    if (key === this.last) { R.progress(); return; }
    this.last = key;
    R.emit("matrix", { cs: this.cs, rows, devices: this.n, intensity: this.intensity });
  }
}

export default {
  headers: { "MD_MAX72xx.h": HEADER, "MD_MAX72XX.h": HEADER },
  classes: { MD_MAX72XX },
};
