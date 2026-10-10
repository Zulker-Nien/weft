import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

// The route handlers are plain functions, so these call them directly with a Request. Everything that
// starts a CLI, spawns a process, or reads ~/.weft is mocked; the store is an in-memory Map.

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, unknown[]>(), seq: 0 }));

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  listCards: vi.fn(() => [...db.cards.values()]),
  getCard: vi.fn((id: string) => db.cards.get(id)),
  createCard: vi.fn((input: Omit<Card, "id" | "column" | "createdAt" | "updatedAt">) => {
    const card = { ...input, id: `card-${++db.seq}`, column: "backlog", createdAt: 1, updatedAt: 1 } as Card;
    db.cards.set(card.id, card);
    return card;
  }),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = db.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  }),
  deleteCard: vi.fn((id: string) => db.cards.delete(id)),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
}));

vi.mock("@/lib/runner", () => ({
  sendMessage: vi.fn(),
  sendUserMessage: vi.fn(),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  isBusy: vi.fn(() => false),
  answerPermission: vi.fn(),
  warmUp: vi.fn(),
  ensureSpare: vi.fn(),
  retryAfterLogin: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  listProjects: vi.fn(() => []),
  touchProject: vi.fn(),
  removeProject: vi.fn(),
  dismissSession: vi.fn(),
  setThreadPrompt: vi.fn(),
  setKeepAliveMinutes: vi.fn(),
  setAutomations: vi.fn(),
  settingsView: vi.fn(() => ({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] })),
}));

vi.mock("@/lib/automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/automations")>()),
  firstMessage: vi.fn((card: Card) => `first:${card.prompt}`),
  messagesForMove: vi.fn((_card: Card, column: string) => [`/move-${column}`]),
}));

vi.mock("@/lib/copilot", () => ({
  prewarm: vi.fn(),
  sendToCopilot: vi.fn(),
  ensureCopilot: vi.fn(() => ({ id: "copilot", role: "copilot" })),
  resetCopilot: vi.fn(async () => ({ id: "copilot", role: "copilot", title: "fresh" })),
}));

vi.mock("@/lib/repos", () => ({
  projectRoot: vi.fn((cwd: string) => cwd),
  cloneRepo: vi.fn(async (name: string) => `/dev/${name.split("/")[1]}`),
  localRepos: vi.fn(() => []),
}));

vi.mock("@/lib/import", () => ({
  releaseSession: vi.fn(() => 1),
  loadTranscript: vi.fn(async () => {}),
  syncSessions: vi.fn(async () => ({ added: 2 })),
}));

vi.mock("@/lib/devserver", () => ({
  devStatus: vi.fn(async () => ({ state: "running" })),
  reachable: vi.fn(async () => false),
  startDev: vi.fn(),
  stopDev: vi.fn(),
}));

vi.mock("@/lib/login", () => ({
  authStatus: vi.fn(async () => ({ loggedIn: true })),
  loginRuns: vi.fn(() => []),
  startLogin: vi.fn((backend: string) => ({ backend, state: "running" })),
  openLoginInTerminal: vi.fn((backend: string) => ({ backend, state: "terminal" })),
  sendLoginInput: vi.fn(),
  cancelLogin: vi.fn(),
}));

const runner = await import("@/lib/runner");
const settings = await import("@/lib/settings");
const store = await import("@/lib/store");
const copilot = await import("@/lib/copilot");
const importLib = await import("@/lib/import");
const dev = await import("@/lib/devserver");
const login = await import("@/lib/login");
const repos = await import("@/lib/repos");

