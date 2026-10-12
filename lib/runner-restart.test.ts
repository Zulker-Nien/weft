// @vitest-environment node
// What a restart needs from the runner: the count of other cards' turns the restart guard denies by
// (lib/restart-guard.ts), and a card shown running whenever its CLI is, so a restart never leaves a cut-off
// turn in Review looking finished. Against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, flush, makeCard, nth, resetHarness, success, toolUse } from "./runner.harness";
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
const card = (id: string) => h.cards.get(id) as Card;

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

describe("a turn and a restart", () => {
  it("shows a card running again when its CLI goes on working after the turn ended", async () => {
    addCard({ id: "c1" });
    const q = await send("c1");
    q.emit(success("Done."));
    await flush();
    expect(card("c1").column).toBe("review");
    q.emit(assistant(toolUse("t9", "Bash", { command: "ls" })));
    await flush();
    expect(card("c1").column).toBe("running");
    q.emit(success("Really done."));
    await flush();
    expect(card("c1").column).toBe("review");
  });

  it("tells the restart guard how many other cards' turns are running", async () => {
    addCard({ id: "c1" });
    addCard({ id: "c2" });
    await send("c1");
    const q = await send("c2");
    expect((q.options.otherTurns as () => number)()).toBe(1);
  });
});
