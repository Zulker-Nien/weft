// lib/public-profile.ts: the new builder-card, league, and apps branches of loadPublicProfile.
// The shared fake service helper is in lib/public-profile.harness.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appRow,
  fromTable,
  leagueRow,
  profileCardRow,
  profileRow,
} from "./public-profile.harness";

const { serviceClient: serviceClientMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
}));

async function load() {
  vi.resetModules();
  return import("./public-profile");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPublicProfile (card / league / apps)", () => {
  it("parses the builder card and sets cardAt when profile_cards has a row", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: profileCardRow(), error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.card).toMatchObject({ className: "Finisher", level: { title: "Thread" } });
    expect(result?.cardAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("returns card null and cardAt null when the card is unparseable", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    // No level block → parseProfileCard returns null; cardAt should then be null too.
    const card = fromTable("profile_cards", { card: { row: { card: { className: "x" }, updated_at: "2026-10-15" }, error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.card).toBeNull();
    expect(result?.cardAt).toBeNull();
  });

  it("returns card null and cardAt null when the profile_cards read errors", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: { message: "denied" } } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.card).toBeNull();
    expect(result?.cardAt).toBeNull();
  });

  it("returns card null and cardAt null when there is no profile_cards row", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.card).toBeNull();
    expect(result?.cardAt).toBeNull();
  });

  it("computes league rank and size from the latest row and the cohort xps", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    // Latest row has 120 XP. Cohort xps: [200, 150, 120, 50]. Rank = (xps > 120) + 1 = 3. Size = 4.
    const league = fromTable("league_weeks", { league: { latest: leagueRow({ xp: 120 }), league: [{ xp: 200 }, { xp: 150 }, { xp: 120 }, { xp: 50 }], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.league).toEqual({ name: "Linen", tier: 1, week: "2026-10-12", xp: 120, shipped: 4, rank: 3, size: 4 });
  });

  it("clamps league size to at least the rank when the cohort is empty", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    // No peers in the cohort. xps filter is 0, rank = 1. size = Math.max(0, 1) = 1.
    const league = fromTable("league_weeks", { league: { latest: leagueRow({ xp: 120 }), league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.league).toMatchObject({ rank: 1, size: 1 });
  });

  it("treats a null cohort query result as an empty list (size still >= rank)", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    // Inline league builder so the cohort query resolves to { data: null } (the ?? [] fallback fires).
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: leagueRow({ xp: 120 }), error: null }));
    Object.defineProperty(chain, "then", {
      get() {
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      },
    });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? chain : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.league).toMatchObject({ rank: 1, size: 1 });
  });

  it("returns league: null when there is no latest row", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.league).toBeNull();
  });

  it("returns league: null when the league query throws", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    // Replace the league builder's `.then` so awaiting it throws — latestLeague's try/catch turns it into null.
    const throwChain: Record<string, unknown> = {};
    throwChain.select = vi.fn(() => throwChain);
    throwChain.eq = vi.fn(() => throwChain);
    throwChain.order = vi.fn(() => throwChain);
    throwChain.limit = vi.fn(() => throwChain);
    throwChain.maybeSingle = vi.fn(() => Promise.resolve({ data: leagueRow(), error: null }));
    Object.defineProperty(throwChain, "then", {
      get() {
        return () => {
          throw new Error("league down");
        };
      },
    });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? throwChain : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.league).toBeNull();
  });

  it("lists apps with a name fallback to 'Mini app' for blank names", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: [appRow({ id: "a1", name: "Growth" }), appRow({ id: "a2", name: "   " }), appRow({ id: "a3", name: "" })], error: null } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.apps).toEqual([
      { id: "a1", name: "Growth" },
      { id: "a2", name: "Mini app" },
      { id: "a3", name: "Mini app" },
    ]);
  });

  it("returns apps: [] when the apps read errors", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const card = fromTable("profile_cards", { card: { row: null, error: null } });
    const league = fromTable("league_weeks", { league: { latest: null, league: [], error: null } });
    const apps = fromTable("cloud_app_shares", { apps: { rows: null, error: { message: "denied" } } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = {
      from: (t: string) => t === "profiles" ? profiles : t === "cloud_shares" ? shares : t === "profile_cards" ? card : t === "league_weeks" ? league : t === "cloud_app_shares" ? apps : null,
      auth: { admin },
    } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.apps).toEqual([]);
  });
});
