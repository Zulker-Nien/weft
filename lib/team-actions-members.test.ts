// The member-mutating server actions: changeMemberRole, removeMember, revokeInvite. The "ctx" the
// gate would return is shaped directly into a TeamContext for each test so the action under test
// can be exercised without re-running the gate (covered in lib/teams.test.ts). The invite action
// (inviteMember) lives in lib/team-actions.test.ts; both files share fixtures and the from()
// builder through lib/team-actions.harness.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({
  ORG_ROLES: ["owner", "admin", "member"] as const,
  listUserOrgs: vi.fn(),
  setCurrentOrg: vi.fn(),
  roleCan: vi.fn(),
  roleAtLeast: vi.fn(),
  roleLabel: vi.fn(),
  roleDescription: vi.fn(),
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

const cacheMock = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

const teamsModMock = vi.hoisted(() => ({
  requireTeam: vi.fn(),
  inviteMailer: vi.fn(),
  isPlausibleEmail: vi.fn(),
  normalizeEmail: vi.fn(),
  roleOptions: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./supabase-project", () => ({ SUPABASE_KEY: sessionMock.SUPABASE_KEY }));
vi.mock("./web-session", () => ({
  serviceClient: sessionMock.serviceClient,
  webUser: sessionMock.webUser,
}));
vi.mock("next/navigation", () => navMock);
vi.mock("next/cache", () => cacheMock);
vi.mock("./teams", () => teamsModMock);

import { changeMemberRole, removeMember, revokeInvite } from "./team-actions";
import { ORG, USER, actorAtLeast, formData, makeService } from "./team-actions.harness";

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: {} });
  teamsModMock.inviteMailer.mockReturnValue({ send: vi.fn().mockResolvedValue(undefined) });
  teamsModMock.isPlausibleEmail.mockImplementation((s: string) => /.+@.+\..+/.test(s));
  teamsModMock.normalizeEmail.mockImplementation((s: string) => s.trim().toLowerCase());
  teamsModMock.roleOptions.mockImplementation((r: string) =>
    r === "owner" ? [{ role: "owner" }, { role: "admin" }, { role: "member" }] : r === "admin" ? [{ role: "admin" }, { role: "member" }] : [],
  );
  teamsMock.roleCan.mockImplementation((role: string, perm: string) => role !== "member" && perm === "members.manage");
  teamsMock.roleAtLeast.mockImplementation((actor: string, target: string) => actorAtLeast(actor, target));
  teamsModMock.createInvite.mockResolvedValue({ invitation: { id: "i1" }, alreadyPending: false });
  teamsModMock.revokeInvite.mockResolvedValue(undefined);
  cacheMock.revalidatePath.mockReturnValue(undefined);
});

describe("changeMemberRole", () => {
  it("refuses when the actor lacks members.manage", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "member", orgs: [ORG], service: {} });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "You don't have permission to change roles." });
  });

  it("rejects a missing user id", async () => {
    const result = await changeMemberRole("acme", "", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "Missing member id." });
  });

  it("rejects changing your own role", async () => {
    const result = await changeMemberRole("acme", USER.id, formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "You can't change your own role. Hand the workspace to someone else first." });
  });

  it("rejects an unknown role", async () => {
    const result = await changeMemberRole("acme", "u2", formData({ role: "superuser" }));
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
  });

  it("rejects a role the actor cannot assign", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "admin", orgs: [ORG], service: {} });
    teamsModMock.roleOptions.mockReturnValue([{ role: "admin" }, { role: "member" }]);
    const result = await changeMemberRole("acme", "u2", formData({ role: "owner" }));
    expect(result).toEqual({ ok: false, message: "You can't assign the owner role." });
  });

  it("rejects a target that isn't a member", async () => {
    const svc = makeService({ org_memberships: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "That person isn't a member of this workspace." });
  });

  it("rejects re-rolling a target at or above the actor", async () => {
    teamsMock.roleAtLeast.mockReturnValue(false);
    const svc = makeService({ org_memberships: [{ role: "owner" }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "admin", orgs: [ORG], service: svc.client });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "You can't change the role of someone at or above your own." });
  });

  it("refuses to demote the only owner", async () => {
    // First call to org_memberships returns the target's current role; the second (count) returns 1.
    let orgMembershipCalls = 0;
    const from = vi.fn((table: string) => {
      if (table !== "org_memberships") throw new Error(`unexpected table ${table}`);
      orgMembershipCalls += 1;
      const isCount = orgMembershipCalls === 2;
      const chain: Record<string, unknown> = {};
      const then = (resolve: (v: unknown) => void) =>
        Promise.resolve(isCount ? { data: null, error: null, count: 1 } : { data: { role: "owner" }, error: null }).then(resolve);
      for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit"]) chain[m] = vi.fn(() => chain);
      Object.defineProperty(chain, "then", { value: then, configurable: true });
      return chain;
    });
    const svc = { client: { from } };
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "You can't demote the workspace's only owner. Promote someone else first." });
  });

  it("updates the role and revalidates on success", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: true, message: "Role updated." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("reports an error when the update fails", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: { message: "boom" } } });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await changeMemberRole("acme", "u2", formData({ role: "admin" }));
    expect(result).toEqual({ ok: false, message: "Could not change role: boom" });
  });
});

