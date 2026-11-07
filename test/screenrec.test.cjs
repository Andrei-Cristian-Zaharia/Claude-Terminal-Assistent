const test = require("node:test");
const assert = require("node:assert");
const { toGray, blockDiff, changeScore, drawPointer, pickFrames, clock, interleave, composeMessage, CHANGE_THRESHOLD, FRAMES_NOTE } = require("../src/screenrec.cjs");
const { timedWords } = require("../src/whisper.cjs");

// Words as whisper-server's verbose_json returned them for a TTS sample (timestamps on).
const WORDS = [
  [" Look", 0.11], [" at", 0.19], [" this", 0.31], [" button", 0.47], [".", 0.76],
  [" It", 1.84], [" does", 1.84], [" nothing", 1.95], [" when", 2.06], [" I", 2.41], [" click", 2.49], [" it", 3.1], [".", 3.1],
  [" Then", 4.26], [" this", 4.26], [" error", 4.37], [" dialog", 4.66], [" appears", 5.24],
].map(([word, start]) => ({ word, start }));

test("interleave puts each image before the first word said after it", () => {
  const out = interleave(WORDS, [
    { t: 0, label: "[0:00] A.jpg" },
    { t: 1.2, label: "[0:01] B.jpg" },
    { t: 4.3, label: "[0:04] C.jpg" },
  ]);
  assert.strictEqual(out, "[0:00] A.jpg Look at this button. [0:01] B.jpg It does nothing when I click it. Then this [0:04] C.jpg error dialog appears");
});

test("interleave: items after the speech, inside removed noise tags, or with no words go last", () => {
  assert.strictEqual(interleave(WORDS.slice(0, 5), [{ t: 9, label: "Z.jpg" }]), "Look at this button. Z.jpg");
  const noisy = [{ word: " [no", start: 0 }, { word: " speech]", start: 1 }, { word: " hello", start: 2 }];
  assert.strictEqual(interleave(noisy, [{ t: 0.5, label: "N.jpg" }]), "hello N.jpg");
  // Never between a word and the punctuation or word piece glued to it.
  assert.strictEqual(interleave(WORDS.slice(0, 6), [{ t: 0.8, label: "P.jpg" }]), "Look at this button. P.jpg It");
  const split = [{ word: " Sal", start: 0 }, { word: "ut", start: 0.3 }, { word: " lume", start: 0.6 }];
  assert.strictEqual(interleave(split, [{ t: 0.2, label: "S.jpg" }]), "Salut S.jpg lume");
  assert.strictEqual(interleave([], [{ t: 1, label: "A.jpg" }, { t: 0, label: "B.jpg" }]), "B.jpg A.jpg");
  assert.strictEqual(interleave(WORDS.slice(0, 2), [{ t: 0, label: "C:\\a$&b.jpg" }]), "C:\\a$&b.jpg Look at");
});

test("timedWords reads word timing, falls back to segments, then to the text", () => {
  assert.deepStrictEqual(timedWords({ segments: [{ start: 1, words: [{ word: " hi", start: 1.5 }] }] }), [{ word: " hi", start: 1.5 }]);
  assert.deepStrictEqual(timedWords({ segments: [{ start: 2, text: " whole segment" }] }), [{ word: " whole segment", start: 2 }]);
  assert.deepStrictEqual(timedWords({ text: "plain" }), [{ word: "plain", start: 0 }]);
});

test("changeScore: identical frames repeat, a changed block or a moved pointer counts", () => {
  const w = 160, h = 90;
  const base = new Uint8Array(w * h).fill(40);
  const sample = (gray, pointer = { x: 0.5, y: 0.5 }, displayId = 1) => ({ displayId, gray, width: w, height: h, pointer });
  assert.strictEqual(changeScore(sample(base), sample(base.slice())), 0);
  // A dialog in one corner: a single grid block (10x10 px of the thumbnail) turns light.
  const dialog = base.slice();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) dialog[y * w + x] = 220;
  assert.ok(changeScore(sample(base), sample(dialog)) > CHANGE_THRESHOLD);
  assert.ok(changeScore(sample(base), sample(base, { x: 0.6, y: 0.5 })) > CHANGE_THRESHOLD);
  assert.ok(changeScore(sample(base), sample(base, { x: 0.502, y: 0.5 })) < CHANGE_THRESHOLD);
  assert.strictEqual(changeScore(sample(base), sample(base, undefined, 2)), Infinity);
  assert.strictEqual(changeScore(null, sample(base)), Infinity);
  assert.strictEqual(blockDiff(base, dialog, w, h), 180);
});

test("toGray and drawPointer", () => {
  assert.deepStrictEqual([...toGray(Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1)], [0, 255]);
  const w = 200, h = 200;
  const bmp = Buffer.alloc(w * h * 4);
  drawPointer(bmp, w, h, 100, 100);
  const px = (x, y) => [...bmp.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
  assert.deepStrictEqual(px(114, 100), [45, 45, 255]); // on the ring: red (BGR order)
  assert.deepStrictEqual(px(100, 100), [0, 0, 0]); // the centre stays visible
  drawPointer(bmp, w, h, -50, 5000); // off the image: no throw, nothing drawn
});

test("pickFrames keeps the first frame and the biggest changes, in time order", () => {
  const f = (t, score) => ({ t, score });
  const frames = [f(0, Infinity), f(1, 5), f(2, 50), f(3, 6), f(4, 30)];
  const { keep, drop } = pickFrames(frames, 3);
  assert.deepStrictEqual(keep.map((x) => x.t), [0, 2, 4]);
  assert.deepStrictEqual(drop.map((x) => x.t), [1, 3]);
  assert.strictEqual(pickFrames(frames, 10).keep.length, 5);
});

test("composeMessage: plain text without images; frames timed, screenshots bare, note once", () => {
  const words = WORDS.slice(0, 5);
  assert.strictEqual(composeMessage({ text: "Look at this button.", words }), "Look at this button.");
  const msg = composeMessage({
    text: "Look at this button.", words,
    frames: [{ t: 0, file: "C:\\shots\\screen-01.jpg" }],
    shots: [{ t: 0.4, file: "C:\\my shots\\shot.png" }],
  });
  assert.strictEqual(msg, `[0:00] C:\\shots\\screen-01.jpg Look at this "C:\\my shots\\shot.png" button. ${FRAMES_NOTE}`);
  // Speech dropped as silence: the images alone, in time order.
  assert.strictEqual(composeMessage({ text: "", words, shots: [{ t: 2, file: "b.png" }, { t: 1, file: "a.png" }] }), "a.png b.png");
});

test("clock", () => {
  assert.strictEqual(clock(4.2), "0:04");
  assert.strictEqual(clock(75), "1:15");
});
