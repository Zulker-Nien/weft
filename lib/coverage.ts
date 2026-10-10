import fs from "node:fs";
import path from "node:path";

export type Coverage = { lines: number; statements: number; functions: number; branches: number };

// A project's coverage report: where it was found and when it was written.
export type CoverageReport = Coverage & { root: string; measuredAt: number };

type Metric = { pct?: number };
type Summary = { total?: Record<keyof Coverage, Metric> };

const SUMMARY = path.join("coverage", "coverage-summary.json");

// Reads the json-summary report that `npm run coverage` writes. Null when there's no report yet.
export function readCoverage(root: string): Coverage | null {
  try {
    const total = (JSON.parse(fs.readFileSync(path.join(root, SUMMARY), "utf8")) as Summary).total;
    if (!total) return null;
    const pct = (k: keyof Coverage) => (typeof total[k]?.pct === "number" ? total[k].pct! : 0);
    return { lines: pct("lines"), statements: pct("statements"), functions: pct("functions"), branches: pct("branches") };
  } catch {
    return null;
  }
}

// The report for the project a folder belongs to: the folder itself, or the nearest parent up to
// its git root, so a card working in a subfolder still finds the repo's report.
export function findCoverage(cwd: string): CoverageReport | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const coverage = readCoverage(dir);
    if (coverage) return { ...coverage, root: dir, measuredAt: fs.statSync(path.join(dir, SUMMARY)).mtimeMs };
    const parent = path.dirname(dir);
    if (parent === dir || fs.existsSync(path.join(dir, ".git"))) return null;
    dir = parent;
  }
}
