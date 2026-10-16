import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Catches the import an edit drops while the file still uses the name: a thread moving code out of a file
// trims its imports before the code that needed them has gone. It still compiles, so no build error shows,
// and then the board throws "X is not defined" the moment it draws (lib/import-check.ts catches the other
// direction, an import of something that isn't there). Plain text matching, like import-check.
// Only node: imports here: scripts/import-check-hook.mjs loads this file with Node's type stripping.

const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;

interface Edit {
  old_string?: unknown;
  new_string?: unknown;
  replace_all?: unknown;
}

// The local names a source's import statements bind: default, namespace and `{ a as b }` (b).
export function importBindings(src: string): Set<string> {
  const names = new Set<string>();
  const pattern = /^import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\*\s+as\s+(\w+)|\{([^}]*)\})?\s*from\s*["'][^"']+["']/gm;
  for (const m of src.matchAll(pattern)) {
    for (const name of [m[1], m[2]]) if (name) names.add(name);
    for (const part of (m[3] ?? "").split(",")) {
      const local = part.replace(/\/\/.*$|\/\*.*?\*\//gm, "").trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

// The code with comments, strings and import statements blanked out, so only real uses are left.
function codeOnly(src: string): string {
  return src
    .replace(/^import\s[^;]*?from\s*["'][^"']+["'];?/gm, "")
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');
}

// Whether the file still uses `name` (not as a property, `a.name`, or an object key, `name:`) without
// declaring it itself.
export function stillUsed(src: string, name: string): boolean {
  const code = codeOnly(src);
  const declared = new RegExp(`\\b(?:const|let|var|function\\*?|class|interface|type|enum)\\s+${name}\\b`);
  if (declared.test(code)) return false;
  return new RegExp(`(?<![\\w$.])${name}(?![\\w$]|\\s*:(?!:))`).test(code);
}

// The file as it was before the tool call: Edit and MultiEdit are undone on the text, a Write is
// compared with the last commit. null when that can't be known (a new file, a deletion Edit).
export function sourceBefore(tool: string, input: Record<string, unknown>, after: string, file: string): string | null {
  if (tool === "Write") return committed(file);
  const list: unknown = input.edits;
  const edits: Edit[] = tool === "MultiEdit" && Array.isArray(list) ? (list as Edit[]) : [input];
  let src = after;
  for (const edit of [...edits].reverse()) {
    const { old_string: oldText, new_string: newText } = edit;
    if (typeof oldText !== "string" || typeof newText !== "string" || !newText || !src.includes(newText)) return null;
    src = edit.replace_all === true ? src.split(newText).join(oldText) : src.replace(newText, () => oldText);
  }
  return src;
}

function committed(file: string): string | null {
  try {
    const dir = path.dirname(file);
    const rel = execFileSync("git", ["ls-files", "--full-name", "--", path.basename(file)], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!rel) return null;
    return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

// What an Edit, MultiEdit or Write to `file` dropped from its imports that the file still uses.
export function droppedImports(tool: string, input: unknown, file: string): string[] {
  file = path.resolve(file);
  if (!SOURCE.test(file) || !input || typeof input !== "object") return [];
  let after: string;
  try {
    after = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const before = sourceBefore(tool, input as Record<string, unknown>, after, file);
  if (before === null) return [];
  const now = importBindings(after);
  const name = path.basename(file);
  return [...importBindings(before)]
    .filter((n) => !now.has(n) && stillUsed(after, n))
    .map((n) => `${name} no longer imports \`${n}\` but still uses it, so it throws "${n} is not defined" when it runs. Put the import back, or move the code that uses it first.`);
}
