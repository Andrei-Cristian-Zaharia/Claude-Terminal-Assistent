// Screen recording for Claude, which reads images but not video. While a voice recording runs,
// the screen under the cursor is sampled about once a second; a sample is kept only when the
// screen changed or the pointer moved, the pointer is marked with a red ring, and at the end the
// kept frames are placed into the transcript at the moment they were taken, so Claude sees what
// was on screen when each sentence was said. The Electron capture loop lives in main.cjs; this
// file holds the parts that are plain data and can be tested.
const { cleanTranscript } = require("./whisper.cjs");

// Change detection works on a small grayscale copy of each frame, split into a grid of blocks.
// The score is the largest per-block mean difference (0..255), so a change in one area (a dialog,
// a line of typed text) counts as much as a full-screen one.
const THUMB_WIDTH = 160;
const GRID = { x: 16, y: 9 };
const CHANGE_THRESHOLD = 4; // below this the frame is a repeat and is not kept
const POINTER_WEIGHT = 100; // pointer moved 5% of the frame width ~ a score of 5

// BGRA bitmap -> grayscale Uint8Array.
function toGray(bgra, width, height) {
  const gray = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < gray.length; i++, o += 4) gray[i] = (bgra[o] * 29 + bgra[o + 1] * 150 + bgra[o + 2] * 77) >> 8;
  return gray;
}

// Largest mean absolute difference over the grid blocks of two same-size grayscale images.
function blockDiff(a, b, width, height) {
  const bw = width / GRID.x, bh = height / GRID.y;
  let max = 0;
  for (let gy = 0; gy < GRID.y; gy++) {
    for (let gx = 0; gx < GRID.x; gx++) {
      const x0 = Math.floor(gx * bw), x1 = Math.floor((gx + 1) * bw);
      const y0 = Math.floor(gy * bh), y1 = Math.floor((gy + 1) * bh);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { sum += Math.abs(a[y * width + x] - b[y * width + x]); n++; }
      }
      if (n) max = Math.max(max, sum / n);
    }
  }
  return max;
}

// How different a sample is from the last kept frame. Samples: { displayId, gray, width, height,
// pointer: { x, y } as fractions of the frame, or null when the pointer is on another monitor }.
function changeScore(prev, cur) {
  if (!prev || prev.displayId !== cur.displayId || prev.width !== cur.width || prev.height !== cur.height) return Infinity;
  const content = blockDiff(prev.gray, cur.gray, cur.width, cur.height);
  let moved = 0;
  if (prev.pointer && cur.pointer) moved = Math.hypot(cur.pointer.x - prev.pointer.x, cur.pointer.y - prev.pointer.y);
  else if (prev.pointer || cur.pointer) moved = 1; // the pointer came onto or left this monitor
  return content + moved * POINTER_WEIGHT;
}

// Red ring with a white edge around (cx, cy), drawn into a BGRA bitmap in place. A ring rather
// than a dot, so it shows where the pointer is without hiding what it points at.
function drawPointer(bgra, width, height, cx, cy) {
  const r = Math.max(14, Math.round(width / 80));
  const outer = r + 4;
  for (let y = Math.max(0, Math.floor(cy - outer)); y <= Math.min(height - 1, Math.ceil(cy + outer)); y++) {
    for (let x = Math.max(0, Math.floor(cx - outer)); x <= Math.min(width - 1, Math.ceil(cx + outer)); x++) {
      const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
      if (d > 4) continue;
      const o = (y * width + x) * 4;
      const [b, g, rr] = d <= 2.5 ? [45, 45, 255] : [255, 255, 255];
      bgra[o] = b; bgra[o + 1] = g; bgra[o + 2] = rr; bgra[o + 3] = 255;
    }
  }
}

