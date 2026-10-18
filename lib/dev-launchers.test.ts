import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// The real devserver module is replaced with a fake one whose runs Map the tests drive.
const runMap = new Map<string, { command: string; cwd: string; url?: string; title?: string; startedAt: number; restarts?: number; exited: boolean; failed: boolean; child: { kill: ReturnType<typeof vi.fn>; pid?: number } }>();
const devStatus = vi.fn();
const reachable = vi.fn();
const restartDev = vi.fn();
const startDev = vi.fn();

vi.mock("./devserver", () => ({
  runs: runMap,
  devStatus,
  reachable,
  restartDev,
  startDev,
}));

const listCards = vi.fn();
vi.mock("./store", () => ({ listCards }));

// detectDevCommands is replaced with a fake so the tests don't need real files.
const detectDevCommands = vi.fn();
vi.mock("./dev-commands", () => ({ detectDevCommands }));

const l = await import("./dev-launchers");

const cards: Card[] = [];
const folders: string[] = [];

const makeFolder = () => {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), "weft-launchers-"));
  folders.push(f);
  return f;
};
const makeCard = (over: Partial<Card> = {}): Card => ({ id: "c1", title: "T", prompt: "p", cwd: "/p", backend: "claude", permissionMode: "default", column: "todo", ...over } as Card);

beforeEach(() => {
  runMap.clear();
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  folders.length = 0;
  cards.length = 0;
  devStatus.mockReset();
  reachable.mockReset().mockResolvedValue(false);
  restartDev.mockReset().mockResolvedValue(undefined);
  startDev.mockReset().mockImplementation((id: string, command: string, cwd: string, title?: string, url?: string) => {
    runMap.set(id, { command, cwd, url, title, startedAt: Date.now(), restarts: 0, exited: false, failed: false, child: { kill: vi.fn() } });
    return Promise.resolve();
  });
  detectDevCommands.mockReset();
  listCards.mockReset().mockImplementation(() => cards);
});
afterEach(() => {
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  folders.length = 0;
  cards.length = 0;
});

describe("folderKey", () => {
  it("prefixes the cwd with 'folder:'", () => {
    expect(l.folderKey("/proj")).toBe("folder:/proj");
  });
});

describe("workingFolders", () => {
  it("leaves out archived cards and the board's own folder", () => {
    const self = makeFolder();
    const other = makeFolder();
    cards.push(makeCard({ cwd: self }));
    cards.push(makeCard({ id: "a", cwd: other }));
    cards.push(makeCard({ id: "b", cwd: other, archived: true }));
    expect(l.workingFolders(cards, self)).toEqual([path.resolve(other)]);
  });

  it("dedupes when several cards share a folder", () => {
    const a = makeFolder();
    cards.push(makeCard({ id: "x", cwd: a }));
    cards.push(makeCard({ id: "y", cwd: a }));
    expect(l.workingFolders(cards, "/elsewhere")).toEqual([path.resolve(a)]);
  });

  it("leaves out cards without a cwd", () => {
    cards.push(makeCard({ cwd: "" }));
    expect(l.workingFolders(cards, "/self")).toEqual([]);
  });
});

describe("runFor", () => {
  it("prefers a live run over one that has ended", () => {
    const cwd = makeFolder();
    const cwd2 = path.resolve(cwd);
    const ended = { command: "npm run dev", cwd: cwd2, url: "http://x", startedAt: 0, restarts: 0, exited: true, failed: false, child: { kill: vi.fn() } };
    const live = { command: "npm run dev", cwd: cwd2, url: "http://x", startedAt: 1, restarts: 0, exited: false, failed: false, child: { kill: vi.fn() } };
    runMap.set("folder:/old", ended);
    runMap.set("folder:/new", live);
    const found = l.runFor(cwd2, "npm run dev");
    expect(found?.key).toBe("folder:/new");
  });

  it("falls back to the first ended run when nothing is live", () => {
    const cwd = makeFolder();
    const cwd2 = path.resolve(cwd);
    const ended = { command: "npm run dev", cwd: cwd2, startedAt: 0, restarts: 0, exited: true, failed: false, child: { kill: vi.fn() } };
    runMap.set("ended", ended);
    const found = l.runFor(cwd2, "npm run dev");
    expect(found?.key).toBe("ended");
  });

  it("skips runs in another folder or with another command, and returns undefined when none match", () => {
    const cwd = makeFolder();
    const cwd2 = path.resolve(cwd);
    runMap.set("folder:/other", { command: "npm run dev", cwd: "/other", startedAt: 0, restarts: 0, exited: true, failed: false, child: { kill: vi.fn() } });
    runMap.set("folder:/x", { command: "pnpm dev", cwd: cwd2, startedAt: 0, restarts: 0, exited: true, failed: false, child: { kill: vi.fn() } });
    expect(l.runFor(cwd2, "npm run dev")).toBeUndefined();
  });
});

