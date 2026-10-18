import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// lib/welcome.ts against a temp ~/.weft folder: the persisted answer, its gates (skip, fresh), and
// the Settings → General helpers. store.listCards is mocked so the board doesn't have to be real.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-welcome-"));
process.env.WEFT_DATA = dir;
const WELCOME_FILE = path.join(dir, "welcome.json");

let listCardsReturn: Card[] = [];
vi.mock("./store", () => ({ DATA_DIR: dir, listCards: () => listCardsReturn }));

function reset() {
  fs.rmSync(WELCOME_FILE, { force: true });
  listCardsReturn = [];
  delete (globalThis as Record<string, unknown>).__weftWelcome;
}

beforeEach(reset);
afterEach(() => {
  reset();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function load() {
  return import("./welcome");
}

const card = (over: Partial<Card> = {}): Card => ({
  id: "c1",
  title: "t",
  prompt: "",
  cwd: "/repo",
  backend: "claude",
  permissionMode: "default",
  column: "review",
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("welcome", () => {
  it("is null before the welcome is saved", async () => {
    const { welcome } = await load();
    expect(welcome()).toBeNull();
  });

  it("returns the saved welcome after saveWelcome", async () => {
    const { welcome, saveWelcome } = await load();
    saveWelcome({ at: 1000, countHistory: true, fresh: false, skip: [] });
    expect(welcome()).toEqual({ at: 1000, countHistory: true, fresh: false, skip: [] });
  });

  it("reads the welcome from disk across module loads", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, JSON.stringify({ at: 42, countHistory: true, fresh: false, skip: ["/left"] }));
    const { welcome } = await load();
    expect(welcome()).toEqual({ at: 42, countHistory: true, fresh: false, skip: ["/left"] });
  });

  it("ignores a malformed welcome file and returns null", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, "not json");
    const { welcome } = await load();
    expect(welcome()).toBeNull();
  });

  it("returns null for a parsed welcome without a number at", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, JSON.stringify({ countHistory: true }));
    const { welcome } = await load();
    expect(welcome()).toBeNull();
  });

  it("treats a missing countHistory, fresh, skip, or legacy as their defaults", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, JSON.stringify({ at: 9 }));
    const { welcome } = await load();
    expect(welcome()).toEqual({ at: 9, countHistory: true, fresh: false, skip: [] });
  });

  it("preserves legacy when it was saved as true", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, JSON.stringify({ at: 9, legacy: true }));
    const { welcome } = await load();
    expect(welcome()).toEqual({ at: 9, countHistory: true, fresh: false, skip: [], legacy: true });
  });

  it("drops non-string entries from skip", async () => {
    fs.mkdirSync(path.dirname(WELCOME_FILE), { recursive: true });
    fs.writeFileSync(WELCOME_FILE, JSON.stringify({ at: 1, skip: ["/keep", 2, null, "/also"] }));
    const { welcome } = await load();
    expect(welcome()?.skip).toEqual(["/keep", "/also"]);
  });
});

describe("welcomeOrAdopt", () => {
  it("returns the saved welcome when one exists", async () => {
    const { welcomeOrAdopt, saveWelcome } = await load();
    saveWelcome({ at: 5, countHistory: true, fresh: false, skip: [] });
    expect(welcomeOrAdopt()).toEqual({ at: 5, countHistory: true, fresh: false, skip: [] });
  });

  it("returns null when there are no cards and no saved welcome", async () => {
    const { welcomeOrAdopt } = await load();
    expect(welcomeOrAdopt()).toBeNull();
  });

  it("adopts a board that already has non-copilot cards, with at = the earliest non-claude-code card", async () => {
    listCardsReturn = [
      card({ id: "c1", createdAt: 1000, source: undefined }),
      card({ id: "c2", createdAt: 500, source: "claude-code" }),
      card({ id: "cp", role: "copilot", createdAt: 200 }),
    ];
    const { welcomeOrAdopt } = await load();
    const w = welcomeOrAdopt();
    expect(w).toEqual({ at: 1000, countHistory: true, fresh: false, skip: [], legacy: true });
  });

  it("adopts a board whose only cards came from claude-code, with at = now and a saved answer", async () => {
    const before = Date.now();
    listCardsReturn = [card({ id: "c1", createdAt: 500, source: "claude-code" })];
    const { welcomeOrAdopt } = await load();
    const w = welcomeOrAdopt();
    expect(w).toEqual({ at: expect.any(Number) as unknown, countHistory: true, fresh: false, skip: [], legacy: true });
    expect(w!.at).toBeGreaterThanOrEqual(before);
    // The adoption was saved, so a second call returns the same value.
    expect(welcomeOrAdopt()).toEqual(w);
  });
});

