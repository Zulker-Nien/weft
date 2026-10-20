// Mocks declared BEFORE the module-under-test import so Vitest hoists them. The package is replaced
// with a thin shim that lets each test pin the helpers it cares about; the cookie/service session
// module is replaced so the test doesn't have to wire up a real Supabase project.
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted runs before vi.mock factories, so the shims can read mutable state.
const teamsMock = vi.hoisted(() => ({
  ORG_ROLES: ["owner", "admin", "member"] as const,
  listUserOrgs: vi.fn(),
  setCurrentOrg: vi.fn(),
  roleCan: vi.fn(),
  roleAtLeast: vi.fn(),
  // ALL_ROLES is built as lib/teams.ts loads, so these need their implementations before the import.
  roleLabel: vi.fn((r: string) => r.charAt(0).toUpperCase() + r.slice(1)),
  assignableRoles: vi.fn(),
  isPlausibleEmail: vi.fn(),
  normalizeEmail: vi.fn(),
  isSuperAdmin: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

const sessionMock = vi.hoisted(() => ({
  SUPABASE_KEY: "sb_test",
  serviceClient: vi.fn(),
  webUser: vi.fn(),
}));

const navMock = vi.hoisted(() => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./supabase-project", () => ({
  get SUPABASE_KEY() {
    return sessionMock.SUPABASE_KEY;
  },
}));
vi.mock("./web-session", () => ({
  serviceClient: sessionMock.serviceClient,
  webUser: sessionMock.webUser,
}));
vi.mock("next/navigation", () => navMock);

import { requireTeam, teamAccess, teamAccessFor } from "./teams";

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };

// A from() builder that returns a single chainable query with the rows wired into the terminal call.
// `rowsByMethod` lets the test pin different rows for each (table, maybeSingle/single) pair.
function makeService(rowsByTable: Record<string, unknown[]>) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    const rows = rowsByTable[table] ?? [];
    const chain: Record<string, unknown> = {};
    const then = (resolve: (v: unknown) => void) => Promise.resolve({ data: rows[0] ?? null, error: null, count: rows.length }).then(resolve);
    for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit", "insert", "update", "delete", "upsert"]) {
      chain[m] = vi.fn(() => chain);
    }
    Object.defineProperty(chain, "then", { value: then, configurable: true });
    return chain;
  });
  return { client: { from }, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.SUPABASE_KEY = "sb_test";
  navMock.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  navMock.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  teamsMock.normalizeEmail.mockImplementation((s: string) => s.trim().toLowerCase());
  teamsMock.isPlausibleEmail.mockImplementation((s: string) => /.+@.+\..+/.test(s));
  teamsMock.isSuperAdmin.mockReturnValue(false);
  teamsMock.roleLabel.mockImplementation((r: string) => r.charAt(0).toUpperCase() + r.slice(1));
  teamsMock.assignableRoles.mockImplementation((r: string) => (r === "owner" ? ["owner", "admin", "member"] : r === "admin" ? ["admin", "member"] : []));
  teamsMock.listUserOrgs.mockResolvedValue([{ org: ORG, role: "admin" }]);
  teamsMock.setCurrentOrg.mockResolvedValue(undefined);
  sessionMock.serviceClient.mockReturnValue({ from: vi.fn() });
  sessionMock.webUser.mockResolvedValue(USER);
});

