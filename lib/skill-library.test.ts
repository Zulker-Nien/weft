import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CLAUDE_CONFIG_DIR is what installedPlugins() reads; HOME is what listSkills() reads.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-library-"));
const claudeDir = path.join(root, "claude");
const homeDir = path.join(root, "home");
fs.mkdirSync(path.join(claudeDir, "plugins"), { recursive: true });
fs.mkdirSync(path.join(homeDir, ".claude", "skills"), { recursive: true });
fs.mkdirSync(path.join(root, "plugin", "skills"), { recursive: true });
process.env.CLAUDE_CONFIG_DIR = claudeDir;
process.env.HOME = homeDir;
process.env.WEFT_PLUGIN_DIR = path.join(root, "plugin");

const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const writeFile = (file: string, body: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
const installedFile = () => path.join(claudeDir, "plugins", "installed_plugins.json");
const settingsFile = () => path.join(claudeDir, "settings.json");
const userSkillDir = () => path.join(homeDir, ".claude", "skills");

const { installedPlugins, skillLibrary } = await import("./skill-library");

const resetFiles = () => {
  for (const f of [installedFile(), settingsFile()]) fs.rmSync(f, { force: true });
  for (const dir of [path.join(claudeDir, "plugins", "cache"), userSkillDir(), path.join(root, "plugin", "skills"), path.join(homeDir, ".claude", "plugins")]) {
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true });
      }
    }
  }
};

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  vi.restoreAllMocks();
  resetFiles();
  // The fallback test deletes CLAUDE_CONFIG_DIR; restore it so the next test reads from claudeDir.
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
});

