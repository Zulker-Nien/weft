import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const cards = new Map<string, Card>();

vi.mock("./store", () => ({
  getCard: (id: string) => cards.get(id),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => cards.set(id, { ...(cards.get(id) as Card), ...patch })),
}));
vi.mock("./activity", () => ({ recordLimit: vi.fn() }));

const { recordLimit } = await import("./activity");
const { hitRateLimit } = await import("./rate-limit");

const card = (over: Partial<Card> = {}): Card => ({
  id: "c1", title: "t", prompt: "", cwd: "/repo", backend: "claude", permissionMode: "default", column: "running", createdAt: 1, updatedAt: 1, ...over,
});

beforeEach(() => {
  cards.clear();
  vi.mocked(recordLimit).mockClear();
});

const logged = () => vi.mocked(recordLimit).mock.calls.map((c) => c[0]);

describe("hitRateLimit", () => {
  it("parks the card in Needs you and logs the window the message names", () => {
    cards.set("c1", card());
    hitRateLimit("c1", "claude", "You've hit your session limit · resets 4am");
    expect(cards.get("c1")).toMatchObject({ column: "needs_you", rateLimitHit: true, lastLine: "Claude Code hit its plan limit" });
    expect(logged()).toEqual(["five_hour"]);
  });

  it("logs the weekly window when the card saw it full and the message doesn't say", () => {
    cards.set("c1", card({ stats: { sevenDay: { used: 100 } } }));
    hitRateLimit("c1", "claude", "You've hit your limit");
    hitRateLimit("c1", "claude", "Rate limit exceeded");
    hitRateLimit("c1", "claude", "You've hit your session limit");
    expect(logged()).toEqual(["seven_day", "seven_day", "five_hour"]);
  });

  it("leaves out the API's own rate limits and cards that are gone", () => {
    cards.set("c1", card());
    hitRateLimit("c1", "claude", "API Error: Rate limit reached");
    hitRateLimit("gone", "claude", "You've hit your limit");
    expect(logged()).toEqual([]);
    expect(cards.has("gone")).toBe(false);
  });
});
