import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeagueEntry } from "./league";

const account = vi.hoisted(() => ({ client: vi.fn() }));
const profileCardSync = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("./account", () => ({ accountClient: account.client }));
vi.mock("./game-server", () => ({
  gameState: vi.fn(() => ({ weekXp: 50, weekShipped: 2, streak: { current: 3 }, level: { level: 4 }, badges: [] })),
}));
vi.mock("./profile-card-sync", () => ({ syncProfileCard: profileCardSync.sync }));

const { FIRST_SYNC_MS, leagueView, NOT_DEPLOYED, startLeagueSync, SYNC_MS, syncWeek } = await import("./league-sync");

const ENTRY: LeagueEntry = { week: "2026-10-12", xp: 120, shipped: 4, streak: 9, level: 6, badges: [{ icon: "🔥", name: "Hot" }] };
const STANDING = {
  rank: 1, user_id: "u1", name: "Alex", avatar_url: null, username: "fotoflo", xp: 120, shipped: 4, streak: 9, level: 6,
  badges: [], is_me: true, tier: 1, size: 1,
};

function fake({ session = true, submitError = null as string | null, submitCode = undefined as string | undefined, standings = [STANDING] as unknown[] | null, standingsError = null as string | null } = {}) {
  const rpc = vi.fn((name: string) =>
    Promise.resolve(
      name === "league_submit"
        ? { error: submitError ? { message: submitError, code: submitCode } : null }
        : { data: standings, error: standingsError ? { message: standingsError } : null },
    ),
  );
  const client = { auth: { getSession: () => Promise.resolve({ data: { session: session ? { user: { id: "u1" } } : null } }) }, rpc };
  return { client: client as unknown as SupabaseClient, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  profileCardSync.sync.mockResolvedValue(false);
  delete (globalThis as Record<string, unknown>).__weftLeagueSync;
});
afterEach(() => vi.useRealTimers());

describe("syncWeek", () => {
  it("posts this week's entry when signed in", async () => {
    const { client, rpc } = fake();
    expect(await syncWeek({ client: () => client, entry: () => ENTRY })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("league_submit", {
      p_week: "2026-10-12", p_xp: 120, p_shipped: 4, p_streak: 9, p_level: 6, p_badges: [{ icon: "🔥", name: "Hot" }],
    });
  });

  it("posts nothing signed out or without accounts", async () => {
    const { client, rpc } = fake({ session: false });
    expect(await syncWeek({ client: () => client, entry: () => ENTRY })).toBe(false);
    expect(await syncWeek({ client: () => null })).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("throws a failed post", async () => {
    const { client } = fake({ submitError: "nope" });
    await expect(syncWeek({ client: () => client, entry: () => ENTRY })).rejects.toThrow("nope");
  });

  it("defaults to the account client and your own game", async () => {
    const { client, rpc } = fake();
    account.client.mockReturnValue(client);
    expect(await syncWeek({ now: () => new Date(2026, 9, 17, 12).getTime() })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("league_submit", expect.objectContaining({ p_week: "2026-10-12", p_xp: 50, p_shipped: 2 }));
  });

  it("reads a build without accounts as signed out", async () => {
    account.client.mockImplementation(() => {
      throw new Error("Weft accounts aren't set up");
    });
    expect(await syncWeek()).toBe(false);
  });
});

describe("leagueView", () => {
  it("posts, then reads your league", async () => {
    const { client, rpc } = fake();
    const view = await leagueView({ client: () => client, entry: () => ENTRY });
    expect(rpc).toHaveBeenNthCalledWith(1, "league_submit", expect.anything());
    expect(rpc).toHaveBeenNthCalledWith(2, "league_standings", { p_week: "2026-10-12" });
    expect(view).toMatchObject({ state: "ready", league: "Linen", rows: [{ name: "Alex", isMe: true }] });
  });

  it("is signed out without a session", async () => {
    const { client } = fake({ session: false });
    expect(await leagueView({ client: () => client, entry: () => ENTRY })).toEqual({ state: "signed-out" });
  });

  it("is an empty league when the standings come back null", async () => {
    const { client } = fake({ standings: null });
    expect(await leagueView({ client: () => client, entry: () => ENTRY })).toMatchObject({ state: "ready", rows: [] });
  });

  it("says plainly when the leagues migration isn't on the server", async () => {
    const { client } = fake({ submitError: "Could not find the function public.league_submit in the schema cache", submitCode: "PGRST202" });
    expect(await leagueView({ client: () => client, entry: () => ENTRY })).toEqual({ state: "error", error: NOT_DEPLOYED });
  });

  it("reports a failed post or read", async () => {
    expect(await leagueView({ client: () => fake({ submitError: "down" }).client, entry: () => ENTRY })).toEqual({ state: "error", error: "down" });
    expect(await leagueView({ client: () => fake({ standingsError: "denied" }).client, entry: () => ENTRY })).toEqual({ state: "error", error: "denied" });
    const throwing = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- a non-Error throw is the branch under test
      throw "boom";
    };
    expect(await leagueView({ client: () => fake().client, entry: throwing })).toEqual({ state: "error", error: "boom" });
  });
});

describe("startLeagueSync", () => {
  it("posts after the first wait, then every SYNC_MS, once per server", async () => {
    vi.useFakeTimers();
    const { client, rpc } = fake();
    const stop = startLeagueSync({ client: () => client, entry: () => ENTRY });
    // A second call while the first is alive returns a no-op (it doesn't push more timers).
    const second = startLeagueSync({ client: () => client, entry: () => ENTRY });
    expect(typeof second).toBe("function");
    second();
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_MS);
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SYNC_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(SYNC_MS * 2);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("warns on a failed post and keeps going", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startLeagueSync({ client: () => fake({ submitError: "down" }).client, entry: () => ENTRY });
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_MS);
    expect(warn).toHaveBeenCalledWith("[weft] league sync failed:", expect.any(Error));
    stop();
    warn.mockRestore();
  });

  it("stays quiet while the server has no leagues yet", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startLeagueSync({ client: () => fake({ submitError: "missing", submitCode: "PGRST202" }).client, entry: () => ENTRY });
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_MS);
    expect(warn).not.toHaveBeenCalled();
    stop();
    warn.mockRestore();
  });

  it("calls syncProfileCard in the timer tick (using the deps client)", async () => {
    vi.useFakeTimers();
    const { client } = fake();
    const stop = startLeagueSync({ client: () => client, entry: () => ENTRY });
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_MS);
    // The deps client was the one passed in.
    const arg = profileCardSync.sync.mock.calls[0]![0] as { client: () => SupabaseClient | null };
    expect(arg.client()).toBe(client);
    stop();
  });

  it("catches and warns on a syncProfileCard rejection", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    profileCardSync.sync.mockRejectedValueOnce(new Error("card down"));
    const { client } = fake();
    const stop = startLeagueSync({ client: () => client, entry: () => ENTRY });
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_MS);
    expect(warn).toHaveBeenCalledWith("[weft] profile card sync failed:", expect.any(Error));
    stop();
    warn.mockRestore();
  });
});
