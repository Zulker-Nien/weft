import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInfo, SkillInfo } from "./types";

// A fake skill library so we can pin skills (weft/project/user) and plugins.
const lib = vi.hoisted(() => ({
  skillLibrary: vi.fn<(cwd?: string) => { skills: SkillInfo[]; plugins: PluginInfo[] }>(),
}));
vi.mock("./skill-library", () => lib);

// A fake usage scan; defaults to no usage. Tests override per-case.
const usage = vi.hoisted(() => ({ skillsUsedIn: vi.fn<(cwd: string) => Promise<string[]>>() }));
vi.mock("./skill-usage", () => usage);

// skill-sets.ts reads WEFT_DATA once at import, so we point it at a fresh temp dir
// and re-import the module. Never the real ~/.weft.
let dir: string;
const g = globalThis as unknown as { __weftSkillSeeding?: Set<string> };

async function load() {
  vi.resetModules();
  delete g.__weftSkillSeeding;
  return import("./skill-sets");
}

const skill = (name: string, source: SkillInfo["source"], description = ""): SkillInfo => ({
  name,
  description,
  source,
});
const plugin = (id: string, skills = 0, description = ""): PluginInfo => ({
  id,
  name: id.split("@")[0] ?? id,
  skills,
  description,
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-sets-"));
  process.env.WEFT_DATA = dir;
  lib.skillLibrary.mockReturnValue({ skills: [], plugins: [] });
  usage.skillsUsedIn.mockReset();
  usage.skillsUsedIn.mockResolvedValue([]);
});

afterEach(() => {
  delete g.__weftSkillSeeding;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isPluginId", () => {
  it("is true when the name contains an @", async () => {
    const { isPluginId } = await load();
    expect(isPluginId("posthog@posthog")).toBe(true);
    expect(isPluginId("a@b")).toBe(true);
  });

  it("is false for plain skill names", async () => {
    const { isPluginId } = await load();
    expect(isPluginId("tdac")).toBe(false);
    expect(isPluginId("weft:done")).toBe(false);
    expect(isPluginId("")).toBe(false);
  });
});

describe("projectSet", () => {
  it("is undefined when no set has been written", async () => {
    const { projectSet } = await load();
    expect(projectSet("/tmp/proj")).toBeUndefined();
  });

  it("returns the saved set for a cwd", async () => {
    const { projectSet, setProjectOff } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    expect(projectSet("/tmp/proj")).toEqual({ off: ["a"], seededAt: expect.any(Number) as number });
  });
});

describe("setProjectOff", () => {
  it("deduplicates, sorts, and persists; seededAt is the call's time for a new project", async () => {
    const before = Date.now();
    const { setProjectOff, projectSet, SETS_FILE } = await load();
    const set = setProjectOff("/tmp/proj", ["b", "a", "a"]);
    expect(set.off).toEqual(["a", "b"]);
    expect(set.seededAt).toBeGreaterThanOrEqual(before);
    expect(projectSet("/tmp/proj")).toEqual(set);
    const raw = JSON.parse(fs.readFileSync(SETS_FILE, "utf8")) as Record<string, { off: string[]; seededAt: number }>;
    expect(raw["/tmp/proj"]).toEqual(set);
  });

  it("keeps the existing seededAt when one is already on file", async () => {
    const { setProjectOff, projectSet } = await load();
    const first = setProjectOff("/tmp/proj", ["a"]);
    const before = Date.now();
    const second = setProjectOff("/tmp/proj", ["b", "a"]);
    expect(second.seededAt).toBe(first.seededAt);
    expect(second.seededAt).toBeLessThanOrEqual(before);
    expect(projectSet("/tmp/proj")?.off).toEqual(["a", "b"]);
  });
});

describe("readSets fallbacks", () => {
  it("returns {} for a missing file and for a corrupt file", async () => {
    const { SETS_FILE, projectSet } = await load();
    // No file yet: undefined.
    expect(projectSet("/tmp/missing")).toBeUndefined();
    // Write garbage and confirm projectSet still returns undefined.
    fs.mkdirSync(path.dirname(SETS_FILE), { recursive: true });
    fs.writeFileSync(SETS_FILE, "{not json");
    expect(projectSet("/tmp/missing")).toBeUndefined();
  });
});

