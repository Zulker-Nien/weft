import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activityMock,
  browserToolsMock,
  commitPileMock,
  copilotThread,
  execFileMock,
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-copilot-sources-meta-"));

const shell = vi.fn();
const measureQuality = vi.fn();
const readScout = vi.fn<(root: string) => ScoutReport | null>();
const listWebhooks = vi.fn<(folders?: readonly string[]) => Webhook[]>();

vi.mock("./store", () => storeMock(dir));
vi.mock("./activity", () => activityMock());
vi.mock("./browser-tools", () => browserToolsMock(shell));
vi.mock("./commit-pile", () => commitPileMock(vi.fn(), vi.fn()));
vi.mock("./quality", () => qualityMock(measureQuality));
vi.mock("./scout", () => scoutMock(readScout));
vi.mock("./sprint-plan", () => sprintPlanMock(vi.fn()));
vi.mock("./webhooks", () => webhooksMock(listWebhooks));
vi.mock("node:child_process", () => ({ execFile: execFileMock() }));

// weakest is the real one (pure, no I/O); everything else is mocked above.
const { weakest } = await import("./quality-view");

const { quality, blanks, history, readClicks, recordClick, analytics, dependencies, analyticsTools, resetSourceCaches } = await import("./copilot-sources");

// A short refactor finding: tests usually only need file, line, smell, fix.
const F = (id: string, file: string, smell: string, fix: string, line = 1) => ({ id, file, line, smell, category: "refactor" as const, severity: "medium" as const, fix });

afterEach(() => {
  resetSourceCaches();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  copilotThread.length = 0;
  shell.mockReset();
  measureQuality.mockReset();
  readScout.mockReset();
  listWebhooks.mockReset();
  vi.useRealTimers();
});

describe("quality source", () => {
  it("prints the score and the two weakest sections, and refactor scout findings not yet started", () => {
    measureQuality.mockReturnValue(
      makeReport({
        score: 72,
        sections: [
          makeSection({ name: "Tests", score: 60 }),
          makeSection({ name: "File size", score: 30 }),
          makeSection({ name: "Lint", score: 90 }),
          makeSection({ name: "Type safety", score: null }),
        ],
      }),
    );
    readScout.mockReturnValue({
      root: "/q1", commit: "abc", ranAt: 0, started: [],
      findings: [F("a.ts:1:Long Function", "src/a.ts", "Long Function", "Extract x()", 10), F("b.ts:2:Duplicated Code", "src/b.ts", "Duplicated Code", "Pull out helper", 20), F("c.ts:3:Feature Envy", "src/c.ts", "Feature Envy", "Move method")],
    });
    const lines = quality(["/q1"], []) as string[];
    expect(lines[0]).toBe("- q1: code quality 72%, weakest: File size 30%, Tests 60%");
    expect(lines.slice(1)).toEqual([
      "  refactor scout: a.ts:10 Long Function: Extract x()",
      "  refactor scout: b.ts:20 Duplicated Code: Pull out helper",
      "  refactor scout: c.ts:1 Feature Envy: Move method",
    ]);
  });

  it("caches the report text but still re-reads the scout", () => {
    measureQuality.mockReturnValue(makeReport({ score: 80, sections: [] }));
    readScout.mockReturnValue(null);
    expect(quality(["/q2"], [])).toEqual(["- q2: code quality 80%"]);
    measureQuality.mockReturnValue(makeReport({ score: 99, sections: [] }));
    expect(quality(["/q2"], [])).toEqual(["- q2: code quality 80%"]);
  });

  it("skips the weakest tail when every section scores 100 or doesn't apply", () => {
    measureQuality.mockReturnValue(makeReport({ score: 100, sections: [makeSection({ name: "Tests", score: 100 }), makeSection({ name: "Type safety", score: null })] }));
    readScout.mockReturnValue(null);
    expect(quality(["/q3"], [])).toEqual(["- q3: code quality 100%"]);
  });

  it("truncates scout findings to the first 3 not-yet-started ones", () => {
    measureQuality.mockReturnValue(makeReport({ score: 70, sections: [] }));
    readScout.mockReturnValue({ root: "/q4", commit: null, ranAt: 0, started: ["b:2:B", "c:3:C"], findings: [F("a:1:A", "a.ts", "A", "Fix A"), F("b:2:B", "b.ts", "B", "Fix B"), F("c:3:C", "c.ts", "C", "Fix C"), F("d:4:D", "d.ts", "D", "Fix D")] });
    expect(quality(["/q4"], [])).toEqual(["- q4: code quality 70%", "  refactor scout: a.ts:1 A: Fix A", "  refactor scout: d.ts:1 D: Fix D"]);
  });

  it("omits the line number when the finding has no line", () => {
    measureQuality.mockReturnValue(makeReport({ score: 70, sections: [] }));
    readScout.mockReturnValue({ root: "/q5", commit: null, ranAt: 0, started: [], findings: [F("a:0:A", "a.ts", "A", "Fix A", 0)] });
    expect(quality(["/q5"], [])).toEqual(["- q5: code quality 70%", "  refactor scout: a.ts A: Fix A"]);
  });

  it("returns [] for a project whose measureQuality throws while others still print", () => {
    measureQuality.mockImplementation((root: string) => {
      if (root === "/bad") throw new Error("can't measure");
      return makeReport({ root, score: 50, sections: [] });
    });
    readScout.mockReturnValue(null);
    expect(quality(["/ok", "/bad", "/also-ok"], []) as string[]).toEqual(["- ok: code quality 50%", "- also-ok: code quality 50%"]);
  });
});

