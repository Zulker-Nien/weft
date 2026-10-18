import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LimitSample } from "./limit-chart";

// ~/.weft/limits.jsonl: a sample per change in a CLI's 5-hour or weekly window, a week and a day kept.

let dir = "";
const DAY = 24 * 60 * 60 * 1000;

async function load() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftLimits;
  return import("./limit-history");
}

const file = () => path.join(dir, "limits.jsonl");
const lines = () => fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LimitSample);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-limits-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("recordLimits", () => {
  it("appends a sample per window that changed, and nothing for a repeat", async () => {
    const { recordLimits, readSamples } = await load();
    recordLimits("claude", { fiveHour: { used: 10, resetsAt: 600 }, sevenDay: { used: 3 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 10, resetsAt: 600 } }, 2000);
    recordLimits("claude", { fiveHour: { used: 12, resetsAt: 600 } }, 3000);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 600 } }, 4000);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 600.4 } }, 4500);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 599.7 } }, 4600);
    expect(lines()).toEqual([
      { at: 1000, backend: "claude", kind: "five_hour", used: 10, resetsAt: 600 },
      { at: 1000, backend: "claude", kind: "seven_day", used: 3 },
      { at: 3000, backend: "claude", kind: "five_hour", used: 12, resetsAt: 600 },
      { at: 4000, backend: "puku", kind: "five_hour", used: 12, resetsAt: 600 },
    ]);
    expect(readSamples(5000).map((s) => s.at)).toEqual([1000, 1000, 3000, 4000]);
  });

  it("picks up where the file left off after a restart", async () => {
    fs.writeFileSync(file(), JSON.stringify({ at: 1000, backend: "claude", kind: "seven_day", used: 40, resetsAt: 9 }) + "\n");
    const { recordLimits } = await load();
    recordLimits("claude", { sevenDay: { used: 40, resetsAt: 9 } }, 2000);
    expect(lines()).toHaveLength(1);
  });

  it("never throws when the folder can't be written", async () => {
    process.env.WEFT_DATA = path.join(dir, "file");
    fs.writeFileSync(path.join(dir, "file"), "");
    const { recordLimits } = await load();
    expect(() => recordLimits("claude", { fiveHour: { used: 1 } })).not.toThrow();
  });
});

describe("readSamples", () => {
  it("is empty without a file", async () => {
    const { readSamples } = await load();
    expect(readSamples()).toEqual([]);
  });

  it("skips bad lines, sorts, and drops what's older than a week and a day from the file", async () => {
    const now = 20 * DAY;
    const old = { at: now - 9 * DAY, backend: "claude", kind: "five_hour", used: 1 };
    const b = { at: now - DAY, backend: "claude", kind: "five_hour", used: 5 };
    const a = { at: now - 2 * DAY, backend: "claude", kind: "seven_day", used: 2 };
    fs.writeFileSync(file(), [old, b, "not json", JSON.stringify({ at: "x" }), a].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
    const { readSamples } = await load();
    expect(readSamples(now)).toEqual([a, b]);
    expect(lines()).toEqual([b, a]);
  });

  it("empties the file when nothing is kept", async () => {
    fs.writeFileSync(file(), JSON.stringify({ at: 0, backend: "claude", kind: "five_hour", used: 1 }) + "\n");
    const { readSamples } = await load();
    expect(readSamples(30 * DAY)).toEqual([]);
    expect(fs.readFileSync(file(), "utf8")).toBe("");
  });
});
