// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GithubFolder, GithubStatus } from "@/lib/github-view";
import "./test-utils";

const api = vi.hoisted(() => ({
  importIssues: vi.fn(() => Promise.resolve({ folder: "/dev/app", added: 2, updated: 0, archived: 0 })),
  stopIssues: vi.fn(() => Promise.resolve({ folders: [] })),
  addHook: vi.fn(() => Promise.resolve({ repo: "acme/app" })),
  removeHook: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/lib/client", () => ({ api }));

const { default: GithubDrawer } = await import("./GithubDrawer");

const folder = (path: string, over: Partial<GithubFolder> = {}): GithubFolder => ({ folder: path, repo: null, error: null, syncing: false, last: null, instant: false, ...over });
const signedIn = (folders: GithubFolder[]): GithubStatus => ({ account: { login: "fotoflo", url: "https://github.com/fotoflo" }, error: null, weft: true, instantError: null, folders });

function setup(status: GithubStatus | null, project: string | null = null, error: string | null = null) {
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  const openExternal = vi.fn();
  (window as unknown as { threadboard: unknown }).threadboard = { openExternal };
  render(<GithubDrawer status={status} error={error} reload={reload} project={project} onOpenUrl={onOpenUrl} notify={notify} />);
  return { reload, notify, onOpenUrl, openExternal };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete (window as unknown as { threadboard?: unknown }).threadboard;
});

describe("GithubDrawer", () => {
  it("says it's loading, or what went wrong", () => {
    setup(null);
    expect(screen.getByText("Asking GitHub…")).toBeInTheDocument();
  });

  it("shows a load error", () => {
    setup(null, null, "Server down");
    expect(screen.getByText("Server down")).toBeInTheDocument();
  });

  it("walks a signed-out gh through signing in, and checks again", async () => {
    const { reload, openExternal } = setup({ account: null, error: "The GitHub CLI isn't logged in. Run gh auth login.", weft: false, instantError: null, folders: [] });
    expect(screen.getByText("gh auth login --web")).toBeInTheDocument();
    expect(screen.queryByText("brew install gh")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(reload).toHaveBeenCalled();
    await userEvent.click(screen.getByText("GitHub CLI"));
    expect(openExternal).toHaveBeenCalledWith("https://cli.github.com");
  });

  it("asks for gh to be installed when it's missing", () => {
    setup({ account: null, error: "The GitHub CLI isn't installed. brew install gh, then gh auth login.", weft: false, instantError: null, folders: [] });
    expect(screen.getByText("brew install gh")).toBeInTheDocument();
  });

  it("shows the account, a folder with no remote, and the repo links", async () => {
    const { onOpenUrl } = setup(signedIn([folder("/dev/app", { repo: "acme/app" }), folder("/dev/notes", { error: "notes has no GitHub remote" })]));
    expect(screen.getByText("notes has no GitHub remote")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "@fotoflo" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/fotoflo");
    await userEvent.click(screen.getByRole("button", { name: /acme\/app/ }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/acme/app");
    await userEvent.click(screen.getByRole("button", { name: "Issues" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://github.com/acme/app/issues");
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
  });

  it("turns a folder's issue sync on, syncing it now", async () => {
    const { reload, notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app" })]));
    await userEvent.click(screen.getByRole("checkbox", { name: /Issues → Backlog/ }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(api.importIssues).toHaveBeenCalledWith("/dev/app");
    expect(notify).toHaveBeenCalledWith("GitHub issues for app: 2 added");
  });

  it("syncs now and turns sync off on a synced folder", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, last: { at: Date.now(), counts: { added: 0, updated: 1, archived: 0 } } })]));
    expect(screen.getByText(/1 updated/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(api.importIssues).toHaveBeenCalledWith("/dev/app"));
    await userEvent.click(screen.getByRole("checkbox", { name: /Issues → Backlog/ }));
    await waitFor(() => expect(api.stopIssues).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenLastCalledWith("Stopped syncing GitHub issues for app; its cards stay");
  });

  it("toasts a failed sync and shows a sync error", async () => {
    api.importIssues.mockRejectedValueOnce(new Error("rate limited"));
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, last: { at: 1, error: "gh broke" } })]));
    expect(screen.getByText("gh broke")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("rate limited")));
  });

  it("shows only the top bar's project, and says when there are none", () => {
    setup(signedIn([folder("/dev/app", { repo: "acme/app" }), folder("/dev/web", { repo: "acme/web" })]), "/dev/web");
    expect(screen.queryByText("acme/app")).not.toBeInTheDocument();
    expect(screen.getByText("acme/web")).toBeInTheDocument();
  });

  it("asks for a project when the board has none", () => {
    setup(signedIn([]));
    expect(screen.getByText(/Add a project to the board/)).toBeInTheDocument();
  });

  it("turns instant updates on and off for a synced folder", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true })]));
    expect(screen.getByText("Syncing every 5 minutes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Instant, by webhook" }));
    await waitFor(() => expect(api.addHook).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenCalledWith("acme/app now sends its issue changes to Weft as they happen");
  });

  it("takes a webhook off", async () => {
    const { notify } = setup(signedIn([folder("/dev/app", { repo: "acme/app", syncing: true, instant: true })]));
    expect(screen.getByText("Syncing as issues change")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Instant, by webhook" }));
    await waitFor(() => expect(api.removeHook).toHaveBeenCalledWith("/dev/app"));
    expect(notify).toHaveBeenCalledWith("Took the webhook off acme/app; it syncs every 5 minutes");
  });

  it("asks for a Weft sign-in before instant updates, and shows a webhook read error", () => {
    setup({ ...signedIn([folder("/dev/app", { repo: "acme/app", syncing: true })]), weft: false, instantError: "Couldn't read your webhooks: offline" });
    expect(screen.getByRole("checkbox", { name: "Instant: sign in to Weft first" })).toBeDisabled();
    expect(screen.getByText("Couldn't read your webhooks: offline")).toBeInTheDocument();
  });
});
