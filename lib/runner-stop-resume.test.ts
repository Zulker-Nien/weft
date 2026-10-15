// @vitest-environment node
// Card 6d7ae34a: a puku thread stopped before its CLI's init, then "continue" began a new conversation.
// A new conversation's id is Weft's own (lib/runner-session.ts open, kept by lib/runner.ts sendMessage), against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, init, makeCard, nth, resetHarness } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg: string) {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("a Stop before the CLI's init", () => {
  it.each(["puku", "claude"] as const)("the next %s message resumes the stopped conversation", async (backend) => {
    addCard({ id: "c1", backend });
    const first = await send("c1", "make a content schedule");
    const id = first.options.sessionId as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.options.resume).toBeUndefined();
    // No init yet, and the card already has the conversation's id.
    expect(card("c1").sessionId).toBe(id);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    first.interrupt.mockImplementation(() => new Promise(() => {}));
    const stopping = runner.stop("c1");
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    vi.useRealTimers();
    await flush();
    expect(first.aborted).toBe(true);
    const next = await send("c1", "continue");
    expect(next).not.toBe(first);
    expect(next.options).toMatchObject({ resume: id, sessionId: undefined });
  });

  it("keeps the id the CLI's init names", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "hello");
    q.emit(init("from-init"));
    await flush();
    expect(card("c1").sessionId).toBe("from-init");
  });

  it("leaves a resumed card's id alone", async () => {
    addCard({ id: "c1", sessionId: "old" });
    const q = await send("c1", "hello");
    expect(q.options).toMatchObject({ resume: "old", sessionId: undefined });
    expect(card("c1").sessionId).toBe("old");
  });
});
