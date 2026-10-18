import fs from "node:fs";
import path from "node:path";

// Where a project's path aliases point, from its tsconfig.json `compilerOptions.paths` (against `baseUrl`,
// else the tsconfig's own folder), so "@/x" is ./src/x in a project that maps `@/*` to `./src/*` (DeckCP)
// and ./x in one that maps it to `./*` (Weft). The import guards (route-import-guard, import-check) use it.

interface TsConfig {
  extends?: unknown;
  compilerOptions?: { baseUrl?: unknown; paths?: unknown };
}

interface Aliases {
  baseUrl: string;
  paths: Record<string, unknown>;
}

const MAX_EXTENDS = 5;
const cache = new Map<string, { mtime: number; config: TsConfig | null }>();

// JSON with comments and trailing commas (what tsconfig allows), null when it still doesn't parse. A
// string is matched first so "http://x" and "@/*" survive.
export function parseJsonc(text: string): TsConfig | null {
  const plain = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\/|,(?=\s*[}\]])/g, (_, str: string | undefined) => str ?? "");
  try {
    return JSON.parse(plain) as TsConfig;
  } catch {
    return null;
  }
}

// A tsconfig file parsed once per modification time, null when it's missing or malformed.
function readConfig(file: string): TsConfig | null {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = cache.get(file);
    if (hit?.mtime === mtime) return hit.config;
    const config = parseJsonc(fs.readFileSync(file, "utf8"));
    cache.set(file, { mtime, config });
    return config;
  } catch {
    return null;
  }
}

// The config an `extends` names: a relative path with or without .json. A package (@tsconfig/next) isn't followed.
function extendedFile(from: string, ext: unknown): string | null {
  if (typeof ext !== "string" || !ext.startsWith(".")) return null;
  const file = path.resolve(path.dirname(from), ext);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : `${file}.json`;
}

// The paths the nearest config in the extends chain sets, with the baseUrl they resolve against.
function aliasesOf(file: string, seen: Set<string> = new Set()): Aliases | null {
  if (seen.has(file) || seen.size >= MAX_EXTENDS) return null;
  seen.add(file);
  const config = readConfig(file);
  if (!config) return null;
  const options = config.compilerOptions;
  const dir = path.dirname(file);
  const baseUrl = typeof options?.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : dir;
  const paths = options?.paths;
  if (paths && typeof paths === "object") return { baseUrl, paths: paths as Record<string, unknown> };
  const parent = extendedFile(file, config.extends);
  return parent ? aliasesOf(parent, seen) : null;
}

// The `*` part of a spec a key matches, "" for an exact key, null when it doesn't match.
function captured(key: string, spec: string): string | null {
  const star = key.indexOf("*");
  if (star < 0) return key === spec ? "" : null;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  const fits = spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix);
  return fits ? spec.slice(prefix.length, spec.length - suffix.length) : null;
}

// The candidate paths (without extension) a spec could name under the tsconfig's `paths`: an exact key
// wins, else the key with the longest prefix before its `*`, as TypeScript picks.
function mapped(aliases: Aliases, spec: string): string[] | null {
  let best: { key: string; rest: string } | null = null;
  for (const key of Object.keys(aliases.paths)) {
    const rest = captured(key, spec);
    if (rest === null) continue;
    if (key === spec) return targets(aliases, aliases.paths[key], rest);
    if (!best || key.indexOf("*") > best.key.indexOf("*")) best = { key, rest };
  }
  return best ? targets(aliases, aliases.paths[best.key], best.rest) : null;
}

function targets(aliases: Aliases, value: unknown, rest: string): string[] | null {
  if (!Array.isArray(value)) return null;
  const found = value.filter((t): t is string => typeof t === "string").map((t) => path.resolve(aliases.baseUrl, t.replace("*", rest)));
  return found.length ? found : null;
}

// Where a non-relative spec points in the project at `root`: its tsconfig's mapping, else (for "@/") the
// root and then src/. Null for a package, which no alias claims.
export function aliasBases(root: string, spec: string): string[] | null {
  const aliases = aliasesOf(path.join(root, "tsconfig.json"));
  const hit = aliases && mapped(aliases, spec);
  if (hit) return hit;
  return spec.startsWith("@/") ? [path.join(root, spec.slice(2)), path.join(root, "src", spec.slice(2))] : null;
}
