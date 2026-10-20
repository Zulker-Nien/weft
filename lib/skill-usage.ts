import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";

// Which skills a folder's threads have run, from its Claude Code and puku-cli transcripts, so a project's
// skill set can start from what it actually uses (lib/skill-sets.ts). Weft's own folder has over a GB of
// transcripts, so the scan runs in the background and reads a file again only when its size changed;
// ~/.weft/skill-usage.json keeps what it found, by file: [size, skill names].

export const USAGE_FILE = path.join(DATA_DIR, "skill-usage.json");

const transcriptRoots = () => [
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects"),
  path.join(os.homedir(), ".puku-cli", "projects"),
];

// Claude Code's folder for a project's transcripts: its path with every character but letters and digits as "-".
export const transcriptDirName = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

const NAME = "[\\w.-]+(?::[\\w.-]+)?";
// A command Claude Code expanded, a Skill tool call, a /skill typed as a message, and a skill Claude loaded
// itself (the base directory it reads from names it: a plugin's sits under plugins/cache/<market>/<plugin>/).
const RUNS = [
  new RegExp(`<command-name>\\/(${NAME})<\\/command-name>`, "g"),
  new RegExp(`"skill":"(${NAME})"`, "g"),
  new RegExp(`"(?:text|content)":"\\/(${NAME})(?=\\s|\\\\n|")`, "g"),
];
const BASE_DIR = /Base directory for this skill: (\/[^"\\\s]+)/g;

function fromBaseDir(dir: string): string | undefined {
  const plugin = /\/plugins\/cache\/[^/]+\/([^/]+)\/.*\/skills\/([^/]+)\/?$/.exec(dir);
  if (plugin) return `${plugin[1]}:${plugin[2]}`;
  return /\/skills\/([^/]+)\/?$/.exec(dir)?.[1];
}

export function skillsIn(transcript: string): string[] {
  const names = new Set(RUNS.flatMap((re) => [...transcript.matchAll(re)].map((m) => String(m[1]))));
  for (const m of transcript.matchAll(BASE_DIR)) names.add(fromBaseDir(String(m[1])) ?? "");
  names.delete("");
  return [...names].sort();
}

type Found = Record<string, [number, string[]] | undefined>;

const state = () => globalSingleton("__weftSkillUsage", () => ({ found: null as Found | null, scans: new Map<string, Promise<string[]>>() }));

function found(): Found {
  const s = state();
  if (!s.found) {
    try {
      s.found = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Found;
    } catch {
      s.found = {};
    }
  }
  return s.found;
}

function transcriptsOf(cwd: string): string[] {
  return transcriptRoots().flatMap((root) => {
    const dir = path.join(root, transcriptDirName(cwd));
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  });
}

async function scan(cwd: string): Promise<string[]> {
  const seen = found();
  const names = new Set<string>();
  let changed = false;
  for (const file of transcriptsOf(cwd)) {
    try {
      const { size } = await fs.promises.stat(file);
      let entry = seen[file];
      if (entry?.[0] !== size) {
        entry = [size, skillsIn(await fs.promises.readFile(file, "utf8"))];
        seen[file] = entry;
        changed = true;
      }
      for (const name of entry[1]) names.add(name);
    } catch {
      // Gone or unreadable: nothing ran there.
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(seen));
  }
  return [...names].sort();
}

// The skills any thread in this folder ran, as they follow the slash ("tdac", "posthog:signals").
// One scan per folder at a time; callers share the one running.
export function skillsUsedIn(cwd: string): Promise<string[]> {
  const { scans } = state();
  let running = scans.get(cwd);
  if (!running) {
    running = scan(cwd).finally(() => scans.delete(cwd));
    scans.set(cwd, running);
  }
  return running;
}
