// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountView } from "@/lib/types";
import "./test-utils";
import AccountButton from "./AccountButton";

const api = vi.hoisted(() => ({
  account: vi.fn<() => Promise<AccountView>>(),
  signIn: vi.fn(() => Promise.resolve({ url: "https://github.com/login/oauth" })),
  magicLink: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/client", () => ({ api }));

const openExternal = vi.fn();
const browserOpen = vi.fn(() => Promise.resolve());
const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: "https://img/ada.png", provider: "github" };

function setup() {
  const onOpenSettings = vi.fn();
  const view = render(<AccountButton onOpenSettings={onOpenSettings} />);
  return { onOpenSettings, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The pane path and the system-browser path both stub the shell bridge; specific tests
  // overwrite `window.threadboard` to exercise each branch.
  window.threadboard = { openExternal, browser: { open: browserOpen } } as unknown as typeof window.threadboard;
});

describe("AccountButton", () => {
  it("takes no room until it knows, or when accounts aren't set up", async () => {
    api.account.mockResolvedValue({ configured: false, user: null });
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
    await vi.waitFor(() => expect(api.account).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("signs in with GitHub in the system browser", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    setup();
    const button = await screen.findByRole("button", { name: "Sign in with GitHub" });
    expect(button).toHaveTextContent("Sign in");
    await userEvent.click(button);
    expect(api.signIn).toHaveBeenCalledWith("github", "/");
    expect(openExternal).toHaveBeenCalledWith("https://github.com/login/oauth");
    expect(button).toHaveTextContent("Signing in…");
    expect(button).toHaveAttribute("title", "Finish signing in with GitHub in your browser");
  });

  it("shows a failed sign-in in its tooltip", async () => {
    api.account.mockResolvedValue({ configured: true, user: null });
    api.signIn.mockRejectedValueOnce(new Error("GitHub sign-in is off"));
    setup();
    const button = await screen.findByRole("button", { name: "Sign in with GitHub" });
    await userEvent.click(button);
    expect(button).toHaveAttribute("title", "GitHub sign-in is off");
  });

  it("shows your avatar once signed in, with Settings and Your team behind it", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const { onOpenSettings } = setup();
    const avatar = await screen.findByRole("button", { name: "Signed in as Ada" });
    expect(avatar.querySelector("img")).toHaveAttribute("src", "https://img/ada.png");
    // No menu until the avatar is clicked; opening Settings is a second click.
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(avatar);
    const settings = await screen.findByRole("menuitem", { name: /Settings/ });
    const team = screen.getByRole("menuitem", { name: /Your team/ });
    expect(team).toHaveTextContent("Invite teammates on weft.zip");
    await userEvent.click(settings);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("opens Your team in the pane when in the desktop, falling back to the system browser", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(browserOpen).toHaveBeenCalledWith("https://weft.zip/team", "board");
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the system browser when the pane is missing (older shells)", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    (window as unknown as { threadboard: unknown }).threadboard = { openExternal };
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(openExternal).toHaveBeenCalledWith("https://weft.zip/team");
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("doesn't open the team page in the pane when the desktop isn't running at all", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    delete (window as unknown as { threadboard?: unknown }).threadboard;
    setup();
    await userEvent.click(await screen.findByRole("button", { name: "Signed in as Ada" }));
    // Outside the desktop, the helper's pane branch is unavailable; window.open takes over.
    // We just assert the pane path is not taken — jsdom's window.open is a no-op stub here.
    await userEvent.click(await screen.findByRole("menuitem", { name: /Your team/ }));
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it("closes the account menu on Escape and on an outside click", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    setup();
    const avatar = await screen.findByRole("button", { name: "Signed in as Ada" });
    await userEvent.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(avatar);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("falls back to your email, then an initial", async () => {
    api.account.mockResolvedValue({ configured: true, user: { ...ada, name: null, avatar: null } });
    setup();
    const button = await screen.findByRole("button", { name: "Signed in as ada@b.co" });
    expect(button).toHaveTextContent("A");
  });

  it("names no one when the account has neither", async () => {
    api.account.mockResolvedValue({ configured: true, user: { ...ada, name: null, email: null, avatar: null } });
    setup();
    expect(await screen.findByRole("button", { name: "Signed in as your account" })).toHaveTextContent("?");
  });
});
