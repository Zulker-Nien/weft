// What lib/runner-session.ts does with the card's skill set: ensureSpare calls ensureSeeded
// and offFor, adoptSpare leaves a spare whose off-list differs from the card's, and
// queryOptions passes the off-list as --settings.skillOverrides / --settings.enabledPlugins.
// lib/skill-sets is mocked through runner.harness's skillSetsMock so the test can pin every call.
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
vi.mock("./skill-sets", async () => (await import("./runner.harness")).skillSetsMock(h));
vi.mock("./question-preview", () => ({ writeQuestionPreview: vi.fn(() => undefined) }));
vi.mock("./plan-preview", () => ({ isPlanTool: () => false, writePlanPreview: vi.fn(() => undefined) }));
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

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("ensureSpare's skill set", () => {
  it("seeds the project and opens the spare with offFor({ cwd })", async () => {
    h.skillOffByCwd.set(cwd, ["quiet-skill"]);
    runner.ensureSpare(cwd);
    await flush();
    expect(h.skillSeededCwds).toContain(cwd);
    const spare = lastQuery();
    expect(spare.options.cwd).toBe(cwd);
    // specFor is called with the spare's spec — verify off-list landed on the spec via the
    // --settings the spare was started with.
    expect(spare.options.settings).toEqual({ skillOverrides: { "quiet-skill": "user-invocable-only" } });
  });
});

describe("adoptSpare", () => {
  it("returns undefined when the card's off-list differs from the spare's, leaving the spare", async () => {
    h.skillOffByCwd.set(cwd, ["spare-only"]);
    runner.ensureSpare(cwd);
    await flush();
    const spare = lastQuery();
    spare.emit(init("spare-sess"));
    await flush();
    expect(h.queries).toHaveLength(1);

    // The card asks for a different off-list, so the spare is left and a new query opens.
    addCard({ id: "c1", permissionMode: "bypassPermissions", skillsOff: ["card-only"] });
    runner.sendMessage("c1", "go");
    await flush();
    expect(h.queries).toHaveLength(2);
    // The spare's session id didn't move to the card.
    expect(card("c1").sessionId).not.toBe("spare-sess");
    // The spare's first message went to a no-card session, not the card's.
    expect(spare.received).toEqual([]);
    expect(lastQuery().received).toEqual(["go"]);
  });
});

describe("queryOptions", () => {
  it("merges the spec's skillsOff into the SDK settings as skillOverrides and enabledPlugins", async () => {
    addCard({ id: "c1", skillsOff: ["quiet-skill", "posthog@posthog"] });
    runner.sendMessage("c1", "go");
    await flush();
    const q = lastQuery();
    expect(q.options.settings).toEqual({
      skillOverrides: { "quiet-skill": "user-invocable-only" },
      enabledPlugins: { "posthog@posthog": false },
    });
  });

  it("leaves settings undefined when the spec's skillsOff is empty", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "go");
    await flush();
    expect(lastQuery().options.settings).toBeUndefined();
  });
});
