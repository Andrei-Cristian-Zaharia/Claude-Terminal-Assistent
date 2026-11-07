// Where the corner cards go: the accept/reject toast (config confirm.position) and the "Claude
// finished" cards (notify.position), each in a corner of the work area of a monitor. When both are
// up in the same corner of the same monitor, the toast sits in the corner (it waits for an answer
// right now) and the cards stack beyond it, so neither covers the other. Tested in test/corners.test.cjs.

const CORNERS = ["bottom-right", "top-right", "bottom-left", "top-left"];
const MARGIN = 4; // from the screen edge; the windows add 8 px of transparent padding of their own
const PADDING = 8;

const cornerOf = (value) => (CORNERS.includes(value) ? value : "bottom-right");

// Bounds of a window of `width` x `height` in `corner` of `area`, `offset` px further from the corner.
function cornerBounds(corner, area, width, height, offset = 0) {
  const right = corner.endsWith("right");
  const bottom = corner.startsWith("bottom");
  return {
    x: Math.round(right ? area.x + area.width - width - MARGIN : area.x + MARGIN),
    y: Math.round(bottom ? area.y + area.height - height - MARGIN - offset : area.y + MARGIN + offset),
    width: Math.round(width),
    height: Math.round(height),
  };
}

const sameArea = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// confirm, done: { corner, area, width, height } of each window that is up, or null.
// -> { confirm?: bounds, done?: bounds }
function placeToasts({ confirm = null, done = null }) {
  const out = {};
  if (confirm) out.confirm = cornerBounds(confirm.corner, confirm.area, confirm.width, Math.min(confirm.height, confirm.area.height - 2 * MARGIN));
  if (done) {
    const shared = confirm && confirm.corner === done.corner && sameArea(confirm.area, done.area);
    // Beyond the toast, with the cards' usual 8 px gap (the two windows' padding overlaps).
    const offset = shared ? out.confirm.height - PADDING : 0;
    const height = Math.max(0, Math.min(done.height, done.area.height - 2 * MARGIN - offset));
    out.done = cornerBounds(done.corner, done.area, done.width, height, offset);
  }
  return out;
}

module.exports = { CORNERS, cornerOf, cornerBounds, placeToasts };
