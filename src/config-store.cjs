// Where the settings live: %APPDATA%\claude-terminal-assistant\config.json, beside state.json and
// the screenshots, so an installed app keeps them across updates (its own folder is replaced).
// config.default.json in the app folder gives every setting a starting value; a config.json left in
// a source checkout from before (when the settings lived there) is copied over once.
const fs = require("node:fs");
const path = require("node:path");

const DATA_DIR = path.join(process.env.APPDATA ?? path.join(require("node:os").homedir(), "AppData", "Roaming"), "claude-terminal-assistant");

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// Settings missing from `cfg` (added in a newer version) take the default; sections one level deep
// (whisper, confirm, notify…) are completed key by key. Pure.
function withDefaults(cfg, defaults) {
  const out = { ...defaults, ...cfg };
  for (const [k, v] of Object.entries(defaults)) if (isObject(v) && isObject(cfg?.[k])) out[k] = { ...v, ...cfg[k] };
  return out;
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };

// -> the settings. `dataDir` holds config.json; `appDir` holds config.default.json (and, in a source
// checkout, maybe an old config.json, which is copied over when the data folder has none).
function loadConfig(dataDir, appDir) {
  const defaults = readJson(path.join(appDir, "config.default.json")) ?? {};
  const file = path.join(dataDir, "config.json");
  let cfg = readJson(file);
  if (!cfg) {
    const legacy = readJson(path.join(appDir, "config.json"));
    if (legacy) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(path.join(appDir, "config.json"), file);
      cfg = legacy;
    }
  }
  return withDefaults(cfg ?? {}, defaults);
}

module.exports = { DATA_DIR, loadConfig, withDefaults };
