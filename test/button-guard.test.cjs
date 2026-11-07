const test = require("node:test");
const assert = require("node:assert");
const { createButtonGuard } = require("../src/button-guard.cjs");

const guard = () => createButtonGuard({ chord: [4, 5], buttons: [4] });
// Feeds [button, down] pairs and returns the guard's answers, shortened to p(ass), s(wallow), r(eplay).
const run = (g, events) => events.map(([b, d]) => g.event(b, d)[0]).join("");

test("outside a recording a lone Back press is held back, then replayed whole", () => {
  assert.strictEqual(run(guard(), [[4, true], [4, false]]), "sr");
});

test("while recording Back and Forward are kept from other apps", () => {
  const g = guard();
  g.setActive(true);
  assert.strictEqual(run(g, [[4, true], [4, false], [5, true], [5, false]]), "ssss");
});

test("the chord that starts a recording reaches no other app, not even half a press", () => {
  const g = guard();
  assert.strictEqual(run(g, [[4, true], [5, true]]), "ss");
  g.setActive(true);
  assert.strictEqual(run(g, [[4, false], [5, false]]), "ss");
});

test("the chord that stops a recording keeps both releases after recording ends", () => {
  const g = guard();
  g.setActive(true);
  assert.strictEqual(run(g, [[4, true], [5, true]]), "ss");
  g.setActive(false);
  assert.strictEqual(run(g, [[5, false], [4, false]]), "ss");
  assert.strictEqual(run(g, [[4, true], [4, false]]), "sr"); // back to normal
});

test("a button held when recording starts belongs to the app", () => {
  const g = guard();
  g.event(4, true);
  g.setActive(true);
  g.setActive(false);
  assert.strictEqual(g.event(4, false), "swallow");
});

test("a left click with Back held (picking a terminal) uses up the Back press", () => {
  const g = guard();
  assert.strictEqual(run(g, [[4, true], [1, true], [1, false], [4, false]]), "spps");
});

test("left, right and unconfigured buttons are never touched", () => {
  const g = guard();
  g.setActive(true);
  assert.strictEqual(run(g, [[1, true], [1, false], [2, true], [2, false], [3, true], [3, false]]), "pppppp");
  assert.deepStrictEqual([...createButtonGuard({ chord: [1, 4], buttons: [2] }).watched], [4]);
});

test("a release whose press the guard never saw goes through, even while recording", () => {
  const g = guard();
  g.setActive(true);
  assert.strictEqual(g.event(4, false), "pass");
});
