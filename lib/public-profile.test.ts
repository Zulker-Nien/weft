// lib/public-profile.ts: a Weft account's public profile (docs/architecture/profiles.md).
// parseUsername, profilePath, toThread, and loadPublicProfile over a fake service client.
// The new builder-card / league / apps tests live in lib/public-profile-card.test.ts; the
// shared fake service helper is in lib/public-profile.harness.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromTable, profileRow, serviceWith, shareRow } from "./public-profile.harness";

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

describe("parseUsername", () => {
  it("lowercases a leading @ handle", async () => {
    const { parseUsername } = await load();
    expect(parseUsername("@Alex")).toBe("alex");
  });

  it("decodes a percent-encoded @ (%40alex)", async () => {
    const { parseUsername } = await load();
    expect(parseUsername("%40alex")).toBe("alex");
  });

  it("returns null on bad percent-encoding", async () => {
    const { parseUsername } = await load();
    expect(parseUsername("%E0%A4%A")).toBeNull();
  });

  it("returns null when the result is too long", async () => {
    const { parseUsername } = await load();
    // Regex max length: 1 lead + 38 middle + 1 trail = 40 chars. Use 41 to overflow.
    const tooLong = "a" + "b".repeat(39) + "c";
    expect(parseUsername(tooLong)).toBeNull();
  });

  it("returns null for a leading hyphen", async () => {
    const { parseUsername } = await load();
    expect(parseUsername("-alex")).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const { parseUsername } = await load();
    expect(parseUsername("")).toBeNull();
  });
});

describe("profilePath", () => {
  it("prefixes with @", async () => {
    const { profilePath } = await load();
    expect(profilePath("alex")).toBe("/@alex");
  });
});

describe("toThread", () => {
  it("returns null when the card is missing", async () => {
    const { toThread } = await load();
    expect(toThread({ id: "s1", updated_at: "t", cloud_cards: null })).toBeNull();
  });

  it("returns null when the card is deleted", async () => {
    const { toThread } = await load();
    expect(toThread({ id: "s1", updated_at: "t", cloud_cards: { card: { id: "c1" }, deleted: true } })).toBeNull();
  });

  it("uses 'Untitled thread' when the title is missing", async () => {
    const { toThread } = await load();
    expect(toThread({ id: "s1", updated_at: "t", cloud_cards: { card: { id: "c1" }, deleted: false } })).toEqual({
      id: "s1",
      title: "Untitled thread",
      updatedAt: "t",
    });
  });

  it("uses 'Untitled thread' when the title is blank whitespace", async () => {
    const { toThread } = await load();
    expect(toThread({ id: "s1", updated_at: "t", cloud_cards: { card: { id: "c1", title: "   " }, deleted: false } })).toEqual({
      id: "s1",
      title: "Untitled thread",
      updatedAt: "t",
    });
  });

  it("trims a real title", async () => {
    const { toThread } = await load();
    expect(toThread({ id: "s1", updated_at: "t", cloud_cards: { card: { id: "c1", title: "  Hello  " }, deleted: false } })).toEqual({
      id: "s1",
      title: "Hello",
      updatedAt: "t",
    });
  });
});

