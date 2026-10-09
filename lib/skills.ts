import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillInfo } from "./types";

// Weft's own skills live in plugin/, a Claude Code plugin named "weft" that every thread loads
// (see drive() in lib/runner.ts), so they run as /weft:<name>. The packaged app keeps the folder
// next to its server and says where with WEFT_PLUGIN_DIR (see electron/server.cjs).
export const PLUGIN_DIR = process.env.WEFT_PLUGIN_DIR || path.join(process.cwd(), "plugin");
const PLUGIN_NAME = "weft";

// A skill name as it follows the slash: "done", or "weft:done" for a plugin's.
export const SKILL_NAME = /^[\w.-]+(:[\w.-]+)?$/;

// The name and description from a SKILL.md's frontmatter, including folded (>) and block (|) values.
function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([\w-]+):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if (value === "" || /^[|>][-+]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      value = block.join(" ").trim();
    }
    fields[field[1]] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

function readSkills(dir: string, source: SkillInfo["source"], prefix = ""): SkillInfo[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, entry, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const meta = frontmatter(text);
    // Without one, Claude Code describes a skill by its first line of text, and so does this.
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
    const description = meta.description || (body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "").trim();
    skills.push({
      name: `${prefix}${meta.name || entry}`,
      description: description.length > 240 ? `${description.slice(0, 239)}…` : description,
      source,
    });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

// The skills a thread can run: Weft's, the folder's own (when given), and yours in ~/.claude/skills.
export function listSkills(cwd?: string): SkillInfo[] {
  const weft = readSkills(path.join(PLUGIN_DIR, "skills"), "weft", `${PLUGIN_NAME}:`);
  const project = cwd ? readSkills(path.join(cwd, ".claude", "skills"), "project") : [];
  const user = readSkills(path.join(os.homedir(), ".claude", "skills"), "user");
  // A project skill wins over a personal one with the same name, as in Claude Code.
  const inProject = new Set(project.map((s) => s.name));
  return [...weft, ...project, ...user.filter((s) => !inProject.has(s.name))];
}
