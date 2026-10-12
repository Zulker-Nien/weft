// @vitest-environment node
// /done and a move to Done: the card shows in Done while its wrap-up runs, then it's archived.
// lib/runner.ts archiveWhenIdle and lib/board-view.ts shownColumn, against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shownColumn } from "./board-view";
import { flush, makeCard, nth, resetHarness, success } from "./runner.harness";
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

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("wrapping up", () => {
  it("shows a /done card in Done while it runs, then archives it", async () => {
    addCard({ id: "c1" });
    runner.sendUserMessage("c1", "/done");
    await flush();
    expect(card("c1")).toMatchObject({ column: "running", wrappingUp: true });
    expect(shownColumn(card("c1"))).toBe("done");
    lastQuery().emit(success("wrapped up"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "done", archived: true, wrappingUp: false });
  });

  it("stays in Done through every queued automation of a move to Done", async () => {
    addCard({ id: "c1", column: "done" });
    runner.queueMessages("c1", ["/a", "/b"]);
    runner.archiveWhenIdle("c1");
    await flush();
    expect(shownColumn(card("c1"))).toBe("done");
    lastQuery().emit(success("a done"));
    await flush(3);
    expect(lastQuery().received).toEqual(["/a", "/b"]);
    expect(card("c1")).toMatchObject({ column: "running", wrappingUp: true, archived: false });
    lastQuery().emit(success("b done"));
    await flush();
    expect(card("c1")).toMatchObject({ column: "done", archived: true, wrappingUp: false });
  });

  it("a plain message isn't wrapping up, and a needs-you card stays in Needs you", () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "build it");
    expect(card("c1").wrappingUp).toBe(false);
    expect(shownColumn(card("c1"))).toBe("running");
    expect(shownColumn({ ...card("c1"), column: "needs_you", wrappingUp: true })).toBe("needs_you");
  });
});
