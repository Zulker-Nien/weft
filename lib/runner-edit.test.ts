// @vitest-environment node
// ↑ in the reply box: lib/runner.ts editLastMessage, against the fake SDK in lib/runner.harness.ts.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistant, flush, makeCard, nth, resetHarness, success, text } from "./runner.harness";
import type { Card, ThreadItem } from "./types";

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
const thread = (id: string): ThreadItem[] => h.threads.get(id) ?? [];
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
  vi.useRealTimers();
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("editLastMessage", () => {
  // A transcript where the prompt `promptId` follows the entry `parent` (null: it opened the session).
  function transcript(sessionId: string, promptId: string, parent: string | null) {
    const file = path.join(cwd, `${sessionId}.jsonl`);
    const lines = [{ uuid: "e-0", parentUuid: null }, { uuid: promptId, parentUuid: parent }, { uuid: "e-2", parentUuid: promptId }];
    fs.writeFileSync(file, `not json ${promptId}\n${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    h.sessionFiles.set(sessionId, file);
  }
  const promptIdOf = (id: string) => {
    const item = thread(id).findLast((i) => i.kind === "user");
    return item?.kind === "user" ? item.id : undefined;
  };

  it("tags each Claude prompt with an id the CLI gets as its uuid", async () => {
    addCard({ id: "c1" });
    const q = await send("c1", "one");
    expect(promptIdOf("c1")).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.uuids).toEqual([promptIdOf("c1")]);
  });

  it("leaves puku prompts untagged", async () => {
    addCard({ id: "c1", backend: "puku" });
    const q = await send("c1", "one");
    expect(promptIdOf("c1")).toBeUndefined();
    expect(q.uuids).toEqual([undefined]);
  });

  it("stops the running turn, rewinds to before the message, folds it and sends the edit", async () => {
    addCard({ id: "c1", sessionId: "s1" });
    const first = await send("c1", "make it blue");
    first.emit(assistant(text("Making it blue")));
    await flush();
    const promptId = promptIdOf("c1")!;
    transcript("s1", promptId, "turn-before");
    await runner.editLastMessage("c1", "make it red");
    await flush();
    expect(first.aborted).toBe(true);
    const q = lastQuery();
    expect(q).not.toBe(first);
    expect(q.options).toMatchObject({ resume: "s1", resumeSessionAt: "turn-before", forkSession: false });
    expect(q.received).toEqual(["make it red"]);
    expect(thread("c1")).toEqual([
      { kind: "edited", at: 0, items: [expect.objectContaining({ kind: "user", text: "make it blue" }), expect.objectContaining({ kind: "assistant" })] },
      expect.objectContaining({ kind: "user", text: "make it red" }),
    ]);
    expect(card("c1").column).toBe("running");
  });

  it("starts a new session when the edited message opened the session", async () => {
    addCard({ id: "c1", sessionId: "s1" });
    const first = await send("c1", "hi");
    first.emit(success("ok", { session_id: "s1" }));
    await flush();
    transcript("s1", promptIdOf("c1")!, null);
    await runner.editLastMessage("c1", "hello");
    await flush();
    expect(lastQuery().options).toMatchObject({ resume: undefined, resumeSessionAt: undefined });
    expect(nth(thread("c1"), 0).kind).toBe("edited");
  });

  it("continues a session open in another app as a copy", async () => {
    addCard({ id: "c1", sessionId: "s1", source: "claude-code" });
    const first = await send("c1", "hi");
    first.emit(success("ok", { session_id: "s1" }));
    await flush();
    transcript("s1", promptIdOf("c1")!, "p0");
    h.openElsewhere = true;
    await runner.editLastMessage("c1", "hello");
    await flush();
    expect(lastQuery().options).toMatchObject({ resume: "s1", resumeSessionAt: "p0", forkSession: true });
    expect(card("c1")).toMatchObject({ forkedFrom: "s1", openElsewhere: false });
  });

  it("sends the edit as a new message when the transcript doesn't hold the prompt", async () => {
    addCard({ id: "c1", sessionId: "s1" });
    const first = await send("c1", "hi");
    first.emit(success("ok", { session_id: "s1" }));
    await flush();
    // No transcript file for s1, then one that is a folder and can't be read.
    await runner.editLastMessage("c1", "hello");
    await flush();
    expect(lastQuery().options).toMatchObject({ resume: "s1", resumeSessionAt: undefined });
    lastQuery().emit(success("ok", { session_id: "s1" }));
    await flush();
    h.sessionFiles.set("s1", cwd);
    await runner.editLastMessage("c1", "hey");
    await flush();
    expect(thread("c1").map((i) => i.kind)).toEqual(["user", "result", "user", "result", "user"]);
  });

  it("drops what was queued after the turn it replaces", async () => {
    h.skillsForPrompt = ["weft:done"];
    addCard({ id: "c1", sessionId: "s1" });
    runner.sendUserMessage("c1", "ship it");
    await flush();
    h.skillsForPrompt = [];
    transcript("s1", promptIdOf("c1")!, "p0");
    await runner.editLastMessage("c1", "ship it carefully");
    await flush();
    lastQuery().emit(success("ok", { session_id: "s1" }));
    await flush(5);
    expect(lastQuery().received).toEqual(["ship it carefully"]);
  });

  it("refuses a missing card, the copilot and a thread with nothing sent", async () => {
    await expect(runner.editLastMessage("nope", "x")).rejects.toThrow("No such card.");
    addCard({ id: "cp", role: "copilot" });
    await expect(runner.editLastMessage("cp", "x")).rejects.toThrow("can't be edited");
    addCard({ id: "c1" });
    await expect(runner.editLastMessage("c1", "x")).rejects.toThrow("no message to edit");
  });
});
