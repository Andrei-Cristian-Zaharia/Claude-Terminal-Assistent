// Which mouse button events the mouse guard (mouse-guard.cjs) keeps away from other apps. Pure
// logic, so it can be tested; buttons use uiohook's numbers (1 left, 3 middle, 4 Back, 5 Forward).
//
// The app's own gestures use Back and Forward: the chord toggles recording, the select button
// drags out screenshots and taps screen recording on/off while recording, and with it held a left
// click picks a terminal. Without the guard the window under the cursor gets those presses too,
// so a browser goes back a page.
//
// Whether a press belongs to the app is often known only later (the second button of the chord,
// the left click that picks a terminal), and a press must never reach an app half-way: a down
// without its up leaves Windows thinking the button is still held. So every press of a watched
// button is held back, and on release it is either dropped (the app used it) or replayed whole,
// down then up, so other apps still get a normal click. Browsers and Explorer act on the release
// anyway, so the delay doesn't show there; holding the button down in another app does nothing
// until it is let go.
//
// A press is the app's ("claimed") when it happens or is still held while recording, when it
// completes the chord (all chord buttons are claimed then), or when a left click comes while it
// is held. event() returns "pass" (let it through), "swallow", or "replay" (swallow this release,
// then send the whole press again).
function createButtonGuard({ chord = [], buttons = [] } = {}) {
  const watched = new Set([...chord, ...buttons].filter((b) => b >= 3));
  const down = new Set(); // presses held back, not yet released
  const claimed = new Set(); // of those, the ones the app used
  let active = false;

  return {
    watched,
    setActive(on) {
      active = !!on;
      if (active) for (const b of down) claimed.add(b);
    },
    event(button, isDown) {
      if (button === 1) {
        if (isDown) for (const b of down) claimed.add(b);
        return "pass";
      }
      if (!watched.has(button)) return "pass";
      if (isDown) {
        down.add(button);
        if (chord.length >= 2 && chord.every((b) => down.has(b))) for (const b of chord) claimed.add(b);
        if (active) claimed.add(button);
        return "swallow";
      }
      // A release whose press went through (the guard started while it was held) must go through too.
      if (!down.has(button)) return "pass";
      const used = active || claimed.has(button);
      down.delete(button);
      claimed.delete(button);
      return used ? "swallow" : "replay";
    },
  };
}

module.exports = { createButtonGuard };