describe("seedProjectSet", () => {
  it("returns the existing set without scanning", async () => {
    lib.skillLibrary.mockReturnValue({ skills: [], plugins: [] });
    usage.skillsUsedIn.mockResolvedValue(["never-called"]);
    const { seedProjectSet, setProjectOff } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const set = await seedProjectSet("/tmp/proj");
    expect(set.off).toEqual(["a"]);
    expect(usage.skillsUsedIn).not.toHaveBeenCalled();
  });

  it("puts user skills not used off, leaves weft and project skills on, leaves a used plugin on", async () => {
    lib.skillLibrary.mockReturnValue({
      skills: [
        skill("weft:commit", "weft", "Weft's commit"),
        skill("project-lint", "project", "Project linter"),
        skill("user-a", "user", "A"),
        skill("user-b", "user", "B"),
      ],
      plugins: [plugin("ph@ph", 173, "Posthog"), plugin("tdac@tdac", 1, "Tdac"), plugin("unused@market", 0, "Unused")],
    });
    usage.skillsUsedIn.mockResolvedValue(["user-a", "ph:signals", "tdac:foo"]);
    const { seedProjectSet } = await load();
    const set = await seedProjectSet("/tmp/proj");
    // Sorted: "@" (0x40) sorts before letters; user-b then the unused plugin.
    expect(set.off).toEqual(["unused@market", "user-b"]);
  });

  it("a set written by another caller during the scan wins", async () => {
    lib.skillLibrary.mockReturnValue({ skills: [skill("user-a", "user")], plugins: [] });
    let resolveUsage!: (names: string[]) => void;
    usage.skillsUsedIn.mockReturnValue(new Promise<string[]>((r) => (resolveUsage = r)));
    const { seedProjectSet, setProjectOff, projectSet } = await load();
    const pending = seedProjectSet("/tmp/proj");
    // Another caller sets the file before the scan resolves.
    setProjectOff("/tmp/proj", ["other"]);
    resolveUsage([]);
    const set = await pending;
    expect(set.off).toEqual(["other"]);
    expect(projectSet("/tmp/proj")?.off).toEqual(["other"]);
  });
});

describe("ensureSeeded", () => {
  it("seeds once per folder; further calls hit the global singleton", async () => {
    lib.skillLibrary.mockReturnValue({ skills: [skill("user-a", "user")], plugins: [] });
    usage.skillsUsedIn.mockImplementation(() => {
      // First call resolves quickly; subsequent calls (had they run) would resolve the same.
      return Promise.resolve([]);
    });
    const { ensureSeeded, projectSet } = await load();
    ensureSeeded("/tmp/proj");
    ensureSeeded("/tmp/proj");
    ensureSeeded("/tmp/proj");
    // Give the promise a tick to resolve.
    await new Promise((r) => setImmediate(r));
    expect(usage.skillsUsedIn).toHaveBeenCalledTimes(1);
    expect(projectSet("/tmp/proj")?.off).toEqual(["user-a"]);
  });

  it("is a no-op when the project already has a set", async () => {
    const { ensureSeeded, setProjectOff } = await load();
    setProjectOff("/tmp/proj", ["x"]);
    ensureSeeded("/tmp/proj");
    expect(usage.skillsUsedIn).not.toHaveBeenCalled();
  });

  it("retries after a failed seed", async () => {
    lib.skillLibrary.mockReturnValue({ skills: [skill("user-a", "user")], plugins: [] });
    const { ensureSeeded, projectSet } = await load();
    usage.skillsUsedIn.mockRejectedValueOnce(new Error("boom"));
    ensureSeeded("/tmp/proj");
    // Wait for the rejection to be caught.
    await new Promise((r) => setImmediate(r));
    expect(projectSet("/tmp/proj")).toBeUndefined();
    // Now the next call goes through.
    usage.skillsUsedIn.mockResolvedValueOnce([]);
    ensureSeeded("/tmp/proj");
    await new Promise((r) => setImmediate(r));
    expect(usage.skillsUsedIn).toHaveBeenCalledTimes(2);
    expect(projectSet("/tmp/proj")?.off).toEqual(["user-a"]);
  });
});

describe("offFor", () => {
  it("is the project's off-list when the card has no own off/on", async () => {
    const { setProjectOff, offFor } = await load();
    setProjectOff("/tmp/proj", ["a", "b"]);
    const off = offFor({ cwd: "/tmp/proj" });
    expect(off).toEqual(["a", "b"]);
  });

  it("combines project off and card off, then drops what the card turned on", async () => {
    const { setProjectOff, offFor } = await load();
    setProjectOff("/tmp/proj", ["a", "b"]);
    const off = offFor({
      cwd: "/tmp/proj",
      skillsOn: ["b"],
      skillsOff: ["c"],
    });
    expect(off).toEqual(["a", "c"]);
  });

  it("treats a missing project's set as empty", async () => {
    const { offFor } = await load();
    const off = offFor({
      cwd: "/tmp/proj",
      skillsOff: ["a"],
    });
    expect(off).toEqual(["a"]);
  });
});

