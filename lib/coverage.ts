import fs from "node:fs";
import path from "node:path";

export type Coverage = { lines: number; statements: number; functions: number; branches: number };

type Metric = { pct?: number };
type Summary = { total?: Record<keyof Coverage, Metric> };

// Reads the json-summary report that `npm run coverage` writes. Null when there's no report yet.
export function readCoverage(root: string): Coverage | null {
  try {
    const file = path.join(root, "coverage", "coverage-summary.json");
    const total = (JSON.parse(fs.readFileSync(file, "utf8")) as Summary).total;
    if (!total) return null;
    const pct = (k: keyof Coverage) => (typeof total[k]?.pct === "number" ? total[k].pct! : 0);
    return { lines: pct("lines"), statements: pct("statements"), functions: pct("functions"), branches: pct("branches") };
  } catch {
    return null;
  }
}
