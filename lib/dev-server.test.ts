import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRecoverable, parseDevServerError, resolveSpec } from "./dev-server";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-devserver-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const PEER_FIXTURE = `--- starting: next dev -p 3457
▲ Next.js 16.4.0 (Turbopack)
- Local:         http://127.0.0.1:3457
✓ Ready in 191ms
⨯ Another next dev server is already running.

- Local:        http://127.0.0.1:3456
- PID:          55338
- Dir:          /Users/fotoflo/dev/weft
- Log:          .next/dev/logs/next-development.log

You can access the existing server at http://127.0.0.1:3456,
or run kill 55338 to stop it and start a new one.
--- server exited (code 1, signal null)`;

const MISSING_FIXTURE = `[browser] ./lib/copilot.ts:3:1
Error: Module not found: Can't resolve './search'
  1 | import os from "node:os";
  2 | import { startSessionSync } from "./import";
> 3 | import { startSearchIndex } from "./search";
    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  4 | import { endSession, ensureSpare, warmUp } from "./runner";
https://nextjs.org/docs/messages/module-not-found
--- server exited (code 1, signal null)`;

describe("parseDevServerError", () => {
  it("extracts PID and port from the 'Another next dev server' message", () => {
    // Debug aid: if the regex misses, the throw below prints the surrounding fixture so a Next
    // version that changes the message format fails loudly with diagnostic output, not a silent
    // misclassify. Remove once the message shape is stable.
    const parsed = parseDevServerError(PEER_FIXTURE, root);
    if (parsed.kind !== "peer") {
      const idx = PEER_FIXTURE.indexOf("Another next dev server");
      throw new Error(
        `PEER_RE did not match. Fixture snippet:\n${PEER_FIXTURE.slice(Math.max(0, idx - 20), idx + 240)}`,
      );
    }
    expect(parsed).toEqual({ kind: "peer", pid: 55338, port: 3456 });
    expect(isRecoverable(parsed)).toBe(true);
  });

  it("extracts a relative spec and marks it existing when the file is on disk", () => {
    fs.writeFileSync(path.join(root, "search.ts"), "export const x = 1;\n");
    const parsed = parseDevServerError(MISSING_FIXTURE, root);
    expect(parsed.kind).toBe("module-not-found");
    if (parsed.kind !== "module-not-found") throw new Error("type guard");
    expect(parsed.spec).toBe("./search");
    expect(parsed.exists).toBe(true);
    expect(isRecoverable(parsed)).toBe(true);
  });

  it("marks a missing relative spec as not-existing so a real bug isn't swallowed", () => {
    // No file on disk; cache-rot theory doesn't apply.
    const parsed = parseDevServerError(MISSING_FIXTURE, root);
    expect(parsed.kind).toBe("module-not-found");
    if (parsed.kind !== "module-not-found") throw new Error("type guard");
    expect(parsed.exists).toBe(false);
    expect(isRecoverable(parsed)).toBe(false);
  });

  it("reports a bare package spec as existing when the package is installed", () => {
    // Bare specifiers resolve to node_modules/<name>/package.json; the parser only knows
    // about cache rot for relative paths, so the caller decides whether a bare-spec "Module
    // not found" is recoverable.
    const pkg = path.join(root, "node_modules", "zod", "package.json");
    fs.mkdirSync(path.dirname(pkg), { recursive: true });
    fs.writeFileSync(pkg, "{}");
    const fixture = `Error: Module not found: Can't resolve 'zod'\n--- server exited`;
    const parsed = parseDevServerError(fixture, root);
    expect(parsed.kind).toBe("module-not-found");
    if (parsed.kind !== "module-not-found") throw new Error("type guard");
    expect(parsed.exists).toBe(true);
  });

  it("returns 'other' for unrelated output", () => {
    const parsed = parseDevServerError("GET /api/cards 200 in 5ms\n--- server exited (code 0)\n", root);
    expect(parsed.kind).toBe("other");
    expect(isRecoverable(parsed)).toBe(false);
  });

  it("finds a match that spans the 4 KB tail window", () => {
    const pad = "x".repeat(8 * 1024);
    const fixture = `${pad}\n${PEER_FIXTURE}`;
    const parsed = parseDevServerError(fixture, root);
    expect(parsed.kind).toBe("peer");
    if (parsed.kind !== "peer") throw new Error("type guard");
    expect(parsed.pid).toBe(55338);
  });

  it("returns the *last* module-not-found when there are several in the buffer", () => {
    const fixture = `Module not found: Can't resolve './a'
Module not found: Can't resolve './b'
Module not found: Can't resolve './c'
--- server exited`;
    const parsed = parseDevServerError(fixture, root);
    expect(parsed.kind).toBe("module-not-found");
    if (parsed.kind !== "module-not-found") throw new Error("type guard");
    expect(parsed.spec).toBe("./c");
  });

  it("falls back to 'other' when a peer block lacks a PID line", () => {
    // An older Next version may not print the PID. Don't misclassify as 'peer'.
    const fixture = `⨯ Another next dev server is already running.
--- server exited`;
    const parsed = parseDevServerError(fixture, root);
    expect(parsed.kind).toBe("other");
  });

  it("returns 'oom' for v8's 'JavaScript heap out of memory' (recoverable)", () => {
    const parsed = parseDevServerError(
      "<- - aborting\n<--- Last few GCs --->\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n",
      root,
    );
    expect(parsed.kind).toBe("oom");
    if (parsed.kind !== "oom") throw new Error("type guard");
    expect(parsed.message).toContain("JavaScript heap out of memory");
    expect(isRecoverable(parsed)).toBe(true);
  });

  it("an OOM in the same boot as a module-not-found wins, because v8 aborts right after the heap message", () => {
    const fixture = `Module not found: Can't resolve './a'
FATAL ERROR: Allocation failed - JavaScript heap out of memory
--- server exited`;
    const parsed = parseDevServerError(fixture, root);
    expect(parsed.kind).toBe("oom");
  });
});

