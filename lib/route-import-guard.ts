import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { projectRoot, resolveSpec, specBases } from "./import-check";

// Refuses an edit that makes a route file import something that isn't there yet. A missing module in
// app/page.tsx (or a layout, or a route handler) fails the whole route before React runs, and with Next's
// dev server every /api route with it: no CrashGuard sees it, and BuildErrorBar only keeps the last good
// build for files that don't parse. On 2026-10-13 a card imported "@/components/home/Home" from
// app/page.tsx before writing it and the board was down ~5 minutes (docs/bug-fixes/010). lib/import-check.ts
// reports a broken import after the edit; for these files that's too late, so this one denies it before.
// Text matching and existsSync only: it runs on every Edit/Write. Only node: imports and ./import-check here
// (./prerender-check loads lazily, for route files): scripts/import-check-hook.mjs loads this file with Node's
// type stripping, for sessions outside Weft. It also refuses (or warns on) what `next build` alone refuses under
// cacheComponents, which cost two production deploys on 2026-10-17 (prerenderCheck).

// The files whose broken import takes the whole app down, relative to the project's root.
const ROUTE_FILE = /^(?:src\/)?app\/(?:.*\/)?(?:(?:page|layout|template|error|global-error|not-found|loading|default)\.[jt]sx?|route\.[jt]s)$/;
const ROOT_FILE = /^(?:src\/)?(?:middleware|proxy|instrumentation)\.[jt]s$/;
// Every module a source names: `… from "x"`, a bare `import "x"`, and `import("x")`.
const SPECS = /\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

export function isRouteFile(root: string, file: string): boolean {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return ROUTE_FILE.test(rel) || ROOT_FILE.test(rel);
}

export function importSpecs(src: string): Set<string> {
  return new Set([...src.matchAll(SPECS)].map((m) => m.slice(1).join("")));
}

interface Replace {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

// The file's text after a Write, Edit or MultiEdit, or null when the edit can't apply (the tool will fail
// on its own and say why).
export function contentAfter(tool: string, input: Record<string, unknown>, before: string | null): string | null {
  if (tool === "Write") return typeof input.content === "string" ? input.content : null;
  const edits = (tool === "MultiEdit" ? input.edits : [input]) as Replace[] | undefined;
  if (before === null || !Array.isArray(edits)) return null;
  let text = before;
  for (const e of edits) {
    if (typeof e.old_string !== "string" || typeof e.new_string !== "string") return null;
    const at = text.indexOf(e.old_string);
    if (at < 0) return null;
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.slice(0, at) + e.new_string + text.slice(at + e.old_string.length);
  }
  return text;
}

// "next/font/google" -> "next", "@scope/pkg/x" -> "@scope/pkg".
function packageName(spec: string): string {
  return spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
}

// Whether a package is installed in a node_modules at or above the file. True when there's no
// node_modules at all (nothing installed yet: not this edit's doing).
function packageInstalled(file: string, name: string): boolean {
  let sawModules = false;
  let dir = file;
  do {
    dir = path.dirname(dir);
    const modules = path.join(dir, "node_modules");
    if (fs.existsSync(path.join(modules, name))) return true;
    sawModules ||= fs.existsSync(modules);
  } while (path.dirname(dir) !== dir);
  return !sawModules;
}

// Where a missing local import should be written: its path with the importer's extension when it has none.
function suggestedFile(root: string, file: string, spec: string): string {
  const base = (specBases(root, file, spec) as string[])[0] as string; // only asked for a spec that resolved to ""
  return path.relative(root, path.extname(base) ? base : base + path.extname(file));
}

// What's wrong with the imports an edit adds to a route file, each with what to do instead. Empty for any
// other file, and for imports the file already had (broken before isn't this edit's fault).
export function addedImportProblems(file: string, before: string | null, after: string): string[] {
  const root = projectRoot(file);
  if (!root || !isRouteFile(root, file)) return [];
  const had = importSpecs(before ?? "");
  const rel = path.relative(root, file);
  const problems: string[] = [];
  for (const spec of importSpecs(after)) {
    if (had.has(spec)) continue;
    const target = resolveSpec(root, file, spec);
    if (target === "") problems.push(`"${spec}" doesn't exist yet: write ${suggestedFile(root, file, spec)} first, then import it from ${rel}.`);
    else if (target === null && !/^[#~]/.test(spec) && !isBuiltin(spec) && !packageInstalled(file, packageName(spec)))
      problems.push(`"${spec}" isn't installed: install ${packageName(spec)} first, then import it from ${rel}.`);
  }
  return problems;
}

export function routeImportReason(file: string, problems: string[]): string {
  return [
    `Refused: ${file} is a route file, and a missing module there fails the whole app (every page and /api route) before any error boundary runs.`,
    ...problems.map((p) => `- ${p}`),
    "Do it in that order, so the import resolves the moment it lands.",
  ].join("\n");
}

// The deny reason for an Edit, MultiEdit or Write, or "" to let it through.
export function routeImportCheck(tool: string, input: unknown, cwd: string): string {
  const fields = (input ?? {}) as Record<string, unknown>;
  if (typeof fields.file_path !== "string") return "";
  const file = path.resolve(cwd, fields.file_path);
  const before = readText(file);
  const after = contentAfter(tool, fields, before);
  const problems = after === null ? [] : addedImportProblems(file, before, after);
  return problems.length ? routeImportReason(path.relative(cwd, file), problems) : "";
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// What an edit to a page, layout or route handler adds of what `next build` refuses under cacheComponents
// (lib/prerender-check.ts): `deny` for a segment config export, a certain build error; `warn` for runtime data
// awaited outside <Suspense>, a heuristic. Problems the file already had aren't this edit's. The check parses with
// TypeScript, so it loads only when a route file is edited, never on the start-a-card path.
export async function prerenderCheck(tool: string, input: unknown, cwd: string): Promise<{ deny: string; warn: string }> {
  const fields = (input ?? {}) as Record<string, unknown>;
  const none = { deny: "", warn: "" };
  if (typeof fields.file_path !== "string") return none;
  const file = path.resolve(cwd, fields.file_path);
  const root = projectRoot(file);
  if (!root || !isRouteFile(root, file)) return none;
  const before = readText(file);
  const after = contentAfter(tool, fields, before);
  const { cacheComponentsOn, prerenderProblems } = await import("./prerender-check");
  if (after === null || !cacheComponentsOn(root)) return none;
  const had = new Set(before === null ? [] : prerenderProblems(root, file, before).map((p) => p.message));
  const added = prerenderProblems(root, file, after).filter((p) => !had.has(p.message));
  const say = (kind: string, lead: string) => {
    const lines = added.filter((p) => p.kind === kind).map((p) => `- ${p.message}`);
    return lines.length ? [lead, ...lines].join("\n") : "";
  };
  return {
    deny: say("config", "Refused: cacheComponents is on (next.config), so `next build` fails on this and the deploy with it; `next dev`, lint, typecheck and tests don't notice."),
    warn: say("blocking", "Heads up: `next build` will likely fail on this edit under cacheComponents (only it checks; `next dev` won't show it):"),
  };
}

export const routeImportGuard: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return {};
  const missing = routeImportCheck(input.tool_name, input.tool_input, input.cwd);
  const { deny, warn } = missing ? { deny: "", warn: "" } : await prerenderCheck(input.tool_name, input.tool_input, input.cwd);
  const why = missing || deny;
  if (why) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } };
  return warn ? { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: warn } } : {};
};

// For PreToolUse in every board thread (lib/env.ts guardedCli).
export const ROUTE_IMPORT_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Edit|MultiEdit|Write", hooks: [routeImportGuard] };
