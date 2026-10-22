// Parses Serial Monitor lines into numbers for the Serial Plotter, like the
// Arduino IDE: numbers separated by spaces, commas or tabs, each optionally
// labelled ("temp:22.5 humidity:40"). Pure (tested in Node).

/** One line → [{ label, value }] (empty when there are no numbers). */
export function parsePlotLine(line) {
  const out = [];
  let i = 0;
  for (const token of line.trim().split(/[\s,;]+/)) {
    if (!token) continue;
    const m = /^(?:([^:]+):)?(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)$/.exec(token);
    if (!m) continue;
    out.push({ label: m[1] ?? `value ${++i}`, value: Number(m[2]) });
  }
  return out;
}

/** Keeps the last `max` points of each series. */
export class PlotData {
  constructor(max = 300) {
    this.max = max;
    this.series = new Map(); // label → number[]
    this.length = 0;
  }

  add(line) {
    const values = parsePlotLine(line);
    if (!values.length) return false;
    for (const { label, value } of values) {
      if (!this.series.has(label)) this.series.set(label, new Array(this.length).fill(null));
    }
    for (const [label, data] of this.series) {
      const v = values.find((x) => x.label === label);
      data.push(v ? v.value : null);
      if (data.length > this.max) data.shift();
    }
    this.length = Math.min(this.length + 1, this.max);
    return true;
  }

  range() {
    let min = Infinity;
    let max = -Infinity;
    for (const data of this.series.values()) {
      for (const v of data) {
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) return { min: 0, max: 1 };
    if (min === max) return { min: min - 1, max: max + 1 };
    const pad = (max - min) * 0.05;
    return { min: min - pad, max: max + pad };
  }

  clear() {
    this.series.clear();
    this.length = 0;
  }
}
