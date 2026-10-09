// Tells the Electron supervisor what kind of Next dev-server exit just happened. Next 16.4 added two
// failure modes the supervisor should not count toward the 3-in-2-min crash budget:
//   1. a peer dev server is already running in the project (PIDs survive across Weft sessions because
//      free-port.cjs only frees the *preferred* port). The log names the squatter's PID and port.
//   2. Turbopack cached a stale "Module not found" for a path that exists on disk. The fix is
//      `rm -rf .next` and retry, not a restart count.
// Both are recoverable; the supervisor (electron/server.cjs) calls these helpers, kills the squatter
// or wipes .next, and resets its crash counter.

import fs from "node:fs";
import path from "node:path";

export type DevServerError =
  | { kind: "peer"; pid: number; port: number }
  | { kind: "module-not-found"; spec: string; exists: boolean }
  | { kind: "other" };

// How much of the child's stderr/stdout to inspect. Next's error blocks are < 1 KB; 4 KB is a safe
// window that still spans ANSI/colour noise from a TTY-style child.
const TAIL_BYTES = 4 * 1024;

// Next 16.4 prints the squatter's URL *before* its PID, so the order is Local then PID.
const PEER_RE = /Another next dev server is already running\.[\s\S]*?- Local:\s+http:\/\/127\.0\.0\.1:(\d+)[\s\S]*?- PID:\s+(\d+)/;
// Two shapes: bare spec ("Can't resolve 'X'") and Turbopack's quoted form ("Can't resolve \"X\"").
// The `g` flag is required for `String.prototype.matchAll`.
const MISSING_RE = /Module not found: Can't resolve ['"]([^'"]+)['"]/g;

export function tailOf(buf: string): string {
  if (buf.length <= TAIL_BYTES) return buf;
  return buf.slice(buf.length - TAIL_BYTES);
}

// Returns the *last* matching error in the buffer, not the first — Next may print both a peer error
// and a stale module-not-found in the same boot; we act on whichever most recently hit the pipe.
// `repoRoot` is required to resolve relative specifiers for the `exists` flag.
export function parseDevServerError(buf: string, repoRoot: string): DevServerError {
  const tail = tailOf(buf);
  const peerMatch = tail.match(PEER_RE);
  if (peerMatch) {
    // Capture group 1 is the squatter's port, group 2 is its PID (see PEER_RE for the order).
    const port = Number(peerMatch[1]);
    const pid = Number(peerMatch[2]);
    if (Number.isFinite(pid) && Number.isFinite(port)) return { kind: "peer", pid, port };
  }
  // Walk all matches; the last one wins so a later missing-path supersedes an earlier one.
  const misses = [...tail.matchAll(MISSING_RE)];
  if (misses.length) {
    const spec = misses[misses.length - 1][1];
    const resolved = resolveSpec(spec, repoRoot);
    // `resolved` is a candidate path. The file actually existing is what makes the error
    // recoverable as cache rot; otherwise it's a real missing-file bug.
    return { kind: "module-not-found", spec, exists: resolved !== null && fs.existsSync(resolved) };
  }
  return { kind: "other" };
}

// When a relative spec has no extension, probe the same extensions TypeScript and Next look for.
// Order matches the usual resolution: .ts, .tsx, .js, .jsx, then a directory with index.*.
const RELATIVE_PROBES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

// Resolve `spec` against `repoRoot`. For relative/absolute/file:// specifiers, returns the first
// *file* that exists on disk across the usual TypeScript extensions; null if none match. A
// directory only counts if it contains an index.* file (a directory import is `./foo` →
// `./foo/index.ts`, not `./foo/`). For bare specifiers, returns the
// `node_modules/<name>/package.json` candidate unconditionally — the caller does the existence
// check, which is the meaningful "is this package actually installed" question.
export function resolveSpec(spec: string, repoRoot: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("file://")) {
    const rel = spec.startsWith("file://") ? new URL(spec).pathname : spec;
    const base = path.resolve(repoRoot, rel);
    for (const probe of RELATIVE_PROBES) {
      const candidate = `${base}${probe}`;
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // ENOENT, EACCES — try the next probe.
      }
    }
    return null;
  }
  return path.join(repoRoot, "node_modules", spec, "package.json");
}

// True iff we should not count this exit toward the 3-in-2-min crash budget. The parser already
// resolved the spec and populated `exists`, so this is a pure decision on the parsed shape.
export function isRecoverable(parsed: DevServerError): boolean {
  if (parsed.kind === "peer") return parsed.pid > 0;
  if (parsed.kind === "module-not-found") return parsed.exists;
  return false;
}
