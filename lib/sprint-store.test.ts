import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The saved sprints' store, against a real file in a temp dir (THREADBOARD_DATA), never ~/.weft.

let dir: string;
const g = globalThis as unknown as { __threadboardState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__threadboardState;
  return import("./sprint-store");
}

const sprintsFile = () => path.join(dir, "sprints.json");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-sprints-"));
  process.env.THREADBOARD_DATA = dir;
});
afterEach(() => {
  delete g.__threadboardState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sprint store", () => {
  it("is empty with no file, a broken file, or a file without a list", async () => {
    const store = await load();
    expect(store.listSprints()).toEqual([]);
    fs.writeFileSync(sprintsFile(), "{nope");
    expect(store.listSprints()).toEqual([]);
    fs.writeFileSync(sprintsFile(), JSON.stringify({ sprints: "x" }));
    expect(store.listSprints()).toEqual([]);
  });

  it("saves cards as a numbered sprint, or under the name given", async () => {
    const store = await load();
    const day = Date.UTC(2026, 9, 18, 12);
    const first = store.saveSprint(["a", "b", "a"], undefined, day);
    expect(first).toMatchObject({ name: "Sprint 1 · Oct 18", cardIds: ["a", "b"], createdAt: day });
    const named = store.saveSprint(["c"], " Launch ");
    expect(named.name).toBe("Launch");
    expect(store.listSprints().map((s) => s.id)).toEqual([first.id, named.id]);
  });

  it("refuses a sprint with no cards", async () => {
    const store = await load();
    expect(() => store.saveSprint([])).toThrow(/at least one card/);
  });

  it("renames a sprint, and refuses a blank name or an unknown id", async () => {
    const store = await load();
    const s = store.saveSprint(["a"]);
    expect(store.renameSprint(s.id, "Polish").name).toBe("Polish");
    expect(store.listSprints()[0]!.name).toBe("Polish");
    expect(() => store.renameSprint(s.id, " ")).toThrow(/needs a name/);
    expect(() => store.renameSprint("nope", "x")).toThrow(/No such sprint/);
  });

  it("removes a sprint", async () => {
    const store = await load();
    const s = store.saveSprint(["a"]);
    store.removeSprint(s.id);
    expect(store.listSprints()).toEqual([]);
    expect(() => store.removeSprint(s.id)).toThrow(/No such sprint/);
  });
});