describe("toggleCardSkill", () => {
  it("turning on a project-off skill adds it to skillsOn", async () => {
    const { setProjectOff, toggleCardSkill } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const out = toggleCardSkill({ cwd: "/tmp/proj" }, "a", true);
    expect(out).toEqual({ skillsOn: ["a"], skillsOff: [] });
  });

  it("turning off a project-on skill adds it to skillsOff", async () => {
    const { setProjectOff, toggleCardSkill } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const out = toggleCardSkill({ cwd: "/tmp/proj" }, "b", false);
    expect(out).toEqual({ skillsOn: [], skillsOff: ["b"] });
  });

  it("turning on a project-on skill is a no-op (off is enough)", async () => {
    const { setProjectOff, toggleCardSkill } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const out = toggleCardSkill({ cwd: "/tmp/proj" }, "b", true);
    expect(out).toEqual({ skillsOn: [], skillsOff: [] });
  });

  it("turning off a project-off skill is a no-op", async () => {
    const { setProjectOff, toggleCardSkill } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const out = toggleCardSkill({ cwd: "/tmp/proj" }, "a", false);
    expect(out).toEqual({ skillsOn: [], skillsOff: [] });
  });

  it("deduplicates and sorts the on/off lists when the same name is already there", async () => {
    const { setProjectOff, toggleCardSkill } = await load();
    setProjectOff("/tmp/proj", ["a"]);
    const out = toggleCardSkill(
      { cwd: "/tmp/proj", skillsOn: ["a", "z"], skillsOff: ["a"] },
      "a",
      true,
    );
    expect(out).toEqual({ skillsOn: ["a", "z"], skillsOff: [] });
  });

  it("treats a missing project set as if every skill were on", async () => {
    const { toggleCardSkill } = await load();
    const out = toggleCardSkill({ cwd: "/tmp/proj" }, "a", false);
    expect(out).toEqual({ skillsOn: [], skillsOff: ["a"] });
  });
});

describe("skillSettings", () => {
  it("is undefined for an empty off-list", async () => {
    const { skillSettings } = await load();
    expect(skillSettings([])).toBeUndefined();
  });

  it("maps plain skill names to skillOverrides with user-invocable-only", async () => {
    const { skillSettings } = await load();
    expect(skillSettings(["tdac", "weft:done"])).toEqual({
      skillOverrides: { tdac: "user-invocable-only", "weft:done": "user-invocable-only" },
    });
  });

  it("maps plugin ids to enabledPlugins with false", async () => {
    const { skillSettings } = await load();
    expect(skillSettings(["ph@ph"])).toEqual({ enabledPlugins: { "ph@ph": false } });
  });

  it("mixes skills and plugins, with each going to its own setting", async () => {
    const { skillSettings } = await load();
    expect(skillSettings(["tdac", "ph@ph", "a@b"])).toEqual({
      skillOverrides: { tdac: "user-invocable-only" },
      enabledPlugins: { "ph@ph": false, "a@b": false },
    });
  });
});

describe("withSkillSettings", () => {
  it("returns the settings unchanged when no skills are off", async () => {
    const { withSkillSettings } = await load();
    const base = { foo: 1 };
    expect(withSkillSettings(base, [])).toBe(base);
    expect(withSkillSettings(base, undefined)).toBe(base);
    expect(withSkillSettings(undefined, [])).toBeUndefined();
  });

  it("merges the skill settings onto the others", async () => {
    const { withSkillSettings } = await load();
    const merged = withSkillSettings({ foo: 1, bar: "x" }, ["tdac"]);
    expect(merged).toEqual({ foo: 1, bar: "x", skillOverrides: { tdac: "user-invocable-only" } });
  });

  it("treats undefined off as empty", async () => {
    const { withSkillSettings } = await load();
    expect(withSkillSettings({ foo: 1 }, undefined)).toEqual({ foo: 1 });
  });
});

describe("sameOff", () => {
  it("is true for the same array and the same elements in order", async () => {
    const { sameOff } = await load();
    expect(sameOff(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is false for different lengths, different order, or different elements", async () => {
    const { sameOff } = await load();
    expect(sameOff(["a", "b"], ["a"])).toBe(false);
    expect(sameOff(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameOff(["a"], ["b"])).toBe(false);
  });

  it("treats undefined as an empty list", async () => {
    const { sameOff } = await load();
    expect(sameOff(undefined, [])).toBe(true);
    expect(sameOff(undefined, undefined)).toBe(true);
    expect(sameOff(["a"], undefined)).toBe(false);
  });
});
