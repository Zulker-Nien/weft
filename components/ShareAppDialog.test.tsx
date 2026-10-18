// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import type { SaveShareAccess, UseShareAccessOptions } from "@aimhuge/share/client";
import type { AppShareState } from "@/lib/app-share-types";
import type { MiniApp } from "@/lib/mini-apps";
import { useEscape } from "@/lib/use-escape";

// The Share… dialog over the real @aimhuge/share UI, with the API and the account faked. Mirrors the card's
// ShareCardDialog test: the dialog draws from the app's memo at once and the server's answer replaces it.

const api = vi.hoisted(() => ({ getShare: vi.fn(), setShare: vi.fn() }));
const reloadApps = vi.fn(() => Promise.resolve());
const account = vi.hoisted(() => ({ signIn: vi.fn(), busy: null as string | null, waiting: null as object | null, error: null as string | null }));
const signedIn = vi.hoisted(() => ({ user: null as { id: string } | null }));
// The dialog's save is captured per render so a test can invoke it with a mode the UI hides
// (public_edit, which the package would never pass because allowEdit={false} hides the level row).
const saveHolder: { current: SaveShareAccess | null } = { current: null };
vi.mock("@/lib/use-mini-apps", () => ({ appsApi: api, reloadApps }));
vi.mock("@/lib/use-account", () => ({ useAccount: () => ({ state: { kind: "ready", view: { configured: true, user: signedIn.user } }, ...account }) }));
vi.mock("@aimhuge/share/client", async () => {
  const actual = await vi.importActual<typeof import("@aimhuge/share/client")>("@aimhuge/share/client");
  return {
    ...actual,
    useShareAccess: (opts: UseShareAccessOptions) => {
      saveHolder.current = opts.save;
      return actual.useShareAccess(opts);
    },
  };
});

const { default: ShareAppDialog } = await import("./ShareAppDialog");

const BLOB_APP: MiniApp = { id: "ap1", name: "Login page", url: "file:///Users/me/dev/app/index.html", addedAt: 1 };
const SITE_APP: MiniApp = { id: "ap2", name: "Docs", url: "https://docs.test/handbook", addedAt: 2 };

const PRIVATE: AppShareState = { kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "blob" };
const SHARED: AppShareState = { kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "email", hasPassword: false, shows: "blob" };
const UNSHAREABLE: AppShareState = { kind: "unshareable", reason: "This app runs on your Mac (localhost:5173), so a weft.zip link can't reach it." };

