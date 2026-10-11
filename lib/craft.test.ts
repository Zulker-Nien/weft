import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-craft-"));

vi.mock("./store", () => ({ DATA_DIR: dir }));

const { CRAFT_FILE, craftHabits, habitsIn, scanCraft } = await import("./craft");

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1", title: "Add login", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "done",
    createdAt: 1000, updatedAt: 1000, sessionId: "s1", ...overrides,
  };
}

const transcript = (name: string, lines: string[]) => {
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, lines.join("\n"));
  return file;
};

function reset() {
  delete (globalThis as Record<string, unknown>).__weftCraft;
  fs.rmSync(CRAFT_FILE, { force: true });
}

beforeEach(reset);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("habitsIn", () => {
  it("reads a typed /skill, an expanded command and a skill Claude loaded itself", () => {
    expect(habitsIn('{"text":"/weft:done"}')).toEqual(["wrap", "commit"]);
    expect(habitsIn("<command-name>/code-review</command-name>")).toEqual(["review"]);
    expect(habitsIn('"Base directory for this skill: /Users/me/.claude/skills/update-docs\\n"')).toEqual(["docs"]);
    expect(habitsIn('{"content":"/simplify\\nthe store"}')).toEqual(["refactor"]);
  });

  it("finds nothing in plain talk", () => {
    expect(habitsIn('{"text":"are we done? see /tmp/x"}')).toEqual([]);
  });
});

describe("scanCraft", () => {
  it("reads Done cards' transcripts, keeps them in craft.json and skips one whose size hasn't changed", async () => {
    const file = transcript("s1", ['{"text":"/done"}']);
    const files = new Map([["s1", file], ["s2", transcript("s2", ['{"text":"/review"}'])]]);
    const cards = [card(), card({ id: "c2", sessionId: "s2", column: "review" }), card({ id: "c3", sessionId: undefined })];
    await scanCraft(cards, files);
    expect([...(craftHabits(cards).get("c1") ?? [])]).toEqual(["wrap", "commit"]);
    expect(craftHabits(cards).has("c2")).toBe(false);
    expect(JSON.parse(fs.readFileSync(CRAFT_FILE, "utf8"))).toEqual({ s1: [16, ["wrap", "commit"]] });

    // Same size: not read again (it would find nothing now), and craft.json isn't rewritten.
    fs.writeFileSync(file, '{"text":"/xyzw"}');
    fs.rmSync(CRAFT_FILE);
    await scanCraft(cards, files);
    expect(fs.existsSync(CRAFT_FILE)).toBe(false);
    expect([...(craftHabits(cards).get("c1") ?? [])]).toEqual(["wrap", "commit"]);
  });

  it("loads what an earlier run found, and reads a transcript again once it grows", async () => {
    const file = transcript("s1", ['{"text":"/done"}', '{"text":"/simplify"}']);
    fs.writeFileSync(CRAFT_FILE, JSON.stringify({ s1: [16, ["wrap"]] }));
    expect([...(craftHabits([card()]).get("c1") ?? [])]).toEqual(["wrap"]);
    await scanCraft([card()], new Map([["s1", file]]));
    expect([...(craftHabits([card()]).get("c1") ?? [])]).toEqual(["wrap", "commit", "refactor"]);
  });

  it("starts empty from a broken craft.json and skips a transcript that's gone", async () => {
    fs.writeFileSync(CRAFT_FILE, "{nope");
    await scanCraft([card()], new Map([["s1", path.join(dir, "gone.jsonl")]]));
    expect(craftHabits([card()]).size).toBe(0);
    expect(fs.readFileSync(CRAFT_FILE, "utf8")).toBe("{nope");
  });

  it("shares the scan already running", async () => {
    const files = new Map([["s1", transcript("s1", ['{"text":"/done"}'])]]);
    const first = scanCraft([card()], files);
    expect(scanCraft([card()], files)).toBe(first);
    await first;
    expect(scanCraft([card()], files)).not.toBe(first);
  });
});
