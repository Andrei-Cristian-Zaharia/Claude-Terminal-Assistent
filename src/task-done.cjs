// Claude Code hook (installed by `npm run install-prompt`): "Stop" when Claude has finished
// answering, "Notification" (matcher permission_prompt) when it waits for a permission. Tells the
// tray app, which shows a card that brings this terminal forward when clicked.
//
// Input: Claude Code's hook JSON on stdin (session_id, cwd, transcript_path, and in newer versions
// last_assistant_message). Output: nothing, exit code 0 always. A hook that fails or prints would
// show up in Claude Code; if the app isn't running, nothing happens.
const fs = require("node:fs");
const net = require("node:net");
const { PIPE_NAME, MAX_TEXT, lastAssistantText } = require("./tasks.cjs");

// This process's ancestors, nearest first. The app finds the terminal among them.
function ancestorChain() {
  const { processes } = require("./console-helper.cjs");
  const procs = processes();
  const chain = [];
  for (let p = procs.get(process.pid)?.ppid; p && !chain.includes(p) && chain.length < 64; p = procs.get(p)?.ppid) {
    if (!procs.has(p)) break; // parent already exited; its pid may belong to someone else by now
    chain.push(p);
  }
  return chain;
}

// The end of the transcript is enough to find the last answer.
function transcriptTail(file, bytes = 512 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function send(message) {
  return new Promise((resolve) => {
    const sock = net.connect(PIPE_NAME);
    const done = () => { sock.destroy(); resolve(); };
    sock.setTimeout(1500, done);
    sock.on("error", done); // the app isn't running
    sock.on("connect", () => sock.end(`${JSON.stringify(message)}\n`, done));
  });
}

async function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch {}
  // Notification hook (installed for permission prompts): Claude is waiting for an answer.
  const ask = input.hook_event_name === "Notification";
  let text = ask ? String(input.message ?? "Claude needs your permission.")
    : typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
  if (!text && !ask && input.transcript_path) {
    try { text = lastAssistantText(transcriptTail(input.transcript_path)); } catch {}
  }
  await send({
    type: "done",
    kind: ask ? "ask" : "done",
    chain: ancestorChain(),
    cwd: input.cwd ?? process.cwd(),
    sessionId: input.session_id ?? "",
    text: text.slice(0, MAX_TEXT),
  });
}

main().catch(() => {}).finally(() => process.exit(0));
