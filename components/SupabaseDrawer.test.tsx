// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseBridge, SupabaseFolder, SupabaseStatus } from "@/lib/supabase-view";
import type { Card } from "@/lib/types";
import "./test-utils";
import SupabaseDrawer from "./SupabaseDrawer";

const REF = "abcdefghijklmnopqrst";
const folder = (path: string, over: Partial<SupabaseFolder> = {}): SupabaseFolder => ({ folder: path, repo: null, migrations: 0, link: null, error: null, ...over });
const signedIn = (folders: SupabaseFolder[]): SupabaseStatus => ({ signedIn: true, orgs: ["Acme"], error: null, folders });

const LINKED = folder("/dev/web", {
  repo: "me/web",
  migrations: 3,
  link: { ref: REF, source: "cli", name: "web", org: "Acme", region: "us-east-1", status: "ACTIVE_HEALTHY", url: `https://${REF}.supabase.co`, pending: ["add_profiles"] },
});

function bridge(): { [K in keyof SupabaseBridge]: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(),
    setToken: vi.fn(() => Promise.resolve({ orgs: ["Acme"] })),
    forgetToken: vi.fn(() => Promise.resolve({ signedIn: false })),
    projects: vi.fn(() =>
      Promise.resolve([
        { ref: "rold", name: "old-thing", org: "Acme", region: "eu-west-1", status: "INACTIVE", createdAt: 9 },
        { ref: "rnotes", name: "notes", org: "Me", region: null, status: "ACTIVE_HEALTHY", createdAt: 1 },
      ]),
    ),
    orgs: vi.fn(() => Promise.resolve([{ slug: "acme", name: "Acme" }])),
    create: vi.fn(() => Promise.resolve({ ref: REF, name: "notes", secret: "SUPABASE_DB_PASSWORD" })),
    link: vi.fn(() => Promise.resolve({ linked: true, name: "notes" })),
    unlink: vi.fn(() => Promise.resolve({ linked: false })),
    restore: vi.fn(() => Promise.resolve({ restoring: true })),
  };
}

// A <p> whose whole text (across its links) is this.
const para = (text: string) => screen.getByText((_, el) => el?.tagName === "P" && el.textContent === text);

function setup(status: SupabaseStatus | null, project: string | null = null, error: string | null = null, cards: Card[] = []) {
  const b = bridge();
  const reload = vi.fn(() => Promise.resolve());
  const notify = vi.fn();
  const onOpenUrl = vi.fn();
  const onOpenCard = vi.fn();
  const openExternal = vi.fn();
  const splashAction = vi.fn();
  (window as unknown as { threadboard: unknown }).threadboard = { openExternal, splashAction };
  render(<SupabaseDrawer bridge={b as unknown as SupabaseBridge} status={status} error={error} reload={reload} project={project} cards={cards} onOpenCard={onOpenCard} onOpenUrl={onOpenUrl} notify={notify} />);
  return { b, reload, notify, onOpenUrl, onOpenCard, openExternal, splashAction };
}

afterEach(() => {
  delete (window as unknown as { threadboard?: unknown }).threadboard;
});

