import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// All three of these have to point at the same temp tree before the module under test loads:
// WEFT_DATA is DATA_DIR (lib/store.ts), CLAUDE_CONFIG_DIR and HOME are the two transcript roots.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-usage-"));
const dataDir = path.join(root, "data");
const claudeDir = path.join(root, "claude");
const pukuDir = path.join(root, "home", ".puku-cli");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(claudeDir, "projects"), { recursive: true });
fs.mkdirSync(pukuDir, { recursive: true });
process.env.WEFT_DATA = dataDir;
process.env.CLAUDE_CONFIG_DIR = claudeDir;
process.env.HOME = path.join(root, "home");

const { USAGE_FILE, skillsIn, skillsUsedIn, transcriptDirName } = await import("./skill-usage");

// Per-test reset: drop the singleton's caches (found map and in-flight scans) and any on-disk usage file
// so a test's scan can re-read its transcripts from scratch.
const resetState = () => {
  delete (globalThis as Record<string, unknown>).__weftSkillUsage;
  fs.rmSync(USAGE_FILE, { force: true });
  for (const dir of [
    path.join(claudeDir, "projects"),
    pukuDir,
  ]) {
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (sub.isDirectory()) fs.rmSync(path.join(dir, sub.name), { recursive: true, force: true });
    }
  }
};

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  resetState();
});

describe("transcriptDirName", () => {
  it("replaces every non-alphanumeric character with a dash", () => {
    expect(transcriptDirName("/Users/me/code/my.app")).toBe("-Users-me-code-my-app");
    expect(transcriptDirName("plain")).toBe("plain");
    expect(transcriptDirName("")).toBe("");
  });
});

describe("skillsIn", () => {
  it("finds a /<name> in a <command-name> tag", () => {
    expect(skillsIn("<command-name>/commit</command-name>")).toEqual(["commit"]);
  });

  it("finds a /<plugin>:<name> in a <command-name> tag", () => {
    expect(skillsIn("<command-name>/weft:done</command-name>")).toEqual(["weft:done"]);
  });

  it("finds a Skill tool call's \"skill\" field", () => {
    expect(skillsIn('{"skill":"simplify","args":""}')).toEqual(["simplify"]);
    expect(skillsIn('{"skill":"weft:preview"}')).toEqual(["weft:preview"]);
  });

  it("finds a typed /<name> inside a JSON text or content field", () => {
    expect(skillsIn('{"text":"/preview the build"}')).toEqual(["preview"]);
    expect(skillsIn('{"content":"/simplify\\nthe store"}')).toEqual(["simplify"]);
  });

  it("does not match a /name in a free-text field that isn't a value", () => {
    expect(skillsIn('{"text":"are we done? see /tmp/x"}')).toEqual([]);
  });

  it("reads a plugin skill from the Base directory line", () => {
    const dir = "/Users/me/.claude/plugins/cache/foo-marketplace/posthog/abc/skills/signals";
    expect(skillsIn(`"Base directory for this skill: ${dir}\\\\n"`)).toEqual(["posthog:signals"]);
  });

  it("reads a plain skill from the Base directory line", () => {
    const dir = "/Users/me/.claude/skills/my-skill/";
    expect(skillsIn(`"Base directory for this skill: ${dir}"`)).toEqual(["my-skill"]);
  });

  it("ignores a Base directory line that isn't a known shape", () => {
    expect(skillsIn('"Base directory for this skill: /somewhere/random"')).toEqual([]);
  });

  it("deduplicates and sorts the result", () => {
    const text = [
      "<command-name>/commit</command-name>",
      '{"skill":"simplify"}',
      '{"text":"/commit"}',
      "<command-name>/approve</command-name>",
    ].join("\n");
    expect(skillsIn(text)).toEqual(["approve", "commit", "simplify"]);
  });
});

