// "Claude finished" notifications: the plain-data half, shared by the Claude Code hook
// (task-done.cjs) and the app (main.cjs), and tested in test/tasks.test.cjs.
//
// Claude Code runs task-done.cjs as a Stop hook when it finishes answering (kind "done"), and as a
// Notification hook when it waits for a permission (kind "ask"). The hook sends one JSON line over
// PIPE_NAME: its own chain of ancestor pids, the folder, and Claude's last message (or what it
// asks). The app finds the terminal in that chain and shows a card; a click brings it forward.

const PIPE_NAME = "\\\\.\\pipe\\claude-terminal-assistant";
const MAX_TEXT = 4000; // what the hook sends; the card shows far less

// The last text Claude wrote, from a transcript (JSONL, one event per line). Only needed when the
// hook input has no last_assistant_message (older Claude Code versions).
function lastAssistantText(jsonl) {
  const lines = String(jsonl ?? "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"assistant"')) continue;
    let ev;
    try { ev = JSON.parse(lines[i]); } catch { continue; } // the first line of a tail read is cut
    if (ev?.type !== "assistant" || ev.isSidechain) continue;
    const content = ev.message?.content;
    const text = typeof content === "string" ? content
      : Array.isArray(content) ? content.filter((c) => c?.type === "text").map((c) => c.text).join("\n") : "";
    if (text.trim()) return text.trim();
  }
  return "";
}

// Claude's answer as one short plain line for the card: markdown marks removed, paragraphs (a
// heading too) joined as sentences, cut at a word near `max` characters.
function summarize(text, max = 220) {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ") // code blocks say little in a notification
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [label](url) -> label
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*[|:-]+\s*$/gm, ""); // table rules
  const paragraphs = plain.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const first = paragraphs.map((p) => (/[.!?:…]$/.test(p) ? p : `${p}.`)).join(" ");
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

// The listed terminal (console-helper `list`) the hook ran in: the one whose anchor pid is among
// the hook's ancestors. Claude may run hooks in a hidden console of its own, but the parent chain
// still leads back to the terminal's shell.
function findTerminal(terminals, chain) {
  const pids = new Set(chain);
  return (terminals ?? []).find((t) => pids.has(t.pid)) ?? null;
}

const normTitle = (t) => (t ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Is that terminal what the person is looking at right now? Then a card would only be noise.
// `fg` is the foreground window ({ hwnd, pid, title }). A Windows Terminal window holds several
// tabs (they share the owner window); its title is the active tab's title. Without a listed
// terminal (Claude in an IDE's own panel), any window of an ancestor process counts.
function isShowing({ fg, terminal, terminals = [], chain = [] }) {
  if (!fg?.hwnd) return false;
  if (!terminal) return chain.includes(fg.pid);
  const win = terminal.owner || terminal.hwnd;
  if (!win || fg.hwnd !== win) return false;
  const tabs = terminals.filter((t) => (t.owner || t.hwnd) === win);
  if (tabs.length <= 1) return true;
  // A renamed tab: the window title is the name the person gave it.
  const a = normTitle(fg.title);
  return [terminal.tabName, terminal.title].map(normTitle).some((b) => a && b && (a === b || a.includes(b)));
}

// What Claude is doing in a terminal, for the terminal lists. Claude Code puts a glyph in front of
// its console title: a turning half circle (◐◓◑◒) while it works, ✳ otherwise, and also ✳ while
// a permission question waits (checked by hand), so the title alone can't tell waiting from idle.
// The hooks' last event for that terminal (`event`: { kind: "ask" | "done", at }) tells those
// apart. -> null (no Claude here) or { state: "working" | "ask" | "done" | "idle", at? }
const WORKING_GLYPH = /^[◐-◓⠀-⣿]/u; // half circles; braille spinners in older versions
const IDLE_GLYPH = /^✳/u;
function claudeStatus(t, event) {
  const title = (t?.title ?? "").trim();
  const claude = (t?.processes ?? []).some((p) => p.toLowerCase() === "claude.exe");
  if (!claude && !WORKING_GLYPH.test(title) && !IDLE_GLYPH.test(title)) return null;
  if (WORKING_GLYPH.test(title)) return { state: "working" };
  if (event?.kind === "ask") return { state: "ask", at: event.at };
  if (event?.kind === "done") return { state: "done", at: event.at };
  return { state: "idle" };
}

// The hooks' last event per terminal pid, kept up to date with what a fresh listing shows: Claude
// seen working again after a permission question means it was answered, so the question is
// dropped (otherwise a refused one would read "needs you" for ever); terminals that closed go.
function updateEvents(events, terminals) {
  const live = new Map(terminals.map((t) => [t.pid, t]));
  for (const [pid, ev] of events) {
    const t = live.get(pid);
    if (!t) events.delete(pid);
    else if (ev.kind === "ask" && WORKING_GLYPH.test((t.title ?? "").trim())) events.delete(pid);
  }
  return events;
}

// Checks what came over the pipe; anything malformed is dropped. -> message or null.
function parseMessage(raw) {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return null; }
  if (!m || typeof m !== "object" || m.type !== "done") return null;
  const chain = Array.isArray(m.chain) ? m.chain.filter((p) => Number.isInteger(p) && p > 0).slice(0, 64) : [];
  if (!chain.length) return null;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const kind = m.kind === "ask" ? "ask" : "done";
  return { type: "done", kind, chain, cwd: str(m.cwd, 1024), sessionId: str(m.sessionId, 128), text: str(m.text, MAX_TEXT) };
}

module.exports = { PIPE_NAME, MAX_TEXT, lastAssistantText, summarize, findTerminal, isShowing, parseMessage, normTitle, claudeStatus, updateEvents };
