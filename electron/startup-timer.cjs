// Times every launch: main.cjs marks each startup phase, the board reports when its cards are on screen,
// and the run is saved to ~/.weft/startup.jsonl. A launch well over the usual time comes back `slow`
// with its slowest phase, so the board can say so (lib/use-startup-check.ts).
//   node electron/startup-timer.cjs            (prints the recent launches)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const KEEP = 50;
// Compared against the median of this many earlier launches; fewer than MIN_HISTORY gives no verdict.
const HISTORY = 10;
const MIN_HISTORY = 3;
// Slow means both 1.5x the usual time and at least 2s over it, so a fast board doesn't cry wolf.
const SLOW_RATIO = 1.5;
const SLOW_EXTRA_MS = 2000;

const LABELS = {
  ready: "Electron start",
  path: "login shell PATH",
  port: "freeing the port",
  server: "server start",
  page: "board page load",
  board: "board's first cards",
};

/** @typedef {{ at: string, version?: string, mode?: string, total: number, marks: Record<string, number> }} Run */
/** @typedef {{ name: string, label: string, ms: number }} Phase */
/** @typedef {{ total: number, usual: number | null, slow: boolean, slowest: Phase }} Verdict */

function defaultFile() {
  return path.join(process.env.THREADBOARD_DATA || path.join(os.homedir(), ".weft"), "startup.jsonl");
}

/** @param {string} file @returns {Run[]} */
function readRuns(file) {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Each phase's own length: the time from the previous mark to this one.
/** @param {Record<string, number>} marks @returns {Phase[]} */
function phases(marks) {
  let prev = 0;
  return Object.entries(marks).map(([name, at]) => {
    const phase = { name, label: LABELS[name] ?? name, ms: at - prev };
    prev = at;
    return phase;
  });
}

// How this run compares with earlier ones of the same mode (dev and packaged differ a lot).
/** @param {Run} run @param {Run[]} earlier @returns {Verdict} */
function judge(run, earlier) {
  const totals = earlier.filter((r) => r.mode === run.mode).slice(-HISTORY).map((r) => r.total);
  const slowest = phases(run.marks).reduce((a, b) => (b.ms > a.ms ? b : a), { ms: -1 });
  if (totals.length < MIN_HISTORY) return { total: run.total, usual: null, slow: false, slowest };
  const usual = median(totals);
  const slow = run.total > usual * SLOW_RATIO && run.total - usual >= SLOW_EXTRA_MS;
  return { total: run.total, usual, slow, slowest };
}

// now() is ms since the process started, so the first mark includes Electron's own start.
/**
 * @param {{ file?: string, now?: () => number, log?: (line: string) => void, version?: string, mode?: string }} [options]
 * @returns {{ mark(name: string): void, finish(): Verdict }}
 */
function createStartupTimer({ file = defaultFile(), now = () => Math.round(process.uptime() * 1000), log = console.log, version, mode } = {}) {
  const marks = {};
  let result;

  return {
    mark(name) {
      if (!result) marks[name] = now();
    },
    // Saves the run once (a reload of the board doesn't count again) and returns the verdict.
    finish() {
      if (result) return result;
      marks.board ??= now();
      const run = { at: new Date().toISOString(), version, mode, total: marks.board, marks };
      const earlier = readRuns(file);
      result = judge(run, earlier);
      log(`[weft] started in ${result.total}ms (usual ${result.usual ?? "?"}ms, slowest: ${result.slowest.label} ${result.slowest.ms}ms)`);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const lines = [...earlier, run].slice(-KEEP).map((r) => JSON.stringify(r));
        fs.writeFileSync(file, `${lines.join("\n")}\n`);
      } catch {}
      return result;
    },
  };
}

// One line per launch, newest last: total, then each phase.
/** @param {Run[]} runs */
function report(runs) {
  return runs
    .map((r) => {
      const parts = phases(r.marks).map((p) => `${p.name} ${(p.ms / 1000).toFixed(1)}s`);
      return `${r.at.slice(0, 16).replace("T", " ")}  ${r.mode.padEnd(8)} ${(r.total / 1000).toFixed(1).padStart(5)}s   ${parts.join(" · ")}`;
    })
    .join("\n");
}

module.exports = { createStartupTimer, judge, phases, median, report, readRuns };

if (require.main === module) {
  const runs = readRuns(defaultFile());
  console.log(runs.length ? report(runs.slice(-20)) : `No launches recorded yet in ${defaultFile()}.`);
}
