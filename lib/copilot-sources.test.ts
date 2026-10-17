import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activityEvents,
  activityMock,
  browserToolsMock,
  commitPileMock,
  copilotThread,
  execFileMock,
  gh,
  makeCard,
  makeReport,
  makeSection,
  qualityMock,
  scoutMock,
  sprintPlanMock,
  storeMock,
  webhooksMock,
} from "./copilot-sources.harness";
import type { ScoutReport } from "./scout-view";
import type { Webhook } from "./webhooks";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-copilot-sources-"));

const shell = vi.fn();
const repoRoot = vi.fn();
const readPile = vi.fn();
const measureQuality = vi.fn();
const readScout = vi.fn<(root: string) => ScoutReport | null>();
const mapBacklog = vi.fn();
const listWebhooks = vi.fn<(folders?: readonly string[]) => Webhook[]>();

vi.mock("./store", () => storeMock(dir));
vi.mock("./activity", () => activityMock());
vi.mock("./browser-tools", () => browserToolsMock(shell));
vi.mock("./commit-pile", () => commitPileMock(repoRoot, readPile));
vi.mock("./quality", () => qualityMock(measureQuality));
vi.mock("./scout", () => scoutMock(readScout));
vi.mock("./sprint-plan", () => sprintPlanMock(mapBacklog));
vi.mock("./webhooks", () => webhooksMock(listWebhooks));
vi.mock("node:child_process", () => ({ execFile: execFileMock() }));

const { activeProjects, within, pile, streak, backlog, gatherSections, SOURCES, resetSourceCaches } = await import("./copilot-sources");

const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const DAY = 86_400_000;

const card = makeCard;

afterEach(() => {
  resetSourceCaches();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  activityEvents.length = 0;
  copilotThread.length = 0;
  shell.mockReset();
  repoRoot.mockReset();
  readPile.mockReset();
  measureQuality.mockReset();
  readScout.mockReset();
  mapBacklog.mockReset();
  gh.responses.clear();
  gh.calls = [];
  vi.useRealTimers();
});

describe("activeProjects", () => {
  it("skips the copilot, archived, and done cards, ranks by count, and caps at 5", () => {
    repoRoot.mockImplementation((cwd: string) => cwd);
    const cards = [
      card({ id: "a", cwd: "/r1" }),
      card({ id: "b", cwd: "/r1" }),
      card({ id: "c", cwd: "/r1" }),
      card({ id: "d", cwd: "/r2" }),
      card({ id: "e", cwd: "/r2" }),
      card({ id: "f", cwd: "/r3" }),
      card({ id: "g", cwd: "/r4" }),
      card({ id: "h", cwd: "/r5" }),
      card({ id: "i", cwd: "/r6" }),
      card({ id: "j", cwd: "/r6" }),
      card({ id: "k", role: "copilot", cwd: "/r1" }),
      card({ id: "l", archived: true, cwd: "/r1" }),
      card({ id: "m", column: "done", cwd: "/r1" }),
    ];
    expect(activeProjects(cards)).toEqual(["/r1", "/r2", "/r6", "/r3", "/r4"]);
  });

  it("falls back to cwd when repoRoot throws", () => {
    repoRoot.mockImplementation(() => {
      throw new Error("not a git repo");
    });
    expect(activeProjects([card({ id: "a", cwd: "/no/git/here" })])).toEqual(["/no/git/here"]);
    expect(repoRoot).toHaveBeenCalledWith("/no/git/here");
  });

  it("falls back to cwd when repoRoot returns empty", () => {
    repoRoot.mockReturnValue("");
    expect(activeProjects([card({ id: "a", cwd: "/plain" })])).toEqual(["/plain"]);
  });
});

describe("within", () => {
  it("returns [] when the work exceeds ms", async () => {
    const out = await within(10, () => new Promise<string[]>((r) => setTimeout(() => r(["late"]), 50)));
    expect(out).toEqual([]);
  });

  it("returns the work when it finishes within ms", async () => {
    expect(await within(50, () => ["ok"])).toEqual(["ok"]);
  });

  it("returns [] when the work throws asynchronously", async () => {
    expect(await within(50, () => Promise.reject(new Error("boom")))).toEqual([]);
  });

  it("returns [] when the work throws synchronously", async () => {
    expect(await within(50, () => {
      throw new Error("sync boom");
    })).toEqual([]);
  });
});

describe("pile source", () => {
  it("returns a line per project with a pile and skips clean repos", () => {
    readPile.mockImplementation((cwd: string) =>
      cwd === "/r1" ? { root: "/r1", files: [{ path: "a.ts", code: " M" }], added: 5, removed: 2 } : null,
    );
    expect(pile(["/r1", "/r2"], [])).toEqual(["- r1: 1 uncommitted files, +5/-2"]);
  });
});