describe("importsSession", () => {
  it("is false while the welcome is undecided", async () => {
    const { importsSession } = await load();
    expect(importsSession(null, "/repo", Date.now())).toBe(false);
  });

  it("is false when the cwd sits inside a skipped folder", async () => {
    const { importsSession } = await load();
    const w = { at: 0, countHistory: true, fresh: false, skip: ["/skip/"] };
    expect(importsSession(w, "/skip/inner", Date.now())).toBe(false);
    expect(importsSession(w, "/skip", Date.now())).toBe(true);
  });

  it("skips the folder itself and what's inside it, not a sibling that shares its name's start", async () => {
    const { importsSession } = await load();
    const w = { at: 0, countHistory: true, fresh: false, skip: ["/skip"] };
    expect(importsSession(w, "/skip", Date.now())).toBe(false);
    expect(importsSession(w, "/skip/inner", Date.now())).toBe(false);
    expect(importsSession(w, "/skipper", Date.now())).toBe(true);
  });

  it("is true for non-skipped folders when not fresh", async () => {
    const { importsSession } = await load();
    const w = { at: 0, countHistory: true, fresh: false, skip: [] };
    expect(importsSession(w, "/repo", 1)).toBe(true);
  });

  it("with fresh on, accepts only sessions last active at or after welcome.at", async () => {
    const { importsSession } = await load();
    const w = { at: 1000, countHistory: true, fresh: true, skip: [] };
    expect(importsSession(w, "/repo", 999)).toBe(false);
    expect(importsSession(w, "/repo", 1000)).toBe(true);
    expect(importsSession(w, "/repo", 2000)).toBe(true);
  });
});

describe("countsAt", () => {
  it("is true when the welcome is null (a brand-new install that hasn't answered yet)", async () => {
    const { countsAt } = await load();
    expect(countsAt(null, 0)).toBe(true);
  });

  it("honors countHistory: false and only counts after the welcome's at", async () => {
    const { countsAt } = await load();
    const w = { at: 100, countHistory: false, fresh: false, skip: [] };
    expect(countsAt(w, 50)).toBe(false);
    expect(countsAt(w, 100)).toBe(true);
    expect(countsAt(w, 200)).toBe(true);
  });

  it("ignores at when countHistory is true", async () => {
    const { countsAt } = await load();
    const w = { at: 100, countHistory: true, fresh: false, skip: [] };
    expect(countsAt(w, 0)).toBe(true);
  });
});

describe("isScratch", () => {
  it("flags a worktree, a Claude app folder, a temp folder, and an evals folder", async () => {
    const { isScratch } = await load();
    expect(isScratch("/repo/.claude/worktrees/x")).toBe(true);
    expect(isScratch("/Users/me/Library/Application Support/Claude/scratch")).toBe(true);
    expect(isScratch("/private/var/folders/abc/T/x")).toBe(true);
    expect(isScratch("/Users/me/projects/-evals-results-/run")).toBe(true);
  });

  it("flags a folder under the OS temp dir", async () => {
    const { isScratch } = await load();
    expect(isScratch(path.join(os.tmpdir(), "weft-x"))).toBe(true);
  });

  it("does not flag a real project folder", async () => {
    const { isScratch } = await load();
    expect(isScratch("/Users/me/dev/app")).toBe(false);
  });
});

describe("setCountHistory", () => {
  it("adopts a new welcome with the given flag when none was saved", async () => {
    const { setCountHistory, welcome } = await load();
    setCountHistory(false);
    expect(welcome()?.countHistory).toBe(false);
  });

  it("flips the saved welcome's countHistory without touching at or skip", async () => {
    const { saveWelcome, setCountHistory, welcome } = await load();
    saveWelcome({ at: 500, countHistory: true, fresh: false, skip: ["/s"] });
    setCountHistory(false);
    expect(welcome()).toEqual({ at: 500, countHistory: false, fresh: false, skip: ["/s"] });
  });
});

describe("importAll", () => {
  it("adopts a new welcome and clears fresh and skip when none was saved", async () => {
    const { importAll, welcome } = await load();
    importAll();
    expect(welcome()).toMatchObject({ countHistory: true, fresh: false, skip: [] });
  });

  it("clears a saved welcome's fresh and skip without touching at or countHistory", async () => {
    const { saveWelcome, importAll, welcome } = await load();
    saveWelcome({ at: 100, countHistory: false, fresh: true, skip: ["/a", "/b"] });
    importAll();
    expect(welcome()).toEqual({ at: 100, countHistory: false, fresh: false, skip: [] });
  });
});
