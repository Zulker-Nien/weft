// Messages that reach a thread mid-turn (a page's link, a failed commit's note): held on the card as
// "after this turn" and sent as the turn ends, instead of "This thread is already running".
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

let runner: typeof import("./runner");
let cwd: string;
const g = globalThis as Record<string, unknown>;

const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id)!;
const lastQuery = () => nth(h.queries, -1, "query");

const STATUS = "BOARD STATUS: column=needs_you | stage=First shot | remaining=add a test";

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  runner = await import("./runner");
});

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("held for after the turn", () => {
  it("sendUserMessage on a busy thread holds it for after the turn, then sends what waited as one message", async () => {
    addCard({ id: "c1" });
    runner.sendUserMessage("c1", "first");
    await flush();
    runner.sendUserMessage("c1", "tweak the title");
    runner.sendUserMessage("c1", "and the color");
    expect(card("c1").scheduled).toMatchObject([
      { text: "tweak the title", afterTurn: true },
      { text: "and the color", afterTurn: true },
    ]);
    // A turn that ends needing you still lets your message through: it's the answer.
    lastQuery().emit(success(`Question?\n${STATUS}`));
    await flush();
    expect(card("c1").scheduled).toBeUndefined();
    expect(lastQuery().received).toEqual(["first", "tweak the title\n\nand the color"]);
  });

  it("a held message waits for the queued automations, keeps other scheduled ones, and notes a send that fails", async () => {
    addCard({ id: "c1" });
    runner.queueMessages("c1", ["/a", "/b"]);
    await flush();
    runner.sendUserMessage("c1", "later");
    h.cards.set("c1", { ...card("c1"), scheduled: [...card("c1").scheduled!, { id: "s", text: "tomorrow", at: Date.now() + 86_400_000 }] });
    lastQuery().emit(success("a done"));
    await flush();
    expect(lastQuery().received).toEqual(["/a", "/b"]);
    lastQuery().emit(success("b done"));
    await flush();
    expect(lastQuery().received).toEqual(["/a", "/b", "later"]);
    expect(card("c1").scheduled).toMatchObject([{ id: "s", text: "tomorrow" }]);
  });

  it("a held message that can't go when the turn ends leaves why on the card", async () => {
    addCard({ id: "c1" });
    runner.sendUserMessage("c1", "first");
    await flush();
    runner.sendUserMessage("c1", "one more");
    lastQuery().emit(success("ok"));
    // Its CLI and folder are gone by the time the held message goes, so a new CLI can't start.
    (g.__weftSessions as Map<string, unknown>).delete("c1");
    h.cards.set("c1", { ...card("c1"), cwd: path.join(cwd, "gone") });
    await flush();
    expect(card("c1").error).toMatch(/^A message that waited for the turn couldn't go: .*doesn't exist anymore/);
    expect(card("c1").scheduled).toBeUndefined();
  });

  it("the copilot is still turned away mid-turn", async () => {
    addCard({ id: "cp", role: "copilot" });
    runner.sendMessage("cp", "hi");
    await flush();
    expect(() => runner.sendUserMessage("cp", "again")).toThrow("already running");
  });
});
