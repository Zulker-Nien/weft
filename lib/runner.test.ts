// Characterization tests for lib/runner.ts: they pin what the SDK loop does today (one query() per card,
// warm spares, permissions, the turn queue) so it can be refactored safely. Where today's behavior looks
// wrong, the test still pins it and says so in a "CURRENT BEHAVIOR" comment.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

// Captured before any test fakes timers, so flush() always really waits.
const realSetTimeout = globalThis.setTimeout;

type Options = Record<string, unknown> & {
  abortController: AbortController;
  canUseTool: (toolName: string, input: Record<string, unknown>, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

// A scripted stand-in for the SDK's Query: tests push SDK messages with emit(), and it records the user
// messages runner feeds into its prompt.
class FakeQuery {
  options: Options;
  received: string[] = [];
  inputClosed = false;
  interrupt = vi.fn(async () => {});
  setPermissionMode = vi.fn(async () => {});
  setModel = vi.fn(async () => {});
  applyFlagSettings = vi.fn(async () => {});
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = vi.fn(async (): Promise<unknown> => ({}));
  private queue: unknown[] = [];
  private wake?: () => void;
  private done = false;
  private error?: Error;

  constructor({ prompt, options }: { prompt: AsyncIterable<{ message: { content: unknown } }>; options: Options }) {
    this.options = options;
    // The real SDK throws once its abort controller fires.
    options.abortController.signal.addEventListener("abort", () => this.fail(new Error("Claude Code process aborted by user")));
    void (async () => {
      for await (const m of prompt) {
        const c = m.message.content;
        this.received.push(typeof c === "string" ? c : JSON.stringify(c));
      }
      this.inputClosed = true;
    })();
  }

  get aborted() {
    return this.options.abortController.signal.aborted;
  }

  emit(...msgs: unknown[]) {
    this.queue.push(...msgs);
    this.wake?.();
  }

  end() {
    this.done = true;
    this.wake?.();
  }

  fail(err: Error) {
    this.error = err;
    this.wake?.();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.queue.length) yield this.queue.shift();
      if (this.error) throw this.error;
      if (this.done) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}

const h = vi.hoisted(() => ({
  cards: new Map<string, Card>(),
  threads: new Map<string, ThreadItem[]>(),
  queries: [] as FakeQuery[],
  keepAlive: 0,
  openElsewhere: false,
  startLogin: [] as { backend: string; onDone?: () => void }[],
  skillsForPrompt: [] as string[],
  publish: [] as unknown[],
  execCalls: [] as string[][],
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: ConstructorParameters<typeof FakeQuery>[0]) => {
    const q = new FakeQuery(args);
    h.queries.push(q);
    return q;
  },
  tool: (name: string) => ({ name }),
  createSdkMcpServer: (opts: { name: string }) => ({ type: "sdk", name: opts.name }),
}));

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => h.cards.get(id),
  listCards: () => [...h.cards.values()],
  createCard: () => {
    throw new Error("not used");
  },
  updateCard: (id: string, patch: Partial<Card>) => {
    const card = h.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    return Object.assign(card, patch);
  },
  getThread: (id: string) => {
    if (!h.threads.has(id)) h.threads.set(id, []);
    return h.threads.get(id)!;
  },
  appendThread: (id: string, item: ThreadItem) => {
    if (!h.threads.has(id)) h.threads.set(id, []);
    return h.threads.get(id)!.push(item) - 1;
  },
  replaceThreadItem: (id: string, index: number, item: ThreadItem) => {
    h.threads.get(id)![index] = item;
  },
}));

