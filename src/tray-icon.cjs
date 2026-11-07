// The tray icon: a microphone drawn in the state's color, anti-aliased, at any pixel size.
// Shapes are signed distance functions in a 16x16 design grid, scaled to the requested size.

const seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Distance from (x, y) to the microphone outline, in grid units (negative inside).
function micDistance(x, y) {
  const body = seg(x, y, 8, 4.4, 8, 7.4) - 2.6; // capsule
  // Cradle: the lower half of a ring around the capsule, ending in rounded tips.
  const cx = 8, cy = 7.2, r = 4.6, w = 0.75;
  const cradle = y >= cy
    ? Math.abs(Math.hypot(x - cx, y - cy) - r) - w
    : Math.min(Math.hypot(x - (cx - r), y - cy), Math.hypot(x - (cx + r), y - cy)) - w;
  const stem = seg(x, y, 8, 11.8, 8, 13.9) - w;
  const base = seg(x, y, 5.6, 14.2, 10.4, 14.2) - w;
  return Math.min(body, cradle, stem, base);
}

// -> BGRA Buffer of size x size pixels.
function micBitmap(size, [r, g, b]) {
  const scale = size / 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = micDistance((px + 0.5) / scale, (py + 0.5) / scale) * scale; // in pixels
      const a = Math.max(0, Math.min(1, 0.5 - d));
      if (!a) continue;
      const o = (py * size + px) * 4;
      buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

// Colors from theme.css: ready is the orange accent; recording rose-red and transcribing gold
// stay clearly apart from it even at 16 px.
const STATE_COLORS = {
  idle: [255, 122, 26], // ready, a target is set
  notarget: [141, 144, 151],
  recording: [255, 51, 85],
  transcribing: [255, 200, 61],
};

// Electron NativeImage with 16 px (100%) and 32 px (200%) representations.
function trayIcon(nativeImage, state) {
  const color = STATE_COLORS[state] ?? STATE_COLORS.notarget;
  const img = nativeImage.createFromBitmap(micBitmap(16, color), { width: 16, height: 16, scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: nativeImage.createFromBitmap(micBitmap(32, color), { width: 32, height: 32 }).toPNG() });
  return img;
}

// ---------- app icon ----------
// A terminal prompt whose cursor is a voice: an orange "›" followed by a waveform in light ink, on
// a graphite tile. Designed on a 32-unit grid, rendered at any size; at 32 px and below the bars
// sit on whole pixels (three of them at 24 px and below) so the wave stays readable in the taskbar.
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c, d, t) => c.map((v, i) => lerp(v, d[i], t));
function roundedBox(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// -> BGRA Buffer of size x size pixels.
function appIconBitmap(size) {
  const s = size / 32;
  const buf = Buffer.alloc(size * size * 4);
  const cover = (d) => Math.max(0, Math.min(1, 0.5 - d * s)); // d in grid units -> pixel coverage
  // The wave per size: [x, half height] per bar and the bar radius, in grid units. Small sizes put
  // the bars on whole pixels with whole-pixel gaps, or they melt into one white block.
  const { bars, barR, chevR } =
    size <= 16 ? { bars: [[17, 3.5], [21, 7], [25, 3.5]], barR: 1, chevR: 2 } // 1 px bars, 1 px gaps
    : size <= 24 ? { bars: [[17.33, 3.6], [21.33, 7.2], [25.33, 3.6]], barR: 1.33, chevR: 2 } // 2 px bars, 1 px gaps
    : size <= 32 ? { bars: [[16, 3], [20, 7], [24, 4.6], [28, 2.2]], barR: 1, chevR: 1.8 } // 2 px bars, 2 px gaps
    : { bars: [[16.2, 3.2], [19.6, 7], [23, 4.6], [26.4, 2.2]], barR: 1.35, chevR: 1.7 };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s, y = (py + 0.5) / s;
      const tileD = roundedBox(x, y, 1, 1, 31, 31, 7.5);
      const tileA = cover(tileD);
      if (!tileA) continue;
      // Tile: soft top-to-bottom graphite, with a faint rim.
      const t = y / 32;
      let col = [lerp(0x2d, 0x1b, t), lerp(0x2e, 0x1c, t), lerp(0x33, 0x1f, t)]; // graphite
      col = mix(col, [0x4b, 0x4d, 0x55], cover(Math.abs(tileD + 0.6) - 0.45) * 0.55);
      // The prompt: an orange chevron.
      const chev = Math.min(seg(x, y, 6.6, 10.5, 12.1, 16), seg(x, y, 12.1, 16, 6.6, 21.5)) - chevR;
      col = mix(col, [0xff, 0x7a, 0x1a], cover(chev));
      // The cursor: a waveform, bars centred on the middle line.
      let wave = Infinity;
      for (const [bx, h] of bars) wave = Math.min(wave, seg(x, y, bx, 16 - h, bx, 16 + h) - barR);
      col = mix(col, [0xee, 0xef, 0xf1], cover(wave));
      const o = (py * size + px) * 4;
      buf[o] = Math.round(col[2]); buf[o + 1] = Math.round(col[1]); buf[o + 2] = Math.round(col[0]);
      buf[o + 3] = Math.round(tileA * 255);
    }
  }
  return buf;
}

module.exports = { micDistance, micBitmap, trayIcon, appIconBitmap, STATE_COLORS };
