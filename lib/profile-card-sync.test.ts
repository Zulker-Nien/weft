// lib/profile-card-sync.ts: posts the public builder card to profile_cards on the league sync's timer
// while you're signed in. The same card twice in a row isn't posted again; a missing table is silent;
// any other error throws (the timer catches).
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileCard } from "./profile-card";

const cardMock = vi.hoisted(() => ({ get: vi.fn(), state: vi.fn(), profile: vi.fn() }));
const githubMock = vi.hoisted(() => ({ profile: vi.fn() }));

vi.mock("./game-server", () => ({
  gameState: cardMock.state,
}));
vi.mock("./github-profile", () => ({
  githubProfile: githubMock.profile,
}));
vi.mock("./signed-in-client", () => ({
  safeClient: () => null,
  signedIn: vi.fn(),
}));

const { syncProfileCard } = await import("./profile-card-sync");

const CARD: ProfileCard = {
  className: "Finisher",
  xp: 10,
  level: { level: 1, title: "Thread", floor: 0, next: 40 },
  streak: { current: 0, best: 0, freezes: 0 },
  totals: { started: 0, shipped: 0 },
  attributes: [],
  skills: [],
  badges: [],
  badgeCount: 0,
  cloth: [],
  usage: [],
  limitHits: { fiveHour: 0, sevenDay: 0 },
  records: { biggestDay: null, mostShipped: null, fastestMs: null, maxRunning: 0 },
  github: null,
};

function clientWith(rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>) {
  return { rpc } as unknown as SupabaseClient;
}

function uniqueCard(i: number): ProfileCard {
  return { ...CARD, xp: 100 + i };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module-level memo so each test gets a fresh "last card".
  delete (globalThis as Record<string, unknown>).__weftProfileCard;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("syncProfileCard", () => {
  it("returns false when there is no client", async () => {
    const ok = await syncProfileCard({ client: () => null, card: () => Promise.resolve(uniqueCard(1)) });
    expect(ok).toBe(false);
  });

  it("returns false when not signed in", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValueOnce(false);
    const rpc = vi.fn();
    const ok = await syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(uniqueCard(2)) });
    expect(ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("posts via rpc('profile_card_submit', {p_card}) and returns true on success", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValueOnce(true);
    const card = uniqueCard(3);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ok = await syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(card) });
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("profile_card_submit", { p_card: card });
  });

  it("skips an identical second post and returns false", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValue(true);
    const card = uniqueCard(4);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    expect(await syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(card) })).toBe(true);
    expect(await syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(card) })).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("returns false (no throw) on a PGRST202 error", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValueOnce(true);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "no function", code: "PGRST202" } });
    await expect(syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(uniqueCard(5)) })).resolves.toBe(false);
  });

  it("throws on any other error", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValueOnce(true);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "denied", code: "PGRST301" } });
    await expect(syncProfileCard({ client: () => clientWith(rpc), card: () => Promise.resolve(uniqueCard(6)) })).rejects.toThrow("denied");
  });

  it("builds its own card by default (gameState + githubProfile)", async () => {
    const signedIn = await import("./signed-in-client");
    vi.mocked(signedIn.signedIn).mockResolvedValueOnce(true);
    cardMock.state.mockReturnValue({ className: "X", xp: 1, level: { level: 1, title: "T", floor: 0, next: 0 }, streak: { current: 0, best: 0, freezes: 0 }, totals: { started: 0, shipped: 0 }, attributes: [], skills: [], badges: [], cloth: [], usage: [], limitHits: { fiveHour: 0, sevenDay: 0 }, records: { biggestDay: null, mostShipped: null, fastest: null, maxRunning: 0 } });
    githubMock.profile.mockResolvedValue(null);
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    // safeClient returns null by default (the module mock above), so we pass our own client.
    const ok = await syncProfileCard({ client: () => clientWith(rpc) });
    expect(ok).toBe(true);
    expect(cardMock.state).toHaveBeenCalled();
    expect(githubMock.profile).toHaveBeenCalled();
    const call = rpc.mock.calls[0] as [string, { p_card: unknown }];
    expect(call[0]).toBe("profile_card_submit");
    expect(call[1].p_card).toBeDefined();
  });
});