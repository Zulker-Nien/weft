// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CloudflareBridge, CloudflareFolder, CloudflareStatus } from "@/lib/cloudflare-view";
import "./test-utils";
import CloudflareDrawer from "./CloudflareDrawer";

const folder = (path: string, over: Partial<CloudflareFolder> = {}): CloudflareFolder => ({ folder: path, repo: null, wrangler: null, link: null, error: null, ...over });

const signedIn = (folders: CloudflareFolder[]): CloudflareStatus => ({ signedIn: true, user: { name: "Acme" }, error: null, folders });

const PAGES = folder("/dev/site", {
  repo: "me/site",
  link: {
    kind: "pages",
    accountId: "acc1",
    name: "site",
    account: "Acme",
    git: "me/other",
    url: "https://site.example.com",
    dashboard: "https://dash.cloudflare.com/acc1/pages/view/site",
    latest: { state: "failure", stage: "build", url: "https://abc.site.pages.dev", createdAt: Date.now() - 60_000, target: "preview", source: null },
  },
});

// vitest 4 narrows `vi.fn()` to `Mock<Procedure | Constructable>`, which no longer matches a typed
// CloudflareBridge method like `(folders: string[]) => Promise<CloudflareStatus>`. A permissive
// `Mock<any[], any>` keeps the runtime mock and the type-check passing. The alias is the one
// place we mean `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;
function bridge(): { [K in keyof CloudflareBridge]: MockFn } {
  return {
    status: vi.fn(),
    setToken: vi.fn(() => Promise.resolve({ name: "Acme" })),
    forgetToken: vi.fn(() => Promise.resolve({ signedIn: false })),
    projects: vi.fn(() =>
      Promise.resolve([
        { kind: "worker", name: "old-thing", accountId: "acc1", account: "Acme", git: null, updatedAt: 9 },
        { kind: "pages", name: "notes", accountId: "acc1", account: "Acme", git: "me/notes", updatedAt: 1 },
      ]),
    ),
    link: vi.fn(() => Promise.resolve({ linked: true, name: "notes" })),
    unlink: vi.fn(() => Promise.resolve({ linked: false })),
  };
}

function setup(status: CloudflareStatus | null, project: string | null = null, error: string | null = null) {
  const b = bridge();
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  const openExternal = vi.fn();
  (window as unknown as { weft: unknown }).weft = { openExternal };
  render(<CloudflareDrawer bridge={b as unknown as CloudflareBridge} status={status} error={error} reload={reload} project={project} onOpenUrl={onOpenUrl} notify={notify} />);
  return { b, reload, notify, onOpenUrl, openExternal };
}

afterEach(() => {
  delete (window as unknown as { weft?: unknown }).weft;
});

const drawer = (b: CloudflareBridge | null, status: CloudflareStatus | null, error: string | null = null) => (
  <CloudflareDrawer bridge={b} status={status} error={error} reload={vi.fn()} project={null} onOpenUrl={vi.fn()} notify={vi.fn()} />
);

