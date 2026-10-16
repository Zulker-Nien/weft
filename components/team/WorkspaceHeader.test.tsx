// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./WorkspaceHeader";
import "../test-utils";

// The TeamContext type lives in lib/teams.ts (written by the parallel
// agent). We build a structural local type so this test typechecks before
// the other module lands; the `as never` cast at the call site keeps
// changes in the lib type from churning this file. When the type lands,
// the test will typecheck against it.
type Ctx = Parameters<typeof WorkspaceHeader>[0]["ctx"];

function makeCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: null },
    org: { id: "o1", slug: "ada", name: "Ada's workspace" },
    role: "owner",
    orgs: [
      { id: "o1", slug: "ada", name: "Ada's workspace" },
      { id: "o2", slug: "weft", name: "Weft Co" },
    ],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("WorkspaceHeader", () => {
  it("shows the workspace name as plain text when there is one workspace", () => {
    render(<WorkspaceHeader ctx={makeCtx({ orgs: [{ id: "o1", slug: "ada", name: "Ada" }] })} current="team" />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch workspace/ })).not.toBeInTheDocument();
  });

  it("renders a switcher button labelled with the current workspace when there are several", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    const btn = screen.getByRole("button", { name: /Switch workspace/ });
    expect(btn).toHaveTextContent("Ada's workspace");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the menu on click and lists every workspace as a link", async () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    await userEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("href", "/ada/team");
    expect(items[1]).toHaveAttribute("href", "/weft/team");
    // Current workspace is marked with aria-current.
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[1]).not.toHaveAttribute("aria-current");
  });

  it("closes the menu when an item is clicked", async () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    await userEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Weft Co/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes the menu on Escape and returns focus to the button", async () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    const btn = screen.getByRole("button", { name: /Switch workspace/ });
    await userEvent.click(btn);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(btn).toHaveFocus();
  });

  it("closes the menu on outside click", async () => {
    render(
      <div>
        <WorkspaceHeader ctx={makeCtx()} current="team" />
        <button type="button" data-testid="outside">Outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the nav with Board, Team and Billing links and marks the current one", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    const board = screen.getByRole("link", { name: "Board" });
    const team = screen.getByRole("link", { name: "Team" });
    const billing = screen.getByRole("link", { name: "Billing" });
    expect(board).toHaveAttribute("href", "/ada/board");
    expect(board).not.toHaveAttribute("aria-current");
    expect(team).toHaveAttribute("href", "/ada/team");
    expect(team).toHaveAttribute("aria-current", "page");
    expect(billing).toHaveAttribute("href", "/ada/billing");
    expect(billing).not.toHaveAttribute("aria-current");
  });

  it("marks Billing as current when the current prop is billing", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="billing" />);
    const billing = screen.getByRole("link", { name: "Billing" });
    expect(billing).toHaveAttribute("aria-current", "page");
  });

  it("marks Board as current when the current prop is board", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="board" />);
    const board = screen.getByRole("link", { name: "Board" });
    expect(board).toHaveAttribute("aria-current", "page");
  });

  it("shows the signed-in user name and email tooltip", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    // The brand shows "Ada's workspace" (apostrophe), the user pill shows "Ada".
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByTitle("ada@b.co")).toBeInTheDocument();
  });

  it("falls back to the email when the user has no name", () => {
    render(<WorkspaceHeader ctx={makeCtx({ user: { id: "u1", email: "ada@b.co", name: null, avatar: null } })} current="team" />);
    // The pill now shows the email; the brand still shows "Ada's workspace".
    expect(screen.getAllByText("ada@b.co").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the avatar image when one is set", () => {
    render(
      <WorkspaceHeader
        ctx={makeCtx({ user: { id: "u1", email: "ada@b.co", name: "Ada", avatar: "https://avatars/ada.png" } })}
        current="team"
      />,
    );
    const img = document.querySelector(".wz-workspaceUserAvatar img");
    expect(img).toHaveAttribute("src", "https://avatars/ada.png");
  });

  it("renders a Sign-out form that posts to /auth/sign-out", () => {
    render(<WorkspaceHeader ctx={makeCtx()} current="team" />);
    const form = document.querySelector("form[action='/auth/sign-out']");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("method", "post");
    const btn = form?.querySelector("button[type='submit']");
    expect(btn).toHaveTextContent("Sign out");
  });
});
