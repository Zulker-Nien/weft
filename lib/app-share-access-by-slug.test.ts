// lib/app-share-access.ts: the by-slug lookups. Split from app-share-access.test.ts to keep that
// file under 300 lines. loadAppShareBySlug looks the share up by (owner, ownerSlug, slug):
// profiles.username → created_by for a user, orgs.slug → org_id for an org. appShareAccessBySlug
// wraps the lookup with the same verdict logic, with a new rule: a user-owned private link is
// for the creator only, not the whole workspace. The mocks are duplicated from the main test
// file (vi.hoisted can't be re-exported); each file gets its own fresh ones through load().
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appShareAccessBySlug, loadAppShareBySlug } from "./app-share-access";
import type { GateVerdict } from "./share-access";
import { appShareRow, fromTable, serviceWith } from "./app-share-access.test-helpers";

const { serviceClient: serviceClientMock, webUser: webUserMock, gateVerdict: gateVerdictMock } = vi.hoisted(() => ({
  serviceClient: vi.fn<() => SupabaseClient | null>(),
  webUser: vi.fn(),
  gateVerdict: vi.fn<() => Promise<GateVerdict>>(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
  webUser: webUserMock,
}));

vi.mock("@/lib/share-access", () => ({ gateVerdict: gateVerdictMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

function asClient(s: ReturnType<typeof serviceClientMock>): SupabaseClient {
  // The tests only call this with a non-null mock; assert here so the linter sees the narrowing.
  if (!s) throw new Error("service client mock was not set");
  return s;
}

describe("loadAppShareBySlug", () => {
  it("returns null for a slug that fails APP_SLUG_RE, never touching the service client", async () => {
    const from = vi.fn();
    const svc = { from } as unknown as SupabaseClient;
    expect(await loadAppShareBySlug(svc, { owner: "user", ownerSlug: "fotoflo", slug: "UPPER" })).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns null when the username has no profile", async () => {
    serviceClientMock.mockReturnValue(serviceWith({ profiles: fromTable("profiles", {}) }));
    expect(await loadAppShareBySlug(asClient(serviceClientMock()), { owner: "user", ownerSlug: "ghost", slug: "growth" })).toBeNull();
  });

  it("looks up a user-owned share by created_by and slug", async () => {
    const share = appShareRow({ owner: "user", slug: "growth", created_by: "u1" });
    const profiles = fromTable("profiles", { profile: { id: "u1" } });
    const shares = fromTable("cloud_app_shares", { share });
    serviceClientMock.mockReturnValue(serviceWith({ profiles, cloud_app_shares: shares }));
    const loaded = await loadAppShareBySlug(asClient(serviceClientMock()), { owner: "user", ownerSlug: "fotoflo", slug: "growth" });
    expect(loaded).toEqual(share);
    // The lookup chain is: profiles (username = fotoflo) → cloud_app_shares (owner = user, created_by = u1, slug = growth).
    expect(profiles.__eqCalls.find((c) => c.column === "username")?.value).toBe("fotoflo");
    expect(shares.__eqCalls.map((c) => c.column)).toEqual(["owner", "created_by", "slug"]);
    expect(shares.__eqCalls.find((c) => c.column === "owner")?.value).toBe("user");
    expect(shares.__eqCalls.find((c) => c.column === "created_by")?.value).toBe("u1");
    expect(shares.__eqCalls.find((c) => c.column === "slug")?.value).toBe("growth");
  });

  it("returns null when the user-owned share doesn't exist for that slug", async () => {
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", {}),
      }),
    );
    expect(await loadAppShareBySlug(asClient(serviceClientMock()), { owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toBeNull();
  });

  it("looks up an org-owned share by org_id and slug", async () => {
    const share = appShareRow({ owner: "org", org_id: "org-1", slug: "growth" });
    const orgs = fromTable("orgs", { org: { id: "org-1" } });
    const shares = fromTable("cloud_app_shares", { share });
    serviceClientMock.mockReturnValue(serviceWith({ orgs, cloud_app_shares: shares }));
    const loaded = await loadAppShareBySlug(asClient(serviceClientMock()), { owner: "org", ownerSlug: "aimhuge", slug: "growth" });
    expect(loaded).toEqual(share);
    expect(orgs.__eqCalls.find((c) => c.column === "slug")?.value).toBe("aimhuge");
    expect(shares.__eqCalls.map((c) => c.column)).toEqual(["owner", "org_id", "slug"]);
    expect(shares.__eqCalls.find((c) => c.column === "org_id")?.value).toBe("org-1");
  });

  it("returns null when the org slug has no org", async () => {
    serviceClientMock.mockReturnValue(serviceWith({ orgs: fromTable("orgs", {}) }));
    expect(await loadAppShareBySlug(asClient(serviceClientMock()), { owner: "org", ownerSlug: "ghost", slug: "growth" })).toBeNull();
  });
});

describe("appShareAccessBySlug", () => {
  it("returns unconfigured when the service client is missing", async () => {
    serviceClientMock.mockReturnValue(null);
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "unconfigured" });
  });

  it("returns missing when no share matches the lookup", async () => {
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", {}),
      }),
    );
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "missing" });
  });

  it("returns login for a user-owned private link when the visitor isn't signed in", async () => {
    const share = appShareRow({ owner: "user", mode: "private", slug: "growth", created_by: "u1" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    webUserMock.mockResolvedValue(null);
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "login" });
  });

  it("returns ok for a user-owned private link when the visitor is the creator", async () => {
    const share = appShareRow({ owner: "user", mode: "private", slug: "growth", created_by: "u1" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    webUserMock.mockResolvedValue({ id: "u1", email: null, name: null, avatar: null });
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "ok", share });
  });

  it("returns denied for a user-owned private link when the visitor is signed in but not the creator", async () => {
    const share = appShareRow({ owner: "user", mode: "private", slug: "growth", created_by: "u1" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    webUserMock.mockResolvedValue({ id: "u2", email: null, name: null, avatar: null });
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "denied" });
  });

  it("uses the standard gate for a user-owned non-private link", async () => {
    const share = appShareRow({ owner: "user", mode: "public", slug: "growth", created_by: "u1" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "ok", share });
    expect(gateVerdictMock).toHaveBeenCalled();
  });

  it("uses the standard gate for an org-owned link", async () => {
    const share = appShareRow({ owner: "org", mode: "private", org_id: "org-1", slug: "growth" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        orgs: fromTable("orgs", { org: { id: "org-1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    expect(await appShareAccessBySlug({ owner: "org", ownerSlug: "aimhuge", slug: "growth" })).toEqual({ kind: "ok", share });
  });

  it("returns the gate verdict for a gated user-owned link", async () => {
    const share = appShareRow({ owner: "user", mode: "email", slug: "growth", created_by: "u1" });
    serviceClientMock.mockReturnValue(
      serviceWith({
        profiles: fromTable("profiles", { profile: { id: "u1" } }),
        cloud_app_shares: fromTable("cloud_app_shares", { share }),
      }),
    );
    gateVerdictMock.mockResolvedValue({ kind: "gate", mode: "email" });
    expect(await appShareAccessBySlug({ owner: "user", ownerSlug: "fotoflo", slug: "growth" })).toEqual({ kind: "gate", mode: "email" });
  });
});
