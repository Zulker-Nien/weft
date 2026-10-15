// Login wall: when the CLI hits an auth error mid-turn the runner puts the card in needs_you and
// starts the in-app login. retryAfterLogin re-runs every waiting card, and the runner drops the
// card's sessionId on a not-logged-in result so puku-cli doesn't replay the cached auth error from
// the session transcript.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, init, makeCard, nth, resetHarness, success } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));

let runner: typeof import("./runner");
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

const send = async (id: string, text = "hi") => {
  runner.sendMessage(id, text);
  await flush(1);
  return lastQuery();
};

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
  process.chdir(cwd);
});

afterEach(() => {
  process.chdir(path.dirname(cwd));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("login", () => {
  it("a not-logged-in result sends the card to needs_you, starts a login and drops sessionId", async () => {
    // Dropping sessionId is what lets the retry start fresh; otherwise puku-cli replays the
    // session's cached authentication_failed and the user stays stuck on "Not logged in".
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(init("sess-poisoned"));
    q.emit(success("Not logged in · Please run /login", { is_error: true }));
    await flush();
    expect(card("c1")).toMatchObject({ column: "needs_you", pending: null, lastLine: "Log in to Claude Code to run this thread" });
    expect(card("c1").error).toContain("Not logged in");
    expect(h.startLogin).toEqual([expect.objectContaining({ backend: "claude" })]);
    expect(card("c1").sessionId).toBeUndefined();
  });

  it("a not-logged-in error from the CLI does the same, and the login retries the last message in a fresh CLI", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "please");
    q.fail(new Error("Invalid API key · Fix external API key"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "needs_you", lastLine: "Log in to Claude Code to run this thread" });
    expect(card("c1").error).toContain("Invalid API key");

    nth(h.startLogin, 0, "login").onDone?.();
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(lastQuery().received).toEqual(["please"]);
    // Retried with echo off: the thread still has the one user item.
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
    expect(card("c1").column).toBe("running");
  });

  it("queued turns wait out a not-logged-in result and run after the login", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    lastQuery().emit(success("Not logged in · Please run /login", { is_error: true }));
    await flush();
    expect(lastQuery().received).toEqual(["/a"]);

    runner.retryAfterLogin("claude");
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(lastQuery().received).toEqual(["/a"]);
    lastQuery().emit(success("a done"));
    await flush();
    expect(lastQuery().received).toEqual(["/a", "/b"]);
  });

  it("queued turns also wait out a not-logged-in CLI error", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    lastQuery().fail(new Error("Not logged in · Please run /login"));
    await flush();

    runner.retryAfterLogin("claude");
    await flush();
    expect(h.queries).toHaveLength(2);
    lastQuery().emit(success("a done"));
    await flush();
    expect(lastQuery().received).toEqual(["/a", "/b"]);
  });

  it("any other CLI error is kept on the card, which leaves running for review", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.fail(new Error("spawn ENOENT"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", error: "spawn ENOENT", lastLine: "Stopped", warm: false });
  });

  it("clearLoginWaiters drops the cards waiting on a cancelled login so the next card starts a fresh one", async () => {
    // First card hits not-logged-in and becomes a waiter.
    addCard({ id: "c1" });
    let q = await send("c1");
    q.emit(success("Not logged in · Please run /login", { is_error: true }));
    await flush();
    expect(card("c1")).toMatchObject({ column: "needs_you" });
    expect(h.startLogin.length).toBeGreaterThan(0);

    // The user cancels. The waiters should drop.
    runner.clearLoginWaiters("claude");

    // A second card that hits the same auth error must start a fresh login,
    // not chain onto the cancelled one's callbacks.
    addCard({ id: "c2" });
    const before = h.startLogin.length;
    q = await send("c2");
    q.emit(success("Not logged in · Please run /login", { is_error: true }));
    await flush();
    expect(card("c2")).toMatchObject({ column: "needs_you" });
    expect(h.startLogin.length).toBe(before + 1);
  });
});