describe("skillsUsedIn", () => {
  const transcriptDir = (cwd: string) => path.join(claudeDir, "projects", transcriptDirName(cwd));
  const pukuTranscriptDir = (cwd: string) => path.join(pukuDir, "projects", transcriptDirName(cwd));
  const writeTranscript = (dir: string, name: string, body: string) => {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    return file;
  };

  it("scans both transcript roots and returns the union, sorted", async () => {
    const cwd = "/Users/me/code/my-app";
    const claudeTranscript = writeTranscript(transcriptDir(cwd), "c1.jsonl", '<command-name>/commit</command-name>');
    const pukuTranscript = writeTranscript(pukuTranscriptDir(cwd), "p1.jsonl", '{"skill":"weft:done"}');
    // A different folder's transcript must not be picked up.
    writeTranscript(transcriptDir("/Users/me/other"), "x.jsonl", '{"skill":"other"}');
    const names = await skillsUsedIn(cwd);
    expect(names).toEqual(["commit", "weft:done"]);
    expect(fs.existsSync(USAGE_FILE)).toBe(true);
    expect((JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Record<string, [number, string[]]>)[claudeTranscript]?.[0]).toBe(fs.statSync(claudeTranscript).size);
    expect((JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Record<string, [number, string[]]>)[pukuTranscript]?.[0]).toBe(fs.statSync(pukuTranscript).size);
  });

  it("returns an empty list when the folder has no transcripts", async () => {
    expect(await skillsUsedIn("/Users/me/code/empty")).toEqual([]);
  });

  it("only writes the usage file when something actually changed", async () => {
    const cwd = "/Users/me/code/single";
    writeTranscript(transcriptDir(cwd), "s.jsonl", '<command-name>/commit</command-name>');
    await skillsUsedIn(cwd);
    const written = fs.readFileSync(USAGE_FILE, "utf8");
    fs.rmSync(USAGE_FILE);
    // Second call: same sizes, so nothing should be persisted.
    await skillsUsedIn(cwd);
    expect(fs.existsSync(USAGE_FILE)).toBe(false);
    // The in-memory cache still has the right answer.
    const names = await skillsUsedIn(cwd);
    expect(names).toEqual(["commit"]);
    // The file we wrote before the second call was just a sanity check; restore.
    fs.writeFileSync(USAGE_FILE, written);
  });

  it("re-reads a transcript when it grows", async () => {
    const cwd = "/Users/me/code/grows";
    const file = writeTranscript(transcriptDir(cwd), "g.jsonl", '<command-name>/commit</command-name>');
    expect(await skillsUsedIn(cwd)).toEqual(["commit"]);
    // Add another skill to the transcript, then re-scan.
    fs.writeFileSync(file, '<command-name>/commit</command-name>\n{"skill":"simplify"}');
    expect(await skillsUsedIn(cwd)).toEqual(["commit", "simplify"]);
  });

  it("starts from a broken usage file as if it were empty", async () => {
    fs.writeFileSync(USAGE_FILE, "{nope");
    const cwd = "/Users/me/code/broken";
    writeTranscript(transcriptDir(cwd), "b.jsonl", '<command-name>/commit</command-name>');
    expect(await skillsUsedIn(cwd)).toEqual(["commit"]);
    // The scan rewrote the file with a valid map.
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8")) as Record<string, unknown>;
    expect(Object.keys(parsed)).toHaveLength(1);
  });

  it("skips transcripts that have been deleted between scans", async () => {
    const cwd = "/Users/me/code/missing";
    writeTranscript(transcriptDir(cwd), "m.jsonl", '<command-name>/commit</command-name>');
    await skillsUsedIn(cwd);
    // Now drop the transcript (and any sibling in the same dir); the next scan must not throw.
    fs.rmSync(transcriptDir(cwd), { recursive: true, force: true });
    expect(await skillsUsedIn(cwd)).toEqual([]);
  });

  it("ignores a transcript that can't be read instead of throwing", async () => {
    const cwd = "/Users/me/code/unreadable";
    const dir = transcriptDir(cwd);
    writeTranscript(dir, "u.jsonl", '<command-name>/commit</command-name>');
    const stat = vi.spyOn(fs.promises, "stat").mockRejectedValue(new Error("nope"));
    expect(await skillsUsedIn(cwd)).toEqual([]);
    stat.mockRestore();
    // The real read still works once the spy is gone.
    expect(await skillsUsedIn(cwd)).toEqual(["commit"]);
  });

  it("returns the same in-flight promise for concurrent callers", async () => {
    const cwd = "/Users/me/code/concurrent";
    writeTranscript(transcriptDir(cwd), "k.jsonl", '<command-name>/commit</command-name>');
    const first = skillsUsedIn(cwd);
    const second = skillsUsedIn(cwd);
    expect(second).toBe(first);
    await first;
    // Once the first scan finishes, a fresh call is a new promise.
    expect(skillsUsedIn(cwd)).not.toBe(first);
    await skillsUsedIn(cwd);
  });

  it("uses the on-disk USAGE_FILE after vi.resetModules and clearing the singleton", async () => {
    const cwd = "/Users/me/code/reload";
    writeTranscript(transcriptDir(cwd), "r.jsonl", '<command-name>/commit</command-name>');
    expect(await skillsUsedIn(cwd)).toEqual(["commit"]);
    expect(fs.existsSync(USAGE_FILE)).toBe(true);

    // Drop the global singleton key (so the next module build a fresh `state()`) and reset modules.
    // A re-imported module must read the on-disk USAGE_FILE the first time it scans, not re-read
    // the transcript files.
    delete (globalThis as Record<string, unknown>).__weftSkillUsage;
    vi.resetModules();
    const readSpy = vi.spyOn(fs.promises, "readFile");
    const reloaded = await import("./skill-usage");
    // The on-disk USAGE_FILE has an entry whose size matches the live transcript, so the scan
    // answers directly without invoking skillsIn.
    expect(await reloaded.skillsUsedIn(cwd)).toEqual(["commit"]);
    // The transcript was not re-read — USAGE_FILE short-circuited the scan.
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("uses ~/.claude when CLAUDE_CONFIG_DIR is unset", async () => {
    // Re-import the module without CLAUDE_CONFIG_DIR so the OR's right side runs and reads from HOME.
    delete process.env.CLAUDE_CONFIG_DIR;
    delete (globalThis as Record<string, unknown>).__weftSkillUsage;
    vi.resetModules();
    const reloaded = await import("./skill-usage");
    const cwd = "/Users/me/code/home-fallback";
    const dirName = reloaded.transcriptDirName(cwd);
    const homeProjects = path.join(root, "home", ".claude", "projects", dirName);
    fs.mkdirSync(homeProjects, { recursive: true });
    fs.writeFileSync(path.join(homeProjects, "h.jsonl"), '<command-name>/home</command-name>');
    expect(await reloaded.skillsUsedIn(cwd)).toEqual(["home"]);
  });
});