describe("listLaunchers", () => {
  it("drops folders with no commands and resolves each command's run", async () => {
    const a = makeFolder();
    const b = makeFolder();
    cards.push(makeCard({ id: "a", cwd: a }));
    cards.push(makeCard({ id: "b", cwd: b }));
    detectDevCommands.mockImplementation((cwd: string) => (path.resolve(cwd) === path.resolve(a) ? [{ command: "npm run dev", label: "dev", url: "http://x" }] : []));
    const a2 = path.resolve(a);
    runMap.set(`folder:${a2}`, { command: "npm run dev", cwd: a2, url: "http://x", startedAt: 100, restarts: 0, exited: false, failed: false, child: { kill: vi.fn() } });
    devStatus.mockResolvedValue({ state: "running", reachable: true, log: "" });
    const launchers = await l.listLaunchers(cards);
    expect(launchers).toHaveLength(1);
    expect(launchers[0]?.cwd).toBe(a2);
    expect(launchers[0]?.commands[0]?.run).toEqual({ id: `dev:folder:${a2}`, state: "running", startedAt: 100, restarts: 0 });
  });

  it("marks a command as answering when something else answers on its url", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev", url: "http://x" }]);
    reachable.mockResolvedValue(true);
    const out = await l.listLaunchers(cards);
    expect(out[0]?.commands[0]?.answering).toBe(true);
  });

  it("leaves a url-less command alone when nothing's running it", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev" }]);
    const out = await l.listLaunchers(cards);
    expect(out[0]?.commands[0]?.run).toBeUndefined();
  });

  it("reads a starting run with no url as running", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev" }]);
    const cwd2 = path.resolve(cwd);
    runMap.set(`folder:${cwd2}`, { command: "next dev", cwd: cwd2, startedAt: 5, restarts: 0, exited: false, failed: false, child: { kill: vi.fn() } });
    devStatus.mockResolvedValue({ state: "starting", reachable: false, log: "" });
    const out = await l.listLaunchers(cards);
    expect(out[0]?.commands[0]?.run?.state).toBe("running");
  });

  it("preserves restarts on the run it reports", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev", url: "http://x" }]);
    const cwd2 = path.resolve(cwd);
    runMap.set(`folder:${cwd2}`, { command: "next dev", cwd: cwd2, url: "http://x", startedAt: 5, restarts: 2, exited: false, failed: false, child: { kill: vi.fn() } });
    devStatus.mockResolvedValue({ state: "running", reachable: true, log: "" });
    const out = await l.listLaunchers(cards);
    expect(out[0]?.commands[0]?.run?.restarts).toBe(2);
  });

  it("treats a missing restarts count as 0", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev", url: "http://x" }]);
    const cwd2 = path.resolve(cwd);
    runMap.set(`folder:${cwd2}`, { command: "next dev", cwd: cwd2, url: "http://x", startedAt: 5, exited: false, failed: false, child: { kill: vi.fn() } });
    devStatus.mockResolvedValue({ state: "running", reachable: true, log: "" });
    const out = await l.listLaunchers(cards);
    expect(out[0]?.commands[0]?.run?.restarts).toBe(0);
  });

  it("names the card behind a thread's own run, but not behind a folder run", async () => {
    const cwd = path.resolve(makeFolder());
    cards.push(makeCard({ id: "card-9", title: "Fix login", cwd }), makeCard({ id: "card-8", title: "", cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev", url: "http://x" }, { command: "vite", label: "web" }, { command: "astro dev", label: "site" }]);
    runMap.set("card-9", { command: "next dev", cwd, url: "http://x", startedAt: 5, exited: false, failed: false, child: { kill: vi.fn() } });
    runMap.set("card-8", { command: "vite", cwd, startedAt: 5, exited: false, failed: false, child: { kill: vi.fn() } });
    runMap.set("gone", { command: "astro dev", cwd, startedAt: 5, exited: false, failed: false, child: { kill: vi.fn() } });
    devStatus.mockResolvedValue({ state: "running", reachable: true, log: "" });
    const [next, vite, astro] = (await l.listLaunchers(cards))[0]?.commands ?? [];
    expect(next?.run).toMatchObject({ cardId: "card-9", title: "Fix login" });
    expect(vite?.run?.cardId).toBe("card-8");
    expect(vite?.run?.title).toBeUndefined();
    expect(astro?.run?.cardId).toBeUndefined();
  });

  it("lists Weft's own folder last, marked self and never probed", async () => {
    const other = makeFolder();
    cards.push(makeCard({ id: "a", cwd: other }), makeCard({ id: "w", cwd: process.cwd() }));
    detectDevCommands.mockReturnValue([{ command: "pnpm dev", label: "dev", url: "http://x" }]);
    const out = await l.listLaunchers(cards);
    expect(out.map((x) => x.cwd)).toEqual([path.resolve(other), path.resolve(process.cwd())]);
    expect(out[1]).toMatchObject({ cwd: path.resolve(process.cwd()), commands: [{ command: "pnpm dev", label: "dev", url: "http://x" }], self: true });
    expect(reachable).toHaveBeenCalledTimes(1);
  });

  it("gives Weft's own folder the port this server listens on, else its dev script's url", async () => {
    cards.push(makeCard({ cwd: process.cwd() }));
    detectDevCommands.mockReturnValue([{ command: "pnpm dev", label: "dev", url: "http://127.0.0.1:1024" }]);
    vi.stubEnv("PORT", "4555");
    expect((await l.listLaunchers(cards))[0]?.url).toBe("http://127.0.0.1:4555");
    vi.stubEnv("PORT", "");
    expect((await l.listLaunchers(cards))[0]?.url).toBe("http://127.0.0.1:1024");
    detectDevCommands.mockReturnValue([{ command: "pnpm dev", label: "dev" }]);
    expect((await l.listLaunchers(cards))[0]?.url).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it("leaves Weft's own folder out when it has no dev command", async () => {
    cards.push(makeCard({ cwd: process.cwd() }));
    detectDevCommands.mockReturnValue([]);
    expect(await l.listLaunchers(cards)).toEqual([]);
  });

  it("uses listCards() when no cards are passed", async () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "next dev", label: "dev" }]);
    const out = await l.listLaunchers();
    expect(out[0]?.cwd).toBe(path.resolve(cwd));
  });
});

