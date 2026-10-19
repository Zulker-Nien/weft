// The "more edges" describe block from lib/runner.test.ts: small miscellaneous cases (cancellation
// races, empty results, fork-vs-resume on stale sessions, review-block extraction, subagent events).
// Same harness setup as lib/runner.test.ts so the cards, queries and mocks work the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, failure, flush, init, makeCard, nth, resetHarness, success, text, toolResultMsg, toolUse, type FakeQuery } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./question-preview", () => ({
  writeQuestionPreview: vi.fn(() => undefined),
}));
vi.mock("./plan-preview", () => ({
  isPlanTool: (toolName: string) => toolName === "ExitPlanMode",
  writePlanPreview: vi.fn(() => undefined),
}));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  cwd = resetHarness(h);
  init();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("more edges", () => {
  const ask = (q: FakeQuery, toolName: string, input: Record<string, unknown>) => {
    const controller = new AbortController();
    return { promise: q.options.canUseTool(toolName, input, { signal: controller.signal }), controller };
  };

  it("cancelling the request on show brings up the next one; cancelling a later one leaves the card alone", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const a = ask(q, "Bash", { command: "one" });
    const b = ask(q, "Bash", { command: "two" });
    const c = ask(q, "Bash", { command: "three" });
    c.controller.abort();
    await expect(c.promise).resolves.toMatchObject({ behavior: "deny" });
    expect(card("c1").pending?.title).toContain("one");
    a.controller.abort();
    await a.promise;
    expect(card("c1").column).toBe("needs_you");
    expect(card("c1").lastLine).toContain("two");
    expect(card("c1").pending?.title).toContain("two");
    a.controller.abort(); // a second abort of the same request is a no-op
    runner.answerPermission("c1", true);
    await expect(b.promise).resolves.toMatchObject({ behavior: "allow" });
  });

  it("a tool with nothing to summarize is asked about by its short name", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    void ask(q, "mcp__x__thing", {});
    expect(card("c1").pending?.title).toBe("x thing");
  });

  it("answering a card with no open CLI says nothing is waiting", () => {
    addCard({ id: "c1" });
    expect(() => runner.answerPermission("c1", true)).toThrow("Nothing is waiting");
  });

  it("lifts a weft-review block onto the card", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const tour = '```weft-review\n{"steps":[{"title":"A","look":"B","path":"/"}]}\n```';
    q.emit(assistant(text(`Done.\n\n${tour}`)));
    await flush();
    expect(card("c1").review?.steps[0]).toMatchObject({ title: "A" });
  });

  it("ignores subagent stream events, and counts context from usage", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    h.publish.length = 0;
    q.emit({
      type: "stream_event",
      parent_tool_use_id: "sub",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
    });
    q.emit({ ...assistant(text("hi")), message: { content: [text("hi")], usage: { input_tokens: 10, cache_read_input_tokens: 5 } } });
    q.emit(success("ok", { modelUsage: { m: { costUSD: 1, inputTokens: 1, outputTokens: 1, contextWindow: 100 } } }));
    await flush();
    expect(h.publish.some((e) => (e as { type: string }).type === "delta")).toBe(false);
    expect(card("c1").stats?.contextUsed).toBe(15);
    expect(card("c1").stats?.cache).toMatchObject({ ttl: 300, hit: 33, tokens: 15 });
  });

  it("keeps the last cache through a request with no input, and reads its life from the next write", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const usage = { input_tokens: 2, cache_read_input_tokens: 8, cache_creation: { ephemeral_1h_input_tokens: 2 } };
    q.emit({ ...assistant(text("a")), message: { content: [text("a")], usage } }, { ...assistant(text("b")), message: { content: [text("b")], usage: { output_tokens: 3 } } });
    q.emit(success("ok"));
    await flush();
    expect(card("c1").stats?.cache).toMatchObject({ ttl: 3600, hit: 80, tokens: 10 });
  });

  it("tool results skip blocks that aren't results, unknown ids and string content", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("t1", "Bash", { command: "ls" })));
    q.emit({ type: "user", parent_tool_use_id: null, message: { role: "user", content: "plain" } });
    q.emit({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "text", text: "x" }, { type: "tool_result", tool_use_id: "nope", content: "?" }] },
    });
    q.emit(toolResultMsg("t1", "files"));
    await flush();
    expect(thread("c1").filter((i) => i.kind === "tool")).toEqual([expect.objectContaining({ id: "t1", result: "files", isError: false })]);
  });

  it("an empty result reads Done", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success(""));
    await flush();
    expect(card("c1").lastLine).toBe("Done");
  });

  it("/done followed by a stop leaves the card unarchived", async () => {
    addCard({ id: "c1" });
    runner.sendUserMessage("c1", "/done");
    await flush();
    const stopping = runner.stop("c1");
    lastQuery().emit(failure("error_during_execution"));
    await stopping;
    await flush();
    expect(card("c1")).toMatchObject({ archived: false, column: "review", wrappingUp: false });
  });

  it("a picked-up session changed outside Weft in the last 10 minutes is forked", async () => {
    addCard({ id: "c1", source: "claude-code", sessionId: "s-orig", lastActivity: Date.now(), lastWeftTurn: 0 });
    const q = await send("c1");
    expect(q.options).toMatchObject({ resume: "s-orig", forkSession: true });
  });

  it("one changed outside Weft long ago is resumed in place", async () => {
    addCard({ id: "c1", source: "claude-code", sessionId: "s-orig", lastActivity: Date.now() - 3_600_000, lastWeftTurn: 0 });
    const q = await send("c1");
    expect(q.options).toMatchObject({ resume: "s-orig" });
    expect(q.options.forkSession).toBeFalsy();
  });
});
