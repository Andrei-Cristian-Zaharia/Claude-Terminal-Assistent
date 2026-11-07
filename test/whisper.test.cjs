const test = require("node:test");
const assert = require("node:assert");
const { cleanTranscript } = require("../src/whisper.cjs");

test("drops Whisper noise tags and collapses whitespace", () => {
  assert.strictEqual(cleanTranscript(" [BLANK_AUDIO] "), "");
  assert.strictEqual(cleanTranscript("(music) run  the\n tests *laughs*"), "run the tests");
  assert.strictEqual(cleanTranscript("Salut, rulează testele."), "Salut, rulează testele.");
});

const { isHallucination, peakLevel } = require("../src/whisper.cjs");

test("recognises Whisper's silence hallucinations, keeps real commands", () => {
  assert.ok(isHallucination("Să vă mulțumim pentru vizionare!"));
  assert.ok(isHallucination("Thanks for watching."));
  assert.ok(isHallucination("Subtitrare realizată de comunitatea Amara.org"));
  assert.ok(!isHallucination("Rulează testele și arată-mi git status."));
  assert.ok(!isHallucination("Thank you, now fix the failing test."));
});

test("peakLevel: silence is ~0, a tone is loud", () => {
  const wav = (fill) => {
    const b = Buffer.alloc(44 + 16000 * 2);
    for (let i = 0; i < 16000; i++) b.writeInt16LE(fill(i), 44 + i * 2);
    return b;
  };
  assert.ok(peakLevel(wav(() => 0)) < 0.001);
  assert.ok(peakLevel(wav((i) => Math.round(8000 * Math.sin(i / 5)))) > 0.1);
});
