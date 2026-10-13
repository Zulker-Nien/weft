import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedFolders as tempLinks, mainOk, resetFake } from "./vercel-hooks.harness";

// Live pull of Vercel env variables by webhook, the listening side: the Realtime channel that pulls a project's folders
// when its event arrives, the catch-up when listening starts, and following sign-in. The account's Supabase client, the
// shell (main) and the board's cards are fakes (lib/vercel-hooks.harness.ts).

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
const web = folder("web", { projectId: "prj_web", orgId: "team_abc" });
const web2 = folder("web2", { projectId: "prj_web", orgId: "team_abc" });
const other = folder("other", { projectId: "prj_other", orgId: "team_xyz" });
const unlinked = folder("unlinked");

const pulled = () => main.shell.mock.calls.filter(([route]) => route === "/vercel/env-pull").map(([, body]) => body?.folder);

beforeEach(() => {
  resetFake(fake);
  board.cards = [];
  delete (globalThis as Record<string, unknown>).__weftVercelHooks;
  vi.clearAllMocks();
  main.shell.mockImplementation(mainOk);
});
afterEach(() => vi.useRealTimers());

describe("linkedFolders and pullProject", () => {
  it("lists each board folder with a Vercel link once", () => {
    board.cards = [{ cwd: app }, { cwd: app }, { cwd: unlinked }, {}, { cwd: web }];
    expect(hooks.linkedFolders()).toEqual([
      { folder: app, link: { projectId: "prj_app", orgId: "team_abc" } },
      { folder: web, link: { projectId: "prj_web", orgId: "team_abc" } },
    ]);
  });

  it("pulls every folder linked to the project", async () => {
    board.cards = [{ cwd: app }, { cwd: web }, { cwd: web2 }];
    await hooks.pullProject("prj_web");
    expect(pulled()).toEqual([web, web2]);
  });

  it("pulls nothing for a project no folder has", async () => {
    board.cards = [{ cwd: app }];
    await hooks.pullProject("prj_nope");
    expect(main.shell).not.toHaveBeenCalled();
  });
});

describe("listening", () => {
  it("pulls the project's folders once its burst of events settles", async () => {
    board.cards = [{ cwd: app }, { cwd: web }, { cwd: web2 }, { cwd: other }];
    await hooks.addVercelHook(app);
    main.shell.mockClear();
    vi.useFakeTimers();
    fake.state.onChange?.({ new: { project_id: "prj_web" } });
    fake.state.onChange?.({ new: { project_id: "prj_web" } });
    fake.state.onChange?.({ new: { project_id: 7 } });
    fake.state.onChange?.({ new: {} });
    await vi.advanceTimersByTimeAsync(hooks.SETTLE_MS - 1);
    expect(main.shell).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(pulled()).toEqual([web, web2]);
    await vi.advanceTimersByTimeAsync(hooks.SETTLE_MS * 2);
    expect(pulled()).toEqual([web, web2]);
  });

  it("settles each project on its own", async () => {
    board.cards = [{ cwd: app }, { cwd: web }];
    await hooks.addVercelHook(app);
    main.shell.mockClear();
    vi.useFakeTimers();
    fake.state.onChange?.({ new: { project_id: "prj_app" } });
    fake.state.onChange?.({ new: { project_id: "prj_web" } });
    await vi.advanceTimersByTimeAsync(hooks.SETTLE_MS);
    expect(pulled().sort()).toEqual([app, web].sort());
  });
});

describe("refreshVercelListener", () => {
  it("listens and catches up on every folder on a hooked team", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    board.cards = [{ cwd: app }, { cwd: other }, { cwd: web }];
    await hooks.refreshVercelListener();
    expect(fake.state.channels).toEqual(["vercel-events-u1"]);
    expect(pulled()).toEqual([app, web]);
    // Already listening: no second channel and no second catch-up.
    await hooks.refreshVercelListener();
    expect(fake.state.channels).toHaveLength(1);
    expect(pulled()).toEqual([app, web]);
  });

  it("stops listening when signed out or with no hooks", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    await hooks.refreshVercelListener();
    fake.state.rows = [];
    await hooks.refreshVercelListener();
    expect(fake.state.removed).toBe(1);
    // Nothing left to stop.
    fake.state.uid = null;
    await hooks.refreshVercelListener();
    expect(fake.state.removed).toBe(1);
  });

  it("doesn't listen if the session ends between the checks", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    board.cards = [{ cwd: app }];
    fake.state.uids = ["u1", null];
    await hooks.refreshVercelListener();
    expect(fake.state.channels).toEqual([]);
  });

  it("moves its channel to the new account on a switch", async () => {
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    await hooks.refreshVercelListener();
    fake.state.uid = "u2";
    await hooks.refreshVercelListener();
    expect(fake.state.channels).toEqual(["vercel-events-u1", "vercel-events-u2"]);
    expect(fake.state.removed).toBe(1);
  });

  it("logs a refresh that can't read the hooks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.state.error = { message: "offline" };
    await hooks.refreshVercelListener();
    expect(warn).toHaveBeenCalledWith("Vercel webhooks: offline");
    warn.mockRestore();
  });
});

describe("startVercelListener", () => {
  it("follows sign-in and sign-out once started", async () => {
    vi.useFakeTimers();
    fake.state.rows = [{ id: "h1", team_id: "team_abc", vercel_hook_id: "hook_1" }];
    hooks.startVercelListener();
    hooks.startVercelListener();
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toHaveLength(1);
    fake.state.uid = "u2";
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.channels).toHaveLength(2);
    expect(fake.state.removed).toBe(1);
    fake.state.uid = null;
    fake.state.onAuth?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.state.removed).toBe(2);
  });

  it("starts quietly with accounts off", () => {
    fake.state.throwClient = true;
    expect(() => hooks.startVercelListener()).not.toThrow();
  });
});