describe("CloudflareDrawer", () => {
  it("explains itself outside the desktop app, while loading, and on an error", () => {
    const { rerender } = render(drawer(null, null));
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    const b = bridge() as unknown as CloudflareBridge;
    rerender(drawer(b, null));
    expect(screen.getByText("Asking Cloudflare…")).toBeInTheDocument();
    rerender(drawer(b, null, "offline"));
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("asks for a restart in a Weft from before Cloudflare, and restarts", async () => {
    const splashAction = vi.fn();
    (window as unknown as { weft: unknown }).weft = { desktop: true, splashAction };
    const { rerender } = render(drawer(null, null));
    expect(screen.getByText("Restart Weft to turn on Cloudflare")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restart Weft" }));
    expect(splashAction).toHaveBeenCalledWith("relaunch");
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
    rerender(drawer(bridge(), null, "No handler registered for 'cloudflare:status'"));
    expect(screen.getByText("Restart Weft to turn on Cloudflare")).toBeInTheDocument();
  });

  it("asks for a token, opens the token page, and saves it", async () => {
    const { b, reload, notify, openExternal } = setup({ signedIn: false, user: null, error: null, folders: [] });
    expect(screen.queryByRole("button", { name: "Forget it" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Cloudflare API tokens ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://dash.cloudflare.com/profile/api-tokens");
    const save = screen.getByRole("button", { name: "Connect" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Cloudflare API token"), "tok");
    await userEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Cloudflare: Acme"));
    expect(b.setToken).toHaveBeenCalledWith("tok");
    expect(reload).toHaveBeenCalled();
    expect(screen.getByLabelText("Cloudflare API token")).toHaveValue("");
    b.setToken.mockResolvedValueOnce({ name: "Acme", made: true, setupDeleted: true });
    await userEvent.type(screen.getByLabelText("Cloudflare API token"), "setup");
    await userEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Cloudflare: Acme. Weft made its own token and deleted the setup token."));
  });

  it("shows a token that stopped working, lets you forget it, and toasts a failed save", async () => {
    const { b, notify } = setup({ signedIn: true, user: null, error: "Cloudflare turned the token down. Add a new one.", folders: [] });
    expect(screen.getByText(/turned the token down/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Forget it" }));
    expect(b.forgetToken).toHaveBeenCalled();
    b.setToken.mockRejectedValueOnce(new Error("nope"));
    await userEvent.type(screen.getByLabelText("Cloudflare API token"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("nope")));
  });

  it("shows a linked Pages project: its deploy, url, repo mismatch and dashboard", async () => {
    const { b, onOpenUrl, openExternal } = setup(signedIn([PAGES, folder("/dev/notes")]), "/dev/site");
    expect(screen.getByText("Signed in · Acme")).toBeInTheDocument();
    expect(screen.queryByText("notes")).not.toBeInTheDocument();
    // The folder's heading and the project's name.
    expect(screen.getAllByText("site")).toHaveLength(2);
    expect(screen.getByText("Pages · Acme")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toHaveAttribute("title", "build");
    expect(screen.getByText(/^preview · /)).toBeInTheDocument();
    expect(screen.getByText("Builds from me/other, not me/site")).toHaveClass("text-warn");
    await userEvent.click(screen.getByRole("button", { name: "site.example.com" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://site.example.com");
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://abc.site.pages.dev");
    await userEvent.click(screen.getByRole("button", { name: "Domains ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://dash.cloudflare.com/acc1/pages/view/site/domains");
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(b.unlink).toHaveBeenCalledWith("/dev/site");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(b.forgetToken).toHaveBeenCalled();
  });

  it("shows a Worker deployed by wrangler, one with no deploys, and a link Cloudflare can't read", () => {
    const worker = folder("/dev/api", {
      wrangler: { file: "wrangler.toml", name: "api", kind: "worker" },
      link: { kind: "worker", accountId: "acc1", name: "api", latest: { state: "deployed", stage: null, url: null, createdAt: 0, target: "production", source: "wrangler" } },
    });
    const none = folder("/dev/b", { link: { kind: "worker", accountId: "acc1", name: "b", account: null, latest: null } });
    const broken = folder("/dev/c", { link: { kind: "pages", accountId: "acc1", name: "gone" }, error: "Not found" });
    setup(signedIn([worker, none, broken]));
    expect(screen.getByText("Deployed")).toBeInTheDocument();
    expect(screen.getByText(/^via wrangler · /)).toBeInTheDocument();
    expect(screen.getByText("Deploys with wrangler (wrangler.toml)")).not.toHaveClass("text-warn");
    expect(screen.getByText("No deploys yet")).toBeInTheDocument();
    expect(screen.getByText("gone: Not found")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unlink" })).toHaveLength(3);
  });

  it("links a folder from the picker, best fit first, and searches", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/notes", { repo: "me/notes" }), folder("/dev/plain", { wrangler: { file: "wrangler.toml", name: "old-thing", kind: "worker" } })]));
    expect(screen.getByText("me/notes · not on Cloudflare yet")).toBeInTheDocument();
    expect(screen.getByText("wrangler.toml names old-thing")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[0]!);
    const picker = await screen.findByRole("region", { name: "Link notes" });
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByText(/^(notes|old-thing)$/).map((e) => e.textContent)).toEqual(["notes", "old-thing"]));
    expect(screen.getByText("best fit")).toBeInTheDocument();
    expect(screen.getByText("Pages · Acme · me/notes")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search Cloudflare projects"), "zzz");
    expect(screen.getByText("No project matches.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search Cloudflare projects"));
    await userEvent.click(screen.getByRole("button", { name: /^notes/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Linked notes to notes on Cloudflare"));
    expect(b.link).toHaveBeenCalledWith("/dev/notes", "pages", "acc1", "notes");
    expect(picker).not.toBeInTheDocument();
    // The list is loaded once per drawer.
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(b.projects).toHaveBeenCalledTimes(1);
  });

  it("says while loading and when the token reaches no projects", async () => {
    const { b } = setup(signedIn([folder("/dev/x")]));
    let resolve: (v: unknown[]) => void = () => {};
    b.projects.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    expect(screen.getByText("Loading your Workers and Pages…")).toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText(/No Workers or Pages projects/)).toBeInTheDocument();
  });

  it("closes the picker and toasts when the project list fails", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/x")]));
    b.projects.mockRejectedValueOnce(new Error("down"));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("down")));
    expect(screen.getByRole("button", { name: "Link…" })).toBeInTheDocument();
  });

  it("asks for a project when the board has none", () => {
    setup(signedIn([]));
    expect(screen.getByText("Add a project to the board to link it to Cloudflare.")).toBeInTheDocument();
  });
});
