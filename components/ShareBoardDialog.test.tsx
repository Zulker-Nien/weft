// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { TeamSnapshot } from "@/lib/team-types";
import type { TeamHookState } from "@/lib/use-team";
import "./test-utils";

// Share board… over the real @aimhuge/share frame, with the team hook, the account and the weft.zip openers faked.

type FakeTeam = { state: TeamHookState; refresh: Mock; invite: Mock; orgs: (string | undefined)[] };
const team = vi.hoisted<FakeTeam>(() => ({
  state: { kind: "loading" },
  refresh: vi.fn(),
  invite: vi.fn(),
  orgs: [] as (string | undefined)[],
}));
const account = vi.hoisted(() => ({ signIn: vi.fn(), busy: null as string | null, waiting: null as object | null, error: null as string | null }));
const signedIn = vi.hoisted(() => ({ user: null as { id: string } | null }));
const palette = vi.hoisted(() => ({ openTeamPage: vi.fn(), openWeftPage: vi.fn() }));
vi.mock("@/lib/use-team", () => ({
  useTeam: (org?: string) => {
    team.orgs.push(org);
    return { state: team.state, refresh: team.refresh, actions: { invite: team.invite, changeRole: vi.fn(), remove: vi.fn(), revoke: vi.fn() } };
  },
}));
vi.mock("@/lib/use-account", () => ({ useAccount: () => ({ state: { kind: "ready", view: { configured: true, user: signedIn.user } }, ...account }) }));
vi.mock("./board-palette", () => palette);

const { default: ShareBoardDialog, boardUrl } = await import("./ShareBoardDialog");

function snapshot(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    user: { id: "u1", email: "me@x.com", name: "Me", avatar: null },
    org: { id: "o1", slug: "acme", name: "Acme" },
    role: "owner",
    orgs: [{ id: "o1", slug: "acme", name: "Acme" }],
    canManage: true,
    members: [
      { userId: "u1", email: "me@x.com", name: "Me", role: "owner", joinedAt: "" },
      { userId: "u2", email: "sam@x.com", name: null, role: "member", joinedAt: "" },
    ],
    pending: [{ id: "i1", email: "new@x.com", role: "member", createdAt: "", expiresAt: "" }],
    roleOptions: [
      { role: "owner", label: "Owner", description: "" },
      { role: "member", label: "Member", description: "" },
    ],
    roleLabels: { owner: "Owner", admin: "Admin", member: "Member" },
    ...over,
  };
}

function setup(state: TeamHookState) {
  team.state = state;
  const onClose = vi.fn();
  render(<ShareBoardDialog onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  team.refresh.mockReset();
  team.invite.mockReset();
  team.orgs = [];
  signedIn.user = { id: "u1" };
  Object.assign(account, { busy: null, waiting: null, error: null });
  account.signIn.mockReset();
  palette.openTeamPage.mockReset();
  palette.openWeftPage.mockReset();
});

describe("ShareBoardDialog", () => {
  it("links the workspace's web board", () => {
    expect(boardUrl("acme")).toBe("https://weft.zip/acme/board");
  });

  it("lists members, you, and pending invites, with the link to copy and open", async () => {
    setup({ kind: "ok", team: snapshot() });
    expect(screen.getByRole("dialog", { name: "Share the board" })).toBeInTheDocument();
    const people = screen.getByRole("list", { name: "People with access" });
    expect(people).toHaveTextContent("Me");
    expect(people).toHaveTextContent("Owner · you");
    expect(people).toHaveTextContent("sam@x.com");
    expect(people).toHaveTextContent("new@x.com");
    expect(people).toHaveTextContent("Invited");
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(palette.openWeftPage).toHaveBeenCalledWith("https://weft.zip/acme/board");
    await userEvent.click(screen.getByRole("button", { name: "Manage the team" }));
    expect(palette.openTeamPage).toHaveBeenCalled();
  });

  it("invites by email as a member and says what happened", async () => {
    team.invite.mockResolvedValueOnce({ ok: true, message: "Invite sent to friend@x.com." });
    setup({ kind: "ok", team: snapshot() });
    const box = screen.getByRole("textbox", { name: "Email to invite" });
    expect(screen.getByRole("button", { name: "Invite" })).toBeDisabled();
    await userEvent.type(box, " friend@x.com ");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(team.invite).toHaveBeenCalledWith("friend@x.com", "member");
    expect(await screen.findByRole("status")).toHaveTextContent("Invite sent to friend@x.com.");
    expect(box).toHaveValue("");
  });

  it("keeps the address and shows the refusal", async () => {
    team.invite.mockResolvedValueOnce({ ok: false, message: "Enter a valid email address." });
    setup({ kind: "ok", team: snapshot() });
    await userEvent.type(screen.getByRole("textbox", { name: "Email to invite" }), "nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(screen.getByRole("textbox", { name: "Email to invite" })).toHaveValue("nope");
  });

  it("falls back to the first role it may hand out", async () => {
    team.invite.mockResolvedValueOnce({ ok: true });
    setup({ kind: "ok", team: snapshot({ roleOptions: [{ role: "admin", label: "Admin", description: "" }] }) });
    await userEvent.type(screen.getByRole("textbox", { name: "Email to invite" }), "a@x.com{Enter}");
    expect(team.invite).toHaveBeenCalledWith("a@x.com", "admin");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells a member who can't invite that the link already works for teammates", () => {
    setup({ kind: "ok", team: snapshot({ canManage: false, role: "member", roleOptions: [], pending: [] }) });
    expect(screen.queryByRole("textbox", { name: "Email to invite" })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the workspace's owners and admins can invite/)).toBeInTheDocument();
  });

  it("switches workspace when you belong to more than one", async () => {
    const orgs = [
      { id: "o1", slug: "acme", name: "Acme" },
      { id: "o2", slug: "side", name: "Side" },
    ];
    setup({ kind: "ok", team: snapshot({ orgs }) });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Workspace" }), "side");
    expect(team.orgs.at(-1)).toBe("side");
  });

  it("asks you to sign in first, with no link", async () => {
    signedIn.user = null;
    setup({ kind: "ok", team: snapshot() });
    expect(screen.getByText("Sign in to Weft to share.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
    expect(account.signIn).toHaveBeenCalledWith("github");
  });

  it("treats weft.zip's 401 as signed out", () => {
    setup({ kind: "signed-out" });
    expect(screen.getByText("Sign in to Weft to share.")).toBeInTheDocument();
  });

  it("says it is loading the workspace", () => {
    setup({ kind: "loading" });
    expect(screen.getByText(/Loading your workspace/)).toBeInTheDocument();
  });

  it("offers Try again on an error", async () => {
    setup({ kind: "error", message: "Couldn't reach weft.zip." });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't reach weft.zip.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(team.refresh).toHaveBeenCalled();
  });

  it("closes from Done", async () => {
    const { onClose } = setup({ kind: "ok", team: snapshot() });
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
