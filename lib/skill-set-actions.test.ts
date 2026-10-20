import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, PluginInfo, SkillInfo } from "./types";

// runner: endSession (only called for an idle card) and isBusy.
const runner = vi.hoisted(() => ({
  endSession: vi.fn<(cardId: string) => Promise<void>>(),
  isBusy: vi.fn<(cardId: string) => boolean>(),
}));
vi.mock("./runner", () => runner);

// store: a fake getCard/updateCard backed by an in-memory map.
const storeApi = vi.hoisted(() => ({ cards: new Map<string, Card>() }));
vi.mock("./store", () => ({
  DATA_DIR: process.env.WEFT_DATA || "/tmp",
  getCard: (id: string) => storeApi.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = storeApi.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    const next = { ...card, ...patch };
    storeApi.cards.set(id, next);
    return next;
  },
}));

// skill-library: a fake library for both skillSetView and (transitively) seedProjectSet.
const lib = vi.hoisted(() => ({
  skillLibrary: vi.fn<(cwd?: string) => { skills: SkillInfo[]; plugins: PluginInfo[] }>(),
}));
vi.mock("./skill-library", () => lib);

// skill-usage: a fake scan that resolves to an empty list.
const usage = vi.hoisted(() => ({ skillsUsedIn: vi.fn<(cwd: string) => Promise<string[]>>() }));
vi.mock("./skill-usage", () => usage);

// skill-set-actions reads skill-sets' DATA_DIR at import time; point it at a fresh temp dir.
let dir: string;

async function load() {
  // Drop the skill-set seeder singleton so each test seeds fresh.
  delete (globalThis as Record<string, unknown>)["__weftSkillSeeding"];
  const actions = await import("./skill-set-actions");
  const sets = await import("./skill-sets");
  // All tests share a single SETS_FILE (the module captures DATA_DIR at import time).
  // Wipe it on every load so each test starts from a clean set.
  try { fs.unlinkSync((sets as { SETS_FILE: string }).SETS_FILE); } catch {}
  return { actions, sets };
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

function makeCard(over: Partial<Card> = {}): Card {
  const id = over.id ?? "c1";
  const card: Card = {
    id,
    title: "t",
    prompt: "p",
    cwd: "/tmp/proj",
    column: "backlog",
    backend: "claude",
    ...over,
  } as Card;
  storeApi.cards.set(id, card);
  return card;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-skill-set-actions-"));
  process.env.WEFT_DATA = dir;
  storeApi.cards.clear();
  runner.endSession.mockReset().mockResolvedValue(undefined);
  runner.isBusy.mockReset().mockReturnValue(false);
  lib.skillLibrary.mockReset().mockReturnValue({ skills: [], plugins: [] });
  usage.skillsUsedIn.mockReset().mockResolvedValue([]);
});

// Reset module cache once before the whole file so a single SETS_FILE is captured at
// import time (the actions module and skill-sets read from the same file on every test).
// Per-test isolation comes from a fresh WEFT_DATA in beforeEach.
vi.resetModules();

// The actions and skill-sets modules share a single SETS_FILE captured at import time;
// load() wipes the file so each test starts from a clean set.
vi.resetModules();

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["__weftSkillSeeding"];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("skillSetView", () => {
  it("returns skills and plugins, with seeded=false before the scan lands and every row on", async () => {
    lib.skillLibrary.mockReturnValue({
      skills: [skill("a", "user", "Alpha")],
      plugins: [plugin("p@m", 3, "P")],
    });
    // Hold the seed open so we can see the unseeded state.
    let resolveUsage!: (names: string[]) => void;
    usage.skillsUsedIn.mockReturnValue(new Promise<string[]>((r) => (resolveUsage = r)));
    const { actions } = await load();
    const view = actions.skillSetView("/tmp/proj");
    expect(view.seeded).toBe(false);
    expect(view.rows).toHaveLength(2);
    expect(view.rows[0]).toMatchObject({ kind: "skill", name: "a", on: true, inProject: true, changedHere: false });
    expect(view.rows[1]).toMatchObject({ kind: "plugin", name: "p@m", on: true, inProject: true, changedHere: false });
    resolveUsage([]);
  });

  it("reflects a seeded set: a user skill used stays on, one not used goes off, with no card", async () => {
    lib.skillLibrary.mockReturnValue({
      skills: [skill("used", "user", "Used"), skill("stale", "user", "Stale")],
      plugins: [],
    });
    usage.skillsUsedIn.mockResolvedValue(["used"]);
    const { actions, sets } = await load();
    sets.setProjectOff("/tmp/proj", ["stale"]);
    const view = actions.skillSetView("/tmp/proj");
    expect(view.seeded).toBe(true);
    const byName = Object.fromEntries(view.rows.map((r) => [r.name, r]));
    expect(byName["used"]).toMatchObject({ inProject: true, on: true, changedHere: false });
    expect(byName["stale"]).toMatchObject({ inProject: false, on: false, changedHere: false });
  });

  it("a card with its own off/on reflects them, and changedHere is true where the card differs from the project", async () => {
    lib.skillLibrary.mockReturnValue({
      skills: [skill("a", "user", "A"), skill("b", "user", "B")],
      plugins: [],
    });
    usage.skillsUsedIn.mockResolvedValue([]);
    const { actions, sets } = await load();
    sets.setProjectOff("/tmp/proj", ["a"]);
    const view = actions.skillSetView("/tmp/proj", { cwd: "/tmp/proj", skillsOn: ["a"], skillsOff: ["b"] });
    const byName = Object.fromEntries(view.rows.map((r) => [r.name, r]));
    // "a" is project-off, card turned it on => inProject:false, on:true, changedHere:true.
    expect(byName["a"]).toMatchObject({ inProject: false, on: true, changedHere: true });
    // "b" is project-on, card turned it off => inProject:true, on:false, changedHere:true.
    expect(byName["b"]).toMatchObject({ inProject: true, on: false, changedHere: true });
  });
});

