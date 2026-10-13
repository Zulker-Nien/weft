import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedFolders as tempLinks, mainOk, resetFake } from "./vercel-hooks.harness";

// Live pull of Vercel env variables by webhook, the account side: the vercel_hooks rows on your Weft account and the hook
// Electron main puts on the Vercel team. The account's Supabase client and the shell (main) are fakes
// (lib/vercel-hooks.harness.ts); links are real .vercel/project.json files in temp folders.

const fake = await vi.hoisted(async () => (await import("./vercel-hooks.harness")).fakeAccount());
vi.mock("./account", () => ({
  accountClient: () => {
    if (fake.state.throwClient) throw new Error("Weft accounts aren't set up in this build yet.");
    return fake.client;
  },
}));

const main = vi.hoisted(() => ({ shell: vi.fn<(route: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>>() }));
vi.mock("./browser-tools", () => main);

const board = vi.hoisted(() => ({ cards: [] as { cwd?: string }[] }));
vi.mock("./store", () => ({ listCards: () => board.cards }));

const hooks = await import("./vercel-hooks");

const links = tempLinks("weft-vercel-hooks-");
afterAll(links.clean);
const folder = links.folder;

const app = folder("app", { projectId: "prj_app", orgId: "team_abc" });
const solo = folder("solo", { projectId: "prj_solo", orgId: "user_me" });
const unlinked = folder("unlinked");

const pulled = () => main.shell.mock.calls.filter(([route]) => route === "/vercel/env-pull").map(([, body]) => body?.folder);

beforeEach(() => {
  resetFake(fake);
  delete (globalThis as Record<string, unknown>).__weftVercelHooks;
  vi.clearAllMocks();
  main.shell.mockImplementation(mainOk);
});
afterEach(() => vi.useRealTimers());

describe("linkOf", () => {
  it("reads the folder's project and team", () => {
    expect(hooks.linkOf(app)).toEqual({ projectId: "prj_app", orgId: "team_abc" });
  });

  it("is null for no link, a half link or a file that isn't JSON", () => {
    expect(hooks.linkOf(unlinked)).toBeNull();
    expect(hooks.linkOf(path.join(links.root, "missing"))).toBeNull();
    expect(hooks.linkOf(folder("half", { projectId: "prj_x" }))).toBeNull();
    expect(hooks.linkOf(folder("numbers", { projectId: 1, orgId: 2 }))).toBeNull();
    expect(hooks.linkOf(folder("junk", "{nope"))).toBeNull();
  });
});

describe("hookedTeams", () => {
  it("lists the Vercel teams hooked on your account", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    expect(await hooks.hookedTeams()).toEqual({ signedIn: true, teams: ["team_abc"] });
  });

  it("is empty when signed out or accounts are off, and throws a read error", async () => {
    fake.state.uid = null;
    expect(await hooks.hookedTeams()).toEqual({ signedIn: false, teams: [] });
    fake.state.throwClient = true;
    expect(await hooks.hookedTeams()).toEqual({ signedIn: false, teams: [] });
    fake.state.throwClient = false;
    fake.state.uid = "u1";
    fake.state.error = { message: "offline" };
    await expect(hooks.hookedTeams()).rejects.toThrow("offline");
  });
});