const cardsRoute = await import("./cards/route");
const cardRoute = await import("./cards/[id]/route");
const messagesRoute = await import("./cards/[id]/messages/route");
const permissionRoute = await import("./cards/[id]/permission/route");
const stopRoute = await import("./cards/[id]/stop/route");
const releaseRoute = await import("./cards/[id]/release/route");
const threadRoute = await import("./cards/[id]/thread/route");
const devRoute = await import("./cards/[id]/dev/route");
const copilotRoute = await import("./copilot/route");
const copilotResetRoute = await import("./copilot/reset/route");
const warmRoute = await import("./warm/route");
const settingsRoute = await import("./settings/route");
const projectsRoute = await import("./projects/route");
const newProjectRoute = await import("./projects/new/route");
const importRoute = await import("./import/route");
const loginRoute = await import("./login/route");
const cloneRoute = await import("./repos/clone/route");

const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function addCard(patch: Partial<Card> = {}): Card {
  const card = {
    id: `card-${++db.seq}`,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "bypassPermissions",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  } as Card;
  db.cards.set(card.id, card);
  return card;
}

// A real folder for routes that check one exists (resolveFolder isn't mocked).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-api-"));

beforeEach(() => {
  db.cards.clear();
  db.threads.clear();
  vi.clearAllMocks();
});

// Every write route: a foreign Host and a missing x-threadboard header both get 403 and touch nothing.
const writes: [string, (r: Request) => Promise<Response>][] = [
  ["POST /cards", (r) => cardsRoute.POST(r)],
  ["PATCH /cards/:id", (r) => cardRoute.PATCH(r, ctx("x"))],
  ["DELETE /cards/:id", (r) => cardRoute.DELETE(r, ctx("x"))],
  ["POST /cards/:id/messages", (r) => messagesRoute.POST(r, ctx("x"))],
  ["POST /cards/:id/permission", (r) => permissionRoute.POST(r, ctx("x"))],
  ["POST /cards/:id/stop", (r) => stopRoute.POST(r, ctx("x"))],
  ["POST /cards/:id/release", (r) => releaseRoute.POST(r, ctx("x"))],
  ["POST /cards/:id/dev", (r) => devRoute.POST(r, ctx("x"))],
  ["POST /copilot/reset", (r) => copilotResetRoute.POST(r)],
  ["POST /warm", (r) => warmRoute.POST(r)],
  ["PATCH /settings", (r) => settingsRoute.PATCH(r)],
  ["POST /projects", (r) => projectsRoute.POST(r)],
  ["DELETE /projects", (r) => projectsRoute.DELETE(r)],
  ["POST /projects/new", (r) => newProjectRoute.POST(r)],
  ["POST /import", (r) => importRoute.POST(r)],
  ["POST /login", (r) => loginRoute.POST(r)],
  ["POST /repos/clone", (r) => cloneRoute.POST(r)],
];

