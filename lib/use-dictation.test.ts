// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge } from "./client";

const api = vi.hoisted(() => ({ dictation: vi.fn(), transcribe: vi.fn() }));
vi.mock("./client", () => ({ api }));

// The whisper status is cached at module level, so each test loads a fresh copy of the hook.
async function loadHook() {
  vi.resetModules();
  return (await import("./use-dictation")).useDictation;
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

// ---- Fake recorder, audio graph and mic --------------------------------------------------------

let supportedTypes: string[];
let samples: number[];

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => supportedTypes.includes(type);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => Promise<void>) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    void Promise.resolve().then(() => this.onstop?.());
  });
  constructor(
    public stream: unknown,
    public options?: { mimeType: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

const audioClose = vi.fn(() => Promise.resolve());
class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 0,
      getByteTimeDomainData(out: Uint8Array) {
        out.set(samples.slice(0, out.length));
      },
    };
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  close = audioClose;
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();
let frames: FrameRequestCallback[];

function recorder() {
  return FakeRecorder.instances[FakeRecorder.instances.length - 1]!;
}

// ---- Fake browser speech recognition ----------------------------------------------------------

type Result = { isFinal: boolean; 0: { transcript: string } };
class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  continuous = false;
  interimResults = true;
  lang = "";
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognizer.instances.push(this);
  }
}

function final(transcript: string, isFinal = true): Result {
  return { isFinal, 0: { transcript } };
}

beforeEach(() => {
  supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  samples = new Array<number>(512).fill(128);
  frames = [];
  FakeRecorder.instances = [];
  FakeRecognizer.instances = [];
  api.dictation.mockResolvedValue({ available: true });
  api.transcribe.mockResolvedValue("hello world");
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }, { stop: trackStop }] });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete window.weft;
});

async function startRecording(onText = vi.fn()) {
  const useDictation = await loadHook();
  const hook = renderHook(() => useDictation(onText));
  act(() => hook.result.current.toggle());
  await flush();
  return { ...hook, onText };
}