vi.mock("./bus", () => ({ publish: (e: unknown) => h.publish.push(e) }));
vi.mock("./env", () => ({ cliEnv: () => ({ PATH: "/usr/bin" }) }));
vi.mock("./import", () => ({ isOpenElsewhere: () => h.openElsewhere }));
vi.mock("./settings", () => ({
  keepAliveMinutes: () => h.keepAlive,
  threadPrompt: () => "THREAD PROMPT",
  touchProject: () => {},
  automations: () => [],
}));
vi.mock("./login", () => ({
  isNotLoggedInError: (text: string) => /not logged in|please run \/login|invalid api key/i.test(text),
  startLogin: (backend: string, onDone?: () => void) => {
    h.startLogin.push({ backend, onDone });
    return {};
  },
}));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFileSync = (cmd: string, args: string[]) => {
    h.execCalls.push([cmd, ...args]);
    if (cmd === "/usr/bin/which") return "/opt/bin/puku-cli\n";
    if (args.includes("rev-parse")) return "main\n";
    if (args.includes("--numstat")) return "3\t1\ta.ts\n2\t0\tb.ts\n";
    return "";
  };
  return { ...actual, default: { ...actual, execFileSync }, execFileSync };
});

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const g = globalThis as Record<string, unknown>;
const GLOBALS = ["__threadboardSessions", "__threadboardSpares", "__threadboardLoginWaiters", "__weftQueued", "__weftArchiveAfter"];

async function flush(times = 3) {
  for (let i = 0; i < times; i++) await new Promise((resolve) => realSetTimeout(resolve, 2));
}

function addCard(over: Partial<Card> = {}): Card {
  const id = over.id ?? `card-${h.cards.size + 1}`;
  const card: Card = {
    id,
    title: "A card",
    prompt: "do it",
    cwd,
    backend: "claude",
    permissionMode: "default",
    column: "todo" as Card["column"],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
  h.cards.set(id, card);
  return card;
}

const card = (id: string) => h.cards.get(id)!;
const thread = (id: string) => h.threads.get(id) ?? [];
const lastQuery = () => h.queries[h.queries.length - 1];

// SDK messages, with only the fields runner reads.
const init = (sessionId = "sess-1") => ({ type: "system", subtype: "init", session_id: sessionId });
const assistant = (...content: unknown[]) => ({ type: "assistant", parent_tool_use_id: null, message: { content } });
const text = (t: string) => ({ type: "text", text: t });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const toolResultMsg = (id: string, content: string, isError = false) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const success = (result: string, over: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  result,
  is_error: false,
  total_cost_usd: 0.25,
  session_id: "sess-1",
  modelUsage: {},
  ...over,
});
const failure = (subtype: string, over: Record<string, unknown> = {}) => ({
  type: "result",
  subtype,
  is_error: true,
  total_cost_usd: 0.1,
  session_id: "sess-1",
  modelUsage: {},
  ...over,
});

const STATUS = "BOARD STATUS: column=needs_you | stage=First shot | remaining=add a test";

// Sends a message and waits until the fake CLI has the query open and has read it.
async function send(id: string, msg = "hello") {
  runner.sendMessage(id, msg);
  await flush();
  return lastQuery();
}