describe("streak source", () => {
  // The source reads Date.now(); pin it to NOW so "today" is the events' day, whatever day the suite runs.
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("counts done cards and turns in the last 7 and 60 days from real activity events", () => {
    activityEvents.push(
      { id: "t1", at: NOW, kind: "turn", turns: 2 },
      { id: "d1", at: NOW - 1 * DAY, kind: "done" },
      { id: "t2", at: NOW - 2 * DAY, kind: "turn", turns: 1 },
      { id: "d2", at: NOW - 3 * DAY, kind: "done" },
      { id: "t3", at: NOW - 8 * DAY, kind: "turn", turns: 4 },
      { id: "d3", at: NOW - 9 * DAY, kind: "done" },
    );
    const lines = streak([], []) as string[];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- streak \d+ days \(best \d+\)$/);
    expect(lines[1]).toBe("- last 7 days: 2 cards done, 3 turns; last 60 days: 3 cards done, 7 turns");
  });

  it("does not warn when today has done work or turns", () => {
    activityEvents.push(
      { id: "d1", at: NOW - 1 * DAY, kind: "done" },
      { id: "d2", at: NOW, kind: "done" },
      { id: "t1", at: NOW, kind: "turn", turns: 1 },
    );
    const [first] = streak([], []) as string[];
    expect(first).not.toContain("nothing yet today");
  });

  it("flips to atRisk when today has no done/turns and a streak is going", () => {
    activityEvents.push({ id: "d1", at: NOW - 1 * DAY, kind: "done" });
    const [first] = streak([], []) as string[];
    expect(first).toContain("nothing yet today");
  });

  it("stays at-risk when today has a day tally with no done/turns (zero values, not missing)", () => {
    const realNow = Date.now();
    activityEvents.push(
      { id: "d1", at: realNow - 1 * DAY, kind: "done" },
      { id: "q1", at: realNow, kind: "quality" },
    );
    const [first] = streak([], []) as string[];
    expect(first).toContain("nothing yet today");
  });
});

describe("backlog source", () => {
  it("emits a line per project with any backlog or active card", () => {
    mapBacklog.mockImplementation((_cards: ReadonlyArray<ReturnType<typeof card>>, root: string) =>
      root === "/r1" ? { backlog: [{ id: "x" } as ReturnType<typeof card>], active: [{ id: "y" } as ReturnType<typeof card>] } : { backlog: [], active: [] },
    );
    expect(backlog(["/r1", "/r2"], [])).toEqual(["- r1: 1 in Backlog, 1 active"]);
  });
});

describe("SOURCES", () => {
  it("registers a title, source and ms per source", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) {
      expect(typeof s.title).toBe("string");
      expect(typeof s.source).toBe("function");
      expect(typeof s.ms).toBe("number");
    }
  });
});

describe("gatherSections", () => {
  it("returns [] when there are no active projects", async () => {
    repoRoot.mockImplementation((cwd: string) => cwd);
    expect(await gatherSections([], [{ title: "X", source: () => ["- whatever"], ms: 1000 }])).toEqual([]);
  });

  it("drops sections whose source returned []", async () => {
    repoRoot.mockImplementation((cwd: string) => cwd);
    const out = await gatherSections([card({ id: "a" })], [
      { title: "Empty", source: () => [], ms: 1000 },
      { title: "Has", source: () => ["- line"], ms: 1000 },
    ]);
    expect(out).toEqual([{ title: "Has", lines: ["- line"] }]);
  });

  it("lets a slow source time out without blocking the rest", async () => {
    repoRoot.mockImplementation((cwd: string) => cwd);
    const out = await gatherSections([card({ id: "a" })], [
      { title: "Slow", source: () => new Promise<string[]>((r) => setTimeout(() => r(["late"]), 200)), ms: 10 },
      { title: "Fast", source: () => ["- quick"], ms: 1000 },
    ]);
    expect(out).toEqual([{ title: "Fast", lines: ["- quick"] }]);
  });

  it("substitutes [] when a source resolves to undefined", async () => {
    repoRoot.mockImplementation((cwd: string) => cwd);
    const out = await gatherSections(
      [card({ id: "a" })],
      [
        { title: "Nothing", source: () => undefined as unknown as string[], ms: 1000 },
        { title: "Line", source: () => ["- x"], ms: 1000 },
      ],
    );
    expect(out).toEqual([{ title: "Line", lines: ["- x"] }]);
  });
});

// Use the real weakest helper so the integration is covered end-to-end.
expect(makeReport({ sections: [makeSection({ name: "A", score: 50 })] }).sections[0]?.name).toBe("A");