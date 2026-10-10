// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Chimes = typeof import("./chimes");

// A small Web Audio stand-in that records what got played and how loud.
class FakeAudioContext {
  static made: FakeAudioContext[] = [];
  static startState: AudioContextState = "running";
  state: AudioContextState = FakeAudioContext.startState;
  destination = { name: "speakers" };
  resume = vi.fn(async () => {
    this.state = "running";
  });
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ decodedFrom: data }));
  played: { buffer: unknown; gain: number; to: unknown }[] = [];
  constructor() {
    FakeAudioContext.made.push(this);
  }
  createGain() {
    return { gain: { value: 1 }, connect: (to: unknown) => to };
  }
  createBufferSource() {
    const source = {
      buffer: null as unknown,
      gainNode: null as null | { gain: { value: number }; connect: (to: unknown) => unknown },
      connect: (gainNode: { gain: { value: number }; connect: (to: unknown) => unknown }) => {
        source.gainNode = gainNode;
        return { connect: (to: unknown) => (source.to = to) };
      },
      to: null as unknown,
      start: () => this.played.push({ buffer: source.buffer, gain: source.gainNode!.gain.value, to: source.to }),
    };
    return source;
  }
}

let chimes: Chimes;
let fetchMock: ReturnType<typeof vi.fn>;
let fail = new Set<string>();

const played = () => FakeAudioContext.made.flatMap((c) => c.played);
const playedFiles = () => played().map((p) => new TextDecoder().decode((p.buffer as { decodedFrom: ArrayBuffer }).decodedFrom));

// Lets the fetch -> decode -> play promise chain settle.
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function saveCookie(value: unknown) {
  document.cookie = `weft-chimes=${encodeURIComponent(JSON.stringify(value))}; path=/`;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(1_000_000);
  FakeAudioContext.made = [];
  FakeAudioContext.startState = "running";
  fail = new Set();
  fetchMock = vi.fn(async (url: string) =>
    fail.has(url) ? { ok: false, status: 404 } : { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(url).buffer },
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.resetModules();
  chimes = await import("./chimes");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = "weft-chimes=; path=/; max-age=0";
});

describe("chimePrefs", () => {
  it("starts with every chime on but Running, at 60%", () => {
    expect(chimes.chimePrefs()).toEqual({
      on: true,
      volume: 60,
      kinds: { needs_you: true, review: true, done: true, error: true, running: false },
    });
  });

  it("reads saved choices back, over the defaults", () => {
    const prefs = { on: false, volume: 30, kinds: { needs_you: false, review: true, done: false, error: true, running: true } };
    chimes.setChimePrefs(prefs);
    expect(chimes.chimePrefs()).toEqual(prefs);
  });

  it("clamps the volume to 0..100", () => {
    saveCookie({ volume: 140 });
    expect(chimes.chimePrefs().volume).toBe(100);
    saveCookie({ volume: -5 });
    expect(chimes.chimePrefs().volume).toBe(0);
  });

  it("ignores values of the wrong type, keeping the default for each", () => {
    saveCookie({ on: "yes", volume: "loud", kinds: { done: 0, running: true } });
    const prefs = chimes.chimePrefs();
    expect(prefs.on).toBe(true);
    expect(prefs.volume).toBe(60);
    expect(prefs.kinds.done).toBe(true);
    expect(prefs.kinds.running).toBe(true);
  });

  it("falls back to the defaults for a cookie that isn't JSON", () => {
    document.cookie = "weft-chimes=%7Bnope; path=/";
    expect(chimes.chimePrefs().volume).toBe(60);
  });
});

describe("CHIMES", () => {
  it("has a sound file in a playable format for each chime kind", () => {
    for (const kind of chimes.CHIME_KINDS) {
      expect(chimes.SOUND_FORMATS.some((ext) => chimes.SOUNDS[kind].endsWith(ext))).toBe(true);
    }
    expect(chimes.CHIME_KINDS).toEqual(["needs_you", "review", "done", "error", "running"]);
  });
});