describe("launch", () => {
  const setup = () => {
    const cwd = makeFolder();
    cards.push(makeCard({ cwd }));
    detectDevCommands.mockReturnValue([{ command: "npm run dev", label: "dev", url: "http://localhost:3000" }]);
    return cwd;
  };

  it("refuses to launch in a folder that isn't on the board", async () => {
    await expect(l.launch("/elsewhere", "npm run dev", cards)).rejects.toBeInstanceOf(l.LaunchRefused);
  });

  it("refuses to launch a command the folder doesn't have", async () => {
    const cwd = setup();
    await expect(l.launch(cwd, "pnpm dev", cards)).rejects.toBeInstanceOf(l.LaunchRefused);
  });

  it("restarts a live run with the same key and reports 'restarted'", async () => {
    const cwd = setup();
    const key = l.folderKey(path.resolve(cwd));
    runMap.set(key, { command: "npm run dev", cwd: path.resolve(cwd), url: "http://x", startedAt: 0, restarts: 0, exited: false, failed: false, child: { kill: vi.fn() } });
    const out = await l.launch(cwd, "npm run dev", cards);
    expect(out).toEqual({ result: "restarted", id: `dev:${key}` });
    expect(restartDev).toHaveBeenCalledWith(key);
  });

  it("starts a fresh run for a folder with no current run", async () => {
    const cwd = setup();
    const out = await l.launch(cwd, "npm run dev", cards);
    const key = l.folderKey(path.resolve(cwd));
    expect(out).toEqual({ result: "started", id: `dev:${key}` });
    expect(startDev).toHaveBeenCalledWith(key, "npm run dev", path.resolve(cwd), undefined, "http://localhost:3000");
  });

  it("reuses an ended run's key so the Services list keeps showing it", async () => {
    const cwd = setup();
    const cwd2 = path.resolve(cwd);
    const ended = { command: "npm run dev", cwd: cwd2, url: "http://x", startedAt: 0, restarts: 0, exited: true, failed: false, child: { kill: vi.fn() } };
    runMap.set(l.folderKey(cwd2), ended);
    const out = await l.launch(cwd, "npm run dev", cards);
    expect(out).toEqual({ result: "started", id: `dev:folder:${cwd2}` });
    expect(startDev).toHaveBeenCalledWith(l.folderKey(cwd2), "npm run dev", cwd2, undefined, "http://localhost:3000");
  });
});
