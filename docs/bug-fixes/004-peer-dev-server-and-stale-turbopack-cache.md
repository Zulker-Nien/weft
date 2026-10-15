# 004 — Peer `next dev` and stale Turbopack cache tripped the crash budget

- **Date:** 2026-10-10
- **Severity:** High (the desktop app is unusable without this fix)

## Symptom

Launching Weft from cold (or after a prior Weft session had been quit without the OS killing the inner `next dev`) showed the desktop crash screen with:

> The server stopped 4 times in two minutes.

The Next dev server's own log, right before each exit, contained:

```
⨯ Another next dev server is already running.
- Local: http://127.0.0.1:3456
- PID: 55338
```

PID 55338 was a `next-server` from a Weft session the user had quit hours earlier. Weft would start a fresh `next dev`, Next would refuse with the peer-guard error, the supervisor would count the exit, the next attempt would collide with the same squatter, and the 3-in-2-min budget would trip.

A quieter failure also showed up: Turbopack printed `Module not found: Can't resolve './search'` even though `lib/search.ts` was on disk. Same supervisor, same counter, same fatal screen — but the fix was `rm -rf .next`, not another restart.

## Root Cause

Two distinct gaps in the supervisor, both in `electron/server.cjs`:

1. **The harness only freed the *preferred* port.** `startServer` calls `freePort(preferredPort, ".next")` before spawning `next dev`. `freePort` uses `lsof -t -iTCP:<port> -sTCP:LISTEN`, so it kills whoever happens to be on the port Weft is about to claim. It has no way to find a `next-server` listening on a *different* port in the same project — and Next 16.4 added a project-wide dev-server guard that scans the project directory and refuses to start a second `next dev` regardless of port. A squatter on 3456 was invisible to a `freePort(3457, …)` call.
2. **The supervisor couldn't tell a recoverable exit from a real crash.** The old `child.on('exit')` counted every non-voluntary exit toward `crashes`:

```js
// electron/server.cjs — pre-fix
child.on('exit', (code, signal) => {
  if (stopping || proc !== child) return;
  crashes = [...crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
  if (crashes.length > MAX_RESTARTS) {
    const message = `The server stopped ${crashes.length} times in two minutes.`;
    if (ready) onFatal?.(message);
    else failStart(new Error(message));
    return;
  }
  setTimeout(launch, 500);
});
```

Both the peer-guard exit and the stale Turbopack cache produced the same signal: child exited, code non-zero, no other distinguishing output was being read. The supervisor had no way to act on the cause, only on the count.

## Why It Was Hard to Find

The crash screen blames the *current* session: "The server stopped N times in two minutes" reads as "this Weft just couldn't start." The squatter was a *previous* Weft session's `next dev` from hours or days ago, still alive because nothing killed it when the user quit the app. (Weft's `child_process.spawn`-then-leave pattern doesn't track the inner `next dev`'s grandchild `next-server` worker, so quitting the app only kills the launcher, not the worker.) The current session's logs only showed the new session's retries and Next's "Another next dev server is already running" message — but that message looked like a Next 16.4 weirdness, not like a fingerprint of an older Weft process. `lsof -iTCP:3457` from the new session showed nothing; the squatter was on 3456.

The Turbopack case was worse: it was indistinguishable from a real missing-file bug, so any "fix" attempt would have been to create the file. (The file already existed.)

## The Fix

A pure parser that classifies a child exit (`lib/dev-server.ts`, 17 unit tests) and a wired-up `child.on('exit')` that acts on the classification. The parser is the contract; the supervisor is the actuator.

