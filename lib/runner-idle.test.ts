// @vitest-environment node
// How many idle card CLIs stay open: past MAX_IDLE_SESSIONS (MAX_IDLE_PUKU for puku) the least recently used close
// (lib/runner-state.ts, lib/puku-idle.ts),
// so a long day of cards doesn't leave dozens of CLIs and their MCP servers running. Against the fake SDK in
// lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
import { MAX_IDLE_PUKU, PUKU_IDLE_ENV, PUKU_KEEP_ALIVE_MINUTES } from "./puku-idle";
import { MAX_IDLE_SESSIONS } from "./runner-state";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: () => h.skillsForPrompt,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);

async function idleCard(id: string, backend: Card["backend"] = "claude") {
  addCard({ id, backend });
  const q = await send(id);
  q.emit(success("ok"));
  await flush();
  return q;
}

async function send(id: string) {
  runner.sendMessage(id, "hello");
  await flush();
  return nth(h.queries, -1, "query");
}

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("idle CLI cap", () => {
  it("closes the least recently used idle CLIs past MAX_IDLE_SESSIONS, never a busy one", async () => {
    addCard({ id: "busy" });
    const busy = await send("busy");
    const idle = [];
    for (let i = 0; i < MAX_IDLE_SESSIONS + 2; i++) {
      addCard({ id: `c${i}` });
      const q = await send(`c${i}`);
      q.emit(success("ok"));
      await flush();
      idle.push(q);
    }
    expect(idle.map((q) => q.inputClosed)).toEqual([true, true, ...Array<boolean>(MAX_IDLE_SESSIONS).fill(false)]);
    expect(busy.inputClosed).toBe(false);
  });
});

describe("idle puku CLIs", () => {
  it(`keeps at most ${MAX_IDLE_PUKU} idle puku CLIs open, closing the least recently used`, async () => {
    const claude = await idleCard("c0");
    const puku = [];
    for (let i = 0; i < MAX_IDLE_PUKU + 2; i++) puku.push(await idleCard(`p${i}`, "puku"));
    expect(puku.map((q) => q.inputClosed)).toEqual([true, true, ...Array<boolean>(MAX_IDLE_PUKU).fill(false)]);
    expect(claude.inputClosed).toBe(false);
  });

  it("starts puku-cli without its heap relaunch, so it never runs gc() every second", async () => {
    const puku = await idleCard("p0", "puku");
    const claude = await idleCard("c0");
    expect(puku.options.env).toMatchObject(PUKU_IDLE_ENV);
    expect(claude.options.env).not.toHaveProperty("PUKU_CLI_DISABLE_HEAP_RELAUNCH");
  });

  it(`closes an idle puku CLI after ${PUKU_KEEP_ALIVE_MINUTES} minutes even when keep-alive is never`, async () => {
    addCard({ id: "p0", backend: "puku" });
    addCard({ id: "c0" });
    const puku = await send("p0");
    const claude = await send("c0");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      puku.emit(success("ok"));
      claude.emit(success("ok"));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(PUKU_KEEP_ALIVE_MINUTES * 60_000);
      expect(puku.inputClosed).toBe(true);
      expect(claude.inputClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("puku spares", () => {
  const spareCount = () => h.queries.filter((q) => !q.options.abortController.signal.aborted).length;

  it("keeps one puku spare at most, in the folder asked for last", async () => {
    runner.ensureSpare(cwd, "puku");
    await flush();
    const first = nth(h.queries, -1, "query");
    runner.ensureSpare(`${cwd}/other`, "puku");
    await flush();
    expect(first.options.abortController.signal.aborted).toBe(true);
    expect(spareCount()).toBe(1);
  });

  it("leaves Claude Code spares alone when a puku one starts", async () => {
    runner.ensureSpare(cwd);
    await flush();
    runner.ensureSpare(cwd, "puku");
    await flush();
    expect(spareCount()).toBe(2);
  });

  it("doesn't start another puku spare after a card adopts one", async () => {
    runner.ensureSpare(cwd, "puku");
    await flush();
    addCard({ id: "p0", backend: "puku" });
    runner.sendMessage("p0", "go");
    await flush(3);
    expect(h.queries).toHaveLength(1);
  });

  it("does start another Claude Code spare after a card adopts one", async () => {
    runner.ensureSpare(cwd);
    await flush();
    addCard({ id: "c0" });
    runner.sendMessage("c0", "go");
    await flush(3);
    expect(h.queries).toHaveLength(2);
  });
});
