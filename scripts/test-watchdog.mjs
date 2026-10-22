// An RSS watchdog for a whole-suite test run: it watches the vitest process tree's real resident memory and
// ends the run before it starves Weft.
//
// Why this exists instead of Vitest's own `vmMemoryLimit`: that option measures `heapUsed` (V8's managed heap)
// and only checks it after each test file finishes (node_modules/vitest .../cli-api*.js: `message.usedMemory`,
// gated on `testfileFinished`). So it cannot see the allocations that actually crashed us — RSC, turbopack's
// native buffers, mmap'd module graphs — and it cannot stop a single runaway file. It is also a no-op on
// `pool: "forks"`: `getMemoryLimit()` returns null unless the pool is `vmForks`/`vmThreads`.
//
// So: a full sweep runs, this polls `ps` for the whole descendant tree of the vitest process, and if RSS
// crosses the ceiling it sends SIGTERM to the run and reports. A scoped run (`pnpm test lib/x.test.ts`) is
// short and bounded; it is never watched, for the same reason it is never memory-gated.
//
// Usage: node scripts/test-watchdog.mjs --limit-mb <n> -- <command... [args]>
//   WEFT_TEST_MAX_RSS_MB (default 3072) overrides the ceiling.

import { execFile, spawn } from "node:child_process";

// How often to sample the tree. Two seconds is fine: RSS climbs over tens of seconds, not milliseconds.
const POLL_MS = 2000;

// Default ceiling for the whole tree. Weft's own processes (next-server, Electron main + renderers, the pane,
// the thread CLIs) hold 2-4 GB of a 16 GB box, so the sweep gets a bounded slice and the box stays out of swap.
export const DEFAULT_MAX_RSS_MB = Number(process.env.WEFT_TEST_MAX_RSS_MB) || 3072;

// `ps -o rss= -p <pid>` gives RSS in KiB. One pid at a time keeps this a single cheap call per poll.
export function parseRssKb(stdout) {
  const value = Number.parseInt(String(stdout).trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

// A child's pid list from `pgrep -P`, tolerant of pgrep's "no match" exit status.
function childPids(pid) {
  return new Promise((resolve) => {
    execFile("/usr/bin/pgrep", ["-P", String(pid)], (error, stdout) => {
      // exit 1 means no children, which is not a failure for us.
      if (error && error.code === 1) return resolve([]);
      if (error) return resolve([]);
      resolve(
        String(stdout)
          .split("\n")
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0),
      );
    });
  });
}

// Every descendant of `root`, breadth-first. A vitest run is the main process plus its fork workers, all
// direct children, but a grandchild costs nothing to include and protects against a nested spawn.
export async function treePids(root) {
  const seen = new Set([root]);
  let frontier = [root];
  while (frontier.length) {
    const children = (await Promise.all(frontier.map(childPids))).flat();
    const fresh = children.filter((pid) => !seen.has(pid));
    for (const pid of fresh) seen.add(pid);
    frontier = fresh;
  }
  return [...seen];
}

// RSS of one pid in KiB; 0 when the process is gone (or ps is unavailable), so a dead worker costs nothing.
export function rssKb(pid) {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-o", "rss=", "-p", String(pid)], (error, stdout) => {
      resolve(error ? 0 : parseRssKb(stdout));
    });
  });
}

// Total RSS of the tree, in MiB, plus how many processes contributed.
export async function treeRssMb(root) {
  const pids = await treePids(root);
  const values = await Promise.all(pids.map(rssKb));
  const totalKb = values.reduce((sum, kb) => sum + kb, 0);
  return { mb: Math.floor(totalKb / 1024), processes: pids.length };
}

// The watchdog loop: poll, and on the first breach SIGTERM the child and resolve. It also resolves on the
// child exiting on its own, so a fast run pays no more than one poll.
export function startWatchdog(child, limitMb) {
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };

  const timer = setInterval(async () => {
    if (stopped || child.exitCode !== null) return stop();
    try {
      const { mb, processes } = await treeRssMb(child.pid);
      if (mb >= limitMb) {
        stop();
        console.error(
          `[weft] the test run passed ${limitMb} MB of resident memory across ${processes} process(es); ` +
            `ending it so it can't take Weft down with it.\n` +
            `[weft] lower the ceiling with WEFT_TEST_MAX_RSS_MB, or run fewer files: pnpm test <file>`,
        );
        child.kill("SIGTERM");
      }
    } catch {
      // A failed sample (ps unavailable, a race with a dying worker) is not worth ending a run over.
    }
  }, POLL_MS);
  // Don't hold the event loop open just for the poll.
  if (typeof timer.unref === "function") timer.unref();

  child.once("exit", stop);
  return stop;
}

// `node scripts/test-watchdog.mjs --limit-mb 3072 -- pnpm test`
export function parseArgv(argv) {
  const dashdash = argv.indexOf("--");
  const head = dashdash === -1 ? argv : argv.slice(0, dashdash);
  const command = dashdash === -1 ? [] : argv.slice(dashdash + 1);
  let limitMb = DEFAULT_MAX_RSS_MB;
  const at = head.indexOf("--limit-mb");
  if (at !== -1 && head[at + 1]) limitMb = Number(head[at + 1]) || DEFAULT_MAX_RSS_MB;
  return { limitMb, command };
}

export function runWatched({ limitMb, command }) {
  const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, forward);
  startWatchdog(child, limitMb);
  return new Promise((resolve) => child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))));
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const parsed = parseArgv(process.argv.slice(2));
  if (!parsed.command.length) {
    console.error("usage: node scripts/test-watchdog.mjs [--limit-mb <n>] -- <command...>");
    process.exitCode = 2;
  } else {
    process.exitCode = await runWatched(parsed);
  }
}