import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// whisper.cpp, ffmpeg and `which` are all mocked: execFileSync answers `which`, execFile plays
// ffmpeg and whisper-cli. Nothing is ever transcribed for real.
const sys = vi.hoisted(() => {
  const bins: Record<string, string> = {};
  return { bins, stdout: "", fail: null as string | null };
});
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((_which: string, [bin = ""]: string[]) => {
    if (!(bin in sys.bins)) throw new Error("not found");
    return `${sys.bins[bin]}\n`;
  }),
  execFile: vi.fn((bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, out?: unknown) => void) => {
    if (sys.fail === bin) cb(new Error(`${bin} crashed`));
    else cb(null, { stdout: bin.endsWith("whisper-cli") ? sys.stdout : "", stderr: "" });
  }),
}));

let dir: string;
let model: string;
let child: typeof import("node:child_process");

async function load() {
  vi.resetModules();
  child = await import("node:child_process");
  return import("./transcribe");
}

const allTools = () => (sys.bins = { "whisper-cli": "/bin/whisper-cli", ffmpeg: "/bin/ffmpeg" });
const call = (bin: string) => vi.mocked(child.execFile).mock.calls.find(([b]) => b === bin)!;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-dictation-test-"));
  model = path.join(dir, "ggml-test.bin");
  fs.writeFileSync(model, "");
  process.env.WEFT_WHISPER_MODEL = model;
  sys.bins = {};
  sys.stdout = "";
  sys.fail = null;
  vi.clearAllMocks();
});
afterEach(() => {
  delete process.env.WEFT_WHISPER_MODEL;
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dictationStatus", () => {
  it("is available with whisper, ffmpeg and a model, naming the model", async () => {
    allTools();
    const { dictationStatus } = await load();
    expect(dictationStatus()).toEqual({ available: true, reason: undefined, model: "ggml-test.bin" });
  });

  it("asks for whisper.cpp first", async () => {
    sys.bins = { ffmpeg: "/bin/ffmpeg" };
    const { dictationStatus } = await load();
    expect(dictationStatus()).toEqual({
      available: false,
      reason: "Dictation needs whisper.cpp: brew install whisper-cpp",
      model: undefined,
    });
  });

  it("treats an empty `which` answer as missing", async () => {
    sys.bins = { "whisper-cli": "", ffmpeg: "/bin/ffmpeg" };
    const { dictationStatus } = await load();
    expect(dictationStatus().reason).toMatch(/whisper\.cpp/);
  });

  it("then asks for ffmpeg", async () => {
    sys.bins = { "whisper-cli": "/bin/whisper-cli" };
    const { dictationStatus } = await load();
    expect(dictationStatus()).toMatchObject({ available: false, reason: "Dictation needs ffmpeg: brew install ffmpeg" });
  });

  it("then asks for a model when none of the known paths exist", async () => {
    allTools();
    delete process.env.WEFT_WHISPER_MODEL;
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const { dictationStatus } = await load();
    expect(dictationStatus()).toMatchObject({
      available: false,
      reason: "Dictation needs a whisper model, e.g. ggml-base.en.bin in /opt/homebrew/share/whisper-cpp",
    });
  });

  it("finds a superwhisper model in the home folder", async () => {
    allTools();
    delete process.env.WEFT_WHISPER_MODEL;
    const exists = fs.existsSync;
    vi.spyOn(fs, "existsSync").mockImplementation((p) => String(p).endsWith("superwhisper/ggml-small.bin") || exists(p));
    const { dictationStatus } = await load();
    expect(dictationStatus().model).toBe("ggml-small.bin");
  });

  it("looks the tools up at most once a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { dictationStatus } = await load();
    expect(dictationStatus().available).toBe(false);
    allTools();
    vi.advanceTimersByTime(59_000);
    expect(dictationStatus().available).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(dictationStatus().available).toBe(true);
    expect(child.execFileSync).toHaveBeenCalledTimes(4); // two lookups of two tools
  });
});

describe("transcribe", () => {
  it("refuses with the setup reason when dictation can't run", async () => {
    const { transcribe } = await load();
    await expect(transcribe(Buffer.from("a"))).rejects.toThrow("Dictation needs whisper.cpp");
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("converts to 16 kHz mono WAV, runs whisper on the model, and cleans its output", async () => {
    allTools();
    vi.spyOn(os, "availableParallelism").mockReturnValue(4);
    sys.stdout = "[BLANK_AUDIO]\n  Hello there,  \n(wind blowing) world.\n[MUSIC PLAYING]\n";
    const { transcribe } = await load();
    let input = "";
    vi.mocked(child.execFile).mockImplementationOnce(((_bin: string, args: string[], _o: unknown, cb: (e: null, o: unknown) => void) => {
      input = args[args.indexOf("-i") + 1]!;
      expect(fs.readFileSync(input, "utf8")).toBe("audio bytes");
      cb(null, { stdout: "" });
    }) as never);

    expect(await transcribe(Buffer.from("audio bytes"), "m4a")).toBe("Hello there, world.");

    expect(path.basename(input)).toBe("input.m4a");
    const wav = path.join(path.dirname(input), "audio.wav");
    expect(call("/bin/ffmpeg").slice(1, 3)).toEqual([
      ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      { timeout: 60_000 },
    ]);
    expect(call("/bin/whisper-cli").slice(1, 3)).toEqual([
      ["-m", model, "-f", wav, "-l", "auto", "-nt", "-np", "-t", "3"],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    ]);
    expect(fs.existsSync(path.dirname(input))).toBe(false); // temp folder removed
  });

  it("uses between 2 and 8 threads", async () => {
    allTools();
    const { transcribe } = await load();
    const threads = () => {
      const args = call("/bin/whisper-cli")[1] as string[];
      return args[args.indexOf("-t") + 1];
    };
    vi.spyOn(os, "availableParallelism").mockReturnValue(1);
    await transcribe(Buffer.from("a"));
    expect(threads()).toBe("2");
    vi.clearAllMocks();
    vi.spyOn(os, "availableParallelism").mockReturnValue(32);
    await transcribe(Buffer.from("a"));
    expect(threads()).toBe("8");
  });

  it("strips odd characters from the extension, defaulting to webm", async () => {
    allTools();
    const { transcribe } = await load();
    const input = () => {
      const args = call("/bin/ffmpeg")[1] as string[];
      return path.basename(args[args.indexOf("-i") + 1]!);
    };
    await transcribe(Buffer.from("a"));
    expect(input()).toBe("input.webm");
    vi.clearAllMocks();
    await transcribe(Buffer.from("a"), "../o.gg");
    expect(input()).toBe("input.ogg");
    vi.clearAllMocks();
    await transcribe(Buffer.from("a"), "/./");
    expect(input()).toBe("input.webm");
  });

  it("removes the temp folder when ffmpeg fails", async () => {
    allTools();
    sys.fail = "/bin/ffmpeg";
    const { transcribe } = await load();
    await expect(transcribe(Buffer.from("a"))).rejects.toThrow("/bin/ffmpeg crashed");
    const args = call("/bin/ffmpeg")[1] as string[];
    expect(fs.existsSync(path.dirname(args[args.indexOf("-i") + 1]!))).toBe(false);
    expect(call("/bin/whisper-cli")).toBeUndefined();
  });
});
