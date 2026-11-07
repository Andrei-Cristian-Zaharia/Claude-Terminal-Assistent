// Which mouse button events the mouse guard (mouse-guard.cjs) keeps away from other apps. Pure
// logic, so it can be tested; buttons use uiohook's numbers (1 left, 3 middle, 4 Back, 5 Forward).
//
// The app's own gestures use Back and Forward: the chord toggles recording, the select button
// drags out screenshots and taps screen recording on/off while recording, and with it held a left
// click picks a terminal. Without the guard the window under the cursor gets those presses too,
// so a browser goes back a page. A browser or Explorer navigates when the button comes back *up*,
// so what matters most is that the release of a press the app used never gets through:
//  - while active (recording), every press and release of a watched button is kept;
//  - the press that completes the chord is kept, and so are the releases of all chord buttons;
//  - a left click while a watched button is held (picking a terminal, free dictation) claims that
//    button, so its release is kept (the left click itself goes through).
// A button pressed and released on its own, outside a recording, still works as usual.
function createButtonGuard({ chord = [], buttons = [] } = {}) {
  const watched = new Set([...chord, ...buttons].filter((b) => b >= 3));
  const down = new Set();
  const claimed = new Set(); // held buttons whose release must be kept
  let active = false;

  return {
    watched,
    setActive(on) {
      active = !!on;
      if (active) for (const b of down) claimed.add(b);
    },
    // true: swallow this event.
    event(button, isDown) {
      if (button === 1) {
        if (isDown) for (const b of down) claimed.add(b);
        return false;
      }
      if (!watched.has(button)) return false;
      if (isDown) {
        down.add(button);
        if (chord.length >= 2 && chord.every((b) => down.has(b))) for (const b of chord) claimed.add(b);
        if (active) claimed.add(button);
        return claimed.has(button);
      }
      const keep = active || claimed.has(button);
      down.delete(button);
      claimed.delete(button);
      return keep;
    },
  };
}

module.exports = { createButtonGuard };
