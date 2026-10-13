// The server-action tests pin the same four mocks: the package, the session module, next/navigation
// (redirect/notFound) and next/cache (revalidatePath). The "ctx" the gate would return is shaped
// directly into a TeamContext for each test so the action under test can be exercised without
// re-running the gate (covered in lib/teams.test.ts). The member-mutating actions
// (changeMemberRole, removeMember, revokeInvite) live in lib/team-actions-members.test.ts so this
// file stays under eslint's max-lines; both share fixtures and the from() builder through
// lib/team-actions.harness.ts.
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

import { inviteMember } from "./team-actions";
import { ORG, PREV, USER, actorAtLeast, formData, makeService } from "./team-actions.harness";

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
  teamsMock.revokeInvite.mockResolvedValue(undefined);
  cacheMock.revalidatePath.mockReturnValue(undefined);
});

describe("inviteMember", () => {
  it("refuses when the actor lacks members.manage", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "member", orgs: [ORG], service: {} });
    const result = await inviteMember("acme", PREV, formData({ email: "new@example.com", role: "member" }));
    expect(result).toEqual({ ok: false, message: "You don't have permission to invite members." });
  });

  it("rejects an invalid email", async () => {
    teamsModMock.isPlausibleEmail.mockReturnValue(false);
    const result = await inviteMember("acme", PREV, formData({ email: "not-an-email", role: "member" }));
    expect(result).toEqual({ ok: false, message: "Enter a valid email address." });
  });

  it("rejects an unknown role", async () => {
    const result = await inviteMember("acme", PREV, formData({ email: "x@y.com", role: "superuser" }));
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
  });

  it("rejects a role the actor cannot assign", async () => {
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "admin", orgs: [ORG], service: {} });
    teamsModMock.roleOptions.mockReturnValue([{ role: "admin" }, { role: "member" }]);
    const result = await inviteMember("acme", PREV, formData({ email: "x@y.com", role: "owner" }));
    expect(result).toEqual({ ok: false, message: "You can't assign the owner role." });
  });

  it("refuses a self-invite", async () => {
    const result = await inviteMember("acme", PREV, formData({ email: "JANE@Example.com", role: "member" }));
    expect(result).toEqual({ ok: false, message: "That's you." });
  });

  it("adds an existing member immediately and revalidates", async () => {
    const svc = makeService({ profiles: [{ id: "u2" }], org_memberships: [{ user_id: "u2" }] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "x@y.com", role: "member" }));
    expect(result).toEqual({ ok: true, message: "Already on the team." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("adds an existing profile to the org straight in (no email)", async () => {
    const svc = makeService({ profiles: [{ id: "u2" }], org_memberships: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "x@y.com", role: "admin" }));
    expect(result).toEqual({ ok: true, message: "Added x@y.com." });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("reports an insert error when adding an existing profile fails", async () => {
    const svc = makeService(
      { profiles: [{ id: "u2" }], org_memberships: [] },
      {},
      { org_memberships: { error: { message: "boom" } } },
    );
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "x@y.com", role: "admin" }));
    expect(result).toEqual({ ok: false, message: "Could not add member: boom" });
  });

  it("refuses to email when RESEND_API_KEY isn't set", async () => {
    teamsModMock.inviteMailer.mockReturnValue(null);
    const svc = makeService({ profiles: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "new@example.com", role: "member" }));
    expect(result).toEqual({ ok: false, message: "Email isn't set up on this Weft (RESEND_API_KEY)." });
    expect(teamsModMock.createInvite).not.toHaveBeenCalled();
  });

  it("creates a new invite and emails it when no profile exists", async () => {
    const svc = makeService({ profiles: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "new@example.com", role: "member" }));
    expect(result).toEqual({ ok: true, message: "Invite sent to new@example.com." });
    expect(teamsModMock.createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ invitedEmail: "new@example.com", role: "member", appName: "Weft" }),
    );
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("says 're-sent' when createInvite reports alreadyPending", async () => {
    teamsModMock.createInvite.mockResolvedValue({ invitation: { id: "i1" }, alreadyPending: true });
    const svc = makeService({ profiles: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "new@example.com", role: "member" }));
    expect(result).toEqual({ ok: true, message: "Invite re-sent… (new@example.com)" });
  });

  it("reports an error when createInvite throws", async () => {
    teamsModMock.createInvite.mockRejectedValue(new Error("Resend 500"));
    const svc = makeService({ profiles: [] });
    teamsModMock.requireTeam.mockResolvedValue({ user: USER, org: ORG, role: "owner", orgs: [ORG], service: svc.client });
    const result = await inviteMember("acme", PREV, formData({ email: "new@example.com", role: "member" }));
    expect(result).toEqual({ ok: false, message: "Could not create invite: Resend 500" });
  });
});