beforeEach(async () => {
  h.cards.clear();
  h.threads.clear();
  h.queries.length = 0;
  h.keepAlive = 0;
  h.openElsewhere = false;
  h.startLogin.length = 0;
  h.skillsForPrompt = [];
  h.publish.length = 0;
  h.execCalls.length = 0;
  for (const key of GLOBALS) delete g[key];
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "weft-runner-"));
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("sendMessage", () => {
  it("opens one query, moves the card to running and echoes the user item", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "build it");
    expect(card("c1")).toMatchObject({ column: "running", lastLine: "Thinking…", pending: null, archived: false });
    expect(thread("c1")).toEqual([expect.objectContaining({ kind: "user", text: "build it" })]);
    expect(runner.isBusy("c1")).toBe(true);
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(lastQuery().received).toEqual(["build it"]);
    expect(card("c1").warm).toBe(true);
  });

  it("passes the card's settings to query() and appends the thread prompt", async () => {
    addCard({ id: "c1", permissionMode: "acceptEdits", model: "opus", effort: "high", sessionId: "old" });
    const q = await send("c1");
    expect(q.options).toMatchObject({
      cwd,
      resume: "old",
      forkSession: undefined,
      permissionMode: "acceptEdits",
      model: "opus",
      effort: "high",
      includePartialMessages: true,
      allowDangerouslySkipPermissions: true,
      pathToClaudeCodeExecutable: undefined,
      env: { PATH: "/usr/bin" },
    });
    expect((q.options.systemPrompt as { append: string }).append).toContain("THREAD PROMPT");
    expect(Object.keys(q.options.mcpServers as object)).toEqual(["browser", "board"]);
  });

  it("starts puku-cli by its path and leaves out allowDangerouslySkipPermissions", async () => {
    addCard({ id: "c1", backend: "puku" });
    const q = await send("c1");
    expect(q.options.pathToClaudeCodeExecutable).toBe("/opt/bin/puku-cli");
    expect(q.options.allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("gives the copilot the copilot prompt and no skip-permissions flag", async () => {
    addCard({ id: "cp", role: "copilot" });
    const q = await send("cp");
    expect(q.options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(q.options.plugins).toBeUndefined();
    expect((q.options.systemPrompt as { append: string }).append).not.toContain("THREAD PROMPT");
  });

  it("refuses a missing card, a missing folder and a card that's already running", async () => {
    expect(() => runner.sendMessage("nope", "x")).toThrow("No such card.");
    addCard({ id: "gone", cwd: "/no/such/folder/weft" });
    expect(() => runner.sendMessage("gone", "x")).toThrow("doesn't exist anymore");
    addCard({ id: "c1" });
    await send("c1");
    expect(() => runner.sendMessage("c1", "again")).toThrow("already running");
  });

  it("reuses the open CLI for the next turn", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "one");
    q.emit(success("ok"));
    await flush();
    runner.sendMessage("c1", "two", { echo: false });
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(q.received).toEqual(["one", "two"]);
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
  });

  it("continues a picked-up session that's open elsewhere as a fork", async () => {
    h.openElsewhere = true;
    addCard({ id: "c1", source: "claude-code", sessionId: "s-orig" });
    const q = await send("c1");
    expect(q.options).toMatchObject({ resume: "s-orig", forkSession: true });
    expect(card("c1")).toMatchObject({ forkedFrom: "s-orig", openElsewhere: false });
  });
});

describe("a turn's messages", () => {
  it("saves the session id from init and the plan limits from the usage report", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "hi");
    await flush(1);
    lastQuery().usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET.mockResolvedValue({
      rate_limits: { five_hour: { utilization: 42, resets_at: null }, seven_day: null },
    });
    lastQuery().emit(init("sess-9"));
    await flush();
    expect(card("c1").sessionId).toBe("sess-9");
    expect(card("c1").stats?.fiveHour).toEqual({ used: 42, resetsAt: undefined });
  });

  it("adds assistant text to the thread, lifting the status line onto the card", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(text(`Working on it.\n\n${STATUS}`)));
    await flush();
    expect(thread("c1").at(-1)).toMatchObject({ kind: "assistant", text: "Working on it." });
    expect(card("c1")).toMatchObject({ stage: "First shot", remaining: "add a test", lastLine: "Working on it." });
  });

  it("adds a tool item for each tool call and fills it in from its result", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(assistant(toolUse("t1", "Bash", { command: "ls" })));
    await flush();
    const index = thread("c1").length - 1;
    expect(thread("c1")[index]).toMatchObject({ kind: "tool", id: "t1", name: "Bash" });
    q.emit(toolResultMsg("t1", "a.txt", true));
    await flush();
    expect(thread("c1")[index]).toMatchObject({ kind: "tool", id: "t1", result: "a.txt", isError: true });
  });

  it("keeps subagent assistant turns out of the thread", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit({ ...assistant(text("subagent chatter")), parent_tool_use_id: "t1" });
    await flush();
    expect(thread("c1").some((i) => i.kind === "assistant")).toBe(false);
  });

  it("publishes streamed text deltas", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
    await flush();
    expect(h.publish).toContainEqual({ type: "delta", cardId: "c1", text: "Hel" });
  });
});

