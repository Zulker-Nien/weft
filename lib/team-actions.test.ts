// The /[orgSlug]/team page's server actions, which are now thin wrappers:
// each runs requireTeam (the gate), then delegates to lib/team-ops.ts's
// runTeamOp, then revalidates the team page on success. The deep business
// behavior — permissions, last-owner rule, self rules, every error message
// — lives in lib/team-ops.test.ts; these tests pin the boundary checks
// (public-endpoint argument validation, revalidation wiring).
import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsModMock = vi.hoisted(() => ({
  requireTeam: vi.fn(),
}));

const teamOpsMock = vi.hoisted(() => ({
  runTeamOp: vi.fn(),
}));

const cacheMock = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}));

vi.mock("./teams", () => teamsModMock);
vi.mock("./team-ops", () => teamOpsMock);
vi.mock("next/cache", () => cacheMock);

import { changeMemberRole, inviteMember, removeMember, revokeInvite } from "./team-actions";
import { ORG, USER } from "./team-actions.harness";

const CTX = { user: USER, org: ORG, role: "owner" as const, orgs: [ORG], service: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  teamsModMock.requireTeam.mockResolvedValue(CTX);
  teamOpsMock.runTeamOp.mockResolvedValue({ ok: true, message: "ok" });
  cacheMock.revalidatePath.mockReturnValue(undefined);
});

describe("inviteMember", () => {
  it("runs the gate, calls runTeamOp with an invite op, and revalidates on success", async () => {
    const result = await inviteMember("acme", "x@y.com", "member");
    expect(teamsModMock.requireTeam).toHaveBeenCalledWith("acme", "/acme/team");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "invite", email: "x@y.com", role: "member" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
    expect(result).toEqual({ ok: true, message: "ok" });
  });

  it("rejects a non-string role at the boundary", async () => {
    const result = await inviteMember("acme", "x@y.com", "superuser");
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
    expect(teamOpsMock.runTeamOp).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the email", async () => {
    await inviteMember("acme", "  x@y.com  ", "member");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ email: "x@y.com" }));
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "boom" });
    await inviteMember("acme", "x@y.com", "member");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("coerces a non-string email to an empty string before delegating", async () => {
    // The server action's argument is typed as string, but a hostile caller could send anything;
    // the boundary check normalizes it so runTeamOp's isPlausibleEmail gets an empty string.
    await inviteMember("acme", 5 as unknown as string, "member");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ email: "" }));
  });
});

describe("changeMemberRole", () => {
  it("runs the gate, calls runTeamOp with a role op, and revalidates on success", async () => {
    await changeMemberRole("acme", "u2", "admin");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "role", userId: "u2", role: "admin" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("rejects a non-string role at the boundary", async () => {
    const result = await changeMemberRole("acme", "u2", "superuser");
    expect(result).toEqual({ ok: false, message: "Pick a role from the list." });
    expect(teamOpsMock.runTeamOp).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the user id", async () => {
    await changeMemberRole("acme", "  u2  ", "admin");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ userId: "u2" }));
  });
});

describe("removeMember", () => {
  it("runs the gate, calls runTeamOp with a remove op, and revalidates on success", async () => {
    await removeMember("acme", "u2");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "remove", userId: "u2" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "nope" });
    await removeMember("acme", "u2");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the user id", async () => {
    await removeMember("acme", "  u2  ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ userId: "u2" }));
  });
});

describe("revokeInvite", () => {
  it("runs the gate, calls runTeamOp with a revoke op, and revalidates on success", async () => {
    await revokeInvite("acme", "i1");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, { org: "acme", action: "revoke", inviteId: "i1" });
    expect(cacheMock.revalidatePath).toHaveBeenCalledWith("/acme/team");
  });

  it("does not revalidate when runTeamOp fails", async () => {
    teamOpsMock.runTeamOp.mockResolvedValueOnce({ ok: false, message: "nope" });
    await revokeInvite("acme", "i1");
    expect(cacheMock.revalidatePath).not.toHaveBeenCalled();
  });

  it("trims a leading/trailing space in the invite id", async () => {
    await revokeInvite("acme", "  i1  ");
    expect(teamOpsMock.runTeamOp).toHaveBeenCalledWith(CTX, expect.objectContaining({ inviteId: "i1" }));
  });
});
