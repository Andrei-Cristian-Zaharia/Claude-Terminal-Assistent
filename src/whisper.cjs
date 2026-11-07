// Keeps one whisper.cpp `whisper-server` running with the model loaded, so a command does not pay
// the model load time. Started lazily (and pre-warmed when recording begins), stopped after
// `idleUnloadMinutes` without use so the VRAM is free for games.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

class Whisper {
  constructor(cfg, log = console.log) {
    this.cfg = cfg;
    this.log = log;
    this.child = null;
    this.ready = null; // promise that resolves when the server answers
    this.idleTimer = null;
  }

  start() {
    if (this.ready) return this.ready;
    const { server, model, language = "auto", port = 8178, threads = 4 } = this.cfg;
    for (const [label, file] of [["whisper-server", server], ["model", model]]) {
      if (!file || !fs.existsSync(file)) return Promise.reject(new Error(`Whisper ${label} not found: ${file}. Fix config.json.`));
    }
    // No "-nt": with timestamps on, verbose_json carries the start time of every word, which is
    // how screen-recording frames are placed into the transcript. Plain text is unaffected.
    const args = ["-m", model, "--host", "127.0.0.1", "--port", String(port), "-l", language, "-t", String(threads)];
    this.log(`[whisper] starting ${path.basename(model)} on port ${port}`);
    const child = spawn(server, args, { cwd: path.dirname(server), windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
    const exited = new Promise((_, reject) => child.once("exit", (code) => {
      if (this.child === child) { this.child = null; this.ready = null; }
      reject(new Error(`whisper-server exited (code ${code}). ${stderr.split("\n").slice(-5).join(" ")}`));
    }));
    exited.catch(() => {});
    this.ready = Promise.race([this.waitUntilUp(port, child), exited]);
    this.ready.catch(() => this.stop());
    return this.ready;
  }

  async waitUntilUp(port, child) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && this.child === child) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) { this.log("[whisper] ready"); return; }
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("whisper-server did not start within 2 minutes");
  }

  // -> { text, words: [{ word, start }] }: the cleaned transcript, and Whisper's words with their
  // start time in seconds from the beginning of the audio (raw, each with its leading space).
  async transcribe(wav) {
    await this.start();
    clearTimeout(this.idleTimer);
    try {
      const form = new FormData();
      form.append("file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
      form.append("response_format", "verbose_json");
      form.append("temperature", "0");
      const res = await fetch(`http://127.0.0.1:${this.cfg.port ?? 8178}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`whisper-server answered HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(`whisper: ${body.error}`);
      return { text: cleanTranscript(body.text ?? ""), words: timedWords(body) };
    } finally {
      this.scheduleUnload();
    }
  }

  scheduleUnload() {
    clearTimeout(this.idleTimer);
    const minutes = this.cfg.idleUnloadMinutes ?? 15;
    if (minutes > 0) this.idleTimer = setTimeout(() => { this.log("[whisper] idle, unloading"); this.stop(); }, minutes * 60_000);
  }

  stop() {
    clearTimeout(this.idleTimer);
    const child = this.child;
    this.child = null;
    this.ready = null;
    if (child && child.exitCode === null) child.kill();
  }
}

// verbose_json -> [{ word, start }]. Falls back to whole segments, then to the bare text at 0 s,
// for servers that leave out word or segment timing.
function timedWords(body) {
  const segments = Array.isArray(body.segments) ? body.segments : [];
  const words = segments.flatMap((s) =>
    Array.isArray(s.words) && s.words.length
      ? s.words.map((w) => ({ word: w.word ?? "", start: Number(w.start ?? s.start ?? 0) }))
      : [{ word: ` ${(s.text ?? "").trim()}`, start: Number(s.start ?? 0) }]);
  return words.length ? words : [{ word: body.text ?? "", start: 0 }];
}

// Whisper marks silence and noise with bracketed tags ("[BLANK_AUDIO]", "(music)"); drop those.
function cleanTranscript(text) {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// On silence or noise Whisper invents video-subtitle phrases ("Thanks for watching",
// "Să vă mulțumim pentru vizionare"). A transcript that is only such a phrase is dropped.
const HALLUCINATIONS = [
  "multumim pentru vizionare", "sa va multumim pentru vizionare", "multumesc pentru vizionare",
  "abonati-va", "nu uitati sa va abonati", "subtitrare", "subtitrari", "traducerea si adaptarea",
  "thanks for watching", "thank you for watching", "thank you", "thank you very much", "please subscribe",
  "subtitles by", "grazie per la visione", "sottotitoli", "provo provo il microfono", "you",
];
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
const HALLUCINATION_SET = new Set(HALLUCINATIONS.map(normalize));

function isHallucination(text) {
  const n = normalize(text);
  return HALLUCINATION_SET.has(n) || /^(subtitrar|sottotitoli|subtitles by)/.test(n);
}

// Loudest 30 ms window of a 16-bit PCM WAV, as RMS in 0..1. Speech is well above 0.02;
// a muted or idle mic stays far below.
function peakLevel(wav) {
  const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, Math.floor((wav.length - 44) / 2));
  const win = 480;
  let peak = 0;
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += (samples[j] / 32768) ** 2;
    peak = Math.max(peak, Math.sqrt(sum / win));
  }
  return peak;
}

module.exports = { Whisper, cleanTranscript, timedWords, isHallucination, peakLevel };
