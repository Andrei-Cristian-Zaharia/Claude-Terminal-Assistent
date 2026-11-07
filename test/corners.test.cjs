const test = require("node:test");
const assert = require("node:assert");
const { cornerOf, cornerBounds, placeToasts } = require("../src/corners.cjs");

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const OTHER = { x: 1920, y: 0, width: 2560, height: 1400 };

test("cornerOf: unknown values fall back to bottom right", () => {
  assert.strictEqual(cornerOf("top-left"), "top-left");
  assert.strictEqual(cornerOf("middle"), "bottom-right");
  assert.strictEqual(cornerOf(undefined), "bottom-right");
});

test("cornerBounds: each corner, 4 px from the edges", () => {
  assert.deepStrictEqual(cornerBounds("bottom-right", AREA, 380, 200), { x: 1536, y: 836, width: 380, height: 200 });
  assert.deepStrictEqual(cornerBounds("top-right", AREA, 380, 200), { x: 1536, y: 4, width: 380, height: 200 });
  assert.deepStrictEqual(cornerBounds("bottom-left", AREA, 380, 200), { x: 4, y: 836, width: 380, height: 200 });
  assert.deepStrictEqual(cornerBounds("top-left", OTHER, 380, 200, 50), { x: 1924, y: 54, width: 380, height: 200 });
});

test("placeToasts: same corner, the cards stack beyond the toast; apart, both sit in their corners", () => {
  const confirm = { corner: "bottom-right", area: AREA, width: 380, height: 220 };
  const done = { corner: "bottom-right", area: AREA, width: 380, height: 300 };
  const both = placeToasts({ confirm, done });
  assert.deepStrictEqual(both.confirm, { x: 1536, y: 816, width: 380, height: 220 });
  // 220 - 8: the windows' transparent padding overlaps, leaving the usual 8 px between cards.
  assert.deepStrictEqual(both.done, { x: 1536, y: 1040 - 300 - 4 - 212, width: 380, height: 300 });
  assert.strictEqual(placeToasts({ done }).done.y, 1040 - 300 - 4); // toast gone: back in the corner
  assert.strictEqual(placeToasts({ confirm, done: { ...done, corner: "top-right" } }).done.y, 4);
  assert.strictEqual(placeToasts({ confirm, done: { ...done, area: OTHER } }).done.y, 1400 - 300 - 4); // other monitor
  const top = placeToasts({ confirm: { ...confirm, corner: "top-left" }, done: { ...done, corner: "top-left" } });
  assert.deepStrictEqual([top.confirm.y, top.done.y], [4, 4 + 212]);
});

test("placeToasts: a tall stack is cut to what fits beside the toast", () => {
  const out = placeToasts({ confirm: { corner: "bottom-right", area: AREA, width: 380, height: 240 }, done: { corner: "bottom-right", area: AREA, width: 380, height: 2000 } });
  assert.strictEqual(out.done.y, 4);
  assert.strictEqual(out.done.height, 1040 - 8 - 232);
});
