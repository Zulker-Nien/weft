// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamSnapshot } from "@/lib/team-types";
import "../test-utils";

// The weft.zip board's Share button over the real @aimhuge/share frame, with the server actions faked.

const server = vi.hoisted(() => ({ boardShareTeam: vi.fn() }));
const web = vi.hoisted(() => ({ invite: vi.fn(), slugs: [] as string[] }));
vi.mock("@/lib/team-actions", () => server);
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../team/web-actions", () => ({
  webTeamActions: (slug: string) => {
    web.slugs.push(slug);
    return { invite: web.invite, changeRole: vi.fn(), remove: vi.fn(), revoke: vi.fn() };
  },
}));

const { WebShareBoard } = await import("./WebShareBoard");

function team(over: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    user: { id: "u1", email: "me@x.com", name: "Me", avatar: null },
    org: { id: "o1", slug: "acme", name: "Acme" },
    role: "owner",
    orgs: [{ id: "o1", slug: "acme", name: "Acme" }],
    canManage: true,
    members: [{ userId: "u1", email: "me@x.com", name: "Me", role: "owner", joinedAt: "" }],
    pending: [],
    roleOptions: [{ role: "member", label: "Member", description: "" }],
    roleLabels: { owner: "Owner", admin: "Admin", member: "Member" },
    ...over,
  };
}

beforeEach(() => {
  server.boardShareTeam.mockReset();
  web.invite.mockReset();
  web.slugs = [];
});

describe("WebShareBoard", () => {
  it("opens the dialog with the board's link and loads the team only then", async () => {
    server.boardShareTeam.mockResolvedValue(team());
    render(<WebShareBoard orgSlug="acme" />);
    expect(server.boardShareTeam).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    expect(screen.getByRole("dialog", { name: "Share the board" })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "People with access" })).toHaveTextContent("Owner · you");
    expect(server.boardShareTeam).toHaveBeenCalledWith("acme");
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
  });

  it("invites by email and reloads the list after a success", async () => {
    server.boardShareTeam.mockResolvedValueOnce(team());
    server.boardShareTeam.mockResolvedValueOnce(team({ pending: [{ id: "i1", email: "new@x.com", role: "member", createdAt: "", expiresAt: "" }] }));
    web.invite.mockResolvedValueOnce({ ok: true, message: "Invite sent to new@x.com." });
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Email to invite" }), "new@x.com{Enter}");
    expect(web.invite).toHaveBeenCalledWith("new@x.com", "member");
    expect(await screen.findByRole("status")).toHaveTextContent("Invite sent to new@x.com.");
    expect(await screen.findByText("new@x.com")).toBeInTheDocument();
    expect(server.boardShareTeam).toHaveBeenCalledTimes(2);
  });

  it("doesn't reload after a refused invite", async () => {
    server.boardShareTeam.mockResolvedValue(team());
    web.invite.mockResolvedValueOnce({ ok: false, message: "Enter a valid email address." });
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    await userEvent.type(await screen.findByRole("textbox", { name: "Email to invite" }), "nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(server.boardShareTeam).toHaveBeenCalledTimes(1);
  });

  it("shows a load error with Try again", async () => {
    server.boardShareTeam.mockRejectedValueOnce(new Error("NEXT_NOT_FOUND"));
    server.boardShareTeam.mockResolvedValueOnce(team());
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("NEXT_NOT_FOUND");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "People with access" })).toBeInTheDocument();
  });

  it("switches to another workspace's team and link", async () => {
    const orgs = [
      { id: "o1", slug: "acme", name: "Acme" },
      { id: "o2", slug: "side", name: "Side" },
    ];
    server.boardShareTeam.mockResolvedValueOnce(team({ orgs }));
    server.boardShareTeam.mockResolvedValueOnce(team({ orgs, org: orgs[1] }));
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Workspace" }), "side");
    expect(server.boardShareTeam).toHaveBeenLastCalledWith("side");
    expect(web.slugs.at(-1)).toBe("side");
  });

  it("goes to the team page from Manage the team", async () => {
    server.boardShareTeam.mockResolvedValue(team());
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Manage the team" }));
    expect(router.push).toHaveBeenCalledWith("/acme/team");
  });

  it("closes from Done", async () => {
    server.boardShareTeam.mockResolvedValue(team());
    render(<WebShareBoard orgSlug="acme" />);
    await userEvent.click(screen.getByRole("button", { name: /Share/ }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
