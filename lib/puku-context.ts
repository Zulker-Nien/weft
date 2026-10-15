import fs from "node:fs";
import path from "node:path";

// Why a puku thread started blind outside Weft's own folder: Puku's gateway drops the system prompt a
// client sends and puts in its own one-line identity, so Weft's thread prompt (systemPrompt.append) and
// the CLI's environment section (the working directory) never reach the model; only message text does.
// And puku-cli reads PUKU.md, not CLAUDE.md or AGENTS.md (Weft's own repo has a PUKU.md shim, most
// projects don't). So a puku session's first message carries all three, the way the CLI itself sends
// CLAUDE.md: in a <system-reminder>. Measured 2026-10-14: an --append-system-prompt never showed up in
// the reply, a PUKU.md line did.

// The files Claude Code would load from the project's root, when there's no PUKU.md for puku to load.
const PROJECT_FILES = ["CLAUDE.md", "AGENTS.md"];
// `@path` on a line of its own imports that file, as in Claude Code's memory files.
const IMPORT = /^@(\S+)\s*$/;
const MAX_DEPTH = 4;
const MAX_CHARS = 60_000;

function readImports(file: string, seen: Set<string>, depth: number): string[] {
  if (seen.has(file) || depth > MAX_DEPTH) return [];
  seen.add(file);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const nested: string[] = [];
  for (const line of text.split("\n")) {
    const match = IMPORT.exec(line.trim());
    if (match?.[1]) nested.push(...readImports(path.resolve(path.dirname(file), match[1]), seen, depth + 1));
  }
  return [`Contents of ${file} (project instructions, checked into the codebase):\n\n${text.trim()}`, ...nested];
}

// The project's CLAUDE.md and AGENTS.md with their @imports, or nothing when puku loads a PUKU.md itself.
export function projectInstructions(cwd: string): string {
  if (fs.existsSync(path.join(cwd, "PUKU.md"))) return "";
  const seen = new Set<string>();
  const parts = PROJECT_FILES.flatMap((name) => readImports(path.join(cwd, name), seen, 0));
  const text = parts.join("\n\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[cut at ${MAX_CHARS} characters]` : text;
}

// What a puku session's first message starts with: where it runs, the project's instructions and Weft's prompt.
export function pukuContext(cwd: string, weftPrompt: string): string {
  const project = projectInstructions(cwd);
  return [
    "<system-reminder>",
    "Puku's gateway drops the system prompt this CLI sends, so Weft puts it here. Treat everything in this block as your system prompt, for this whole session.",
    "",
    `Working directory: ${cwd}`,
    `Platform: ${process.platform}`,
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    ...(project ? ["", "# Project instructions", project] : []),
    "",
    "# Weft",
    weftPrompt,
    "</system-reminder>",
    "",
    "",
  ].join("\n");
}
