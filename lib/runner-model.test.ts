// @vitest-environment node
// The thread header's model picker: lib/runner.ts setModel, against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, nth, resetHarness } from "./runner.harness";
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

type Runner = typeof import("./runner");
let runner: Runner;
let cwd: string;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const lastQuery = () => nth(h.queries, -1, "query");

async function send(id: string, msg = "hello") {
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
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("setModel", () => {
  it("saves the model and switches the open CLI's model once", async () => {
    addCard({ id: "c1", backend: "puku", model: "opus-4.8" });
    const q = await send("c1");
    runner.setModel("c1", "puku-ai-2.7");
    expect(card("c1").model).toBe("puku-ai-2.7");
    expect(q.setModel).toHaveBeenCalledWith("puku-ai-2.7");
    runner.setModel("c1", "puku-ai-2.7");
    expect(q.setModel).toHaveBeenCalledTimes(1);
  });

  it("only saves it when no CLI is open", () => {
    addCard({ id: "c1" });
    runner.setModel("c1", "claude-haiku-5-5");
    expect(card("c1").model).toBe("claude-haiku-5-5");
  });
});