describe("a turn's result", () => {
  it("moves the card to the status line's column and records summary, cost and stats", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success(`All set.\n\n${STATUS}`, { total_cost_usd: 0.5 }));
    await flush();
    expect(card("c1")).toMatchObject({
      column: "needs_you",
      costUsd: 0.5,
      turns: 1,
      lastLine: "All set.",
      error: undefined,
      pending: null,
      stage: "First shot",
      remaining: "add a test",
      sessionId: "sess-1",
    });
    expect(card("c1").stats).toMatchObject({ branch: "main", added: 5, removed: 1 });
    expect(thread("c1").at(-1)).toMatchObject({ kind: "result", text: "All set.", costUsd: 0.5, isError: false });
    expect(runner.isBusy("c1")).toBe(false);
  });

  it("goes to review when there's no status line, using one seen earlier in the turn if any", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("Done."));
    await flush();
    expect(card("c1").column).toBe("review");

    runner.sendMessage("c1", "more");
    await flush();
    q.emit(assistant(text(`Partway.\n${STATUS}`)), success("Finished."));
    await flush();
    expect(card("c1").column).toBe("needs_you");
  });

  it("treats total_cost_usd as the process's running total", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("one", { total_cost_usd: 0.5 }));
    await flush();
    runner.sendMessage("c1", "two");
    await flush();
    q.emit(success("two", { total_cost_usd: 0.8 }));
    await flush();
    expect(card("c1")).toMatchObject({ costUsd: 0.8, turns: 2 });
  });

  it("an error result goes to review with the error", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(failure("error_max_turns"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", error: "Ended early: error max turns", lastLine: "Ended early: error max turns" });
    expect(thread("c1").at(-1)).toMatchObject({ kind: "result", isError: true });
  });
});

describe("permissions", () => {
  const ask = (q: FakeQuery, toolName: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const controller = new AbortController();
    const promise = q.options.canUseTool(toolName, input, { signal: controller.signal, ...extra });
    return { promise, controller };
  };

  it("an untrusted tool puts the card in needs_you until you allow it", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const { promise } = ask(q, "Bash", { command: "rm -rf build" });
    expect(card("c1")).toMatchObject({ column: "needs_you", pending: { toolName: "Bash" } });
    expect(card("c1").pending?.title).toContain("rm -rf build");
    const index = thread("c1").findIndex((i) => i.kind === "permission");
    runner.answerPermission("c1", true);
    await expect(promise).resolves.toEqual({ behavior: "allow", updatedInput: { command: "rm -rf build" } });
    expect(card("c1")).toMatchObject({ column: "running", pending: null });
    expect(card("c1").lastLine).toMatch(/^Allowed: /);
    expect(thread("c1")[index]).toMatchObject({ kind: "permission", decision: "allow" });
  });

  it("deny resolves with a deny message and returns to running", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const { promise } = ask(q, "Bash", { command: "ls" });
    runner.answerPermission("c1", false);
    await expect(promise).resolves.toEqual({ behavior: "deny", message: "The user denied this in Weft." });
    expect(card("c1").column).toBe("running");
    expect(card("c1").lastLine).toMatch(/^Denied: /);
  });

  it("parallel requests queue: the card shows the oldest, then the next", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const first = ask(q, "Bash", { command: "one" }, { title: "First" });
    const second = ask(q, "Write", { file_path: "x" }, { title: "Second" });
    expect(card("c1").pending?.title).toBe("First");
    const firstId = card("c1").pending!.id;
    runner.answerPermission("c1", true);
    await first.promise;
    expect(card("c1")).toMatchObject({ column: "needs_you", pending: { title: "Second" }, lastLine: "Second" });
    // The answered request's id no longer matches.
    expect(() => runner.answerPermission("c1", true, undefined, firstId)).toThrow("isn't waiting anymore");
    runner.answerPermission("c1", false, undefined, card("c1").pending!.id);
    await expect(second.promise).resolves.toMatchObject({ behavior: "deny" });
    expect(() => runner.answerPermission("c1", true)).toThrow("Nothing is waiting");
  });

  it("a cancelled request is denied and the card goes back to running", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const { promise, controller } = ask(q, "Bash", { command: "ls" });
    controller.abort();
    await expect(promise).resolves.toEqual({ behavior: "deny", message: "Cancelled." });
    expect(card("c1")).toMatchObject({ column: "running", pending: null, lastLine: "Working…" });
  });

  it("Weft's own sdk tools are allowed without asking", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const sdk = { mcpServer: { source: "sdk" } };
    await expect(ask(q, "mcp__browser__navigate", { url: "x" }, sdk).promise).resolves.toEqual({ behavior: "allow", updatedInput: { url: "x" } });
    await expect(ask(q, "mcp__board__list_cards", {}, sdk).promise).resolves.toMatchObject({ behavior: "allow" });
    expect(card("c1").column).toBe("running");
    // The same name from a non-sdk server still asks.
    void ask(q, "mcp__browser__navigate", { url: "x" }, { mcpServer: { source: "stdio" } }).promise;
    expect(card("c1").column).toBe("needs_you");
  });

  it("AskUserQuestion needs answers, which go back in the tool input", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const input = { questions: [{ question: "Which color?", options: [{ label: "Red" }, { label: "Blue" }] }] };
    const { promise } = ask(q, "AskUserQuestion", input);
    expect(card("c1").pending).toMatchObject({ title: "Which color?", questions: [{ question: "Which color?" }] });
    expect(() => runner.answerPermission("c1", true)).toThrow("needs answers");
    runner.answerPermission("c1", true, { "Which color?": "Blue" });
    await expect(promise).resolves.toEqual({ behavior: "allow", updatedInput: { ...input, answers: { "Which color?": "Blue" } } });
    expect(card("c1").lastLine).toBe("Answered: Blue");
  });

  it("skipping a question denies it", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const { promise } = ask(q, "AskUserQuestion", { questions: [{ question: "Go?" }] });
    runner.answerPermission("c1", false);
    await expect(promise).resolves.toEqual({ behavior: "deny", message: "The user skipped the question." });
  });
});

