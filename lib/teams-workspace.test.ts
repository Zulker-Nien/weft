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

import { ROLE_DESCRIPTIONS } from "./team-types";
import { ALL_ROLES, currentWorkspaceFor, currentWorkspaceSlug, inviteMailer, roleOptions, setActiveWorkspace } from "./teams";

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

describe("currentWorkspaceFor", () => {
  const bearerUser = { id: "u-bearer", email: "bearer@x.co", name: "Bearer", avatar: null };

  it("is { kind: 'none' } when unconfigured", async () => {
    sessionMock.SUPABASE_KEY = "";
    expect(await currentWorkspaceFor(USER)).toEqual({ kind: "none" });
  });

  it("is { kind: 'signed-out' } when the user is null", async () => {
    expect(await currentWorkspaceFor(null)).toEqual({ kind: "signed-out" });
    expect(teamsMock.listUserOrgs).not.toHaveBeenCalled();
  });

  it("does not read the cookie session — the supplied user is enough", async () => {
    const svc = makeService({ profiles: [{ current_org_id: ORG.id }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceFor(bearerUser)).toEqual({ kind: "ok", slug: "acme" });
    expect(sessionMock.webUser).not.toHaveBeenCalled();
  });

  it("returns the slug the profile points at when the pointer is current", async () => {
    const svc = makeService({ profiles: [{ current_org_id: ORG.id }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceFor(bearerUser)).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).not.toHaveBeenCalled();
  });

  it("heals a stale pointer using the supplied user's id, not the cookie's", async () => {
    const svc = makeService({ profiles: [{ current_org_id: "stale" }] });
    sessionMock.serviceClient.mockReturnValue(svc.client);
    expect(await currentWorkspaceFor(bearerUser)).toEqual({ kind: "ok", slug: "acme" });
    expect(teamsMock.setCurrentOrg).toHaveBeenCalledWith(svc.client, bearerUser.id, ORG.id);
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
    expect(roleOptions("owner")).toEqual([
      { role: "owner", label: "Owner", description: ROLE_DESCRIPTIONS.owner },
      { role: "admin", label: "Admin", description: ROLE_DESCRIPTIONS.admin },
      { role: "member", label: "Member", description: ROLE_DESCRIPTIONS.member },
    ]);
  });

  it("returns admin+member for an admin", () => {
    teamsMock.assignableRoles.mockReturnValue(["admin", "member"]);
    teamsMock.roleLabel.mockImplementation((r: string) => r.charAt(0).toUpperCase() + r.slice(1));
    expect(roleOptions("admin")).toEqual([
      { role: "admin", label: "Admin", description: ROLE_DESCRIPTIONS.admin },
      { role: "member", label: "Member", description: ROLE_DESCRIPTIONS.member },
    ]);
  });

  it("is an empty list for a member", () => {
    teamsMock.assignableRoles.mockReturnValue([]);
    expect(roleOptions("member")).toEqual([]);
  });
});

describe("ALL_ROLES", () => {
  it("lists every role the package ships, in order, with its label and Weft's description", () => {
    expect(ALL_ROLES).toEqual([
      { role: "owner", label: "Owner", description: ROLE_DESCRIPTIONS.owner },
      { role: "admin", label: "Admin", description: ROLE_DESCRIPTIONS.admin },
      { role: "member", label: "Member", description: ROLE_DESCRIPTIONS.member },
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

  it("adds the Salt Flats HTML when the text is an invite", async () => {
    let body = "";
    const fetchFn = vi.fn((_url: string, init: { body: string }) => {
      body = init.body;
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") });
    });
    const mailer = inviteMailer({ RESEND_API_KEY: "re_test" }, fetchFn as unknown as typeof fetch);
    if (!mailer) throw new Error("expected mailer");
    const text = 'a@b.c invited you to join "Acme" on Weft as a member.\n\nhttps://weft.zip/invite/t1';
    await mailer.send({ to: "jane@example.com", subject: "Hi", text });
    const sent = JSON.parse(body) as { text: string; html: string };
    expect(sent.text).toBe(text);
    expect(sent.html).toContain('href="https://weft.zip/invite/t1"');
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
