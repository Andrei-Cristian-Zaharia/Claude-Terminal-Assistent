// In-process copy of a screen rectangle with GDI BitBlt, for screen-recording frames. About 30 ms
// for a 1920x1080 monitor, fast enough to make the cursor pill transparent just for the copy
// (see captureFrame in main.cjs). Unlike console-helper.cjs this is safe in the app process: it
// touches no console state and does not change the process DPI awareness (Electron is already
// per-monitor aware, so coordinates are physical pixels).
const koffi = require("koffi");

const u32 = koffi.load("user32.dll");
const gdi = koffi.load("gdi32.dll");
const GetDC = u32.func("void* __stdcall GetDC(void* hwnd)");
const ReleaseDC = u32.func("int __stdcall ReleaseDC(void* hwnd, void* dc)");
const CreateCompatibleDC = gdi.func("void* __stdcall CreateCompatibleDC(void* dc)");
const CreateCompatibleBitmap = gdi.func("void* __stdcall CreateCompatibleBitmap(void* dc, int w, int h)");
const SelectObject = gdi.func("void* __stdcall SelectObject(void* dc, void* obj)");
const BitBlt = gdi.func("bool __stdcall BitBlt(void* dst, int x, int y, int w, int h, void* src, int sx, int sy, uint32_t rop)");
const GetDIBits = gdi.func("int __stdcall GetDIBits(void* dc, void* bmp, uint32_t start, uint32_t lines, _Out_ void* bits, void* info, uint32_t usage)");
const DeleteObject = gdi.func("bool __stdcall DeleteObject(void* obj)");
const DeleteDC = gdi.func("bool __stdcall DeleteDC(void* dc)");
const SRCCOPY = 0x00cc0020;
const CAPTUREBLT = 0x40000000; // include layered windows (menus, tooltips, other apps' overlays)

// Screen rectangle in physical pixels -> top-down BGRA Buffer (alpha 255), as nativeImage takes it.
function grab(x, y, width, height) {
  if (!(width > 0 && height > 0)) throw new Error("Empty capture area.");
  const screenDc = GetDC(null);
  const memDc = CreateCompatibleDC(screenDc);
  const bmp = CreateCompatibleBitmap(screenDc, width, height);
  const old = SelectObject(memDc, bmp);
  try {
    if (!BitBlt(memDc, 0, 0, width, height, screenDc, x, y, SRCCOPY | CAPTUREBLT)) throw new Error("BitBlt failed");
    SelectObject(memDc, old);
    const info = Buffer.alloc(40); // BITMAPINFOHEADER, 32 bpp, negative height = top-down rows
    info.writeUInt32LE(40, 0);
    info.writeInt32LE(width, 4);
    info.writeInt32LE(-height, 8);
    info.writeUInt16LE(1, 12);
    info.writeUInt16LE(32, 14);
    const bits = Buffer.alloc(width * height * 4);
    if (GetDIBits(memDc, bmp, 0, height, bits, info, 0) !== height) throw new Error("GetDIBits failed");
    for (let i = 3; i < bits.length; i += 4) bits[i] = 255;
    return bits;
  } finally {
    DeleteObject(bmp);
    DeleteDC(memDc);
    ReleaseDC(null, screenDc);
  }
}

module.exports = { grab };
