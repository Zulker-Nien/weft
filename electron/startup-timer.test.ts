import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStartupTimer, judge, median, phases, readRuns, report } from "./startup-timer.cjs";

const dirs: string[] = [];
function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-startup-"));
  dirs.push(dir);
  return path.join(dir, "startup.jsonl");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// A clock that returns the given times in order.
function clock(...times: number[]) {
  return () => times.shift() ?? 0;
}

function run(total: number, mode = "dev") {
  return { at: "2026-10-11T01:00:00.000Z", version: "1", mode, total, marks: { ready: 100, board: total } };
}

describe("startup timer", () => {
  it("saves each phase and the total when the board is ready", () => {
    const file = tmpFile();
    const timer = createStartupTimer({ file, log: () => {}, now: clock(300, 1500, 4000, 6000), version: "0.1.0", mode: "dev" });
    timer.mark("ready");
    timer.mark("path");
    timer.mark("server");
    const result = timer.finish();
    const [saved] = readRuns(file);
    expect(saved!).toMatchObject({ version: "0.1.0", mode: "dev", total: 6000, marks: { ready: 300, path: 1500, server: 4000, board: 6000 } });
    expect(result).toEqual({ total: 6000, usual: null, slow: false, slowest: { name: "server", label: "server start", ms: 2500 } });
  });

  it("counts a launch once, even when the board reloads", () => {
    const file = tmpFile();
    const timer = createStartupTimer({ file, log: () => {}, now: clock(100, 200, 900) });
    timer.mark("ready");
    const first = timer.finish();
    timer.mark("late");
    expect(timer.finish()).toBe(first);
    expect(readRuns(file)).toHaveLength(1);
    expect(readRuns(file)[0]!.marks).toEqual({ ready: 100, board: 200 });
  });

  it("keeps only the last 50 launches", () => {
    const file = tmpFile();
    fs.writeFileSync(file, `${Array.from({ length: 50 }, (_, i) => JSON.stringify(run(i + 1))).join("\n")}\n`);
    createStartupTimer({ file, log: () => {}, now: clock(5), mode: "dev" }).finish();
    const runs = readRuns(file);
    expect(runs).toHaveLength(50);
    expect(runs[0]!.total).toBe(2);
    expect(runs[49]!.total).toBe(5);
  });

  it("still answers when the file can't be written", () => {
    const file = tmpFile();
    fs.mkdirSync(file); // a folder where the file should be
    const result = createStartupTimer({ file, log: () => {}, now: clock(10) }).finish();
    expect(result.total).toBe(10);
  });

  it("uses the process uptime by default", () => {
    const result = createStartupTimer({ file: tmpFile(), log: () => {} }).finish();
    expect(result.total).toBeGreaterThan(0);
  });
});

describe("judge", () => {
  const usualRuns = [run(3000), run(3200), run(2800)];

  it("gives no verdict until there are a few earlier launches", () => {
    expect(judge(run(20_000), usualRuns.slice(0, 2))).toMatchObject({ usual: null, slow: false });
  });

  it("calls a launch slow at 1.5x and 2s over the usual time", () => {
    expect(judge(run(5100), usualRuns)).toMatchObject({ usual: 3000, slow: true });
    expect(judge(run(4900), usualRuns)).toMatchObject({ slow: false });
  });

  it("doesn't call a fast board slow for a small absolute delay", () => {
    expect(judge(run(1900), [run(1000), run(1000), run(1000)])).toMatchObject({ usual: 1000, slow: false });
  });

  it("compares only with launches of the same mode", () => {
    const packaged = [run(1000, "packaged"), run(1000, "packaged"), run(1000, "packaged")];
    expect(judge(run(4000), [...packaged, ...usualRuns])).toMatchObject({ usual: 3000, slow: false });
    expect(judge(run(4000), packaged)).toMatchObject({ usual: null });
  });

  it("names the longest phase", () => {
    const r = { ...run(9000), marks: { ready: 500, path: 1700, server: 7000, board: 9000 } };
    expect(judge(r, []).slowest).toEqual({ name: "server", label: "server start", ms: 5300 });
  });
});

describe("helpers", () => {
  it("takes the median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(3);
  });

  it("splits marks into phases, with a fallback label", () => {
    expect(phases({ ready: 100, custom: 400 })).toEqual([
      { name: "ready", label: "Electron start", ms: 100 },
      { name: "custom", label: "custom", ms: 300 },
    ]);
  });

  it("reads nothing from a missing file", () => {
    expect(readRuns(path.join(os.tmpdir(), "weft-no-such-file.jsonl"))).toEqual([]);
  });

  it("reports one line per launch", () => {
    expect(report([run(3400)])).toBe("2026-10-11 01:00  dev        3.4s   ready 0.1s · board 3.3s");
  });
});