describe("removeMember", () => {
  it("rejects a missing user id", async () => {
    const result = await removeMember("acme", "");
    expect(result).toEqual({ ok: false, message: "Missing member id." });
  });

  it("refuses a member-role actor from removing someone else", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "member", orgs: [ORG], service: {} });
    const result = await removeMember("acme", "u2");
    expect(result).toEqual({ ok: false, message: "You don't have permission to remove members." });
  });

  it("rejects a target that isn't a member", async () => {
    const svc = makeService({ org_memberships: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", "u2");
    expect(result).toEqual({ ok: false, message: "That person isn't a member of this workspace." });
  });

  it("rejects removing someone at or above the actor", async () => {
    teamsMock.roleAtLeast.mockReturnValue(false);
    const svc = makeService({ org_memberships: [{ role: "owner" }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "admin", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", "u2");
    expect(result).toEqual({ ok: false, message: "You can't remove someone at or above your own role." });
  });

  it("refuses to let the only owner leave", async () => {
    let orgMembershipCalls = 0;
    const from = vi.fn((table: string) => {
      if (table !== "org_memberships") throw new Error(`unexpected table ${table}`);
      orgMembershipCalls += 1;
      const isCount = orgMembershipCalls === 2;
      const chain: Record<string, unknown> = {};
      const then = (resolve: (v: unknown) => void) =>
        Promise.resolve(isCount ? { data: null, error: null, count: 1 } : { data: { role: "owner" }, error: null }).then(resolve);
      for (const m of ["select", "eq", "in", "is", "maybeSingle", "single", "order", "limit"]) chain[m] = vi.fn(() => chain);
      Object.defineProperty(chain, "then", { value: then, configurable: true });
      return chain;
    });
    const svc = { client: { from } };
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", USER.id);
    expect(result).toEqual({ ok: false, message: "You can't leave the workspace as its only owner. Promote someone else first." });
  });

  it("lets the actor remove someone else and revalidates", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: null } });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", "u2");
    expect(result).toEqual({ ok: true, message: "Removed." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("lets the actor leave a workspace they're a member of", async () => {
    const svc = makeService({ org_memberships: [{ role: "admin" }] }, {}, { org_memberships: { error: null } });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "admin", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", USER.id);
    expect(result).toEqual({ ok: true, message: "You left the workspace." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("reports an error when the delete fails", async () => {
    const svc = makeService({ org_memberships: [{ role: "member" }] }, {}, { org_memberships: { error: { message: "boom" } } });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await removeMember("acme", "u2");
    expect(result).toEqual({ ok: false, message: "Could not remove member: boom" });
  });
});

describe("revokeInvite", () => {
  it("refuses when the actor lacks members.manage", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "member", orgs: [ORG], service: {} });
    const result = await revokeInvite("acme", "i1");
    expect(result).toEqual({ ok: false, message: "You don't have permission to revoke invites." });
  });

  it("rejects a missing invite id", async () => {
    const result = await revokeInvite("acme", "");
    expect(result).toEqual({ ok: false, message: "Missing invite id." });
  });

  it("refuses to revoke an invite from another org", async () => {
    const svc = makeService({ invitations: [{ org_id: "o2" }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await revokeInvite("acme", "i1");
    expect(result).toEqual({ ok: false, message: "That invite isn't from this workspace." });
    expect(teamsModMock.revokeInvite).not.toHaveBeenCalled();
  });

  it("refuses when the invite row is missing", async () => {
    const svc = makeService({ invitations: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await revokeInvite("acme", "i1");
    expect(result).toEqual({ ok: false, message: "That invite isn't from this workspace." });
  });

  it("revokes the invite and revalidates on success", async () => {
    const svc = makeService({ invitations: [{ org_id: ORG.id }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await revokeInvite("acme", "i1");
    expect(result).toEqual({ ok: true, message: "Invite revoked." });
    expect(teamsModMock.revokeInvite).toHaveBeenCalledWith(svc.client, "i1");
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("reports an error when revokeInvite throws", async () => {
    teamsModMock.revokeInvite.mockRejectedValue(new Error("nope"));
    const svc = makeService({ invitations: [{ org_id: ORG.id }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await revokeInvite("acme", "i1");
    expect(result).toEqual({ ok: false, message: "Could not revoke invite: nope" });
  });
});
