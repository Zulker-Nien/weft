// lib/profile-card.ts: the public builder card on weft.zip/@username. The Mac builds it (profileCard)
// from the game state and the gh profile; the page reads the row back (parseProfileCard) with every
// field clamped and cut to size, so a post can't smuggle a javascript: URL through.
import { describe, expect, it } from "vitest";
import { profileCard, safeUrl } from "./profile-card";
import { game, gh } from "./profile-card.harness";

describe("profileCard", () => {
  it("maps the game fields the page draws, with usage tokens summed", () => {
    const card = profileCard(game(), gh());
    expect(card.className).toBe("Finisher");
    expect(card.xp).toBe(120);
    expect(card.level).toEqual({ level: 2, title: "Thread", floor: 40, next: 160 });
    expect(card.streak).toEqual({ current: 4, best: 9, freezes: 1 });
    expect(card.totals).toEqual({ started: 10, shipped: 6 });
    expect(card.attributes).toEqual([{ icon: "🎯", label: "Follow-through", value: 80, hint: "8 of 10" }]);
    expect(card.skills).toEqual([{ tech: "Next.js", level: 3 }]);
    expect(card.badgeCount).toBe(3);
    expect(card.cloth).toEqual([
      { day: "2026-10-10", xp: 5, tone: 1 },
      { day: "2026-10-11", xp: 17, tone: 4 },
    ]);
    // tokens = input + output per usage row.
    expect(card.usage).toEqual([
      { day: "2026-10-10", tokens: 0, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-11", tokens: 1_500_000, fiveHour: 1, sevenDay: 1 },
    ]);
    expect(card.limitHits).toEqual({ fiveHour: 3, sevenDay: 1 });
    expect(card.records.biggestDay).toEqual({ day: "2026-10-09", cards: 9 });
    expect(card.records.mostShipped).toEqual({ day: "2026-10-08", done: 4 });
    expect(card.records.fastestMs).toBe(5 * 60_000);
    expect(card.records.maxRunning).toBe(2);
  });

  it("keeps only unlocked badges, sorted newest first; badgeCount is the full total", () => {
    const card = profileCard(game(), gh());
    expect(card.badges).toEqual([
      { icon: "⚡", name: "Faster", desc: "Shipped in <5m", group: "Habits", at: 5 },
      { icon: "🧵", name: "First thread", desc: "Start a card", group: "Milestones", at: 1 },
    ]);
    expect(card.badgeCount).toBe(3);
  });

  it("treats a null unlock timestamp as 0 when sorting", () => {
    const card = profileCard(
      game({
        badges: [
          { id: "a", icon: "🅰️", name: "A", desc: "a", group: "Habits", unlocked: true, at: null as unknown as number },
          { id: "b", icon: "🅱️", name: "B", desc: "b", group: "Habits", unlocked: true, at: 2 },
          { id: "c", icon: "🅲", name: "C", desc: "c", group: "Habits", unlocked: true, at: null as unknown as number },
        ],
      }),
      gh(),
    );
    // The "at: null" badges sort before the at: 2 one (0 < 2); both surface because unlocked is true.
    // The two null-at badges share the same 0 sort key, so order between them is stable.
    expect(card.badges).toEqual([
      { icon: "🅱️", name: "B", desc: "b", group: "Habits", at: 2 },
      { icon: "🅰️", name: "A", desc: "a", group: "Habits", at: null },
      { icon: "🅲", name: "C", desc: "c", group: "Habits", at: null },
    ]);
  });

  it("sets the github block when a profile is given", () => {
    const card = profileCard(game(), gh());
    expect(card.github).toEqual({
      login: "alex",
      bio: "Hello",
      company: "@co",
      location: "Berlin",
      blog: "https://example.com/",
      followers: 12,
      publicRepos: 3,
    });
  });

  it("passes github null through as null on the card", () => {
    const card = profileCard(game(), null);
    expect(card.github).toBeNull();
  });

  it("passes an undefined github through as null on the card", () => {
    const card = profileCard(game(), undefined);
    expect(card.github).toBeNull();
  });
});

describe("safeUrl", () => {
  it("keeps http and https URLs (URL parser normalizes a bare host to a trailing slash)", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
    expect(safeUrl("http://example.com/")).toBe("http://example.com/");
  });

  it("rejects a javascript: URL", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects a data: URL", () => {
    expect(safeUrl("data:text/html,<script>1</script>")).toBeNull();
  });

  it("returns null for a string that isn't a URL", () => {
    expect(safeUrl("not a url")).toBeNull();
  });

  it("returns null for empty / whitespace / non-string input", () => {
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("   ")).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(123)).toBeNull();
  });

  it("returns null when the URL throws (e.g. bad scheme)", () => {
    // `://no-scheme` parses but throws on `new URL()` because there's no protocol; try/catch covers it.
    expect(safeUrl("://no-scheme")).toBeNull();
  });
});