describe("blanks source", () => {
  it("lists missing vault secrets and unregistered webhooks", async () => {
    shell.mockResolvedValueOnce({ secrets: [{ name: "GH_TOKEN", missing: true }, { name: "OK", missing: false }] });
    shell.mockResolvedValueOnce({ secrets: [] });
    listWebhooks.mockReturnValue([
      { id: "w1", folder: "/r1", name: "stripe", target: "http://localhost:3000/api/stripe/webhook", createdAt: 0, updatedAt: 0, registered: true },
      { id: "w2", folder: "/r2", name: "github", target: "http://localhost:3000/api/github/webhook", hint: "GitHub → Settings → Webhooks", createdAt: 0, updatedAt: 0 },
    ]);
    const lines = await blanks(["/r1", "/r2"], []);
    expect(lines).toContain("- r1: vault blanks to fill in: GH_TOKEN");
    expect(lines).toContain('- r2: webhook "github" (http://localhost:3000/api/github/webhook) not registered yet, at GitHub → Settings → Webhooks');
  });

  it("limits listed missing secrets to the first 5", async () => {
    shell.mockResolvedValueOnce({ secrets: ["A", "B", "C", "D", "E", "F", "G"].map((n) => ({ name: n, missing: true })) });
    listWebhooks.mockReturnValue([]);
    expect((await blanks(["/r1"], []))[0]).toBe("- r1: vault blanks to fill in: A, B, C, D, E");
  });

  it("skips projects whose secrets response is empty and webhooks without a hint", async () => {
    shell.mockResolvedValueOnce({});
    listWebhooks.mockReturnValue([{ id: "w3", folder: "/r3", name: "plain", target: "http://localhost:3000/api/plain", createdAt: 0, updatedAt: 0 }]);
    expect(await blanks(["/r1"], [])).toEqual(['- r3: webhook "plain" (http://localhost:3000/api/plain) not registered yet']);
  });
});

describe("history source", () => {
  it("returns the last 6 user messages and the last 8 clicks", () => {
    copilotThread.push(
      { kind: "user", text: "first question", at: 0 },
      { kind: "assistant", text: "answer", at: 1 },
      { kind: "user", text: "second question with\nmore", at: 2 },
    );
    const file = path.join(dir, "copilot-chips.jsonl");
    fs.writeFileSync(file, ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((t) => JSON.stringify({ text: t, at: 0 })).join("\n") + "\n");
    const asked = history([], []) as string[];
    const askedLines = asked.filter((l) => l.startsWith("- you asked:"));
    const clickedLines = asked.filter((l) => l.startsWith("- you clicked:"));
    expect(askedLines).toEqual(["- you asked: first question", "- you asked: second question with"]);
    expect(clickedLines.map((l) => l.replace("- you clicked: ", ""))).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
  });
});