describe("installedPlugins", () => {
  it("returns an empty list when nothing is installed", () => {
    expect(installedPlugins()).toEqual([]);
  });

  it("starts from a broken installed_plugins.json as if it were empty", () => {
    writeFile(installedFile(), "{nope");
    expect(installedPlugins()).toEqual([]);
  });

  it("starts from a broken settings.json as if there were no settings", () => {
    writeJson(installedFile(), { plugins: { "posthog@market": [{ installPath: "/whatever" }] } });
    writeFile(settingsFile(), "{nope");
    const [plugin] = installedPlugins();
    expect(plugin?.id).toBe("posthog@market");
  });

  it("skips a plugin the user has disabled (enabledPlugins[id] === false)", () => {
    writeJson(installedFile(), {
      plugins: {
        "posthog@market": [{ installPath: "/ph" }],
        "kept@market": [{ installPath: "/k" }],
      },
    });
    writeJson(settingsFile(), { enabledPlugins: { "posthog@market": false } });
    const ids = installedPlugins().map((p) => p.id);
    expect(ids).toEqual(["kept@market"]);
  });

  it("treats an enabledPlugins setting of true as enabled", () => {
    writeJson(installedFile(), { plugins: { "posthog@market": [{ installPath: "/ph" }] } });
    writeJson(settingsFile(), { enabledPlugins: { "posthog@market": true } });
    expect(installedPlugins().map((p) => p.id)).toEqual(["posthog@market"]);
  });

  it("still lists a plugin whose installed entry isn't an array, with no skills and an empty description", () => {
    // The source doesn't drop these — it sets installPath to "" and the plugin is still emitted.
    writeJson(installedFile(), { plugins: { "broken@market": "not an array", "kept@market": [{ installPath: "/k" }] } });
    const out = installedPlugins();
    expect(out.map((p) => p.id)).toEqual(["broken@market", "kept@market"]);
    const broken = out.find((p) => p.id === "broken@market");
    expect(broken).toEqual({ id: "broken@market", name: "broken", skills: 0, description: "" });
  });

  it("skips a plugin when the array is empty (no installPath to read)", () => {
    writeJson(installedFile(), { plugins: { "empty@market": [] } });
    const out = installedPlugins();
    expect(out).toHaveLength(1);
    expect(out[0]?.skills).toBe(0);
    expect(out[0]?.description).toBe("");
  });

  it("uses the first install when an array has more than one", () => {
    const firstPath = "/tmp/weft-skill-library-first-install";
    const secondPath = "/tmp/weft-skill-library-second-install";
    // Both paths exist; the first one's manifest proves the source reads installs[0], not installs[1].
    fs.mkdirSync(path.join(firstPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(firstPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: "first wins" }));
    fs.mkdirSync(secondPath, { recursive: true });
    fs.mkdirSync(path.join(secondPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(secondPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: "second loses" }));
    writeJson(installedFile(), { plugins: { "dup@market": [{ installPath: firstPath }, { installPath: secondPath }] } });
    const out = installedPlugins();
    expect(out[0]?.description).toBe("first wins");
  });

  it("returns 0 skills and an empty description when the installPath is missing", () => {
    writeJson(installedFile(), { plugins: { "ghost@market": [{ installPath: "/nope/missing" }] } });
    const [plugin] = installedPlugins();
    expect(plugin).toEqual({ id: "ghost@market", name: "ghost", skills: 0, description: "" });
  });

  it("returns 0 skills when the installPath exists but its skills folder is missing", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "noskills");
    fs.mkdirSync(installPath, { recursive: true });
    writeJson(installedFile(), { plugins: { "ns@market": [{ installPath }] } });
    const [plugin] = installedPlugins();
    expect(plugin?.skills).toBe(0);
  });

  it("counts only directories under skills/ that contain a SKILL.md", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "counted");
    fs.mkdirSync(path.join(installPath, "skills"), { recursive: true });
    fs.mkdirSync(path.join(installPath, "skills", "a"), { recursive: true });
    fs.writeFileSync(path.join(installPath, "skills", "a", "SKILL.md"), "# a");
    fs.mkdirSync(path.join(installPath, "skills", "b"), { recursive: true });
    fs.writeFileSync(path.join(installPath, "skills", "b", "SKILL.md"), "# b");
    // No SKILL.md → not counted.
    fs.mkdirSync(path.join(installPath, "skills", "blank"), { recursive: true });
    // A loose file under skills/ → not counted.
    fs.writeFileSync(path.join(installPath, "skills", "README.md"), "loose");
    writeJson(installedFile(), { plugins: { "counted@market": [{ installPath }] } });
    const [plugin] = installedPlugins();
    expect(plugin?.skills).toBe(2);
  });

  it("reads the plugin description from .claude-plugin/plugin.json", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "withdesc");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: "useful plugin" }));
    writeJson(installedFile(), { plugins: { "wd@market": [{ installPath }] } });
    expect(installedPlugins()[0]?.description).toBe("useful plugin");
  });

  it("truncates a long description to 240 characters with an ellipsis", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "long");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), { recursive: true });
    const long = "x".repeat(300);
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: long }));
    writeJson(installedFile(), { plugins: { "long@market": [{ installPath }] } });
    const desc = installedPlugins()[0]?.description ?? "";
    expect(desc).toHaveLength(240);
    expect(desc.endsWith("…")).toBe(true);
    // Exactly 240 is kept as-is.
    const exact = "y".repeat(240);
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: exact }));
    expect(installedPlugins()[0]?.description).toBe(exact);
  });

  it("returns an empty description when the manifest is missing, isn't an object, or the field is wrong type", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "edge");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), { recursive: true });
    // No file at all.
    writeJson(installedFile(), { plugins: { "no-manifest@market": [{ installPath }] } });
    expect(installedPlugins().find((p) => p.id === "no-manifest@market")?.description).toBe("");

    // An array, not an object.
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify(["nope"]));
    fs.writeFileSync(installedFile(), JSON.stringify({ plugins: { "arr@market": [{ installPath }] } }));
    expect(installedPlugins().find((p) => p.id === "arr@market")?.description).toBe("");

    // Wrong type for description.
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: 42 }));
    fs.writeFileSync(installedFile(), JSON.stringify({ plugins: { "num@market": [{ installPath }] } }));
    expect(installedPlugins().find((p) => p.id === "num@market")?.description).toBe("");
  });

  it("falls back to an empty description when the manifest is broken JSON", () => {
    const installPath = path.join(claudeDir, "plugins", "cache", "brokenmanifest");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), "{nope");
    writeJson(installedFile(), { plugins: { "broken@market": [{ installPath }] } });
    expect(installedPlugins()[0]?.description).toBe("");
  });

  it("sorts plugins by their name (id split on '@')", () => {
    writeJson(installedFile(), {
      plugins: {
        "zebra@market": [{ installPath: "/z" }],
        "alpha@other": [{ installPath: "/a" }],
        "middle@market": [{ installPath: "/m" }],
      },
    });
    expect(installedPlugins().map((p) => p.name)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("uses the full id as the name when it has no '@'", () => {
    writeJson(installedFile(), { plugins: { "local-no-market": [{ installPath: "/l" }] } });
    expect(installedPlugins()[0]?.name).toBe("local-no-market");
  });

  it("ignores a non-object installed_plugins.json or settings.json", () => {
    // An array for installed.json and a string for settings.json.
    writeFile(installedFile(), JSON.stringify(["nope"]));
    writeFile(settingsFile(), JSON.stringify("nope"));
    expect(installedPlugins()).toEqual([]);
  });

  it("falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset", async () => {
    // Re-import the module without CLAUDE_CONFIG_DIR so the OR's right side runs.
    delete process.env.CLAUDE_CONFIG_DIR;
    vi.resetModules();
    const reloaded = await import("./skill-library");
    const homeClaude = path.join(homeDir, ".claude", "plugins");
    fs.mkdirSync(homeClaude, { recursive: true });
    fs.writeFileSync(
      path.join(homeClaude, "installed_plugins.json"),
      JSON.stringify({ plugins: { "home-fb@market": [{ installPath: "/hp" }] } }),
    );
    expect(reloaded.installedPlugins().map((p) => p.id)).toEqual(["home-fb@market"]);
  });
});

describe("skillLibrary", () => {
  beforeEach(() => {
    resetFiles();
  });

  it("combines listSkills() with installedPlugins()", () => {
    // Two user skills in the HOME.
    writeFile(path.join(userSkillDir(), "alpha", "SKILL.md"), "---\ndescription: a\n---\n");
    writeFile(path.join(userSkillDir(), "beta", "SKILL.md"), "---\ndescription: b\n---\n");
    // One installed plugin.
    const installPath = path.join(claudeDir, "plugins", "cache", "plg");
    fs.mkdirSync(path.join(installPath, "skills", "one"), { recursive: true });
    fs.writeFileSync(path.join(installPath, "skills", "one", "SKILL.md"), "# one");
    fs.mkdirSync(path.join(installPath, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(installPath, ".claude-plugin", "plugin.json"), JSON.stringify({ description: "d" }));
    writeJson(installedFile(), { plugins: { "plg@market": [{ installPath }] } });

    const lib = skillLibrary();
    expect(lib.skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    expect(lib.plugins).toEqual([{ id: "plg@market", name: "plg", skills: 1, description: "d" }]);
  });

  it("passes cwd to listSkills so the project's skills show up", () => {
    const project = path.join(root, "project");
    fs.mkdirSync(path.join(project, ".claude", "skills", "local"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "skills", "local", "SKILL.md"), "---\ndescription: l\n---\n");
    const lib = skillLibrary(project);
    expect(lib.skills.map((s) => s.name)).toEqual(["local"]);
  });
});
