const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLog } = require("../src/log.cjs");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cta-log-"));

test("log lines carry time, level and formatted arguments", () => {
  const dir = path.join(tmp(), "logs"); // created on demand
  const log = createLog(dir);
  log.write("ERROR", ["[whisper] failed:", new Error("boom"), { code: 7 }]);
  const text = fs.readFileSync(log.file, "utf8");
  assert.match(text, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ERROR \[whisper\] failed: Error: boom/);
  assert.match(text, /\{ code: 7 \}\n$/);
});

test("a log over the size limit is kept as app.old.log and a new one starts", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "app.log"), "x".repeat(200));
  fs.writeFileSync(path.join(dir, "app.old.log"), "older");
  const log = createLog(dir, { maxBytes: 100 });
  assert.strictEqual(fs.readFileSync(path.join(dir, "app.old.log"), "utf8"), "x".repeat(200));
  assert.strictEqual(fs.existsSync(log.file), false);
  log.write("INFO", ["fresh"]);
  assert.match(fs.readFileSync(log.file, "utf8"), /INFO  fresh\n$/);
});

test("a small log is kept and appended to", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "app.log"), "earlier\n");
  const log = createLog(dir, { maxBytes: 100 });
  log.write("WARN", ["later"]);
  assert.match(fs.readFileSync(log.file, "utf8"), /^earlier\n.* WARN  later\n$/);
});