describe("teamAccess", () => {
  it("is unconfigured when SUPABASE_KEY is empty", async () => {
    sessionMock.SUPABASE_KEY = "";
    const result = await teamAccess("acme");
    expect(result).toEqual({ kind: "unconfigured" });
    expect(sessionMock.serviceClient).not.toHaveBeenCalled();
  });

  it("is unconfigured when the service client is null", async () => {
    sessionMock.serviceClient.mockReturnValue(null);
    const result = await teamAccess("acme");
    expect(result).toEqual({ kind: "unconfigured" });
  });

  it("is signed-out when the visitor has no web session", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    const result = await teamAccess("acme");
    expect(result).toEqual({ kind: "signed-out" });
    expect(teamsMock.listUserOrgs).not.toHaveBeenCalled();
  });

  it("is denied when the org doesn't exist", async () => {
    const svc = makeService({ orgs: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const result = await teamAccess("acme");
    expect(result).toEqual({ kind: "denied" });
    expect(svc.calls).toEqual(["orgs"]);
  });

  it("is denied when the org exists but the user is not a member", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const result = await teamAccess("acme");
    expect(result).toEqual({ kind: "denied" });
    expect(svc.calls).toEqual(["orgs", "org_memberships"]);
  });

  it("is denied for a super-admin who is not a member (no bypass in Weft)", async () => {
    teamsMock.isSuperAdmin.mockReturnValue(true);
    const svc = makeService({ orgs: [ORG], org_memberships: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const result = await teamAccess("acme");
    // Same "denied" as a non-member: there is no god-view bypass in Weft, so even a platform
    // super-admin who isn't on the org gets the same 404-shaped answer.
    expect(result).toEqual({ kind: "denied" });
  });

  it("is ok with the user's role, the org, and their workspaces", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [{ role: "admin" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const other = { id: "o2", slug: "two", name: "Two" };
    teamsMock.listUserOrgs.mockResolvedValue([
      { org: ORG, role: "admin" },
      { org: other, role: "member" },
    ]);
    const result = await teamAccess("acme");
    expect(result).toEqual({
      kind: "ok",
      ctx: {
        user: USER,
        org: ORG,
        role: "admin",
        orgs: [ORG, other],
        orgRoles: { o1: "admin", o2: "member" },
        service: svc.client,
      },
    });
  });
});

describe("teamAccessFor", () => {
  it("is unconfigured when SUPABASE_KEY is empty", async () => {
    sessionMock.SUPABASE_KEY = "";
    expect(await teamAccessFor(USER, "acme")).toEqual({ kind: "unconfigured" });
    expect(sessionMock.serviceClient).not.toHaveBeenCalled();
  });

  it("is unconfigured when the service client is null", async () => {
    sessionMock.serviceClient.mockReturnValue(null);
    expect(await teamAccessFor(USER, "acme")).toEqual({ kind: "unconfigured" });
  });

  it("is signed-out when the user is null (no cookie, no bearer)", async () => {
    expect(await teamAccessFor(null, "acme")).toEqual({ kind: "signed-out" });
    expect(teamsMock.listUserOrgs).not.toHaveBeenCalled();
  });

  it("uses the user argument directly without reading the cookie session", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [{ role: "admin" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const bearerUser = { id: "u-bearer", email: "bearer@x.co", name: "Bearer", avatar: null };
    await teamAccessFor(bearerUser, "acme");
    // The cookie path must not be hit; the bearer user is the source of truth.
    expect(sessionMock.webUser).not.toHaveBeenCalled();
  });

  it("is ok with the supplied user as the ctx.user", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [{ role: "admin" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const bearerUser = { id: "u-bearer", email: "bearer@x.co", name: "Bearer", avatar: null };
    const result = await teamAccessFor(bearerUser, "acme");
    expect(result).toMatchObject({ kind: "ok", ctx: { user: bearerUser, org: ORG, role: "admin" } });
  });

  it("is denied for a non-member (same answer as a missing org)", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await teamAccessFor(USER, "acme")).toEqual({ kind: "denied" });
  });
});

describe("requireTeam", () => {
  it("redirects to /login with the return path when signed out", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    await expect(requireTeam("acme", "/acme/team")).rejects.toThrow("NEXT_REDIRECT");
    expect(navMock.redirect).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam");
  });

  it("falls back to /<slug>/team when the return path is open-redirect shaped", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    await expect(requireTeam("acme", "//evil.com")).rejects.toThrow("NEXT_REDIRECT");
    expect(navMock.redirect).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam");
  });

  it("falls back to /<slug>/team when the return path isn't a path", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    await expect(requireTeam("acme", "https://evil.example/path")).rejects.toThrow("NEXT_REDIRECT");
    expect(navMock.redirect).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam");
  });

  it("uses the default team path when no return path is supplied", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    await expect(requireTeam("acme")).rejects.toThrow("NEXT_REDIRECT");
    expect(navMock.redirect).toHaveBeenCalledWith("/login?next=%2Facme%2Fteam");
  });

  it("notFound()s when the org is missing", async () => {
    const svc = makeService({ orgs: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    await expect(requireTeam("acme")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("notFound()s when unconfigured", async () => {
    sessionMock.SUPABASE_KEY = "";
    await expect(requireTeam("acme")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(navMock.notFound).toHaveBeenCalled();
  });

  it("returns the ctx when ok", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [{ role: "owner" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const ctx = await requireTeam("acme");
    expect(ctx.role).toBe("owner");
    expect(ctx.org).toEqual(ORG);
    expect(ctx.user).toBe(USER);
  });
});