describe("server.cjs duplicate-parser contract", () => {
  // electron/server.cjs inlines a copy of these regexes and the resolveSpec probe list so the
  // main process doesn't need a TS loader. This test guards against silent drift: if either
  // side changes a regex or probe, both must change in lockstep. Keep this test in sync with
  // server.cjs's `classifyTail` + `resolveSpec`.
  // Resolve from the test file's location rather than the temp `root`, which is a fresh
  // mkdtempSync that has no `../electron` parent.
  const serverCjs = fs.readFileSync(path.resolve(__dirname, "..", "electron", "server.cjs"), "utf8");

  it("server.cjs carries the same PEER_RE as the parser", () => {
    // The regex string in server.cjs is the canonical source for the inline copy; check for the
    // distinguishing fragments rather than the full string (regex escape characters differ).
    expect(serverCjs).toContain("Another next dev server is already running");
    expect(serverCjs).toContain("Local:");
    expect(serverCjs).toContain("127.0.0.1");
    expect(serverCjs).toContain("PID:");
  });

  it("server.cjs carries the same MISSING_RE (with the `g` flag for matchAll)", () => {
    expect(serverCjs).toContain("Module not found: Can't resolve");
    // matchAll needs the global flag; the cjs file must have it too.
    expect(serverCjs).toMatch(/MISSING_RE\s*=\s*\/[^\n]*\/g/);
  });

  it("server.cjs keeps the same relative-spec probe list", () => {
    expect(serverCjs).toContain('RELATIVE_PROBES = ["", ".ts", ".tsx", ".js", ".jsx",');
  });

  it("server.cjs carries the same OOM_RE as the parser", () => {
    expect(serverCjs).toContain("OOM_RE");
    expect(serverCjs).toContain("JavaScript heap out of memory");
  });
});

describe("resolveSpec", () => {
  it("returns the existing .ts file for a relative spec with no extension", () => {
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib", "foo.ts"), "");
    const out = resolveSpec("./lib/foo", root);
    expect(out).toBe(path.join(root, "lib/foo.ts"));
  });

  it("returns the existing directory's index.ts for a relative spec with no file", () => {
    fs.mkdirSync(path.join(root, "lib/foo"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib/foo/index.ts"), "");
    const out = resolveSpec("./lib/foo", root);
    expect(out).toBe(path.join(root, "lib/foo/index.ts"));
  });

  it("returns null when no probe matches", () => {
    expect(resolveSpec("./lib/does-not-exist", root)).toBeNull();
  });

  it("resolves an absolute spec to its actual on-disk path", () => {
    // The /etc/hosts path exists on macOS/Linux CI; the test is gated by the host OS, but the
    // expectation is "whichever candidate exists" rather than the raw spec. Skip on Windows
    // where the path is different.
    if (process.platform === "win32") return;
    const out = resolveSpec("/etc/hosts", root);
    expect(out).toBe("/etc/hosts");
  });

  it("returns a node_modules package.json candidate for a bare spec", () => {
    // resolveSpec intentionally doesn't stat the file — the parser does — so the caller knows
    // exactly which path would have to exist for the error to be cache rot.
    expect(resolveSpec("definitely-not-installed-pkg-xyz", root)).toBe(
      path.join(root, "node_modules", "definitely-not-installed-pkg-xyz", "package.json"),
    );
  });

  it("returns the package.json path when the package is installed", () => {
    const pkg = path.join(root, "node_modules", "react", "package.json");
    fs.mkdirSync(path.dirname(pkg), { recursive: true });
    fs.writeFileSync(pkg, "{}");
    expect(resolveSpec("react", root)).toBe(pkg);
  });
});

describe("resolveSpec with a file:// URL", () => {
  it("resolves the URL's path like an absolute spec, probing extensions", () => {
    fs.writeFileSync(path.join(root, "mod.tsx"), "");
    expect(resolveSpec(`file://${root}/mod`, root)).toBe(path.join(root, "mod.tsx"));
    expect(resolveSpec(`file://${root}/missing`, root)).toBeNull();
  });
});