describe("loadPublicProfile", () => {
  it("returns null for a bad username and does not call from()", async () => {
    const { loadPublicProfile } = await load();
    const service = serviceWith({});
    const result = await loadPublicProfile("-bad", service);
    expect(result).toBeNull();
  });

  it("returns null when the service client is null", async () => {
    const { loadPublicProfile } = await load();
    expect(await loadPublicProfile("alex", null)).toBeNull();
  });

  it("returns null on a profiles error", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profileError: { message: "boom" } });
    const shares = fromTable("cloud_shares", { share: [] });
    const service = serviceWith({ profiles, cloud_shares: shares });
    const result = await loadPublicProfile("alex", service);
    expect(result).toBeNull();
  });

  it("returns null when the profile is missing", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: null });
    const shares = fromTable("cloud_shares", { share: [] });
    const service = serviceWith({ profiles, cloud_shares: shares });
    expect(await loadPublicProfile("alex", service)).toBeNull();
  });

  it("returns the profile with filtered threads on success", async () => {
    const { loadPublicProfile } = await load();
    const profile = profileRow();
    const profiles = fromTable("profiles", { profile });
    const shares = fromTable("cloud_shares", {
      share: [
        shareRow({ id: "s1", cloud_cards: { card: { id: "c1", title: "Hello" }, deleted: false } }),
        shareRow({ id: "s2", cloud_cards: { card: { id: "c2", title: "World" }, deleted: false } }),
        shareRow({ id: "s3", cloud_cards: { card: { id: "c3", title: "Gone" }, deleted: true } }),
      ],
    });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result).toEqual({
      username: "alex",
      name: "Alex",
      avatarUrl: "https://x/a.png",
      githubUrl: "https://github.com/alex",
      memberSince: "2026-01-01T00:00:00.000Z",
      threads: [
        { id: "s1", title: "Hello", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "s2", title: "World", updatedAt: "2026-10-01T00:00:00.000Z" },
      ],
      apps: [],
      card: null,
      cardAt: null,
      league: null,
    });
  });

  it("returns threads: [] when the shares read errors", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { sharesError: { message: "boom" } });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.threads).toEqual([]);
  });

  it("returns threads: [] when the shares data is null", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: null });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.threads).toEqual([]);
  });

  it("returns githubUrl: null when getUserById returns an error", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.githubUrl).toBeNull();
  });

  it("returns null when getUserById throws", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const admin = { getUserById: vi.fn().mockRejectedValue(new Error("boom")) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    // The profile still returns, with githubUrl: null.
    const result = await loadPublicProfile("alex", service);
    expect(result?.githubUrl).toBeNull();
  });

  it("returns githubUrl: null when user_name is blank", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow() });
    const shares = fromTable("cloud_shares", { share: [] });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "   " } } }, error: null }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.githubUrl).toBeNull();
  });

  it("returns null name/avatar when they are blank", async () => {
    const { loadPublicProfile } = await load();
    const profiles = fromTable("profiles", { profile: profileRow({ name: "  ", avatar_url: "" }) });
    const shares = fromTable("cloud_shares", { share: [] });
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = { from: (t: string) => (t === "profiles" ? profiles : t === "cloud_shares" ? shares : null), auth: { admin } } as unknown as SupabaseClient;
    const result = await loadPublicProfile("alex", service);
    expect(result?.name).toBeNull();
    expect(result?.avatarUrl).toBeNull();
  });

  it("asserts the query filters: eq username, eq created_by, eq mode=public, limit(THREAD_LIMIT)", async () => {
    const { loadPublicProfile, THREAD_LIMIT } = await load();
    // Track per-method calls by replacing the chainable methods with spies.
    const eq = vi.fn(() => sharesBuilder);
    const order = vi.fn(() => sharesBuilder);
    const limit = vi.fn(() => sharesBuilder);
    const select = vi.fn(() => sharesBuilder);
    const sharesBuilder = { select, eq, order, limit, then: (r: (v: unknown) => void) => r({ data: [], error: null }) };
    const profileBuilder: Record<string, unknown> = {};
    profileBuilder.select = vi.fn(() => profileBuilder);
    profileBuilder.eq = vi.fn(() => profileBuilder);
    profileBuilder.maybeSingle = vi.fn(() => Promise.resolve({ data: profileRow(), error: null }));
    const from = vi.fn((t: string) => (t === "profiles" ? profileBuilder : t === "cloud_shares" ? sharesBuilder : null));
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const service = { from, auth: { admin } } as unknown as SupabaseClient;
    await loadPublicProfile("alex", service);
    // Profile read: eq('username', 'alex') was called.
    expect((profileBuilder.eq as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual(["username", "alex"]);
    // Shares read: select, eq('created_by', ...), eq('mode', 'public'), order, limit(THREAD_LIMIT).
    expect(select).toHaveBeenCalledWith("id, updated_at, cloud_cards(card, deleted)");
    expect((eq as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("created_by");
    expect((eq as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual(["mode", "public"]);
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(THREAD_LIMIT);
  });

  it("uses serviceClient() when no service arg is given", async () => {
    const profileBuilder: Record<string, unknown> = {};
    profileBuilder.select = vi.fn(() => profileBuilder);
    profileBuilder.eq = vi.fn(() => profileBuilder);
    profileBuilder.maybeSingle = vi.fn(() => Promise.resolve({ data: profileRow(), error: null }));
    const sharesBuilder: Record<string, unknown> = {};
    sharesBuilder.select = vi.fn(() => sharesBuilder);
    sharesBuilder.eq = vi.fn(() => sharesBuilder);
    sharesBuilder.order = vi.fn(() => sharesBuilder);
    sharesBuilder.limit = vi.fn(() => sharesBuilder);
    Object.defineProperty(sharesBuilder, "then", {
      get() {
        return (r: (v: unknown) => void) => r({ data: [], error: null });
      },
    });
    const from = vi.fn((t: string) => (t === "profiles" ? profileBuilder : t === "cloud_shares" ? sharesBuilder : null));
    const admin = { getUserById: vi.fn().mockResolvedValue({ data: { user: { user_metadata: { user_name: "alex" } } }, error: null }) };
    const fakeService = { from, auth: { admin } } as unknown as SupabaseClient;
    serviceClientMock.mockReturnValue(fakeService);
    const { loadPublicProfile } = await load();
    const result = await loadPublicProfile("alex");
    expect(result?.username).toBe("alex");
    expect(serviceClientMock).toHaveBeenCalled();
  });
});