function setup(app: MiniApp, ...answers: AppShareState[]) {
  for (const a of answers) api.getShare.mockResolvedValueOnce(a);
  const onClose = vi.fn();
  render(<ShareAppDialog app={app} onClose={onClose} />);
  return { onClose };
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  reloadApps.mockReset().mockResolvedValue(undefined);
  saveHolder.current = null;
  Object.assign(account, { busy: null, waiting: null, error: null });
  signedIn.user = { id: "u1" };
  account.signIn.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("ShareAppDialog", () => {
  it("draws the app's remembered link at once, before the server answers", () => {
    api.getShare.mockReturnValueOnce(new Promise(() => {}));
    render(<ShareAppDialog app={{ ...BLOB_APP, share: { id: "memo-1", mode: "public", hasPassword: false } }} onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Who can open this app" })).toHaveValue("link");
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("replaces the seed with the server's answer once it lands", async () => {
    api.getShare.mockResolvedValueOnce(SHARED);
    setup(BLOB_APP);
    expect(api.getShare).toHaveBeenCalledWith("ap1");
    await waitFor(() => screen.getByRole("combobox", { name: "Who can open this app" }));
    expect(screen.getByRole("combobox", { name: "Who can open this app" })).toHaveValue("link");
    expect(screen.getAllByRole("button", { name: /Copy link/ })).toHaveLength(2);
  });

  it("shows the reason when the page can't be shared", async () => {
    setup(BLOB_APP, UNSHAREABLE);
    expect(await screen.findByText(/This app runs on your Mac/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows the sign-in at once when signed out", async () => {
    signedIn.user = null;
    api.getShare.mockResolvedValueOnce({ kind: "signed-out" });
    setup(BLOB_APP);
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("does not draw a workspace note (apps have no per-workspace folders)", async () => {
    api.getShare.mockResolvedValueOnce({ kind: "no-workspace" });
    setup(BLOB_APP);
    expect(await screen.findByText(/weft\.zip\/team/)).toBeInTheDocument();
  });

  it("shows a failed load", async () => {
    api.getShare.mockRejectedValueOnce("offline");
    setup(BLOB_APP);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("saves a new email-gated link when the audience is changed from private to link", async () => {
    // Going private → link with the gate still on "none" would be a one-click open link, so
    // the package's withAxis defaults the gate to "email". The save is called with mode "email".
    api.getShare.mockResolvedValueOnce(PRIVATE);
    api.setShare.mockResolvedValueOnce({ ...PRIVATE, id: "sNew", url: "https://weft.zip/a/sNew", mode: "email", hasPassword: false });
    setup(BLOB_APP);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Who can open this app" }), "link");
    expect(api.setShare).toHaveBeenCalledWith("ap1", { mode: "email", password: undefined });
  });

  it("refuses a public_edit mode the UI cannot reach: the save refuses anyway", async () => {
    // The dialog's "What link holders can do" select is hidden (allowEdit={false}), so public_edit
    // can't be picked from the UI. The save callback still checks for it, defensively: invoke the
    // captured save with a public_edit mode and assert it returns an error without calling setShare.
    api.getShare.mockResolvedValueOnce(PRIVATE);
    render(<ShareAppDialog app={BLOB_APP} onClose={vi.fn()} />);
    await screen.findByRole("dialog");
    expect(saveHolder.current).not.toBeNull();
    const result = await saveHolder.current!({ mode: "public_edit", editRequiresEmail: false }, undefined);
    expect(result).toEqual({ ok: false, error: "Mini apps can't be edited from a link." });
    expect(api.setShare).not.toHaveBeenCalled();
  });

  it("reloads the apps list after a successful save", async () => {
    api.getShare.mockResolvedValueOnce(SHARED);
    api.setShare.mockResolvedValueOnce({ ...SHARED, mode: "public", hasPassword: false });
    setup(BLOB_APP);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Who can open this app" }), "link");
    expect(reloadApps).toHaveBeenCalledTimes(1);
  });

  it("returns the server's refusal for a non-ok save answer", async () => {
    // The dialog's save function turns a non-ok AppShareState into {ok:false, error:...} so the
    // package's useShareAccess can snap the UI back. Invoke the captured save with a stubbed
    // server answer that the dialog can't show as a state (a non-ok kind), and the error message
    // is exactly the one the package's alert will draw.
    api.getShare.mockResolvedValueOnce(PRIVATE);
    render(<ShareAppDialog app={BLOB_APP} onClose={vi.fn()} />);
    await screen.findByRole("dialog");
    api.setShare.mockResolvedValueOnce({ kind: "no-workspace" });
    const result = await saveHolder.current!({ mode: "public", editRequiresEmail: true }, undefined);
    expect(result).toEqual({ ok: false, error: "Sharing isn't available right now." });
  });

  it("returns the thrown message when setShare rejects", async () => {
    api.getShare.mockResolvedValueOnce(PRIVATE);
    api.setShare.mockRejectedValueOnce(new Error("Set a password first."));
    setup(BLOB_APP);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Who can open this app" }), "link");
    expect(await screen.findByRole("alert")).toHaveTextContent("Set a password first.");
  });

  it("draws the blob note for a local-file app", async () => {
    api.getShare.mockResolvedValueOnce(SHARED);
    setup(BLOB_APP);
    expect(await screen.findByText(/copy of this page, sandboxed/)).toBeInTheDocument();
  });

  it("draws the site note for an https site", async () => {
    api.getShare.mockResolvedValueOnce(SHARED);
    setup(SITE_APP);
    expect(await screen.findByText(/frames this site under weft\.zip/)).toBeInTheDocument();
  });

  it("closes once on Escape, leaving Weft's panels open", async () => {
    const panel = vi.fn();
    function Panel() {
      useEscape(true, panel, { panel: true });
      return null;
    }
    api.getShare.mockResolvedValueOnce(PRIVATE);
    const onClose = vi.fn();
    render(
      <>
        <Panel />
        <ShareAppDialog app={BLOB_APP} onClose={onClose} />
      </>,
    );
    await screen.findByRole("combobox", { name: "Who can open this app" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled();
  });
});
