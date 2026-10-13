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
  roleDescription: vi.fn((r: string) => `${r} desc`),
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

import { ALL_ROLES, currentWorkspaceSlug, inviteMailer, requireTeam, roleOptions, setActiveWorkspace, teamAccess } from "./teams";

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
  teamsMock.roleDescription.mockImplementation((r: string) => `${r} desc`);
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
        service: svc.client,
      },
    });
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

describe("currentWorkspaceSlug", () => {
  it("is { kind: 'none' } when unconfigured", async () => {
    sessionMock.SUPABASE_KEY = "";
    expect(await currentWorkspaceSlug()).toEqual({ kind: "none" });
  });

  it("is { kind: 'none' } when the service client is missing", async () => {
    sessionMock.serviceClient.mockReturnValue(null);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "none" });
  });

  it("is { kind: 'signed-out' } when there is no web user", async () => {
    sessionMock.webUser.mockResolvedValue(null);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "signed-out" });
  });

  it("is { kind: 'none' } when the user has no memberships at all", async () => {
    teamsMock.listUserOrgs.mockResolvedValue([]);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "none" });
  });

  it("returns the slug the profile points at when the pointer is current", async () => {
    const svc = makeService({ profiles: [{ current_org_id: ORG.id }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).not.toHaveBeenCalled();
  });

  it("heals a stale pointer by setting it to the oldest membership", async () => {
    const newer = { id: "o2", slug: "newer", name: "Newer" };
    teamsMock.listUserOrgs.mockResolvedValue([{ org: ORG, role: "owner" }, { org: newer, role: "member" }]);
    const svc = makeService({ profiles: [{ current_org_id: "stale" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).toHaveBeenCalledWith(svc.client, USER.id, ORG.id);
  });

  it("heals a null pointer", async () => {
    const svc = makeService({ profiles: [{ current_org_id: null }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).toHaveBeenCalledWith(svc.client, USER.id, ORG.id);
  });

  it("heals when the profile row is missing entirely", async () => {
    const svc = makeService({ profiles: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceSlug()).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).toHaveBeenCalled();
  });
});

describe("setActiveWorkspace", () => {
  it("requires the team (membership) and writes the new active org", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [{ role: "admin" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    const out = await setActiveWorkspace("acme");
    expect(out).toEqual({ org: ORG });
    expect(teamsMock.setCurrentOrg).toHaveBeenCalledWith(svc.client, USER.id, ORG.id);
  });

  it("notFound()s when the visitor isn't a member", async () => {
    const svc = makeService({ orgs: [ORG], org_memberships: [] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    await expect(setActiveWorkspace("acme")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(teamsMock.setCurrentOrg).not.toHaveBeenCalled();
  });
});

describe("roleOptions", () => {
  it("returns the assignable roles for an owner (all three)", () => {
    teamsMock.assignableRoles.mockReturnValue(["owner", "admin", "member"]);
    teamsMock.roleLabel.mockImplementation((r: string) => r.charAt(0).toUpperCase() + r.slice(1));
    teamsMock.roleDescription.mockImplementation((r: string) => `${r} desc`);
    expect(roleOptions("owner")).toEqual([
      { role: "owner", label: "Owner", description: "owner desc" },
      { role: "admin", label: "Admin", description: "admin desc" },
      { role: "member", label: "Member", description: "member desc" },
    ]);
  });

  it("returns admin+member for an admin", () => {
    teamsMock.assignableRoles.mockReturnValue(["admin", "member"]);
    teamsMock.roleLabel.mockImplementation((r: string) => r.charAt(0).toUpperCase() + r.slice(1));
    teamsMock.roleDescription.mockImplementation((r: string) => `${r} desc`);
    expect(roleOptions("admin")).toEqual([
      { role: "admin", label: "Admin", description: "admin desc" },
      { role: "member", label: "Member", description: "member desc" },
    ]);
  });

  it("is an empty list for a member", () => {
    teamsMock.assignableRoles.mockReturnValue([]);
    expect(roleOptions("member")).toEqual([]);
  });
});

describe("ALL_ROLES", () => {
  it("lists every role the package ships, in order, with label and description", () => {
    expect(ALL_ROLES).toEqual([
      { role: "owner", label: "Owner", description: "owner desc" },
      { role: "admin", label: "Admin", description: "admin desc" },
      { role: "member", label: "Member", description: "member desc" },
    ]);
  });
});

describe("inviteMailer", () => {
  it("is null without RESEND_API_KEY", () => {
    expect(inviteMailer({})).toBeNull();
  });

  it("POSTs to Resend with the Weft from address and the supplied body", async () => {
    const fetchFn = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") }));
    const mailer = inviteMailer({ RESEND_API_KEY: "re_test" }, fetchFn as unknown as typeof fetch);
    if (!mailer) throw new Error("expected mailer");
    await mailer.send({ to: "jane@example.com", subject: "Hi", text: "Body" });
    expect(fetchFn).toHaveBeenCalledWith("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer re_test", "content-type": "application/json" },
      body: JSON.stringify({ from: "Weft <team@weft.zip>", to: ["jane@example.com"], subject: "Hi", text: "Body" }),
    });
  });

  it("throws with the status and a body excerpt on a non-2xx response", async () => {
    const body = "bad address: too long; not a real value";
    const fetchFn = vi.fn(() => Promise.resolve({ ok: false, status: 422, text: () => Promise.resolve(body) }));
    const mailer = inviteMailer({ RESEND_API_KEY: "re_test" }, fetchFn as unknown as typeof fetch);
    if (!mailer) throw new Error("expected mailer");
    await expect(mailer.send({ to: "x@y", subject: "S", text: "T" })).rejects.toThrow(/Resend 422/);
    await expect(mailer.send({ to: "x@y", subject: "S", text: "T" })).rejects.toThrow(/bad address/);
  });
});
