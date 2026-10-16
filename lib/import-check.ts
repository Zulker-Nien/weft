import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { droppedImports } from "./dropped-imports";

// Catches a broken import the moment an edit makes it, before the dev server shows it as a build error
// over the whole board: one thread removes an export (or a whole module) another file still imports,
// or adds an import of a name that isn't there. A React error boundary can't catch these: the module
// never compiles, so nothing runs. Plain text matching, no type-checker, so it takes milliseconds.
// Only node: imports (erased type imports, and ./dropped-imports, which keeps to the same rule) here:
// scripts/import-check-hook.mjs loads this file with
// Node's type stripping, for Claude Code sessions outside Weft.

const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
// How many files that might import an edited module get read; past that it's a hub nobody edits blind.
const MAX_IMPORTERS = 200;

export interface NamedImport {
  spec: string;
  names: string[];
  line: number;
}

// The names a module exports ("default" for its default export), or null when that can't be known
// from its text: `export *` from another module, or no ESM exports at all (CommonJS, say).
export function exportsOf(src: string): Set<string> | null {
  if (/^export \* from/m.test(src)) return null;
  const names = new Set<string>();
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|abstract\s+class|interface|type|enum)\s+(\w+)/gm)) names.add(group(m, 1));
  for (const m of src.matchAll(/^export\s+\*\s+as\s+(\w+)/gm)) names.add(group(m, 1));
  if (/^export\s+default\b/m.test(src)) names.add("default");
  for (const m of src.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) for (const n of braceNames(group(m, 1), "exported")) names.add(n);
  return names.size ? names : null;
}

// The named and default imports (and `export { … } from` re-exports) in a source, one per statement.
export function namedImports(src: string): NamedImport[] {
  const out: NamedImport[] = [];
  const pattern = /^(?:import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?|export\s+(?:type\s+)?\{([^}]*)\})\s*from\s*["']([^"']+)["']/gm;
  for (const m of src.matchAll(pattern)) {
    const names = [...(group(m, 1) ? ["default"] : []), ...braceNames(group(m, 2) || group(m, 3), "local")];
    if (names.length) out.push({ spec: group(m, 4), names, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

// A capture group, "" when it didn't take part in the match.
function group(m: RegExpMatchArray, i: number) {
  return m.slice(i, i + 1).join("");
}

// `a, b as c, type D` -> the names the module must export (local) or does export (exported).
function braceNames(list: string, side: "local" | "exported"): string[] {
  return list
    .split(",")
    .map((part) => part.replace(/\/\/.*$|\/\*.*?\*\//gm, "").trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(/\s+as\s+/);
      return (side === "exported" ? pieces.slice(-1) : pieces.slice(0, 1)).join("");
    });
}

// The file a local import names, "" when that file isn't there, or null for a package. "@/x" is the
// project root's x (tsconfig's paths).
export function resolveSpec(root: string, fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  if (isFile(base)) return base;
  return EXTENSIONS.map((ext) => base + ext).find(isFile) ?? "";
}

function isFile(p: string) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// The nearest folder above a file holding a tsconfig.json or package.json: where "@/" points.
export function projectRoot(file: string): string | null {
  let dir = path.dirname(file);
  while (!isFile(path.join(dir, "tsconfig.json")) && !isFile(path.join(dir, "package.json"))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
  return dir;
}

// What's broken after an edit to `file`: its own imports of local modules that don't exist or lack a
// name, and files importing it that name something it no longer exports. Empty when all is well.
export function brokenImports(file: string): string[] {
  file = path.resolve(file);
  if (!SOURCE.test(file) || !isFile(file)) return [];
  const root = projectRoot(file);
  if (!root) return [];
  const src = fs.readFileSync(file, "utf8");
  return [...ownImportProblems(root, file, src), ...importerProblems(root, file, src)];
}

function ownImportProblems(root: string, file: string, src: string): string[] {
  const problems: string[] = [];
  for (const imp of namedImports(src)) {
    const target = resolveSpec(root, file, imp.spec);
    if (target === null) continue;
    const where = `${path.relative(root, file)}:${imp.line}`;
    if (!target) {
      problems.push(`${where} imports "${imp.spec}", which doesn't exist.`);
      continue;
    }
    const missing = missingNames(target, imp.names);
    if (missing.length) problems.push(`${where} imports ${list(missing)} from "${imp.spec}", which doesn't export ${missing.length > 1 ? "them" : "it"}.`);
  }
  return problems;
}

function importerProblems(root: string, file: string, src: string): string[] {
  const exported = exportsOf(src);
  if (!exported) return [];
  const problems: string[] = [];
  for (const importer of possibleImporters(root, file)) {
    const importerSrc = fs.readFileSync(importer, "utf8");
    for (const imp of namedImports(importerSrc)) {
      if (resolveSpec(root, importer, imp.spec) !== file) continue;
      const missing = imp.names.filter((n) => !exported.has(n));
      if (missing.length) problems.push(`${path.relative(root, importer)}:${imp.line} still imports ${list(missing)} from ${path.relative(root, file)}, which no longer exports ${missing.length > 1 ? "them" : "it"}.`);
    }
  }
  return problems;
}

function missingNames(target: string, names: string[]): string[] {
  const exported = exportsOf(fs.readFileSync(target, "utf8"));
  return exported ? names.filter((n) => !exported.has(n)) : [];
}

// Source files that mention the module's name (its folder's, for an index file): git grep, tracked and
// untracked files alike, ignored ones (node_modules, builds) left out. None outside a git repo.
function possibleImporters(root: string, file: string): string[] {
  const parsed = path.parse(file);
  const name = parsed.name === "index" ? path.basename(parsed.dir) : parsed.name;
  try {
    const out = execFileSync("git", ["grep", "-l", "--untracked", "-F", name, "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out
      .split("\n")
      .filter(Boolean)
      .map((rel) => path.join(root, rel))
      .filter((p) => p !== file)
      .slice(0, MAX_IMPORTERS);
  } catch {
    return [];
  }
}

function list(names: string[]) {
  return names.map((n) => (n === "default" ? "its default export" : `\`${n}\``)).join(", ");
}

// What the agent that made the edit is told, so it fixes the break before anyone sees it.
export function importReport(problems: string[]): string {
  return [
    "This edit breaks the board (a build error over all of it, or a name that's not defined when it draws):",
    ...problems.map((p) => `- ${p}`),
    "Fix it now: update those imports, or keep the old export until every importer has moved (Fowler's Parallel Change). Another thread may be editing the importer, so read it fresh first.",
  ].join("\n");
}

// After an Edit or Write in a board thread (or one of its subagents), tell it what it just broke.
export const importGuard: HookCallback = (input) => {
  if (input.hook_event_name !== "PostToolUse") return Promise.resolve({});
  const file = (input.tool_input as { file_path?: unknown } | null)?.file_path;
  const full = typeof file === "string" ? path.resolve(input.cwd, file) : null;
  const problems = full ? [...brokenImports(full), ...droppedImports(input.tool_name, input.tool_input, full)] : [];
  return Promise.resolve(problems.length ? { decision: "block", reason: importReport(problems) } : {});
};

// For PostToolUse in every board thread (lib/env.ts guardedCli).
export const IMPORT_GUARD_MATCHER: HookCallbackMatcher = { matcher: "Edit|MultiEdit|Write", hooks: [importGuard] };
