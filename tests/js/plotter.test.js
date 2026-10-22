import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlotLine, PlotData } from "../../ui/js/plotter.js";

test("lines become numbers", () => {
  assert.deepEqual(parsePlotLine("512"), [{ label: "value 1", value: 512 }]);
  assert.deepEqual(parsePlotLine("temp:22.5, humidity:40"), [{ label: "temp", value: 22.5 }, { label: "humidity", value: 40 }]);
  assert.deepEqual(parsePlotLine("3 -4\t1e2"), [{ label: "value 1", value: 3 }, { label: "value 2", value: -4 }, { label: "value 3", value: 100 }]);
  assert.deepEqual(parsePlotLine("Hello there!"), []);
  assert.deepEqual(parsePlotLine("Distance: 12 cm"), [{ label: "value 1", value: 12 }]);
});

test("series keep their last points", () => {
  const d = new PlotData(3);
  assert.equal(d.add("hello"), false);
  d.add("a:1");
  d.add("a:2 b:5");
  d.add("a:3");
  d.add("a:4");
  assert.deepEqual(d.series.get("a"), [2, 3, 4]);
  assert.deepEqual(d.series.get("b"), [5, null, null]);
  const r = d.range();
  assert.ok(r.min < 2 && r.max > 5);
  d.clear();
  assert.deepEqual(d.range(), { min: 0, max: 1 });
});
