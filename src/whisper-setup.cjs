// Speech recognition setup: downloads whisper.cpp's server and a model, the first time the app
// runs (or from Settings). This file holds the parts that are plain data or plain file work; the
// window is setup.html and the flow is in main.cjs ("speech recognition setup").
//
// whisper.cpp publishes its Windows builds on its GitHub releases, but on the build tags (b5454…)
// and with names that change between versions (whisper-bin-win-cuda-12.4.0-x64.zip, earlier
// whisper-cublas-12.4.0-bin-x64.zip), so the file is found by pattern in the newest releases.
const fs = require("node:fs");
const path = require("node:path");

const RELEASES_API = "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15";
const MODEL_URL = (file) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;

// Engines: the NVIDIA build bundles the CUDA libraries (big); the CPU build works anywhere.
const ENGINES = {
  gpu: { label: "NVIDIA graphics card", pattern: [/^whisper-(?:bin-win-cuda|cublas)-12[\d.]*(?:-bin)?-x64\.zip$/i, /^whisper-(?:bin-win-cuda|cublas)-11[\d.]*(?:-bin)?-x64\.zip$/i] },
  cpu: { label: "Processor only", pattern: [/^whisper-bin-x64\.zip$/i] },
};

// Sizes checked on Hugging Face (2026-11-07).
const MODELS = [
  { id: "large-v3-turbo", file: "ggml-large-v3-turbo.bin", size: 1624555275, label: "Large v3 Turbo", note: "Best accuracy. Best with an NVIDIA card." },
  { id: "large-v3-turbo-q5_0", file: "ggml-large-v3-turbo-q5_0.bin", size: 574041195, label: "Large v3 Turbo, compressed", note: "Nearly as accurate, a third of the size." },
  { id: "small", file: "ggml-small.bin", size: 487601967, label: "Small", note: "Faster on a processor, less accurate." },
  { id: "base", file: "ggml-base.bin", size: 147951465, label: "Base", note: "Fastest, least accurate." },
];

// The model to suggest for an engine.
const defaultModel = (engine) => (engine === "gpu" ? "large-v3-turbo" : "large-v3-turbo-q5_0");

// GitHub releases (API JSON, newest first) -> the newest matching asset { name, url, size, tag }
// for the engine, or null. Patterns are tried in order (CUDA 12 before 11.8).
function pickAsset(releases, engine) {
  for (const pattern of ENGINES[engine]?.pattern ?? []) {
    for (const r of releases ?? []) {
      const a = (r.assets ?? []).find((x) => pattern.test(x.name));
      if (a) return { name: a.name, url: a.browser_download_url, size: a.size, tag: r.tag_name };
    }
  }
  return null;
}

// The first file called `name` under `dir` (the archives keep it in Release\). -> path or null.
function findFile(dir, name) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findFile(path.join(dir, e.name), name);
    if (found) return found;
  }
  return null;
}

// 1624555275 -> "1.5 GB", 8388608 -> "8 MB".
function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1024 ** 2))} MB`;
}

// Downloads `url` to `file` (through file.part, so a cut download never looks finished), calling
// onProgress(done, total). A file already there with the expected size is kept.
async function download(url, file, { size = 0, onProgress = () => {}, signal } = {}) {
  if (size && fs.existsSync(file) && fs.statSync(file).size === size) return onProgress(size, size);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(url, { signal, redirect: "follow", headers: { "User-Agent": "claude-terminal-assistant" } });
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  const total = Number(res.headers.get("content-length")) || size;
  const part = `${file}.part`;
  const out = fs.createWriteStream(part);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      onProgress(done, total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw err;
  }
  if (total && done !== total) { fs.rmSync(part, { force: true }); throw new Error("The download was cut short. Try again."); }
  fs.renameSync(part, file);
}

module.exports = { RELEASES_API, MODEL_URL, ENGINES, MODELS, defaultModel, pickAsset, findFile, formatBytes, download };