describe("stop", () => {
  it("interrupts the turn; the result reads Stopped and the card goes to review without an error", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    const promise = q.options.canUseTool("Bash", { command: "ls" }, { signal: new AbortController().signal });
    const stopping = runner.stop("c1");
    // Waiting requests are denied first.
    await expect(promise).resolves.toMatchObject({ behavior: "deny" });
    expect(q.interrupt).toHaveBeenCalled();
    q.emit(failure("error_during_execution"));
    await stopping;
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", lastLine: "Stopped", error: undefined });
    expect(thread("c1").at(-1)).toMatchObject({ kind: "result", text: "Stopped", isError: false });
    expect(q.aborted).toBe(false);
  });

  it("ends the CLI if the turn hasn't ended 5s after stop", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    q.interrupt.mockImplementation(() => new Promise(() => {}));
    const stopping = runner.stop("c1");
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(q.aborted).toBe(true);
    vi.useRealTimers();
    await flush();
    // The drive loop's cleanup moves a card that was mid-turn to review.
    expect(card("c1")).toMatchObject({ column: "review", lastLine: "Stopped", warm: false });
  });

  it("does nothing for an idle card", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    await runner.stop("c1");
    expect(q.interrupt).not.toHaveBeenCalled();
  });
});

describe("queueMessages", () => {
  it("runs queued texts one per turn", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    const q = lastQuery();
    expect(q.received).toEqual(["/a"]);
    q.emit(success("a done"));
    await flush();
    expect(q.received).toEqual(["/a", "/b"]);
    q.emit(success("b done"));
    await flush();
    expect(q.received).toEqual(["/a", "/b"]);
    expect(runner.isBusy("c1")).toBe(false);
  });

  it("waits while a turn is running, and a failed turn drops the rest", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "first");
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    expect(q.received).toEqual(["first"]);
    q.emit(success("ok"));
    await flush();
    expect(q.received).toEqual(["first", "/a"]);
    q.emit(failure("error_max_turns"));
    await flush();
    expect(q.received).toEqual(["first", "/a"]);
  });

  it("a turn that ends needing you holds the queue until your reply's turn ends", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    const q = lastQuery();
    q.emit(success(`Question?\n${STATUS}`));
    await flush();
    expect(q.received).toEqual(["/a"]);
    runner.sendMessage("c1", "answer");
    await flush();
    q.emit(success("thanks"));
    await flush();
    expect(q.received).toEqual(["/a", "answer", "/b"]);
  });

  it("sendUserMessage with /done archives the card once its turn ends", async () => {
    addCard({ id: "c1" });
    runner.sendUserMessage("c1", "/done");
    await flush();
    lastQuery().emit(success("wrapped up"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "done", archived: true });
  });

  it("sendUserMessage queues the skills a prompt-matches rule wants", async () => {
    addCard({ id: "c1" });
    h.skillsForPrompt = ["weft:preview"];
    runner.sendUserMessage("c1", "make a page");
    await flush();
    expect(card("c1").promptSkills).toEqual(["weft:preview"]);
    lastQuery().emit(success("ok"));
    await flush();
    expect(lastQuery().received).toEqual(["make a page", "/weft:preview"]);
  });
});