describe("setProjectSkill", () => {
  it("turns an off skill on by removing it from off", async () => {
    const { actions, sets } = await load();
    sets.setProjectOff("/tmp/proj", ["a", "b"]);
    const off = actions.setProjectSkill("/tmp/proj", "a", true);
    expect(off).toEqual(["b"]);
    expect(sets.projectSet("/tmp/proj")?.off).toEqual(["b"]);
  });

  it("turns an on skill off by adding it to off", async () => {
    const { actions, sets } = await load();
    sets.setProjectOff("/tmp/proj", ["a"]);
    const off = actions.setProjectSkill("/tmp/proj", "b", false);
    expect(off).toEqual(["a", "b"]);
    expect(sets.projectSet("/tmp/proj")?.off).toEqual(["a", "b"]);
  });

  it("works from a fresh (unseeded) project", async () => {
    const { actions, sets } = await load();
    const off = actions.setProjectSkill("/tmp/proj", "x", false);
    expect(off).toEqual(["x"]);
    expect(sets.projectSet("/tmp/proj")?.off).toEqual(["x"]);
  });
});

describe("setCardSkill", () => {
  it("returns undefined for a missing card", async () => {
    const { actions } = await load();
    expect(await actions.setCardSkill("nope", "a", true)).toBeUndefined();
    expect(runner.endSession).not.toHaveBeenCalled();
  });

  it("updates the card and ends the session when the card is idle", async () => {
    makeCard({ skillsOn: ["b"] });
    runner.isBusy.mockReturnValue(false);
    runner.endSession.mockResolvedValue(undefined);
    const { actions, sets } = await load();
    // Skill "a" is project-off, so on=true should add to skillsOn.
    sets.setProjectOff("/tmp/proj", ["a"]);
    const next = await actions.setCardSkill("c1", "a", true);
    expect(next?.skillsOn).toContain("a");
    expect(next?.skillsOn).toContain("b"); // preserves existing
    expect(runner.endSession).toHaveBeenCalledWith("c1");
    expect(sets.projectSet("/tmp/proj")?.off).toEqual(["a"]);
  });

  it("does not end the session when the card is busy", async () => {
    makeCard();
    runner.isBusy.mockReturnValue(true);
    const { actions, sets } = await load();
    // Project has "a" off, so on=true should add it to the card's skillsOn.
    sets.setProjectOff("/tmp/proj", ["a"]);
    const next = await actions.setCardSkill("c1", "a", true);
    expect(next?.skillsOn).toEqual(["a"]);
    expect(runner.endSession).not.toHaveBeenCalled();
  });
});

describe("isSkillName", () => {
  it("accepts plain skill names", async () => {
    const { actions } = await load();
    expect(actions.isSkillName("tdac")).toBe(true);
    expect(actions.isSkillName("weft:done")).toBe(true);
    expect(actions.isSkillName("a.b-c_d")).toBe(true);
  });

  it("accepts plugin ids of the form name@market", async () => {
    const { actions } = await load();
    expect(actions.isSkillName("ph@ph")).toBe(true);
    expect(actions.isSkillName("a-b.c@d_e.f")).toBe(true);
  });

  it("rejects junk and non-strings", async () => {
    const { actions } = await load();
    expect(actions.isSkillName("")).toBe(false);
    expect(actions.isSkillName("a b")).toBe(false);
    expect(actions.isSkillName("a:b:c")).toBe(false);
    expect(actions.isSkillName("weft:")).toBe(false);
    expect(actions.isSkillName(":done")).toBe(false);
    expect(actions.isSkillName("a/b")).toBe(false);
    // has "@" but doesn't fit name@market (the second name segment contains a ":").
    expect(actions.isSkillName("a:b@c")).toBe(false);
    expect(actions.isSkillName(undefined)).toBe(false);
    expect(actions.isSkillName(null)).toBe(false);
    expect(actions.isSkillName(42)).toBe(false);
  });
});
