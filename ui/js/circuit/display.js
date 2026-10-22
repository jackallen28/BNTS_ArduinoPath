// Turning display contents into drawing paths (pure, no DOM): OLED pixels,
// LCD characters, 7-segment and matrix bits.

import { glyph } from "./font5x7.js";

const f = (v) => Math.round(v * 100) / 100;

/**
 * Is pixel (x, y) of a 1-bit-per-pixel OLED buffer lit? The buffer is
 * either SSD1306 page order (width × height / 8 bytes: byte x + (y>>3)·width,
 * bit y&7, as Adafruit_SSD1306 keeps it) or one byte per pixel.
 */
export function oledPixel(buffer, width, height, x, y) {
  if (buffer.length >= width * height) return !!buffer[y * width + x];
  return !!(buffer[x + (y >> 3) * width] & (1 << (y & 7)));
}

/**
 * The lit pixels of an OLED as one path (runs of pixels per row).
 * @param {ArrayLike<number>} buffer
 * @param {number} width   pixels (128)
 * @param {number} height  pixels (64 or 32)
 * @param {{x:number,y:number,w:number,h:number}} box  the screen in drawing units
 */
export function oledPath(buffer, width, height, box) {
  if (!buffer || !buffer.length) return "";
  const pw = box.w / width, ph = box.h / height;
  let d = "";
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!oledPixel(buffer, width, height, x, y)) { x++; continue; }
      const start = x;
      while (x < width && oledPixel(buffer, width, height, x, y)) x++;
      d += `M${f(box.x + start * pw)} ${f(box.y + y * ph)}h${f((x - start) * pw)}v${f(ph)}h${f(-(x - start) * pw)}z`;
    }
  }
  return d;
}

/**
 * An LCD's characters as dots: {on, off} paths (the lit dots, and every
 * cell's unlit dots for the faint grid of a real LCD).
 * @param {string[]} lines
 * @param {number} cols
 * @param {number} rows
 * @param {{x:number,y:number,w:number,h:number}} box
 */
export function lcdPaths(lines, cols, rows, box) {
  const padX = box.w * 0.03, padY = box.h * 0.1;
  const cw = (box.w - 2 * padX) / cols, ch = (box.h - 2 * padY) / rows;
  const dot = Math.min(cw / 6, ch / 9);
  const gap = dot * 0.15;
  let on = "", off = "";
  for (let r = 0; r < rows; r++) {
    const text = String(lines?.[r] ?? "");
    for (let c = 0; c < cols; c++) {
      const g = c < text.length ? glyph(text[c]) : [0, 0, 0, 0, 0];
      const x0 = box.x + padX + c * cw + (cw - dot * 5) / 2;
      const y0 = box.y + padY + r * ch + (ch - dot * 8) / 2;
      for (let col = 0; col < 5; col++) {
        for (let row = 0; row < 8; row++) {
          const lit = row < 7 && g[col] & (1 << row);
          const s = `M${f(x0 + col * dot)} ${f(y0 + row * dot)}h${f(dot - gap)}v${f(dot - gap)}h${f(gap - dot)}z`;
          if (lit) on += s; else off += s;
        }
      }
    }
  }
  return { on, off };
}

/** Which segments of a TM1637 digit are lit: "abcdefg" letters (bit 0 = a). */
export function segmentsOn(byte) {
  let out = "";
  for (let i = 0; i < 7; i++) if (byte & (1 << i)) out += "abcdefg"[i];
  return out;
}

/** Is a MAX7219 matrix dot lit? rows[r] bit 7 is the left column. */
export function matrixDot(rows, r, c) {
  return !!((rows?.[r] ?? 0) & (0x80 >> c));
}
