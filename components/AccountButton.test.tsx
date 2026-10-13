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
const ada = { id: "u1", email: "ada@b.co", name: "Ada", avatar: "https://img/ada.png", provider: "github" };

function setup() {
  const onOpenSettings = vi.fn();
  const view = render(<AccountButton onOpenSettings={onOpenSettings} />);
  return { onOpenSettings, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.threadboard = { openExternal } as unknown as typeof window.threadboard;
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

  it("shows your avatar once signed in, which opens Settings", async () => {
    api.account.mockResolvedValue({ configured: true, user: ada });
    const { onOpenSettings } = setup();
    const button = await screen.findByRole("button", { name: "Signed in as Ada" });
    expect(button.querySelector("img")).toHaveAttribute("src", "https://img/ada.png");
    await userEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalled();
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
