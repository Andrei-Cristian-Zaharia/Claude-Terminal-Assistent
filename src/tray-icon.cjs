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
// A graphite tile with the microphone in light ink and the orange state lamp at the top right:
// the same lamp the tray menu's header lights. Designed on a 32-unit grid, rendered at any size.
const lerp = (a, b, t) => a + (b - a) * t;
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
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / s, y = (py + 0.5) / s;
      const tileD = roundedBox(x, y, 1, 1, 31, 31, 7.5);
      const tileA = cover(tileD);
      if (!tileA) continue;
      // Tile: soft top-to-bottom graphite, with a faint rim.
      const t = y / 32;
      let col = [lerp(0x2d, 0x1b, t), lerp(0x2e, 0x1c, t), lerp(0x33, 0x1f, t)]; // graphite
      const rim = cover(Math.abs(tileD + 0.6) - 0.45) * 0.55;
      col = col.map((c, i) => lerp(c, [0x4b, 0x4d, 0x55][i], rim));
      // Microphone, scaled up from the 16-unit tray glyph and centred a little left and low.
      const k = 1.32;
      const micA = cover(micDistance((x - 14.6) / k + 8, (y - 17.2) / k + 8.4) * k);
      col = col.map((c, i) => lerp(c, [0xee, 0xef, 0xf1][i], micA));
      // Lamp: a gap ring in the tile color, then the green light with a soft halo.
      const ld = Math.hypot(x - 24.6, y - 7.4);
      const halo = Math.max(0, 1 - Math.max(0, ld - 2.6) / 3.2) * 0.35;
      col = col.map((c, i) => lerp(c, [0xff, 0x7a, 0x1a][i], halo * (1 - micA)));
      const gap = cover(ld - 4.1) * (1 - cover(ld - 2.7));
      col = col.map((c, i) => lerp(c, [0x22, 0x23, 0x27][i], gap));
      const lampA = cover(ld - 2.7);
      // Orange lamp with a lighter core.
      const core = Math.max(0, 1 - Math.hypot(x - 24.0, y - 6.8) / 1.6);
      col = col.map((c, i) => lerp(c, lerp([0xff, 0x7a, 0x1a][i], [0xff, 0xd0, 0xa0][i], core * 0.8), lampA));
      const o = (py * size + px) * 4;
      buf[o] = Math.round(col[2]); buf[o + 1] = Math.round(col[1]); buf[o + 2] = Math.round(col[0]);
      buf[o + 3] = Math.round(tileA * 255);
    }
  }
  return buf;
}

module.exports = { micDistance, micBitmap, trayIcon, appIconBitmap, STATE_COLORS };
