import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, inline } from "../../ui/js/markdown.js";

test("inline pieces", () => {
  assert.deepEqual(inline("Use `digitalWrite` and **HIGH**, *not* 5."), [
    { type: "text", text: "Use " },
    { type: "code", text: "digitalWrite" },
    { type: "text", text: " and " },
    { type: "strong", text: "HIGH" },
    { type: "text", text: ", " },
    { type: "em", text: "not" },
    { type: "text", text: " 5." },
  ]);
  assert.deepEqual(inline("2 * 3 * 4"), [{ type: "text", text: "2 * 3 * 4" }]);
});

test("blocks", () => {
  const b = parse("**Your task:** blink the LED.\nIt's easy.\n\n- one\n- two `x`\n\n1. first\n2. second\n\n```cpp\nint a = 1;\n\nint b;\n```\nend");
  assert.deepEqual(b.map((x) => x.type), ["p", "ul", "ol", "code", "p"]);
  assert.equal(b[0].inlines[0].text, "Your task:");
  assert.equal(b[1].items.length, 2);
  assert.equal(b[3].text, "int a = 1;\n\nint b;");
});

test("nothing", () => {
  assert.deepEqual(parse(""), []);
  assert.deepEqual(parse(null), []);
});