describe("useDictation with whisper", () => {
  it("starts idle", async () => {
    const useDictation = await loadHook();
    const { result } = renderHook(() => useDictation(vi.fn()));
    expect(result.current).toMatchObject({ state: "idle", error: null, seconds: 0, level: 0 });
  });

  it("records from the mic with echo cancellation and noise suppression", async () => {
    const { result } = await startRecording();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    expect(result.current.state).toBe("recording");
    expect(recorder().start).toHaveBeenCalledWith(1000);
  });

  it("records in the first audio format the browser supports", async () => {
    supportedTypes = ["audio/mp4"];
    await startRecording();
    expect(recorder().options).toEqual({ mimeType: "audio/mp4" });
  });

  it("lets the browser pick a format when none on the list is supported", async () => {
    supportedTypes = [];
    await startRecording();
    expect(recorder().options).toBeUndefined();
  });

  it("transcribes the recording on the second toggle and hands over the text", async () => {
    const { result, onText } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(api.transcribe).toHaveBeenCalledOnce();
    const blob = api.transcribe.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("audio/webm;codecs=opus");
    expect(onText).toHaveBeenCalledWith("hello world");
    expect(result.current.state).toBe("idle");
  });

  it("labels the upload audio/webm when the recorder reports no type", async () => {
    supportedTypes = [];
    const { result } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect((api.transcribe.mock.calls[0]![0] as Blob).type).toBe("audio/webm");
  });

  it("reads transcribing while whisper works", async () => {
    let finish: (text: string) => void = () => {};
    api.transcribe.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)));
    const { result } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(result.current.state).toBe("transcribing");
    // A toggle mid-transcription doesn't start a new recording.
    act(() => result.current.toggle());
    await flush();
    expect(FakeRecorder.instances).toHaveLength(1);
    finish("done");
    await flush();
    expect(result.current.state).toBe("idle");
  });

  it("skips empty chunks and sends nothing when no audio arrived", async () => {
    const { result, onText } = await startRecording();
    recorder().ondataavailable?.({ data: new Blob([]) });
    act(() => result.current.toggle());
    await flush();
    expect(api.transcribe).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("asks the user to move closer when whisper hears nothing", async () => {
    api.transcribe.mockResolvedValue("");
    const { result, onText } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Didn't catch anything. Try again a little closer to the mic.");
    expect(result.current.state).toBe("idle");
  });

  it("shows a transcription failure as the error", async () => {
    api.transcribe.mockRejectedValueOnce(new Error("whisper crashed"));
    const { result } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(result.current.error).toBe("whisper crashed");
    expect(result.current.state).toBe("idle");
  });

  it("stringifies a non-Error transcription failure", async () => {
    api.transcribe.mockRejectedValueOnce("bad gateway");
    const { result } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(result.current.error).toBe("bad gateway");
  });

  it("cancel stops without transcribing", async () => {
    const { result, onText } = await startRecording();
    recorder().emit("audio");
    act(() => result.current.cancel());
    await flush();
    expect(api.transcribe).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  it("releases the mic, meter and audio graph when recording stops", async () => {
    const { result } = await startRecording();
    act(() => result.current.cancel());
    await flush();
    expect(trackStop).toHaveBeenCalledTimes(2);
    expect(audioClose).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(result.current.level).toBe(0);
  });

  it("stops the recorder only once when stopped twice", async () => {
    const { result } = await startRecording();
    act(() => {
      result.current.cancel();
      result.current.cancel();
    });
    await flush();
    expect(recorder().stop).toHaveBeenCalledOnce();
  });

  it("drops the recording if the composer unmounts mid-recording", async () => {
    const { unmount } = await startRecording();
    const rec = recorder();
    rec.emit("audio");
    unmount();
    await flush();
    expect(rec.stop).toHaveBeenCalledOnce();
    expect(api.transcribe).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();
  });

  it("meters mic loudness from 0 to 1 every animation frame", async () => {
    samples = new Array<number>(512).fill(128);
    samples[3] = 160; // a peak of 32 out of 64
    const { result } = await startRecording();
    expect(result.current.level).toBe(0.5);
    samples[3] = 0; // a peak of 128 caps at 1
    act(() => frames[frames.length - 1]!(0));
    expect(result.current.level).toBe(1);
  });

  it("counts whole seconds while recording", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { result } = await startRecording();
    act(() => {
      vi.advanceTimersByTime(2750);
    });
    expect(result.current.seconds).toBe(2);
  });

  it("stops and transcribes on its own after ten minutes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const { result, onText } = await startRecording();
    recorder().emit("audio");
    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000 - 250);
    });
    expect(recorder().stop).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(recorder().stop).toHaveBeenCalledOnce();
    await flush();
    expect(onText).toHaveBeenCalledWith("hello world");
    expect(result.current.state).toBe("idle");
  });

  it("explains how to allow the mic when macOS denies it", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    const { result } = await startRecording();
    expect(result.current.error).toBe(
      "Weft can't use the microphone. Allow it in System Settings → Privacy & Security → Microphone.",
    );
    expect(result.current.state).toBe("idle");
  });

  it("reports any other mic failure with its message", async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error("no device"), { name: "NotFoundError" }));
    const { result } = await startRecording();
    expect(result.current.error).toBe("Couldn't open the microphone: no device");
  });

  it("clears the error on the next start and on clearError", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("no device"), { name: "NotFoundError" }));
    const { result } = await startRecording();
    expect(result.current.error).not.toBeNull();
    act(() => result.current.toggle());
    await flush();
    expect(result.current.error).toBeNull();
    expect(result.current.state).toBe("recording");
    act(() => result.current.cancel());
    await flush();

    api.transcribe.mockResolvedValue("");
    act(() => result.current.toggle());
    await flush();
    recorder().emit("audio");
    act(() => result.current.toggle());
    await flush();
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("asks the server about whisper once and reuses the answer", async () => {
    const { result } = await startRecording();
    act(() => result.current.cancel());
    await flush();
    act(() => result.current.toggle());
    await flush();
    expect(api.dictation).toHaveBeenCalledOnce();
    expect(FakeRecorder.instances).toHaveLength(2);
  });

  it("does nothing on cancel when nothing is recording", async () => {
    const useDictation = await loadHook();
    const { result } = renderHook(() => useDictation(vi.fn()));
    expect(() => act(() => result.current.cancel())).not.toThrow();
    expect(result.current.state).toBe("idle");
  });
});