```ts
// lib/dev-server.ts
export type DevServerError =
  | { kind: "peer"; pid: number; port: number }
  | { kind: "module-not-found"; spec: string; exists: boolean }
  | { kind: "other" };

export function parseDevServerError(buf: string, repoRoot: string): DevServerError {
  const tail = tailOf(buf);
  const peerMatch = tail.match(PEER_RE);
  if (peerMatch) {
    const port = Number(peerMatch[1]);
    const pid = Number(peerMatch[2]);
    if (Number.isFinite(pid) && Number.isFinite(port)) return { kind: "peer", pid, port };
  }
  const misses = [...tail.matchAll(MISSING_RE)];
  if (misses.length) {
    const spec = misses[misses.length - 1][1];
    const resolved = resolveSpec(spec, repoRoot);
    return { kind: "module-not-found", spec, exists: resolved !== null && fs.existsSync(resolved) };
  }
  return { kind: "other" };
}

export function isRecoverable(parsed: DevServerError): boolean {
  if (parsed.kind === "peer") return parsed.pid > 0;
  if (parsed.kind === "module-not-found") return parsed.exists;
  return false;
}
```

The supervisor reads the tail of the child's log, classifies it, and only counts toward `crashes` when the cause is `other` (or `module-not-found` for a spec that genuinely doesn't exist):

```js
// electron/server.cjs — post-fix, in startServer().child.on('exit')
const classified = classifyTail(readTail(logPath));
if (classified?.kind === "peer") {
  log.write(`--- weft: killing peer dev server pid ${classified.pid} (port ${classified.port})\n`);
  killPid(classified.pid);
  crashes = [];
  onStatus?.("Restarting…");
  setTimeout(launch, RECOVER_GRACE_MS);
  return;
}
if (classified?.kind === "module-not-found" && classified.exists) {
  const dist = process.env.THREADBOARD_DIST || ".next";
  const distPath = path.join(ROOT, dist);
  log.write(`--- weft: stale module resolution for "${classified.spec}"; removing ${dist} and retrying\n`);
  try { fs.rmSync(distPath, { recursive: true, force: true }); } catch {}
  crashes = [];
  onStatus?.("Restarting…");
  setTimeout(launch, RECOVER_GRACE_MS);
  return;
}
const now = Date.now();
crashes = [...crashes.filter((t) => now - t < RESTART_WINDOW_MS), now];
if (crashes.length > MAX_RESTARTS) { ... }
```

Defense in depth: the dev port is now **1000 everywhere**. `package.json` (`scripts.dev`) and `electron/main.cjs` (`PREFERRED_PORT` default) both use 1000; previously `pnpm dev` used 3456 and the Electron app used 3457, so two dev servers in the same project on different ports were trivially easy to start (and for the project-wide guard to squash). With one port, the run script's `node electron/free-port.cjs 1000 .next` and the Electron app's own `freePort` call agree on the same target.

**Verified:** with a stale `next-server` left over from a previous Weft session, a fresh launch reads the log, kills the squatter (`SIGTERM`), restarts once, and the board comes up. A `rm -rf .next && pnpm dev` is no longer needed for the Turbopack cache case; the supervisor wipes `.next` itself on the next retry.

## Key Rule

A supervisor that counts every exit toward a crash budget must first check whether the exit is a known-recoverable cause; only count it if it isn't. "Known-recoverable" means a parser can name the cause from the child's own output — peer-guard, stale cache, port-already-bound — and the parser's test suite is what proves the matchers are tight enough not to false-positive on real crashes.

And: **one port per project, enforced by the run script.** Two dev servers in one project on two ports is the exact condition the Next 16.4 project-wide guard exists to prevent; the fix is to never give the guard a reason to fire.

## Files Involved

- `lib/dev-server.ts` (created — pure parser, contract for the supervisor)
- `lib/dev-server.test.ts` (created — 17 cases over `parseDevServerError`, `resolveSpec`, and `isRecoverable`)
- `electron/server.cjs` (modified — `startServer` `child.on('exit')` now classifies, kills the peer or wipes `.next`, and clears the crash counter)
- `electron/main.cjs` (modified — `PREFERRED_PORT` default is now 1000)
- `package.json` (modified — `scripts.dev` is now `node electron/free-port.cjs 1000 .next && next dev -H 127.0.0.1 -p 1000`)
- `docs/architecture/desktop-shell.md` (updated — describes the supervisor's recoverable-cause handling and the unified dev port)