// A capture of one monitor (Electron NativeImage) -> the sample changeScore compares. `display` is
// the Electron Display it shows, `cursor` the pointer in DIP screen coordinates.
function sampleOf(img, display, cursor) {
  const small = img.resize({ width: THUMB_WIDTH, quality: "good" });
  const { width, height } = small.getSize();
  const b = display.bounds;
  const inside = cursor.x >= b.x && cursor.y >= b.y && cursor.x < b.x + b.width && cursor.y < b.y + b.height;
  return {
    displayId: display.id, width, height,
    gray: toGray(small.toBitmap(), width, height),
    pointer: inside ? { x: (cursor.x - b.x) / b.width, y: (cursor.y - b.y) / b.height } : null,
  };
}

// The kept frame as JPEG bytes, with the pointer ring drawn in. `nativeImage` is Electron's.
function frameJpeg(nativeImage, img, sample) {
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  if (sample.pointer) drawPointer(bgra, width, height, sample.pointer.x * width, sample.pointer.y * height);
  return nativeImage.createFromBitmap(bgra, { width, height }).toJPEG(80);
}

// Keeps at most `max` frames: the first one (the starting state), then those that changed the
// most, back in time order. Returns { keep, drop }.
function pickFrames(frames, max) {
  if (frames.length <= max) return { keep: frames, drop: [] };
  const [first, ...rest] = frames;
  const best = new Set([first, ...[...rest].sort((a, b) => b.score - a.score).slice(0, Math.max(0, max - 1))]);
  return { keep: frames.filter((f) => best.has(f)), drop: frames.filter((f) => !best.has(f)) };
}

// 4.2 -> "0:04", 75 -> "1:15".
const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// Places each item ({ t: seconds from the start of the audio, label }) into the transcript before
// the first word spoken at or after it. `words` are Whisper's timed words ({ word, start }, each
// word with its own leading space). Items whose spot was inside a noise tag that cleaning removed,
// or that come after the last word, go at the end.
function interleave(words, items) {
  const mark = (i) => ` ⟦${i}⟧ `;
  const sorted = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.t - b.t);
  let out = "";
  let k = 0;
  for (const w of words) {
    // Only between words: a token without a leading space continues the previous word (".", ",",
    // the second half of a split word), and an image there would cut it off.
    const between = !out || /^\s/.test(w.word);
    while (between && k < sorted.length && sorted[k].t <= w.start) out += mark(sorted[k++].i);
    out += w.word;
  }
  while (k < sorted.length) out += mark(sorted[k++].i);
  let text = cleanTranscript(out);
  const missing = [];
  items.forEach((it, i) => {
    if (text.includes(`⟦${i}⟧`)) text = text.replace(`⟦${i}⟧`, () => it.label); // a function: "$" in a path stays literal
    else missing.push(it.label);
  });
  return [text, ...missing].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

// Told to Claude once per message that has screen-recording frames, so it reads them right.
const FRAMES_NOTE = "(screen recording: each [m:ss] image is what was on my screen at that point of what I said; the red ring is my mouse pointer)";
const quote = (file) => (/\s/.test(file) ? `"${file}"` : file); // paths are typed unquoted unless they hold spaces

// The text sent to Claude. Without images it is the transcript as is. With images, each one sits
// where it was taken in the speech: screen-recording frames with their time, screenshots as bare
// paths (Claude Code attaches image files whose path it receives).
function composeMessage({ text, words = [], shots = [], frames = [] }) {
  if (!shots.length && !frames.length) return text;
  const items = [
    ...frames.map((f) => ({ t: f.t, label: `[${clock(f.t)}] ${quote(f.file)}` })),
    ...shots.map((s) => ({ t: s.t, label: quote(s.file) })),
  ];
  const body = interleave(text ? words : [], items);
  return frames.length ? `${body} ${FRAMES_NOTE}` : body;
}

module.exports = {
  THUMB_WIDTH, CHANGE_THRESHOLD, FRAMES_NOTE,
  toGray, blockDiff, changeScore, drawPointer, sampleOf, frameJpeg, pickFrames, clock, interleave, composeMessage,
};
