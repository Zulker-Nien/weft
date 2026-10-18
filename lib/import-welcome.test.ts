import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// lib/import.ts's sync: the first-launch welcome gate (lib/welcome.ts) holds the sync until the
// user has answered, and only then starts adding cards. Shared mocks and helpers live in
// lib/import.harness.ts (the rest of the sync tests in lib/import.test.ts use the same harness).
const h = await vi.hoisted(async () => (await import("./import.harness")).harnessState());
const mocks = await vi.hoisted(async () => (await import("./import.harness")).installMocks(h));

vi.mock("node:child_process", () => mocks.childProcess);
vi.mock("@anthropic-ai/claude-agent-sdk", () => mocks.sdk);
vi.mock("./store", () => mocks.store);
vi.mock("./transcript", () => mocks.transcript);
vi.mock("./settings", () => mocks.settings);
vi.mock("./welcome", () => mocks.welcome);

const { ago, DAY, info, MIN, onDisk, resetPickup, said, setWelcome, addedFor } = await import("./import.harness");
const sdk = await import("@anthropic-ai/claude-agent-sdk");
const store = await import("./store");
const settings = await import("./settings");
const { sessionsToImport, syncSessions } = await import("./import");
const { execFile, execFileSync } = await import("node:child_process");

async function sync(sessions: ReturnType<typeof info>[], cards: Card[] = []) {
  h.board = cards;
  vi.mocked(sdk.listSessions).mockResolvedValue(sessions);
  vi.mocked(store.listCards).mockImplementation(() => h.board);
  return syncSessions();
}

const reset = (): void => {
  resetPickup(h, { execFile, execFileSync }, store, settings);
};

function beforeReset() {
  reset();
}

describe("syncSessions: the welcome gate", () => {
  beforeEach(() => {
    beforeReset();
  });

  it("adds no cards and returns waiting: true when the welcome isn't answered", async () => {
    setWelcome(null, () => false);
    const id = onDisk([said("go", ago(MIN))]);
    const result = await sync([info(id)]);
    expect(result).toEqual({ sessions: 1, added: 0, updated: 0, waiting: true });
    expect(store.addCards).not.toHaveBeenCalled();
  });

  it("skips a card whose folder is in the welcome's skip list", async () => {
    setWelcome({ at: 0, countHistory: true, fresh: false, skip: [] }, (_w, cwd) => cwd !== "/Users/me/app");
    const id = onDisk([said("go", ago(MIN))]);
    const result = await sync([info(id)]);
    expect(result).toEqual({ sessions: 1, added: 0, updated: 0 });
    expect(store.addCards).not.toHaveBeenCalled();
  });

  it("respects Start fresh and drops sessions last active before welcome.at", async () => {
    const at = Date.now() - 5 * DAY;
    setWelcome({ at, countHistory: true, fresh: true, skip: [] }, (_w, _cwd, lastActivity) => lastActivity >= at);
    const old = onDisk([said("go", ago(10 * DAY))]);
    const fresh = onDisk([said("go", ago(MIN))]);
    const result = await sync([info(old), info(fresh)]);
    expect(result.added).toBe(1);
    expect(addedFor(store, old)).toBeUndefined();
    expect(addedFor(store, fresh)).toBeDefined();
  });

  it("with Start fresh off, keeps sessions from before the welcome when the user didn't skip them", async () => {
    const at = Date.now() - 5 * DAY;
    setWelcome({ at, countHistory: true, fresh: false, skip: [] }, () => true);
    const old = onDisk([said("go", ago(10 * DAY))]);
    const result = await sync([info(old)]);
    expect(result.added).toBe(1);
    expect(addedFor(store, old)).toBeDefined();
  });
});

describe("sessionsToImport", () => {
  beforeEach(() => {
    beforeReset();
  });

  it("returns the would-be cards without adding them, even when the welcome is undecided", async () => {
    setWelcome(null, () => false);
    const id = onDisk([said("go", ago(MIN))]);
    vi.mocked(sdk.listSessions).mockResolvedValue([info(id)]);
    vi.mocked(store.listCards).mockImplementation(() => h.board);
    const cards = await sessionsToImport();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.sessionId).toBe(id);
    expect(store.addCards).not.toHaveBeenCalled();
  });
});
