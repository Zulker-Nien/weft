import { describe, expect, it } from "vitest";
import type { ActivityEvent, DayTally } from "./game";
import { attributes, classFor, stackSkills, thriftScore, type Attribute, type AttributeInput } from "./game-attributes";
import { CHECKS, type ProjectReport } from "./project-badges";

const ev = (kind: ActivityEvent["kind"], card: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `${kind}${card}`, kind, at: 1, card, cwd: "/a", ...extra });
const day = (d: Partial<DayTally>): DayTally => ({ cards: 0, turns: 0, done: 0, xp: 0, ...d });

function input(overrides: Partial<AttributeInput> = {}): AttributeInput {
  return { events: [], days: new Map(), today: "2026-10-11", bestStreak: 0, projects: [], projectCount: 0, stacks: 0, ...overrides };
}

const value = (list: Attribute[], id: Attribute["id"]) => list.find((a) => a.id === id)?.value;

describe("attributes", () => {
  it("is zeros (and a middling thrift) with no history", () => {
    const list = attributes(input());
    expect(list.map((a) => a.value)).toEqual([0, 0, 0, 0, 0, 0, 0, 50]);
    expect(list.find((a) => a.id === "thrift")?.hint).toBe("No costs recorded yet");
  });

  it("measures follow-through, velocity, range, craft, stamina and thrift", () => {
    const events = [
      ev("created", "a"), ev("created", "b"), ev("created", "c"), ev("created", "d"),
      ev("done", "a", { cost: 0.1, title: "Refactor the store" }),
      ev("done", "b", { cost: 0.1 }),
      ev("done", "c"),
    ];
    const days = new Map([
      ["2026-10-11", day({ done: 2, cards: 1 })],
      ["2026-10-10", day({ done: 1 })],
      ["2026-09-01", day({ done: 9 })],
    ]);
    const list = attributes(input({ events, days, bestStreak: 30, projectCount: 4, stacks: 5 }));
    expect(value(list, "follow")).toBe(75);
    expect(value(list, "velocity")).toBe(15);
    expect(value(list, "range")).toBe(39);
    expect(value(list, "craft")).toBe(100);
    expect(value(list, "stamina")).toBe(Math.round((2 / 30) * 80 + 20));
    expect(value(list, "thrift")).toBe(100);
    expect(list.find((a) => a.id === "thrift")?.hint).toBe("$0.10 per shipped card");
  });

  it("scores rigor and guard from the projects' trees", () => {
    const testing = Object.fromEntries(CHECKS.filter((c) => c.branch === "testing").map((c) => [c.id, true]));
    const p = (ok: Record<string, boolean>): ProjectReport => ({ root: "/a", name: "a", stack: [], ok, score: 0, coverage: null, perfect: false, clean: false });
    const list = attributes(input({ projects: [p(testing), p({ envIgnored: true })] }));
    expect(value(list, "rigor")).toBe(50);
    expect(value(list, "guard")).toBe(5);
  });
});

describe("thriftScore", () => {
  it("runs from 100 at 10 cents down to 0 at $5", () => {
    expect(thriftScore(0.05)).toBe(100);
    expect(thriftScore(5)).toBe(0);
    expect(thriftScore(50)).toBe(0);
    expect(thriftScore(null)).toBe(50);
  });
});

describe("classFor", () => {
  const a = (id: Attribute["id"], v: number): Attribute => ({ id, icon: "", label: id, value: v, hint: "" });
  it("names the best attribute after the second best's adjective", () => {
    expect(classFor([a("follow", 90), a("velocity", 80), a("guard", 10)])).toBe("Swift Finisher");
    expect(classFor([a("guard", 90)])).toBe("Guardian");
    expect(classFor([])).toBe("Apprentice");
  });
});

describe("stackSkills", () => {
  it("gives each shipped card's XP to its project's stack", () => {
    const events = [ev("done", "a"), ev("done", "b"), ev("done", "c", { cwd: "/b" }), ev("done", "d", { cwd: undefined }), ev("created", "e")];
    const skills = stackSkills(events, (cwd) => (cwd === "/a" ? ["Next.js", "Supabase"] : ["Electron"]));
    expect(skills).toEqual([
      { tech: "Next.js", xp: 20, level: 1 },
      { tech: "Supabase", xp: 20, level: 1 },
      { tech: "Electron", xp: 10, level: 1 },
    ]);
  });
});