describe("playChime", () => {
  it("fetches, decodes, and plays the kind's file at the squared volume", async () => {
    chimes.playChime("done");
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/sounds/done.m4a");
    expect(played()).toEqual([{ buffer: expect.anything(), gain: 0.36, to: { name: "speakers" } }]);
    expect(playedFiles()).toEqual(["/sounds/done.m4a"]);
  });

  it("stays quiet when chimes are off, or that kind is", async () => {
    chimes.setChimePrefs({ ...chimes.chimePrefs(), on: false });
    chimes.playChime("done");
    chimes.setChimePrefs({ ...chimes.chimePrefs(), on: true });
    chimes.playChime("running");
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(played()).toEqual([]);
  });

  it("collapses chimes that arrive together into the most important one", async () => {
    chimes.playChime("done");
    chimes.playChime("needs_you");
    chimes.playChime("review");
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(playedFiles()).toEqual(["/sounds/needs-you.m4a"]);
  });

  it("waits out the gap after the last chime before playing the next", async () => {
    chimes.playChime("done");
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    chimes.playChime("review");
    await vi.advanceTimersByTimeAsync(349);
    await settle();
    expect(playedFiles()).toEqual(["/sounds/done.m4a"]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(playedFiles()).toEqual(["/sounds/done.m4a", "/sounds/review.m4a"]);
  });

  it("plays Running at most every 1.5s", async () => {
    saveCookie({ kinds: { running: true } });
    chimes.playChime("running");
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    chimes.playChime("running");
    await vi.runAllTimersAsync();
    await settle();
    expect(playedFiles()).toEqual(["/sounds/running.m4a"]);
    await vi.advanceTimersByTimeAsync(500);
    chimes.playChime("running");
    await vi.runAllTimersAsync();
    await settle();
    expect(playedFiles()).toEqual(["/sounds/running.m4a", "/sounds/running.m4a"]);
  });

  it("reads the volume when it plays, not when it was asked", async () => {
    chimes.playChime("error");
    chimes.setChimePrefs({ ...chimes.chimePrefs(), volume: 50 });
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(played()[0].gain).toBe(0.25);
  });

  it("makes no sound at volume 0", async () => {
    saveCookie({ volume: 0 });
    chimes.playChime("done");
    await vi.runAllTimersAsync();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(played()).toEqual([]);
  });
});

describe("audio loading", () => {
  it("makes one audio context and decodes each file once", async () => {
    chimes.previewChime("done");
    await settle();
    chimes.previewChime("done");
    await settle();
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.made[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(played()).toHaveLength(2);
  });

  it("resumes a suspended context (autoplay policy)", async () => {
    FakeAudioContext.startState = "suspended";
    chimes.previewChime("done");
    await settle();
    expect(FakeAudioContext.made[0].resume).toHaveBeenCalled();
  });

  it("stays silent on a missing file, and tries again next time", async () => {
    fail.add("/sounds/done.m4a");
    chimes.previewChime("done");
    await settle();
    expect(played()).toEqual([]);
    fail.clear();
    chimes.previewChime("done");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(playedFiles()).toEqual(["/sounds/done.m4a"]);
  });

  it("previewChime plays even with chimes turned off", async () => {
    saveCookie({ on: false, kinds: { done: false } });
    chimes.previewChime("done");
    await settle();
    expect(playedFiles()).toEqual(["/sounds/done.m4a"]);
  });

  it("preloadChimes fetches every sound up front", async () => {
    chimes.preloadChimes();
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual(Object.values(chimes.SOUNDS).sort());
    await settle();
    chimes.previewChime("review");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(played()).toHaveLength(1);
  });

  it("does nothing where Web Audio isn't available", async () => {
    vi.stubGlobal("AudioContext", undefined);
    chimes.preloadChimes();
    chimes.previewChime("done");
    chimes.playChime("done");
    await vi.runAllTimersAsync();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