describe("SupabaseDrawer", () => {
  it("explains itself outside the desktop app, while loading, and on an error", () => {
    const { rerender } = render(<SupabaseDrawer bridge={null} status={null} error={null} reload={vi.fn()} project={null} cards={[]} onOpenCard={vi.fn()} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText(/desktop app/)).toBeInTheDocument();
    const b = bridge() as unknown as SupabaseBridge;
    rerender(<SupabaseDrawer bridge={b} status={null} error={null} reload={vi.fn()} project={null} cards={[]} onOpenCard={vi.fn()} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("Asking Supabase…")).toBeInTheDocument();
    rerender(<SupabaseDrawer bridge={b} status={null} error="offline" reload={vi.fn()} project={null} cards={[]} onOpenCard={vi.fn()} onOpenUrl={vi.fn()} notify={vi.fn()} />);
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("asks for a restart when Weft started before Supabase was added", async () => {
    const { splashAction } = setup(null, null, "No handler registered for 'supabase:status'");
    const restart = screen.getByRole("button", { name: "Restart Weft" });
    await userEvent.click(restart);
    expect(splashAction).toHaveBeenCalledWith("relaunch");
    expect(screen.getByRole("button", { name: "Restarting…" })).toBeDisabled();
  });

  it("asks for a token, opens the token page, and saves it", async () => {
    const { b, reload, notify, openExternal } = setup({ signedIn: false, orgs: null, error: null, folders: [] });
    expect(screen.queryByRole("button", { name: "Forget it" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "supabase.com/dashboard/account/tokens" }));
    expect(openExternal).toHaveBeenCalledWith("https://supabase.com/dashboard/account/tokens");
    const save = screen.getByRole("button", { name: "Save token" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Supabase access token"), "sbp_x");
    await userEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Supabase (Acme)"));
    expect(b.setToken).toHaveBeenCalledWith("sbp_x");
    expect(reload).toHaveBeenCalled();
    expect(screen.getByLabelText("Supabase access token")).toHaveValue("");
    b.setToken.mockResolvedValueOnce({ orgs: [] });
    await userEvent.type(screen.getByLabelText("Supabase access token"), "sbp_y");
    await userEvent.click(save);
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Signed in to Supabase"));
  });

  it("shows a token that stopped working, lets you forget it, and toasts a failed save", async () => {
    const { b, notify } = setup({ signedIn: true, orgs: null, error: "Supabase turned the token down. Add a new one.", folders: [] });
    expect(screen.getByText(/turned the token down/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Forget it" }));
    expect(b.forgetToken).toHaveBeenCalled();
    b.setToken.mockRejectedValueOnce(new Error("nope"));
    await userEvent.type(screen.getByLabelText("Supabase access token"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save token" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(new Error("nope")));
  });

  it("links an unapplied migration to the card that wrote it", async () => {
    const owner = { id: "c1", title: "Profiles table", touchedFiles: ["/dev/web/supabase/migrations/20261011_add_profiles.sql"], updatedAt: 2 } as Card;
    const pending = ["add_profiles", "add_notes", "add_tags"];
    const { onOpenCard } = setup(signedIn([{ ...LINKED, link: { ...LINKED.link!, pending } }]), "/dev/web", null, [owner]);
    expect(para("3 of 3 migrations not applied: add_profiles, add_notes, …")).toHaveClass("text-warn");
    expect(screen.queryByRole("button", { name: "add_notes" })).not.toBeInTheDocument();
    const link = screen.getByRole("button", { name: "add_profiles" });
    expect(link).toHaveAttribute("title", "Open the card that wrote it: Profiles table");
    await userEvent.click(link);
    expect(onOpenCard).toHaveBeenCalledWith(owner);
  });

  it("shows a linked project: its state, API URL, migrations and dashboard links", async () => {
    const { b, onOpenUrl, openExternal } = setup(signedIn([LINKED, folder("/dev/notes")]), "/dev/web");
    expect(screen.getByText("Signed in · Acme")).toBeInTheDocument();
    expect(screen.queryByText("notes")).not.toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(para("1 of 3 migrations not applied: add_profiles")).toHaveClass("text-warn");
    expect(screen.queryByRole("button", { name: "add_profiles" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${REF}.supabase.co` }));
    expect(onOpenUrl).toHaveBeenCalledWith(`https://supabase.com/dashboard/project/${REF}`);
    await userEvent.click(screen.getByRole("button", { name: "Usage ↗" }));
    expect(openExternal).toHaveBeenCalledWith(`https://supabase.com/dashboard/project/${REF}/settings/billing/usage`);
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(b.unlink).toHaveBeenCalledWith("/dev/web");
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(b.forgetToken).toHaveBeenCalled();
  });

  it("restores a paused project, shows an .mcp.json link, and a link Supabase can't read", async () => {
    const paused = folder("/dev/a", { link: { ref: "ra", source: "cli", name: "a", status: "INACTIVE" } });
    const mcp = folder("/dev/b", { link: { ref: "rb", source: "mcp", name: null } });
    const broken = folder("/dev/c", { link: { ref: "gone", source: "cli", name: null }, error: "Project not found" });
    const { b, notify } = setup(signedIn([paused, mcp, broken]));
    expect(screen.getByText("Paused")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Supabase is waking the project; it takes a few minutes"));
    expect(b.restore).toHaveBeenCalledWith("ra");
    expect(screen.getByText("Linked in .mcp.json")).toBeInTheDocument();
    expect(screen.getByText("rb")).toBeInTheDocument();
    expect(screen.getByText("gone: Project not found")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Unlink" })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Link CLI…" }));
    expect(await screen.findByRole("region", { name: "Link b" })).toBeInTheDocument();
  });

  it("links a folder from the picker, best fit first, and searches", async () => {
    const { b, notify, openExternal } = setup(signedIn([folder("/dev/notes", { migrations: 2 }), folder("/dev/plain")]));
    expect(screen.getByText("2 local migrations · not linked")).toBeInTheDocument();
    expect(screen.getByText("Not linked to a Supabase project")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[0]!);
    const picker = await screen.findByRole("region", { name: "Link notes" });
    await waitFor(() => expect(within(screen.getByRole("list")).getAllByText(/^(notes|old-thing)$/).map((e) => e.textContent)).toEqual(["notes", "old-thing"]));
    expect(screen.getByText("best fit")).toBeInTheDocument();
    expect(screen.getByText("Acme · eu-west-1 · paused")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    await userEvent.click(screen.getByRole("button", { name: "supabase.com ↗" }));
    expect(openExternal).toHaveBeenCalledWith("https://supabase.com/dashboard/new");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.type(screen.getByLabelText("Search Supabase projects"), "zzz");
    expect(screen.getByText("No project matches.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Search Supabase projects"));
    await userEvent.click(screen.getByRole("button", { name: /^notes/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Linked notes to notes on Supabase"));
    expect(b.link).toHaveBeenCalledWith("/dev/notes", "rnotes");
    expect(picker).not.toBeInTheDocument();
    // The list is loaded once per drawer.
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getAllByRole("button", { name: "Link…" })[1]!);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(b.projects).toHaveBeenCalledTimes(1);
  });

  it("makes a new project in place: name from the folder, your usual region, the org you pick", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/shop", { repo: "me/shop-app" })]));
    b.orgs.mockResolvedValueOnce([
      { slug: "acme", name: "Acme" },
      { slug: "me", name: "Me" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await screen.findByText("old-thing");
    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.queryByLabelText("Search Supabase projects")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New project name")).toHaveValue("shop-app");
    expect(screen.getByLabelText("Region")).toHaveValue("eu-west-1");
    await userEvent.selectOptions(screen.getByLabelText("Organization"), "me");
    await userEvent.selectOptions(screen.getByLabelText("Region"), "ap-southeast-1");
    await userEvent.clear(screen.getByLabelText("New project name"));
    expect(screen.getByRole("button", { name: "Create & link" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("New project name"), " shop {Enter}");
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("Made notes on Supabase and linked shop; its database password is in the 🔐 vault as SUPABASE_DB_PASSWORD")));
    expect(b.create).toHaveBeenCalledWith("/dev/shop", { name: "shop", org: "me", region: "ap-southeast-1" });
    expect(screen.queryByLabelText("New project name")).not.toBeInTheDocument();
    // A made project lists itself next time: the list loads again.
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await userEvent.click(await screen.findByRole("button", { name: "New project" }));
    expect(screen.queryByLabelText("Organization")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("New project name"), "{Escape}");
    expect(screen.getByLabelText("Search Supabase projects")).toBeInTheDocument();
    expect(b.projects).toHaveBeenCalledTimes(2);
  });

  it("still links when the organizations can't be listed, and says why New project can't make one", async () => {
    const { b } = setup(signedIn([folder("/dev/shop")]));
    b.orgs.mockRejectedValueOnce(new Error("No handler registered for 'supabase:orgs'"));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    expect(await screen.findByText("old-thing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(screen.getByText(/couldn.t list your Supabase organizations/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create & link" })).toBeDisabled();
  });

  it("says when the token reaches no projects, and closes the picker when the list fails", async () => {
    const { b, notify } = setup(signedIn([folder("/dev/x")]));
    b.projects.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    expect(await screen.findByText("No projects on Supabase yet: make one above.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // A fresh drawer, whose list fails to load.
    document.body.innerHTML = "";
    const second = setup(signedIn([folder("/dev/y")]));
    second.b.projects.mockRejectedValueOnce(new Error("down"));
    await userEvent.click(screen.getByRole("button", { name: "Link…" }));
    await waitFor(() => expect(second.notify).toHaveBeenCalledWith(new Error("down")));
    expect(screen.getByRole("button", { name: "Link…" })).toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
  });

  it("asks for a project when the board has none", () => {
    setup(signedIn([]));
    expect(screen.getByText("Add a project to the board to link it to Supabase.")).toBeInTheDocument();
  });
});