describe("guard on write routes", () => {
  it.each(writes)("%s rejects a foreign host", async (_name, call) => {
    const res = await call(req("/x", { method: "POST", body: {}, headers: { host: "evil.com", "x-threadboard": "1" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden host" });
  });

  it.each(writes)("%s rejects a write without x-threadboard", async (_name, call) => {
    const res = await call(req("/x", { method: "POST", body: {}, headers: { host: "localhost:3457" } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Missing x-threadboard header" });
  });

  it("calls nothing when denied", async () => {
    for (const [, call] of writes) await call(req("/x", { method: "POST", body: {}, headers: { host: "evil.com" } }));
    for (const fn of Object.values(runner)) expect(fn).not.toHaveBeenCalled();
    expect(store.createCard).not.toHaveBeenCalled();
    expect(store.deleteCard).not.toHaveBeenCalled();
  });
});

describe("guard on read routes", () => {
  const reads: [string, (r: Request) => Promise<Response>][] = [
    ["GET /cards", (r) => cardsRoute.GET(r)],
    ["GET /cards/:id/thread", (r) => threadRoute.GET(r, ctx("x"))],
    ["GET /cards/:id/dev", (r) => devRoute.GET(r, ctx("x"))],
    ["GET /copilot", (r) => copilotRoute.GET(r)],
    ["GET /settings", (r) => settingsRoute.GET(r)],
    ["GET /projects", (r) => projectsRoute.GET(r)],
    ["GET /login", (r) => loginRoute.GET(r)],
  ];

  it.each(reads)("%s rejects a foreign host", async (_name, call) => {
    expect((await call(req("/x", { headers: { host: "attacker.test" } }))).status).toBe(403);
  });

  it.each(reads)("%s needs no x-threadboard header", async (_name, call) => {
    addCard({ id: "x" });
    expect((await call(req("/x", { headers: { host: "localhost:3457" } }))).status).toBe(200);
  });
});

describe("GET /cards", () => {
  it("lists board cards without the copilot, with home and worktree roots", async () => {
    const card = addCard({ cwd: "/repo-wt" });
    addCard({ id: "copilot", role: "copilot" });
    vi.mocked(repos.projectRoot).mockImplementation((cwd) => (cwd === "/repo-wt" ? "/repo" : cwd));
    const res = await cardsRoute.GET(req("/cards"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cards.map((c: Card) => c.id)).toEqual([card.id]);
    expect(json.home).toBe(os.homedir());
    expect(json.roots).toEqual({ "/repo-wt": "/repo" });
    expect(copilot.prewarm).toHaveBeenCalled();
  });
});

describe("POST /cards", () => {
  it("creates a card with defaults and doesn't start it unless asked", async () => {
    const res = await cardsRoute.POST(req("/cards", { method: "POST", body: { prompt: "  fix the bug  ", cwd: tmp } }));
    expect(res.status).toBe(200);
    const { card } = await res.json();
    expect(card).toMatchObject({ prompt: "fix the bug", cwd: tmp, backend: "claude", permissionMode: "bypassPermissions", column: "backlog" });
    expect(card.title).toBeTruthy();
    expect(settings.touchProject).toHaveBeenCalledWith(tmp);
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("starts the thread with its first message when start is set", async () => {
    const res = await cardsRoute.POST(req("/cards", { method: "POST", body: { prompt: "go", title: "Go", cwd: tmp, start: true } }));
    const { card } = await res.json();
    expect(card.title).toBe("Go");
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "first:go");
  });

  it("keeps valid model, effort and mode, and drops bad ones", async () => {
    await cardsRoute.POST(
      req("/cards", { method: "POST", body: { prompt: "p", cwd: tmp, model: "opus[1m]", effort: "high", permissionMode: "acceptEdits" } }),
    );
    expect(store.createCard).toHaveBeenLastCalledWith(expect.objectContaining({ model: "opus[1m]", effort: "high", permissionMode: "acceptEdits" }));

    await cardsRoute.POST(
      req("/cards", { method: "POST", body: { prompt: "p", cwd: tmp, model: "bad model; rm", effort: "huge", permissionMode: "yolo", backend: "nope" } }),
    );
    expect(store.createCard).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: undefined, effort: undefined, permissionMode: "bypassPermissions", backend: "claude" }),
    );
  });

  it("ignores model and effort for puku", async () => {
    await cardsRoute.POST(req("/cards", { method: "POST", body: { prompt: "p", cwd: tmp, backend: "puku", model: "opus", effort: "high" } }));
    expect(store.createCard).toHaveBeenLastCalledWith(expect.objectContaining({ backend: "puku", model: undefined, effort: undefined }));
  });

  it("rejects a missing prompt, a missing folder and bad JSON with 400", async () => {
    for (const body of [{ cwd: tmp }, { prompt: "   ", cwd: tmp }, { prompt: "p", cwd: path.join(tmp, "nope") }, "{not json"]) {
      const res = await cardsRoute.POST(req("/cards", { method: "POST", body }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(store.createCard).not.toHaveBeenCalled();
  });
});

describe("PATCH /cards/:id", () => {
  const patch = (id: string, body: unknown) => cardRoute.PATCH(req(`/cards/${id}`, { method: "PATCH", body }), ctx(id));

  it("404s an unknown card", async () => {
    const res = await patch("ghost", { title: "x" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No such card." });
  });

  it("400s bad JSON", async () => {
    const card = addCard();
    expect((await patch(card.id, "{")).status).toBe(400);
  });

  it("renames, keeping the old title when the new one is blank", async () => {
    const card = addCard({ title: "Old" });
    const res = await patch(card.id, { title: "  New  " });
    expect((await res.json()).card.title).toBe("New");
    await patch(card.id, { title: "   " });
    expect(db.cards.get(card.id)!.title).toBe("New");
  });

  it("archives, but not the copilot", async () => {
    const card = addCard();
    await patch(card.id, { archived: true });
    expect(db.cards.get(card.id)!.archived).toBe(true);
    const cop = addCard({ role: "copilot" });
    expect((await patch(cop.id, { archived: true })).status).toBe(400);
  });

  it("re-points the folder unless the thread is busy", async () => {
    const card = addCard({ error: "gone" });
    await patch(card.id, { cwd: tmp });
    expect(db.cards.get(card.id)).toMatchObject({ cwd: tmp, error: undefined });

    vi.mocked(runner.isBusy).mockReturnValueOnce(true);
    const res = await patch(card.id, { cwd: os.tmpdir() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Stop the thread/);
  });

  it("moving to Running from Backlog sends the first message", async () => {
    const card = addCard({ prompt: "build" });
    expect((await patch(card.id, { column: "running" })).status).toBe(200);
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "first:build");
  });

  it("won't run a card again from another column", async () => {
    const card = addCard({ column: "review" });
    expect((await patch(card.id, { column: "running" })).status).toBe(400);
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("moving to Review queues that column's automations and unarchives", async () => {
    const card = addCard({ archived: true });
    const res = await patch(card.id, { column: "review" });
    expect((await res.json()).card).toMatchObject({ column: "review", archived: false });
    expect(runner.queueMessages).toHaveBeenCalledWith(card.id, ["/move-review"]);
    expect(runner.archiveWhenIdle).not.toHaveBeenCalled();
  });

  it("moving to Done queues automations and archives when idle", async () => {
    const card = addCard({ column: "review" });
    await patch(card.id, { column: "done" });
    expect(db.cards.get(card.id)!.column).toBe("done");
    expect(runner.queueMessages).toHaveBeenCalledWith(card.id, ["/move-done"]);
    expect(runner.archiveWhenIdle).toHaveBeenCalledWith(card.id);
  });

  it("refuses unknown columns, Needs you, busy threads and the copilot", async () => {
    const card = addCard();
    expect((await patch(card.id, { column: "limbo" })).status).toBe(400);
    expect((await patch(card.id, { column: "needs_you" })).status).toBe(400);
    vi.mocked(runner.isBusy).mockReturnValueOnce(true);
    expect((await patch(card.id, { column: "done" })).status).toBe(400);
    const cop = addCard({ role: "copilot" });
    expect((await patch(cop.id, { column: "done" })).status).toBe(400);
    expect(db.cards.get(card.id)!.column).toBe("backlog");
    expect(runner.queueMessages).not.toHaveBeenCalled();
  });

  it("does nothing for a move to the column it's already in", async () => {
    const card = addCard({ column: "review" });
    expect((await patch(card.id, { column: "review" })).status).toBe(200);
    expect(runner.queueMessages).not.toHaveBeenCalled();
  });
});

describe("DELETE /cards/:id", () => {
  const del = (id: string) => cardRoute.DELETE(req(`/cards/${id}`, { method: "DELETE" }), ctx(id));

  it("ends the session and deletes the card", async () => {
    const card = addCard();
    const res = await del(card.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(runner.endSession).toHaveBeenCalledWith(card.id);
    expect(store.deleteCard).toHaveBeenCalledWith(card.id);
    expect(settings.dismissSession).not.toHaveBeenCalled();
  });

  it("dismisses a picked-up Claude Code session so the sync won't bring it back", async () => {
    const card = addCard({ source: "claude-code", sessionId: "s-1" });
    await del(card.id);
    expect(settings.dismissSession).toHaveBeenCalledWith("s-1");
  });

  it("refuses to delete the copilot", async () => {
    const cop = addCard({ role: "copilot" });
    expect((await del(cop.id)).status).toBe(400);
    expect(store.deleteCard).not.toHaveBeenCalled();
  });
});

describe("POST /cards/:id/messages", () => {
  it("sends the trimmed text and returns the card", async () => {
    const card = addCard();
    const res = await messagesRoute.POST(req(`/cards/${card.id}/messages`, { method: "POST", body: { text: "  hi  " } }), ctx(card.id));
    expect(res.status).toBe(200);
    expect((await res.json()).card.id).toBe(card.id);
    expect(runner.sendUserMessage).toHaveBeenCalledWith(card.id, "hi");
  });

  it("400s an empty message or bad JSON", async () => {
    for (const body of [{ text: "  " }, {}, "nope"]) {
      expect((await messagesRoute.POST(req("/cards/a/messages", { method: "POST", body }), ctx("a"))).status).toBe(400);
    }
    expect(runner.sendUserMessage).not.toHaveBeenCalled();
  });

  it("passes the runner's error through as 400", async () => {
    vi.mocked(runner.sendUserMessage).mockImplementationOnce(() => {
      throw new Error("No card ghost");
    });
    const res = await messagesRoute.POST(req("/cards/ghost/messages", { method: "POST", body: { text: "hi" } }), ctx("ghost"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No card ghost" });
  });
});

describe("POST /cards/:id/permission", () => {
  const answer = (id: string, body: unknown) => permissionRoute.POST(req(`/cards/${id}/permission`, { method: "POST", body }), ctx(id));

  it("answers with allow, answers and pendingId", async () => {
    const res = await answer("c1", { allow: true, answers: { q: "a" }, pendingId: "p1" });
    expect(await res.json()).toEqual({ ok: true });
    expect(runner.answerPermission).toHaveBeenCalledWith("c1", true, { q: "a" }, "p1");
  });

  it("treats anything but allow: true as deny and drops malformed fields", async () => {
    await answer("c1", { allow: "yes", answers: "nope", pendingId: 3 });
    expect(runner.answerPermission).toHaveBeenCalledWith("c1", false, undefined, undefined);
  });

  it("409s when there's nothing to answer, or bad JSON", async () => {
    vi.mocked(runner.answerPermission).mockImplementationOnce(() => {
      throw new Error("Nothing is waiting for an answer.");
    });
    const res = await answer("c1", { allow: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Nothing is waiting/);
    expect((await answer("c1", "{")).status).toBe(409);
  });
});

describe("POST /cards/:id/stop", () => {
  it("stops the thread", async () => {
    const res = await stopRoute.POST(req("/cards/c9/stop", { method: "POST" }), ctx("c9"));
    expect(await res.json()).toEqual({ ok: true });
    expect(runner.stop).toHaveBeenCalledWith("c9");
  });
});

describe("POST /cards/:id/release", () => {
  it("releases the session and marks the card as no longer open elsewhere", async () => {
    const card = addCard({ sessionId: "s-2", openElsewhere: true });
    const res = await releaseRoute.POST(req(`/cards/${card.id}/release`, { method: "POST" }), ctx(card.id));
    const json = await res.json();
    expect(json.stopped).toBe(1);
    expect(json.card.openElsewhere).toBe(false);
    expect(importLib.releaseSession).toHaveBeenCalledWith("s-2");
  });

  it("404s a card without a session", async () => {
    const card = addCard();
    expect((await releaseRoute.POST(req("/x", { method: "POST" }), ctx(card.id))).status).toBe(404);
    expect((await releaseRoute.POST(req("/x", { method: "POST" }), ctx("ghost"))).status).toBe(404);
  });
});

describe("GET /cards/:id/thread", () => {
  it("loads the transcript and returns the items", async () => {
    const card = addCard();
    db.threads.set(card.id, [{ kind: "user", text: "hi" }]);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread`), ctx(card.id));
    expect(await res.json()).toEqual({ items: [{ kind: "user", text: "hi" }] });
    expect(importLib.loadTranscript).toHaveBeenCalledWith(card);
  });

  it("still answers when the transcript can't be read", async () => {
    const card = addCard();
    vi.mocked(importLib.loadTranscript).mockRejectedValueOnce(new Error("eacces"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await threadRoute.GET(req("/x"), ctx(card.id))).status).toBe(200);
    spy.mockRestore();
  });

  it("404s an unknown card", async () => {
    expect((await threadRoute.GET(req("/x"), ctx("ghost"))).status).toBe(404);
  });
});

describe("/cards/:id/dev", () => {
  const post = (id: string, body?: unknown) => devRoute.POST(req(`/cards/${id}/dev`, { method: "POST", body }), ctx(id));
  const review = { dev: "npm run dev", url: "http://localhost:3000", steps: [] } as unknown as Card["review"];

  it("GET returns the status for the review url", async () => {
    const card = addCard({ review });
    const res = await devRoute.GET(req("/x"), ctx(card.id));
    expect(await res.json()).toEqual({ status: { state: "running" } });
    expect(dev.devStatus).toHaveBeenCalledWith(card.id, "http://localhost:3000");
  });

  it("start runs the dev command in the card's folder", async () => {
    const card = addCard({ review, cwd: "/proj" });
    expect((await post(card.id, { action: "start" })).status).toBe(200);
    expect(dev.startDev).toHaveBeenCalledWith(card.id, "npm run dev", "/proj");
  });

  it("start skips the command when the url already answers", async () => {
    const card = addCard({ review });
    vi.mocked(dev.reachable).mockResolvedValueOnce(true);
    await post(card.id, { action: "start" });
    expect(dev.startDev).not.toHaveBeenCalled();
  });

  it("restart stops then starts; stop stops", async () => {
    const card = addCard({ review });
    await post(card.id, { action: "restart" });
    expect(dev.stopDev).toHaveBeenCalledWith(card.id);
    expect(dev.startDev).toHaveBeenCalled();
    vi.clearAllMocks();
    await post(card.id, { action: "stop" });
    expect(dev.stopDev).toHaveBeenCalledWith(card.id);
    expect(dev.startDev).not.toHaveBeenCalled();
  });

  it("400s an unknown action, no body, or a tour without a dev command; 404s an unknown card", async () => {
    const card = addCard({ review });
    expect((await post(card.id, { action: "explode" })).status).toBe(400);
    expect((await post(card.id)).status).toBe(400);
    const bare = addCard();
    expect((await post(bare.id, { action: "start" })).status).toBe(400);
    expect((await post("ghost", { action: "start" })).status).toBe(404);
    expect((await devRoute.GET(req("/x"), ctx("ghost"))).status).toBe(404);
    expect(dev.startDev).not.toHaveBeenCalled();
  });
});

describe("copilot", () => {
  it("GET ensures the copilot and warms it", async () => {
    const res = await copilotRoute.GET(req("/copilot"));
    expect((await res.json()).card.id).toBe("copilot");
    expect(runner.warmUp).toHaveBeenCalledWith("copilot");
  });

  it("POST /reset returns the fresh copilot", async () => {
    const res = await copilotResetRoute.POST(req("/copilot/reset", { method: "POST" }));
    expect((await res.json()).card.title).toBe("fresh");
    expect(copilot.resetCopilot).toHaveBeenCalled();
  });
});

describe("POST /warm", () => {
  const warm = (body: unknown) => warmRoute.POST(req("/warm", { method: "POST", body }));

  it("warms a card's own CLI", async () => {
    expect(await (await warm({ cardId: "c1" })).json()).toEqual({ ok: true });
    expect(runner.warmUp).toHaveBeenCalledWith("c1");
    expect(runner.ensureSpare).not.toHaveBeenCalled();
  });

  it("starts a spare in a folder, claude unless puku is asked for", async () => {
    await warm({ cwd: tmp });
    expect(runner.ensureSpare).toHaveBeenLastCalledWith(tmp, "claude");
    await warm({ cwd: tmp, backend: "puku" });
    expect(runner.ensureSpare).toHaveBeenLastCalledWith(tmp, "puku");
  });

  it("400s a folder that doesn't exist, or bad JSON", async () => {
    expect((await warm({ cwd: path.join(tmp, "missing") })).status).toBe(400);
    expect((await warm("x")).status).toBe(400);
    expect(runner.ensureSpare).not.toHaveBeenCalled();
  });
});

describe("/settings", () => {
  const patch = (body: unknown) => settingsRoute.PATCH(req("/settings", { method: "PATCH", body }));

  it("GET returns the settings view", async () => {
    expect(await (await settingsRoute.GET(req("/settings"))).json()).toEqual({ threadPrompt: "tp", keepAliveMinutes: 5, automations: [] });
  });

  it("PATCH saves the prompt, keep-alive and automations", async () => {
    const res = await patch({
      threadPrompt: "be brief",
      keepAliveMinutes: 10,
      automations: [
        { id: "a1", on: "done", skill: "/weft:done" },
        { on: "prompt-matches", skill: "deploy", pattern: "ship it" },
      ],
    });
    expect(res.status).toBe(200);
    expect(settings.setThreadPrompt).toHaveBeenCalledWith("be brief");
    expect(settings.setKeepAliveMinutes).toHaveBeenCalledWith(10);
    const [rules] = vi.mocked(settings.setAutomations).mock.calls[0];
    expect(rules[0]).toEqual({ id: "a1", on: "done", skill: "weft:done" });
    expect(rules[1]).toMatchObject({ on: "prompt-matches", skill: "deploy", pattern: "ship it" });
    expect(rules[1].id).toBeTruthy();
  });

  it("PATCH rejects bad values with 400 and saves nothing", async () => {
    for (const body of [
      { threadPrompt: 5 },
      { keepAliveMinutes: -1 },
      { keepAliveMinutes: "10" },
      { automations: "nope" },
      { automations: [{ on: "sometimes", skill: "x" }] },
      { automations: [{ on: "done", skill: "bad skill!" }] },
      { automations: [{ on: "prompt-matches", skill: "x" }] },
      { automations: [{ on: "prompt-matches", skill: "x", pattern: "(" }] },
      { threadPrompt: "ok", automations: [{ on: "nope" }] },
      "{",
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(settings.setThreadPrompt).not.toHaveBeenCalled();
    expect(settings.setKeepAliveMinutes).not.toHaveBeenCalled();
    expect(settings.setAutomations).not.toHaveBeenCalled();
  });
});

describe("/projects", () => {
  it("POST adds an existing folder", async () => {
    const res = await projectsRoute.POST(req("/projects", { method: "POST", body: { path: tmp } }));
    expect(await res.json()).toEqual({ path: tmp, projects: [] });
    expect(settings.touchProject).toHaveBeenCalledWith(tmp);
  });

  it("POST 400s an empty or missing folder", async () => {
    expect((await projectsRoute.POST(req("/projects", { method: "POST", body: { path: " " } }))).status).toBe(400);
    expect((await projectsRoute.POST(req("/projects", { method: "POST", body: { path: path.join(tmp, "no") } }))).status).toBe(400);
    expect(settings.touchProject).not.toHaveBeenCalled();
  });

  it("DELETE removes a project", async () => {
    const res = await projectsRoute.DELETE(req("/projects", { method: "DELETE", body: { path: "/gone" } }));
    expect(res.status).toBe(200);
    expect(settings.removeProject).toHaveBeenCalledWith("/gone");
  });

  it("POST /new creates the folder, and reuses one that exists", async () => {
    const res = await newProjectRoute.POST(req("/projects/new", { method: "POST", body: { parent: tmp, name: "app-1" } }));
    const folder = path.join(tmp, "app-1");
    expect((await res.json()).path).toBe(folder);
    expect(fs.statSync(folder).isDirectory()).toBe(true);
    expect(settings.touchProject).toHaveBeenCalledWith(folder);
    expect((await newProjectRoute.POST(req("/projects/new", { method: "POST", body: { parent: tmp, name: "app-1" } }))).status).toBe(200);
  });

  it("POST /new 400s bad names, a missing parent, or a file in the way", async () => {
    fs.writeFileSync(path.join(tmp, "file.txt"), "x");
    for (const body of [
      { parent: tmp, name: "../up" },
      { parent: tmp, name: ".hidden" },
      { parent: tmp, name: "a/b" },
      { parent: "", name: "ok" },
      { parent: tmp, name: "file.txt" },
    ]) {
      expect((await newProjectRoute.POST(req("/projects/new", { method: "POST", body }))).status, JSON.stringify(body)).toBe(400);
    }
    expect(fs.existsSync(path.join(tmp, "..", "up"))).toBe(false);
  });
});

describe("POST /import", () => {
  it("returns the sync result, or 500 when it fails", async () => {
    expect(await (await importRoute.POST(req("/import", { method: "POST" }))).json()).toEqual({ added: 2 });
    vi.mocked(importLib.syncSessions).mockRejectedValueOnce(new Error("disk"));
    expect((await importRoute.POST(req("/import", { method: "POST" }))).status).toBe(500);
  });
});

describe("/login", () => {
  const post = (body: unknown) => loginRoute.POST(req("/login", { method: "POST", body }));

  it("GET returns both CLIs' status and runs", async () => {
    const json = await (await loginRoute.GET(req("/login"))).json();
    expect(json).toEqual({ status: { claude: { loggedIn: true }, puku: { loggedIn: true } }, runs: [] });
  });

  it("start begins a login that retries the CLI's cards when done", async () => {
    const res = await post({ backend: "claude", action: "start" });
    expect((await res.json()).login).toEqual({ backend: "claude", state: "running" });
    const onDone = vi.mocked(login.startLogin).mock.calls[0][1]!;
    onDone();
    expect(runner.retryAfterLogin).toHaveBeenCalledWith("claude");
  });

  it("input sends the trimmed code; cancel cancels", async () => {
    await post({ backend: "puku", action: "input", text: " abc " });
    expect(login.sendLoginInput).toHaveBeenCalledWith("puku", "abc");
    await post({ backend: "puku", action: "cancel" });
    expect(login.cancelLogin).toHaveBeenCalledWith("puku");
  });

  it("400s an unknown backend or action, or empty input", async () => {
    for (const body of [{ backend: "gpt", action: "start" }, { backend: "claude", action: "hack" }, { backend: "claude", action: "input", text: " " }, "{"]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(login.startLogin).not.toHaveBeenCalled();
    expect(login.sendLoginInput).not.toHaveBeenCalled();
  });
});

describe("POST /repos/clone", () => {
  it("clones and adds the folder to projects", async () => {
    const res = await cloneRoute.POST(req("/repos/clone", { method: "POST", body: { fullName: " aimhuge/weft " } }));
    expect((await res.json()).path).toBe("/dev/weft");
    expect(repos.cloneRepo).toHaveBeenCalledWith("aimhuge/weft");
    expect(settings.touchProject).toHaveBeenCalledWith("/dev/weft");
  });

  it("400s when the clone fails", async () => {
    vi.mocked(repos.cloneRepo).mockRejectedValueOnce(new Error("Not a repo."));
    const res = await cloneRoute.POST(req("/repos/clone", { method: "POST", body: { fullName: "x" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Not a repo." });
    expect(settings.touchProject).not.toHaveBeenCalled();
  });
});
