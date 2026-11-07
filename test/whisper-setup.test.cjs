const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pickAsset, findFile, formatBytes, defaultModel, MODELS } = require("../src/whisper-setup.cjs");

const asset = (name, size = 1) => ({ name, size, browser_download_url: `https://x/${name}` });
// Shaped like GitHub's answer: the version tags have no files, the build tags do, and the names changed.
const RELEASES = [
  { tag_name: "v1.9.5", assets: [] },
  { tag_name: "b5454", assets: [asset("whisper-bin-win-cuda-11.8.0-x64.zip"), asset("whisper-bin-win-cuda-12.4.0-x64.zip", 653), asset("whisper-bin-x64.zip", 8), asset("whisper-bin-win-cuda-13.4-arm64.zip")] },
  { tag_name: "b5130", assets: [asset("whisper-cublas-12.4.0-bin-x64.zip"), asset("whisper-bin-x64.zip")] },
];

test("pickAsset: the newest Windows x64 build for each engine", () => {
  assert.deepStrictEqual(pickAsset(RELEASES, "gpu"), { name: "whisper-bin-win-cuda-12.4.0-x64.zip", url: "https://x/whisper-bin-win-cuda-12.4.0-x64.zip", size: 653, tag: "b5454" });
  assert.strictEqual(pickAsset(RELEASES, "cpu").name, "whisper-bin-x64.zip");
  assert.strictEqual(pickAsset(RELEASES.slice(2), "gpu").name, "whisper-cublas-12.4.0-bin-x64.zip"); // the older naming
  assert.strictEqual(pickAsset([{ tag_name: "b1", assets: [asset("whisper-cublas-11.8.0-bin-x64.zip")] }], "gpu").name, "whisper-cublas-11.8.0-bin-x64.zip"); // CUDA 11 if no 12
  assert.strictEqual(pickAsset([{ tag_name: "b1", assets: [asset("whisper-bin-win-cuda-13.4-arm64.zip")] }], "gpu"), null); // never ARM
  assert.strictEqual(pickAsset([], "cpu"), null);
});

test("findFile: whisper-server.exe inside the unpacked Release folder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cta-ws-"));
  fs.mkdirSync(path.join(dir, "Release"));
  fs.writeFileSync(path.join(dir, "Release", "whisper-server.exe"), "");
  assert.strictEqual(findFile(dir, "whisper-server.exe"), path.join(dir, "Release", "whisper-server.exe"));
  assert.strictEqual(findFile(dir, "nope.exe"), null);
});

test("models and sizes", () => {
  assert.strictEqual(defaultModel("gpu"), "large-v3-turbo");
  assert.ok(MODELS.some((m) => m.id === defaultModel("cpu")));
  assert.strictEqual(formatBytes(1624555275), "1.5 GB");
  assert.strictEqual(formatBytes(8 * 1024 * 1024), "8 MB");
});
