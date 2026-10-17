import { describe, expect, it } from "vitest";
import { ago, cardLines, clock, overlaps, questionText, recentDone, span, spend, urgency } from "./copilot-context";
import type { Card } from "./types";

const NOW = Date.UTC(2026, 9, 16, 14, 54);
const H = 3_600_000;
const card = (over: Partial<Card>): Card =>
  ({ id: "a", title: "Fix login", cwd: "/x/weft", column: "review", createdAt: NOW - 9 * H, updatedAt: NOW - 9 * H, ...over }) as Card;

describe("urgency and time", () => {
  it("ranks waiting on you, errored, review, running, backlog", () => {
    expect([
      urgency(card({ column: "needs_you" })),
      urgency(card({ column: "running", pending: { title: "x" } as Card["pending"] })),
      urgency(card({ column: "running", error: "x" })),
      urgency(card({})),
      urgency(card({ column: "running" })),
      urgency(card({ column: "backlog" })),
    ]).toEqual([0, 0, 1, 2, 3, 4]);
  });
  it("says spans in minutes, hours and days", () => {
    expect([span(-5), span(10 * 60_000), span(3 * H), span(50 * H)]).toEqual(["1m", "10m", "3h", "2d"]);
    expect(ago(undefined, NOW)).toBeUndefined();
    expect(ago(NOW - 2 * H, NOW)).toBe("2h");
  });
  it("names the day and time", () => {
    expect(clock(NOW)).toMatch(/^Friday \d\d:54$/);
  });
});

describe("questionText", () => {
  it("spells out every option's meaning", () => {
    expect(
      questionText({ question: "Which sign-in?", options: [{ label: "Option A", description: "GitHub only" }, { label: "Option B" }] }),
    ).toBe('Which sign-in? Options: "Option A" (GitHub only); "Option B"');
  });
});

describe("cardLines", () => {
  it("lists open cards most urgent and oldest first, with everything they say", () => {
    const lines = cardLines(
      [
        card({ id: "r", columnAt: NOW - 2 * H, stage: "Polishing", remaining: "commit", lastLine: "Done, tests pass", suggestion: "Ship it" }),
        card({ id: "n", column: "needs_you", columnAt: NOW - 48 * H, pending: { title: "AskUserQuestion", questions: [{ question: "Auth?", options: [{ label: "A", description: "GitHub only" }] }] } as Card["pending"] }),
        card({ id: "p", column: "needs_you", columnAt: NOW - H, pending: { title: "Run rm -rf build?" } as Card["pending"] }),
        card({ id: "e", column: "running", error: "Boom\nstack", rateLimitHit: true, remaining: "none", lastActivity: NOW - 5 * 60_000 }),
        card({ id: "b", column: "backlog" }),
        card({ id: "d", column: "done" }),
        card({ id: "x", archived: true }),
        card({ id: "c", role: "copilot" }),
      ],
      NOW,
    );
    expect(lines).toEqual([
      '- [needs_you for 2d] · weft · "Fix login" · (id n)\n  asks: Auth? Options: "A" (GitHub only)',
      '- [needs_you for 1h] · weft · "Fix login" · (id p)\n  asks permission: Run rm -rf build?',
      '- [running for 5m] · weft · "Fix login" · (id e)\n  error: Boom\n  stopped by the plan\'s rate limit',
      '- [review for 2h] · weft · "Fix login" · (id r) · stage Polishing · left: commit\n  last reply: Done, tests pass\n  suggested next message: Ship it',
      '- [backlog] · weft · "Fix login" · (id b)',
    ]);
  });
});

describe("recentDone, overlaps, spend", () => {
  it("lists the last day's finished cards, newest first", () => {
    const cards = [
      card({ id: "1", column: "done", title: "Old", columnAt: NOW - 30 * H }),
      card({ id: "2", column: "done", title: "Billing", columnAt: NOW - 3 * H }),
      card({ id: "3", column: "done", title: "Tags", columnAt: NOW - H }),
      card({ id: "4", column: "done", title: "No time" }),
      card({ id: "5", column: "done", role: "copilot", columnAt: NOW }),
    ];
    expect(recentDone(cards, NOW)).toEqual(['- weft · "Tags" (1h ago)', '- weft · "Billing" (3h ago)']);
  });

  it("finds open cards editing the same file", () => {
    const cards = [
      card({ id: "1", title: "A", touchedFiles: ["/x/weft/Board.tsx", "/x/weft/a.ts"] }),
      card({ id: "2", title: "B", touchedFiles: ["/x/weft/Board.tsx"] }),
      card({ id: "3", title: "C", column: "done", touchedFiles: ["/x/weft/a.ts"] }),
      card({ id: "4", title: "D" }),
    ];
    expect(overlaps(cards)).toEqual(['- Board.tsx: "A" (id 1), "B" (id 2)']);
  });

  it("sums the day's spend and reads the latest limits", () => {
    const cards = [
      card({ costUsd: 1.5, lastActivity: NOW - H, stats: { fiveHour: { used: 40 } } }),
      card({ costUsd: 2, lastActivity: NOW - 2 * H }),
      card({ costUsd: 9, lastActivity: NOW - 30 * H }),
      card({ lastActivity: NOW - 10 * 60_000, stats: { fiveHour: { used: 96.4, resetsAt: (NOW + 2 * H) / 1000 }, sevenDay: { used: 2 } } }),
    ];
    expect(spend(cards, NOW)).toEqual(["- $3.50 spent on cards active in the last day", "- plan limits: 5-hour window 96% used, resets in 2h; weekly 2% used"]);
    expect(spend([card({})], NOW)).toEqual([]);
  });
});