describe("spares", () => {
  it("a new card in the spare's folder adopts it without a second query()", async () => {
    runner.ensureSpare(cwd);
    await flush();
    expect(h.queries).toHaveLength(1);
    const spare = lastQuery();
    expect(spare.options.permissionMode).toBe("bypassPermissions");
    // Startup messages before adoption belong to no card.
    spare.emit(init("spare-sess"));
    await flush();

    addCard({ id: "c1", permissionMode: "bypassPermissions" });
    runner.sendMessage("c1", "go");
    expect(h.queries).toHaveLength(1);
    expect(card("c1").warm).toBe(true);
    expect(card("c1").sessionId).toBeUndefined();
    await flush();
    expect(spare.received).toEqual(["go"]);
    expect(spare.setPermissionMode).not.toHaveBeenCalled();
    // A fresh spare replaces the one taken.
    expect(h.queries).toHaveLength(2);
    expect(h.queries[1].options.cwd).toBe(cwd);
  });

  it("switches an adopted spare to the card's mode, model and effort", async () => {
    runner.ensureSpare(cwd);
    await flush();
    const spare = lastQuery();
    addCard({ id: "c1", permissionMode: "default", model: "sonnet", effort: "low" });
    runner.sendMessage("c1", "go");
    expect(spare.setPermissionMode).toHaveBeenCalledWith("default");
    expect(spare.setModel).toHaveBeenCalledWith("sonnet");
    expect(spare.applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "low" });
  });

  it("a card with a session, the copilot or another folder doesn't adopt the spare", async () => {
    runner.ensureSpare(cwd);
    await flush();
    addCard({ id: "resumed", sessionId: "s1" });
    runner.sendMessage("resumed", "go");
    addCard({ id: "cp", role: "copilot" });
    runner.sendMessage("cp", "go");
    await flush();
    expect(h.queries).toHaveLength(3);
    expect(h.queries[0].received).toEqual([]);
  });

  it("a spare denies tool requests until a card takes it", async () => {
    runner.ensureSpare(cwd);
    await flush();
    await expect(
      lastQuery().options.canUseTool("Bash", {}, { signal: new AbortController().signal }),
    ).resolves.toEqual({ behavior: "deny", message: "No card is attached yet." });
  });

  it("keeps one spare per folder and at most three, closing the oldest", async () => {
    const dirs = [cwd, ...[1, 2, 3].map(() => fs.mkdtempSync(path.join(os.tmpdir(), "weft-runner-")))];
    runner.ensureSpare(dirs[0]);
    runner.ensureSpare(dirs[0]);
    await flush();
    expect(h.queries).toHaveLength(1);
    for (const dir of dirs.slice(1)) runner.ensureSpare(dir);
    await flush();
    expect(h.queries).toHaveLength(4);
    expect(h.queries[0].aborted).toBe(true);
    expect(h.queries.slice(1).every((q) => !q.aborted)).toBe(true);
  });
});

describe("warmUp", () => {
  it("starts a card's CLI without sending anything", async () => {
    addCard({ id: "c1" });
    runner.warmUp("c1");
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(lastQuery().received).toEqual([]);
    expect(card("c1").warm).toBe(true);
    runner.warmUp("c1");
    expect(h.queries).toHaveLength(1);
  });

  it("never warms a picked-up session", async () => {
    addCard({ id: "c1", source: "claude-code", sessionId: "s1" });
    runner.warmUp("c1");
    await flush();
    expect(h.queries).toHaveLength(0);
  });
});