describe("useDictation without whisper", () => {
  beforeEach(() => {
    api.dictation.mockResolvedValue({ available: false, reason: "whisper-cli isn't installed." });
  });

  it("shows why when the browser has no speech recognition either", async () => {
    const { result } = await startRecording();
    expect(result.current.error).toBe("whisper-cli isn't installed.");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the server gives no reason", async () => {
    api.dictation.mockResolvedValue({ available: false });
    const { result } = await startRecording();
    expect(result.current.error).toBe("Dictation isn't available here.");
  });

  it("reports a failed status check and asks again next time", async () => {
    api.dictation.mockRejectedValueOnce(new Error("server down"));
    const { result } = await startRecording();
    expect(result.current.error).toBe("server down");
    api.dictation.mockRejectedValueOnce("offline");
    act(() => result.current.toggle());
    await flush();
    expect(result.current.error).toBe("offline");
    expect(api.dictation).toHaveBeenCalledTimes(2);
  });

  it("uses the browser's SpeechRecognition in a normal tab", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { result } = await startRecording();
    const rec = FakeRecognizer.instances[0]!;
    expect(rec).toMatchObject({ continuous: true, interimResults: false, lang: navigator.language });
    expect(rec.start).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("recording");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("falls back to webkitSpeechRecognition", async () => {
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognizer);
    await startRecording();
    expect(FakeRecognizer.instances).toHaveLength(1);
  });

  it("defaults the language to en-US when the browser has none", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const language = vi.spyOn(navigator, "language", "get").mockReturnValue("");
    await startRecording();
    expect(FakeRecognizer.instances[0]!.lang).toBe("en-US");
    language.mockRestore();
  });

  it("never uses the desktop app's speech API, which has no service behind it", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    window.weft = {} as ShellBridge;
    const { result } = await startRecording();
    expect(FakeRecognizer.instances).toHaveLength(0);
    expect(result.current.error).toBe("whisper-cli isn't installed.");
  });

  it("hands over each final, non-blank result trimmed", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { onText } = await startRecording();
    const rec = FakeRecognizer.instances[0]!;
    act(() =>
      rec.onresult?.({
        resultIndex: 1,
        results: [final("already sent"), final("  first  "), final("partial", false), final("   "), final("second")],
      }),
    );
    expect(onText.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("stops on the second toggle and goes idle when recognition ends", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { result } = await startRecording();
    act(() => result.current.toggle());
    expect(FakeRecognizer.instances[0]!.stop).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("idle");
  });

  it("drops results that arrive after cancel", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { result, onText } = await startRecording();
    const rec = FakeRecognizer.instances[0]!;
    rec.stop.mockImplementation(() => {}); // onend comes later, as in Chrome
    act(() => result.current.cancel());
    act(() => rec.onresult?.({ resultIndex: 0, results: [final("too late")] }));
    expect(onText).not.toHaveBeenCalled();
    act(() => rec.onend?.());
    expect(result.current.state).toBe("idle");
  });

  it("shows recognition errors but not aborted or no-speech", async () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { result } = await startRecording();
    const rec = FakeRecognizer.instances[0]!;
    act(() => rec.onerror?.({ error: "aborted" }));
    act(() => rec.onerror?.({ error: "no-speech" }));
    expect(result.current.error).toBeNull();
    act(() => rec.onerror?.({ error: "network" }));
    expect(result.current.error).toBe("Dictation stopped: network");
  });

  it("counts seconds while the browser listens", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    const { result } = await startRecording();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(3);
    act(() => result.current.toggle());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(3);
  });
});