describe("analytics source", () => {
  it("lists the analytics libraries it finds in package.json", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-analytics-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "posthog-js": "^1.0.0", next: "^14.0.0" } }));
        expect(analytics([root], [])).toEqual([`- ${path.basename(root)}: analytics PostHog`]);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("falls back to the gtag file when there are no dependencies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-analytics-gtag-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({}));
      fs.mkdirSync(path.join(root, "components"), { recursive: true });
      fs.writeFileSync(path.join(root, "components", "GoogleAnalytics.tsx"), "export const GA = 1;");
        expect(analytics([root], [])).toEqual([`- ${path.basename(root)}: analytics GA4 (gtag in the page, no server API)`]);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("returns [] when there are no analytics and no gtag file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-analytics-none-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({}));
        expect(analytics([root], [])).toEqual([`- ${path.basename(root)}: analytics none set up`]);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("returns [] when package.json can't be read or parsed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-analytics-bad-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), "not json");
        expect(analytics([root], [])).toEqual([]);
        expect(analytics([path.join(os.tmpdir(), "weft-no-such-folder-xyz")], [])).toEqual([]);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("dependencies", () => {
  it("returns null without a package.json", () => {
    expect(dependencies(path.join(os.tmpdir(), "weft-deps-missing-xyz"))).toBeNull();
  });

  it("returns the merged dependencies and devDependencies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-deps-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "^14.0.0" }, devDependencies: { vitest: "^1.0.0" } }));
      expect(dependencies(root)).toEqual({ next: "^14.0.0", vitest: "^1.0.0" });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("returns null when package.json isn't valid JSON", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-deps-bad-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), "not json");
      expect(dependencies(root)).toBeNull();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("analyticsTools", () => {
  it("returns null without a package.json", () => {
    expect(analyticsTools(path.join(os.tmpdir(), "weft-tools-missing-xyz"))).toBeNull();
  });

  it("returns [] when there are no analytics dependencies and no gtag file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tools-empty-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "^14.0.0" } }));
      expect(analyticsTools(root)).toEqual([]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("returns the list of analytics tools from the dependencies", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tools-list-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "posthog-js": "^1.0.0", "mixpanel-browser": "^2.0.0", next: "^14.0.0" } }));
      expect(analyticsTools(root)).toEqual(["PostHog", "Mixpanel"]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("deduplicates tools that come from more than one dependency", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-tools-dedup-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { "posthog-js": "^1.0.0", "posthog-node": "^1.0.0" } }));
      expect(analyticsTools(root)).toEqual(["PostHog"]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe("readClicks and recordClick", () => {
  it("reads clicks from the file", () => {
    const file = path.join(dir, "clicks.jsonl");
    fs.writeFileSync(file, JSON.stringify({ text: "first", at: 0 }) + "\n" + JSON.stringify({ text: "second", at: 1 }) + "\n");
    expect(readClicks(file)).toEqual(["first", "second"]);
  });

  it("returns [] when the file is missing or unparseable", () => {
    expect(readClicks(path.join(dir, "missing.jsonl"))).toEqual([]);
    const bad = path.join(dir, "bad.jsonl");
    fs.writeFileSync(bad, "not json\n");
    expect(readClicks(bad)).toEqual([]);
  });

  it("records a click and caps the file at MAX_CLICKS entries", () => {
    const file = path.join(dir, "rec.jsonl");
    // 200 entries already on disk; adding one rolls the oldest off.
    const seed = Array.from({ length: 200 }, (_, i) => JSON.stringify({ text: `t${i}`, at: 0 }));
    fs.writeFileSync(file, seed.join("\n") + "\n");
    recordClick("new", file);
    const kept = readClicks(file);
    expect(kept.length).toBe(200);
    expect(kept[0]).toBe("t1");
    expect(kept.at(-1)).toBe("new");
  });
});

// Use the real weakest helper so the integration is covered end-to-end.
expect(weakest(makeReport({ sections: [makeSection({ name: "A", score: 50 })] }))[0]?.name).toBe("A");
