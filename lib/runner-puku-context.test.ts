// @vitest-environment node
// A puku thread's first message carries Weft's prompt (lib/puku-context.ts), since Puku's gateway drops the system prompt.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, init, makeCard, nth, resetHarness, success } from "./runner.harness";
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
const lastQuery = () => nth(h.queries, -1, "query");

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("a puku thread's context", () => {
  it("goes ahead of the first message only, and the thread shows just what was typed", async () => {
    addCard({ id: "c1", backend: "puku" });
    runner.sendMessage("c1", "hello");
    await flush();
    const q = lastQuery();
    const append = (q.options.systemPrompt as { append: string }).append;
    const first = nth(q.received, 0, "message");
    expect(first.startsWith("<system-reminder>")).toBe(true);
    expect(first).toContain(`Working directory: ${cwd}`);
    expect(first).toContain(append);
    expect(first.endsWith("hello")).toBe(true);
    expect(h.threads.get("c1")?.[0]).toMatchObject({ kind: "user", text: "hello" });

    q.emit(init(), success("done"));
    await flush();
    runner.sendMessage("c1", "again");
    await flush();
    expect(nth(q.received, 1, "message")).toBe("again");
  });

  it("isn't sent to Claude Code, which gets the system prompt", async () => {
    addCard({ id: "c1", backend: "claude" });
    runner.sendMessage("c1", "hello");
    await flush();
    expect(nth(lastQuery().received, 0, "message")).toBe("hello");
  });
});
