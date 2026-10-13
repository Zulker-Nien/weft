// @vitest-environment node
// How many idle card CLIs stay open: past MAX_IDLE_SESSIONS the least recently used close (lib/runner-state.ts),
// so a long day of cards doesn't leave dozens of CLIs and their MCP servers running. Against the fake SDK in
// lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
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
