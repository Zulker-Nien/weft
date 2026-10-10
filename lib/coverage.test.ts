import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCoverage, readCoverage } from "./coverage";

let outer: string;
let repo: string;

function writeSummary(dir: string, lines: number) {
  fs.mkdirSync(path.join(dir, "coverage"), { recursive: true });
  const m = (pct: number) => ({ pct });
  const total = { lines: m(lines), statements: m(40), functions: m(30), branches: m(20) };
  fs.writeFileSync(path.join(dir, "coverage", "coverage-summary.json"), JSON.stringify({ total }));
}

beforeEach(() => {
  outer = fs.mkdtempSync(path.join(os.tmpdir(), "weft-cov-"));
  repo = path.join(outer, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
});

afterEach(() => fs.rmSync(outer, { recursive: true, force: true }));

describe("readCoverage", () => {
  it("reads the totals, and is null without a report", () => {
    expect(readCoverage(repo)).toBeNull();
    writeSummary(repo, 49);
    expect(readCoverage(repo)).toEqual({ lines: 49, statements: 40, functions: 30, branches: 20 });
  });
});

describe("findCoverage", () => {
  it("finds the repo's report from a subfolder, with its root and time", () => {
    writeSummary(repo, 49);
    const found = findCoverage(path.join(repo, "src", "deep"));
    expect(found).toMatchObject({ lines: 49, root: repo });
    expect(found?.measuredAt).toBeGreaterThan(0);
  });

  it("prefers the nearest report", () => {
    writeSummary(repo, 49);
    writeSummary(path.join(repo, "src"), 90);
    expect(findCoverage(path.join(repo, "src", "deep"))?.lines).toBe(90);
  });

  it("stops at the git root", () => {
    writeSummary(outer, 10);
    expect(findCoverage(path.join(repo, "src"))).toBeNull();
  });
});

describe("readCoverage with odd reports", () => {
  const write = (body: string) => {
    fs.mkdirSync(path.join(repo, "coverage"), { recursive: true });
    fs.writeFileSync(path.join(repo, "coverage", "coverage-summary.json"), body);
  };

  it("is null for a report with no totals or one that isn't JSON", () => {
    write(JSON.stringify({ "/a.ts": {} }));
    expect(readCoverage(repo)).toBeNull();
    write("{ not json");
    expect(readCoverage(repo)).toBeNull();
  });

  it("reads a missing or non-numeric metric as 0", () => {
    write(JSON.stringify({ total: { lines: { pct: 80 }, statements: { pct: "Unknown" }, functions: {} } }));
    expect(readCoverage(repo)).toEqual({ lines: 80, statements: 0, functions: 0, branches: 0 });
  });
});