describe("addVercelHook", () => {
  it("makes the Vercel hook, saves the row, listens and pulls the folder", async () => {
    expect(await hooks.addVercelHook(app)).toEqual({ team: "team_abc" });
    const [route, body] = main.shell.mock.calls[0] ?? [];
    expect(route).toBe("/vercel/webhook-create");
    const id = fake.state.rows[0]?.id ?? "missing";
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({ teamId: "team_abc", url: `${hooks.HOOK_URL}?hook=${id}` });
    expect(fake.state.rows).toEqual([{ id, team_id: "team_abc", vercel_hook_id: "hook_1", secret: "whsec" }]);
    expect(fake.state.channels).toEqual(["vercel-events-u1"]);
    expect(pulled()).toEqual([app]);
  });

  it("leaves a team that already has one, and doesn't open a second channel", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_9" }];
    await hooks.addVercelHook(app);
    await hooks.addVercelHook(app);
    expect(main.shell.mock.calls.filter(([route]) => route === "/vercel/webhook-create")).toEqual([]);
    expect(fake.state.channels).toHaveLength(1);
    expect(pulled()).toEqual([app, app]);
  });

  it("needs a Weft sign-in", async () => {
    fake.state.uid = null;
    await expect(hooks.addVercelHook(app)).rejects.toThrow("Sign in to your Weft account");
    expect(main.shell).not.toHaveBeenCalled();
  });

  it("says when the folder has no Vercel project, or its project isn't in a team", async () => {
    await expect(hooks.addVercelHook(unlinked)).rejects.toThrow("unlinked isn't linked to a Vercel project yet.");
    await expect(hooks.addVercelHook(solo)).rejects.toThrow("Vercel webhooks belong to a team");
    expect(main.shell).not.toHaveBeenCalled();
  });

  it("takes the Vercel hook back off and says why when the row won't save", async () => {
    fake.state.insertError = { message: "insert refused" };
    await expect(hooks.addVercelHook(app)).rejects.toThrow("insert refused");
    expect(main.shell).toHaveBeenLastCalledWith("/vercel/webhook-delete", { teamId: "team_abc", id: "hook_1" });
    expect(fake.state.channels).toEqual([]);
    // Even if undoing it fails, the original reason is what comes back.
    main.shell.mockImplementation((route: string) => (route === "/vercel/webhook-delete" ? Promise.reject(new Error("vercel down")) : Promise.resolve({ id: "hook_1", secret: "whsec" })));
    await expect(hooks.addVercelHook(app)).rejects.toThrow("insert refused");
  });

  it("passes on a read error", async () => {
    fake.state.error = { message: "offline" };
    await expect(hooks.addVercelHook(app)).rejects.toThrow("offline");
    expect(main.shell).not.toHaveBeenCalled();
  });

  it("still succeeds when the first pull fails, and logs it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    main.shell.mockImplementation((route: string) => (route === "/vercel/env-pull" ? Promise.reject(new Error("no token")) : Promise.resolve({ id: "hook_1", secret: "whsec" })));
    expect(await hooks.addVercelHook(app)).toEqual({ team: "team_abc" });
    expect(warn).toHaveBeenCalledWith(`Vercel pull for ${app}: no token`);
    warn.mockRestore();
  });
});

describe("removeVercelHook", () => {
  it("takes the hook off Vercel and the account, and stops listening with none left", async () => {
    await hooks.addVercelHook(app);
    main.shell.mockClear();
    await hooks.removeVercelHook(app);
    expect(main.shell).toHaveBeenCalledWith("/vercel/webhook-delete", { teamId: "team_abc", id: "hook_1" });
    expect(fake.state.rows).toEqual([]);
    expect(fake.state.removed).toBe(1);
  });

  it("keeps listening while another team has a hook", async () => {
    fake.state.rows = [
      { id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" },
      { id: "h2", team_id: "team_xyz", vercel_hook_id: "hook_2" },
    ];
    await hooks.removeVercelHook(app);
    expect(fake.state.rows.map((r) => r.team_id)).toEqual(["team_xyz"]);
    expect(fake.state.removed).toBe(0);
  });

  it("does nothing signed out or with no hook, and passes on a read error", async () => {
    fake.state.uid = null;
    await hooks.removeVercelHook(app);
    fake.state.uid = "u1";
    await hooks.removeVercelHook(app);
    expect(main.shell).not.toHaveBeenCalled();
    await expect(hooks.removeVercelHook(unlinked)).rejects.toThrow("isn't linked");
    fake.state.error = { message: "offline" };
    await expect(hooks.removeVercelHook(app)).rejects.toThrow("offline");
  });
});

