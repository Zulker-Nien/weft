import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Dictation runs whisper.cpp on this machine: the desktop app's Chromium has no speech service, and
// local transcription keeps what you say on your Mac. Needs `brew install whisper-cpp ffmpeg` and a model.

const run = promisify(execFile);

const SUPERWHISPER = path.join(os.homedir(), "Library/Application Support/superwhisper");
const BREW = "/opt/homebrew/share/whisper-cpp";

// Best first. WEFT_WHISPER_MODEL picks one explicitly.
const MODELS = [
  process.env.WEFT_WHISPER_MODEL,
  path.join(SUPERWHISPER, "ggml-large-v3-turbo.bin"),
  path.join(SUPERWHISPER, "ggml-medium.bin"),
  path.join(SUPERWHISPER, "ggml-small.bin"),
  path.join(SUPERWHISPER, "ggml-small.en.bin"),
  path.join(SUPERWHISPER, "ggml-base.bin"),
  path.join(BREW, "ggml-large-v3-turbo.bin"),
  path.join(BREW, "ggml-medium.bin"),
  path.join(BREW, "ggml-small.bin"),
  path.join(BREW, "ggml-base.bin"),
  path.join(BREW, "ggml-base.en.bin"),
];

function which(bin: string) {
  try {
    return execFileSync("/usr/bin/which", [bin], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

interface Tools {
  whisper: string;
  ffmpeg: string;
  model: string;
}

let cached: { tools: Tools | null; reason?: string; at: number } | undefined;

// What dictation needs, looked up once a minute at most.
function tools(): { tools: Tools | null; reason?: string } {
  if (cached && Date.now() - cached.at < 60_000) return cached;
  const whisper = which("whisper-cli");
  const ffmpeg = which("ffmpeg");
  const model = MODELS.find((m) => m && fs.existsSync(m));
  let reason: string | undefined;
  if (!whisper) reason = "Dictation needs whisper.cpp: brew install whisper-cpp";
  else if (!ffmpeg) reason = "Dictation needs ffmpeg: brew install ffmpeg";
  else if (!model) reason = `Dictation needs a whisper model, e.g. ggml-base.en.bin in ${BREW}`;
  cached = { tools: whisper && ffmpeg && model ? { whisper, ffmpeg, model } : null, reason, at: Date.now() };
  return cached;
}

export function dictationStatus() {
  const { tools: found, reason } = tools();
  return { available: Boolean(found), reason, model: found ? path.basename(found.model) : undefined };
}

// Turns a recording (any format ffmpeg reads) into text.
export async function transcribe(audio: Buffer, ext = "webm"): Promise<string> {
  const { tools: found, reason } = tools();
  if (!found) throw new Error(reason ?? "Dictation isn't set up.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `weft-dictation-${randomUUID().slice(0, 8)}-`));
  try {
    const input = path.join(dir, `input.${ext.replace(/[^a-z0-9]/gi, "") || "webm"}`);
    const wav = path.join(dir, "audio.wav");
    fs.writeFileSync(input, audio);
    await run(found.ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], {
      timeout: 60_000,
    });
    const threads = String(Math.max(2, Math.min(8, os.availableParallelism() - 1)));
    const { stdout } = await run(found.whisper, ["-m", found.model, "-f", wav, "-l", "auto", "-nt", "-np", "-t", threads], {
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .join(" ")
      // whisper marks silence and noise like [BLANK_AUDIO] or (wind blowing).
      .replace(/\[[A-Z_ ]+\]|\((?:[a-z ]+)\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
