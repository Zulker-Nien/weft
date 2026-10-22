# 027 — the test suite's memory cap was a no-op, so a sweep took Weft down

- **Date:** 2026-10-22
- **Severity:** high — a routine `pnpm test` could kill the running app

## Symptom

Running the whole Vitest suite twice pushed the Mac into swap and Weft died with it: the board's
`next dev` was killed by the OS under memory pressure and the Electron window went with it. A
thread trying to verify a change had to restart the app, which cut off every other running card.

The first response (`f9140cf`) added three guards: `maxWorkers: 2`, a per-worker
`--max-old-space-size=768`, and a pre-flight gate refusing a sweep on a memory-starved box. **The
suite still crashed Weft.** Those guards had a hole.

## Root cause

The per-worker cap relied on Vitest's `vmMemoryLimit`, which does not apply here — for three
independent reasons, any one of which is fatal:

```js
// node_modules/vitest/dist/chunks/cli-api.*.js
function getMemoryLimit(config, pool) {
    if (pool !== "vmForks" && pool !== "vmThreads") return null;   // we set pool: "forks"
    const limit = getWorkerMemoryLimit(config);
    return stringToBytes(limit, config.watch ? memory / 2 : memory);
}
```

1. **Wrong pool.** On `pool: "forks"` this returns `null` before the configured value is ever read.
2. **Wrong unit.** Even on a vm pool, `vmMemoryLimit: 768` parses as **768 bytes**, not megabytes.
   `stringToBytes` only scales a suffixed string like `"768MB"`.
3. **Wrong signal.** It reports `memoryUsage().heapUsed` — V8's managed heap — and only compares it
   on a `testfileFinished` message, i.e. *after* a whole file completes. So it cannot observe the
   allocations that actually killed us (RSC, turbopack's native buffers, mmap'd module graphs — the
   same off-heap growth the heap snapshots found in `next dev`), and it cannot interrupt a single
   runaway file.

The one ceiling that was real, `execArgv: ["--max-old-space-size=768"]`, bounds V8's old space and
nothing else. It never bounded RSS.

## Fix

`scripts/test-watchdog.mjs`: an external watcher that measures what actually fills the box.

```js
// every 2s
const pids = await treePids(child.pid);      // pgrep -P, breadth-first, includes the root
const mb   = await treeRssMb(child.pid);      // sum of ps -o rss=, in MiB
if (mb >= limitMb) { child.kill("SIGTERM"); }
```

It is attached by `runHolding(name, command, { args, watchdog })` in `scripts/one-at-a-time.mjs`,
which already owned the spawn, so it polls the real vitest pid and every fork worker under it. The
ceiling is 3072 MB, overridable with `WEFT_TEST_MAX_RSS_MB`, bypassable with `--no-watchdog`. A run
of named files is never watched, the same way it is never memory-gated: it is short and bounded.

`vmMemoryLimit` is removed from `vitest.config.ts` rather than corrected. A correct value would
still only see `heapUsed` after each file, which is not the problem worth solving, and leaving a
no-op in the config invited the next reader to trust it.

## Key rule

**`pool: "forks"` makes Vitest's `vmMemoryLimit` a no-op, and it measures V8's heap, never RSS.**
To cap a test run's real memory, watch the process tree's RSS from outside.

## Files

- `scripts/test-watchdog.mjs` (new) — the watcher
- `scripts/test-watchdog.test.mjs` (new) — 11 tests, incl. a live allocator killed at the ceiling
- `scripts/one-at-a-time.mjs` — `runHolding` takes `watchdog`
- `scripts/run-tests.mjs` — wires it for whole-suite runs
- `vitest.config.ts` — drops `vmMemoryLimit`, corrects the comment
- `SOUL.md` — the convention note