describe("login", () => {
  it("a not-logged-in result sends the card to needs_you and starts a login", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("Not logged in · Please run /login", { is_error: true }));
    await flush();
    expect(card("c1")).toMatchObject({ column: "needs_you", pending: null, lastLine: "Log in to Claude Code to run this thread" });
    expect(card("c1").error).toContain("Not logged in");
    expect(h.startLogin).toEqual([expect.objectContaining({ backend: "claude" })]);
  });

  it("a not-logged-in error from the CLI does the same, and the login retries the last message in a fresh CLI", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "please");
    q.fail(new Error("Invalid API key · Fix external API key"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "needs_you", lastLine: "Log in to Claude Code to run this thread" });
    expect(card("c1").error).toContain("Invalid API key");

    h.startLogin[0].onDone?.();
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(lastQuery().received).toEqual(["please"]);
    // Retried with echo off: the thread still has the one user item.
    expect(thread("c1").filter((i) => i.kind === "user")).toHaveLength(1);
    expect(card("c1").column).toBe("running");
  });

  it("any other CLI error is kept on the card, which leaves running for review", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.fail(new Error("spawn ENOENT"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", error: "spawn ENOENT", lastLine: "Stopped", warm: false });
  });
});

describe("the CLI going away", () => {
  it("deleting the card mid-run aborts its CLI on the next message", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    h.cards.delete("c1");
    q.emit(assistant(text("still going")));
    await flush();
    expect(q.aborted).toBe(true);
    expect(runner.isBusy("c1")).toBe(false);
    expect(thread("c1").some((i) => i.kind === "assistant")).toBe(false);
  });

  it("a CLI that exits mid-turn leaves the card in review and drops the queue; the next message opens a new one", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    const q = lastQuery();
    q.end();
    await flush();
    expect(card("c1")).toMatchObject({ column: "review", lastLine: "Stopped", warm: false, pending: null });
    runner.sendMessage("c1", "again");
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(lastQuery().received).toEqual(["again"]);
    lastQuery().emit(success("ok"));
    await flush();
    // "/b" was dropped with the CLI.
    expect(lastQuery().received).toEqual(["again"]);
  });

  it("endSession closes the CLI and resolves once it's wound down", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    await runner.endSession("c1");
    expect(q.aborted).toBe(true);
    expect(q.inputClosed).toBe(true);
    expect(card("c1").warm).toBe(false);
  });

  it("closes an idle CLI after the keep-alive time", async () => {
    h.keepAlive = 1;
    addCard({ id: "c1" });
    const q = await send("c1");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    q.emit(success("ok"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    // Its input is closed first...
    expect(q.inputClosed).toBe(true);
    expect(q.aborted).toBe(false);
    // ...and the process ended 10s later if it hasn't exited.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(q.aborted).toBe(true);
  });
});

describe("stale sessions (BUILD)", () => {
  type Session = { build: string; busy: boolean };
  const sessionsMap = () => g.__threadboardSessions as Map<string, Session>;

  it("an idle session started by older code is replaced on the next message", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    sessionsMap().get("c1")!.build = "older-build";
    runner.sendMessage("c1", "next");
    expect(q.aborted).toBe(true);
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(lastQuery().received).toEqual(["next"]);
  });

  it("a busy session from older code is kept", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    sessionsMap().get("c1")!.build = "older-build";
    expect(() => runner.sendMessage("c1", "next")).toThrow("already running");
    expect(q.aborted).toBe(false);
  });

  it("a reloaded copy of the module shares sessions and computes the same BUILD", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("ok"));
    await flush();
    vi.resetModules();
    const reloaded: Runner = await import("./runner");
    reloaded.sendMessage("c1", "from the reloaded copy");
    await flush();
    expect(h.queries).toHaveLength(1);
    expect(q.received.at(-1)).toBe("from the reloaded copy");
  });

  it("ensureSpare replaces a stale spare", async () => {
    runner.ensureSpare(cwd);
    await flush();
    const spares = g.__threadboardSpares as Map<string, Session>;
    [...spares.values()][0].build = "older-build";
    runner.ensureSpare(cwd);
    await flush();
    expect(h.queries).toHaveLength(2);
    expect(h.queries[0].aborted).toBe(true);
  });
});
