// lib/profile-card.ts: parseProfileCard reads the row back from profile_cards with every field
// clamped and cut to size, so a post can't smuggle a javascript: URL through. game() and gh() are
// exported from lib/profile-card.test.ts so the round-trip test can build a real card.
import { describe, expect, it } from "vitest";
import { parseProfileCard, profileCard } from "./profile-card";
import { game, gh } from "./profile-card.harness";

describe("parseProfileCard", () => {
  it("round-trips a full profileCard into the same shape", () => {
    const built = profileCard(game(), gh());
    const parsed = parseProfileCard(built);
    expect(parsed).toEqual(built);
  });

  it("returns null when the input isn't an object", () => {
    expect(parseProfileCard(null)).toBeNull();
    expect(parseProfileCard("hello")).toBeNull();
    expect(parseProfileCard(42)).toBeNull();
    expect(parseProfileCard([])).toBeNull();
  });

  it("returns null when the level block is missing", () => {
    // A bare object with no level: the gate is the level block.
    expect(parseProfileCard({ className: "Finisher", xp: 10 })).toBeNull();
    expect(parseProfileCard({ level: "nope" })).toBeNull();
    expect(parseProfileCard({ level: [] })).toBeNull();
  });

  it("defaults className to Apprentice and level title to Thread", () => {
    const parsed = parseProfileCard({ level: { level: 1, title: "" } });
    expect(parsed?.className).toBe("Apprentice");
    expect(parsed?.level.title).toBe("Thread");
  });

  it("clamps numbers into their bounds, defaulting at the floor", () => {
    const parsed = parseProfileCard({
      level: { level: -3, title: "T", floor: -50, next: 1e15 },
      xp: -10,
      streak: { current: -1, best: -2, freezes: 99 },
      totals: { started: -1, shipped: 1e15 },
      limitHits: { fiveHour: -1, sevenDay: 1e15 },
      records: { maxRunning: 1e7 },
      badgeCount: -1,
    });
    expect(parsed?.level).toEqual({ level: 1, title: "T", floor: 0, next: 1e12 });
    expect(parsed?.xp).toBe(0);
    expect(parsed?.streak).toEqual({ current: 0, best: 0, freezes: 10 });
    expect(parsed?.totals).toEqual({ started: 0, shipped: 1e12 });
    expect(parsed?.limitHits).toEqual({ fiveHour: 0, sevenDay: 100_000 });
    expect(parsed?.records.maxRunning).toBe(10_000);
    expect(parsed?.badgeCount).toBe(0);
  });

  it("drops non-finite and non-number fields when clamping", () => {
    const parsed = parseProfileCard({
      level: { level: "x", title: "T" },
      xp: Number.NaN,
    });
    // level.level falls back to 1 (min default); xp falls back to 0.
    expect(parsed?.level.level).toBe(1);
    expect(parsed?.xp).toBe(0);
  });

  it("rounds numbers through Math.round inside the clamp", () => {
    const parsed = parseProfileCard({ level: { level: 2.6, title: "T" }, xp: 5.4 });
    expect(parsed?.level.level).toBe(3);
    expect(parsed?.xp).toBe(5);
  });

  it("cuts strings to their max length and drops empty / non-string ones", () => {
    const parsed = parseProfileCard({
      className: "  ",
      level: { level: 1, title: "   " },
      attributes: [
        { icon: "🎯", label: "  ", value: 1, hint: "h" }, // dropped (no label)
        { icon: "🎯", label: "L", value: 999, hint: "   " }, // value clamped to 100, hint defaults ""
        { icon: "", label: "L2", value: 1, hint: "h" }, // icon defaults to "•"
        "not an object", // dropped
      ],
      skills: [
        { tech: "  ", level: 1 }, // dropped
        { tech: "React", level: 999_999 }, // level clamped to 1000
        null, // dropped
      ],
      badges: [
        { icon: "", name: "B", desc: "", group: "", at: -1 }, // icon default 🏅, group default Milestones, at clamps to 0
        { icon: "", name: "B2", desc: "", group: "", at: "soon" }, // non-number at → null
        { icon: "", name: "  ", desc: "", group: "" }, // blank name → dropped
      ],
    });
    expect(parsed?.attributes).toEqual([
      { icon: "🎯", label: "L", value: 100, hint: "" },
      { icon: "•", label: "L2", value: 1, hint: "h" },
    ]);
    expect(parsed?.skills).toEqual([{ tech: "React", level: 1000 }]);
    expect(parsed?.badges).toEqual([
      { icon: "🏅", name: "B", desc: "", group: "Milestones", at: 0 },
      { icon: "🏅", name: "B2", desc: "", group: "Milestones", at: null },
    ]);
  });

  it("drops rows with bad day strings or no name", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      cloth: [
        { day: "2026-10-11", xp: 1, tone: 0 },
        { day: "nope", xp: 1, tone: 0 },
        { day: 42, xp: 1, tone: 0 },
      ],
      usage: [
        { day: "2026-10-11", tokens: 1, fiveHour: 0, sevenDay: 0 },
        { day: "not-a-date", tokens: 1, fiveHour: 0, sevenDay: 0 },
      ],
    });
    expect(parsed?.cloth).toEqual([{ day: "2026-10-11", xp: 1, tone: 0 }]);
    expect(parsed?.usage).toEqual([{ day: "2026-10-11", tokens: 1, fiveHour: 0, sevenDay: 0 }]);
  });

  it("rejects a javascript: blog URL and a github login with bad chars", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      github: { login: "alex!", blog: "javascript:alert(1)" },
    });
    expect(parsed?.github).toBeNull();
  });

  it("keeps a github block with a valid login and safe blog", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      github: { login: "alex", blog: "https://example.com/", followers: 5 },
    });
    expect(parsed?.github).toMatchObject({ login: "alex", blog: "https://example.com/", followers: 5 });
  });

  it("parses records with biggestDay, mostShipped, fastestMs and maxRunning", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      records: {
        biggestDay: { day: "2026-10-09", cards: 9 },
        mostShipped: { day: "2026-10-08", done: 4 },
        fastestMs: 5_000,
        maxRunning: 2,
      },
    });
    expect(parsed?.records).toEqual({
      biggestDay: { day: "2026-10-09", cards: 9 },
      mostShipped: { day: "2026-10-08", done: 4 },
      fastestMs: 5_000,
      maxRunning: 2,
    });
  });

  it("drops biggestDay/mostShipped when the day string is bad or the object is missing", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      records: { biggestDay: { day: "bad", cards: 9 }, mostShipped: null, fastestMs: 10, maxRunning: 2 },
    });
    expect(parsed?.records).toEqual({ biggestDay: null, mostShipped: null, fastestMs: 10, maxRunning: 2 });
  });

  it("keeps records with only biggestDay and only fastestMs", () => {
    const onlyBig = parseProfileCard({
      level: { level: 1, title: "T" },
      records: { biggestDay: { day: "2026-10-09", cards: 9 } },
    });
    expect(onlyBig?.records.biggestDay).toEqual({ day: "2026-10-09", cards: 9 });
    expect(onlyBig?.records.mostShipped).toBeNull();
    expect(onlyBig?.records.fastestMs).toBeNull();

    const onlyFast = parseProfileCard({
      level: { level: 1, title: "T" },
      records: { fastestMs: 500 },
    });
    expect(onlyFast?.records.fastestMs).toBe(500);
    expect(onlyFast?.records.biggestDay).toBeNull();
  });

  it("uses empty objects when streak / totals / limitHits are missing", () => {
    const parsed = parseProfileCard({ level: { level: 1, title: "T" } });
    expect(parsed?.streak).toEqual({ current: 0, best: 0, freezes: 0 });
    expect(parsed?.totals).toEqual({ started: 0, shipped: 0 });
    expect(parsed?.limitHits).toEqual({ fiveHour: 0, sevenDay: 0 });
  });

  it("treats list fields that aren't arrays as empty", () => {
    const parsed = parseProfileCard({
      level: { level: 1, title: "T" },
      attributes: "nope",
      skills: null,
      badges: 42,
      cloth: { day: "2026-10-11" },
      usage: undefined,
    });
    expect(parsed?.attributes).toEqual([]);
    expect(parsed?.skills).toEqual([]);
    expect(parsed?.badges).toEqual([]);
    expect(parsed?.cloth).toEqual([]);
    expect(parsed?.usage).toEqual([]);
  });

  it("caps a list at its max length", () => {
    const attrs = Array.from({ length: 10 }, (_, i) => ({ icon: "🎯", label: `L${i}`, value: 1, hint: "h" }));
    const parsed = parseProfileCard({ level: { level: 1, title: "T" }, attributes: attrs });
    expect(parsed?.attributes).toHaveLength(7); // ATTRS cap.
  });

  it("treats records as {} when the field is missing or not an object", () => {
    const parsed = parseProfileCard({ level: { level: 1, title: "T" } });
    expect(parsed?.records).toEqual({ biggestDay: null, mostShipped: null, fastestMs: null, maxRunning: 0 });
  });

  it("treats github as null when the block is missing", () => {
    const parsed = parseProfileCard({ level: { level: 1, title: "T" } });
    expect(parsed?.github).toBeNull();
  });

  it("parses an array as null (the gate excludes arrays)", () => {
    // Sanity: the gate is "not an object", which excludes arrays. A bare array still falls into the gate.
    expect(parseProfileCard([])).toBeNull();
  });
});
