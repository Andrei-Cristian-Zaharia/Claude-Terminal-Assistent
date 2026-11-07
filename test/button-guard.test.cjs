const test = require("node:test");
const assert = require("node:assert");
const { createButtonGuard } = require("../src/button-guard.cjs");

const guard = () => createButtonGuard({ chord: [4, 5], buttons: [4] });
// Feeds [button, down] pairs and returns which were swallowed.
const run = (g, events) => events.map(([b, d]) => g.event(b, d));

test("outside a recording a lone Back press reaches other apps", () => {
  assert.deepStrictEqual(run(guard(), [[4, true], [4, false]]), [false, false]);
});

test("while recording Back and Forward are kept from other apps", () => {
  const g = guard();
  g.setActive(true);
  assert.deepStrictEqual(run(g, [[4, true], [4, false], [5, true], [5, false]]), [true, true, true, true]);
});

test("the chord that starts a recording: only the first press got through", () => {
  const g = guard();
  assert.deepStrictEqual(run(g, [[4, true], [5, true]]), [false, true]);
  g.setActive(true);
  assert.deepStrictEqual(run(g, [[4, false], [5, false]]), [true, true]);
});

test("the chord that stops a recording keeps both releases after recording ends", () => {
  const g = guard();
  g.setActive(true);
  assert.deepStrictEqual(run(g, [[4, true], [5, true]]), [true, true]);
  g.setActive(false);
  assert.deepStrictEqual(run(g, [[5, false], [4, false]]), [true, true]);
  assert.deepStrictEqual(run(g, [[4, true], [4, false]]), [false, false]); // back to normal
});

test("a left click with Back held (picking a terminal) keeps Back's release", () => {
  const g = guard();
  assert.deepStrictEqual(run(g, [[4, true], [1, true], [1, false], [4, false]]), [false, false, false, true]);
});

test("left, right and unconfigured buttons are never touched", () => {
  const g = guard();
  g.setActive(true);
  assert.deepStrictEqual(run(g, [[1, true], [1, false], [2, true], [2, false], [3, true], [3, false]]), [false, false, false, false, false, false]);
  assert.deepStrictEqual([...createButtonGuard({ chord: [1, 4], buttons: [2] }).watched], [4]);
});

test("a release whose press the guard never saw passes unless recording", () => {
  assert.strictEqual(guard().event(4, false), false);
});
