// @vitest-environment node
// While a restart is armed (lib/restart-when-idle.ts), sendMessage and sendUserMessage ask holdForRestart first and
// start nothing when it holds the message. Against the fake SDK in lib/runner.harness.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, makeCard, resetHarness } from "./runner.harness";
import type { Card } from "./types";

const h = await vi.hoisted(async () => (await import("./runner.harness")).harnessState());
const hold = vi.hoisted(() => ({ fn: vi.fn<(cardId: string, text: string, opts?: { echo?: boolean }) => boolean>(() => false) }));
const skills = vi.hoisted(() => ({ fn: vi.fn((): string[] => []) }));
const shellContext = vi.hoisted(() => ({ fn: vi.fn((_id: string, cli: string) => cli) }));

vi.mock("@anthropic-ai/claude-agent-sdk", async () => (await import("./runner.harness")).sdkMock(h));
vi.mock("./store", async () => (await import("./runner.harness")).storeMock(h));
vi.mock("./bus", async () => (await import("./runner.harness")).busMock(h));
vi.mock("./env", async () => (await import("./runner.harness")).envMock());
vi.mock("./import", async () => (await import("./runner.harness")).importMock(h));
vi.mock("./settings", async () => (await import("./runner.harness")).settingsMock(h));
vi.mock("./login", async () => (await import("./runner.harness")).loginMock(h));
vi.mock("./restart-when-idle", () => ({ holdForRestart: hold.fn }));
vi.mock("./shell", () => ({ withShellContext: shellContext.fn }));
vi.mock("./automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./automations")>()),
  skillsForPrompt: skills.fn,
}));
vi.mock("node:child_process", async (importOriginal) =>
  (await import("./runner.harness")).childProcessMock(h, await importOriginal<typeof import("node:child_process")>()),
);

let runner: typeof import("./runner");
let cwd: string;
const addCard = (over: Partial<Card> = {}) => makeCard(h, cwd, over);
const card = (id: string) => h.cards.get(id) as Card;

beforeEach(async () => {
  cwd = resetHarness(h);
  vi.resetModules();
  hold.fn.mockReset().mockReturnValue(false);
  skills.fn.mockReset().mockReturnValue([]);
  shellContext.fn.mockReset().mockImplementation((_id, cli) => cli);
  runner = await import("./runner");
}, 30_000);

afterEach(async () => {
  for (const q of h.queries) q.options.abortController.abort();
  await flush(2);
});

describe("sendMessage while a restart is armed", () => {
  it("asks holdForRestart with the text and whether to echo, after the card lookup", () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "hello", { echo: false });
    expect(hold.fn).toHaveBeenCalledWith("c1", "hello", { echo: false });
    expect(() => runner.sendMessage("nope", "x")).toThrow(/No such card/);
    expect(hold.fn).toHaveBeenCalledTimes(1);
  });

  it("starts no turn for a held message: not busy, no CLI, no thread echo", async () => {
    addCard({ id: "c1", column: "review" });
    hold.fn.mockReturnValue(true);
    runner.sendMessage("c1", "hello");
    await flush();
    expect(hold.fn).toHaveBeenCalledWith("c1", "hello", { echo: true });
    expect(runner.isBusy("c1")).toBe(false);
    expect(h.queries).toEqual([]);
    expect(h.threads.get("c1") ?? []).toEqual([]);
    expect(card("c1").column).toBe("review");
    expect(card("c1").lastLine).toBeUndefined();
  });

  it("lets the error from a refused hold (the copilot, a re-run) reach the caller", () => {
    addCard({ id: "c1" });
    hold.fn.mockImplementation(() => {
      throw new Error("held");
    });
    expect(() => runner.sendMessage("c1", "hello")).toThrow("held");
    expect(h.queries).toEqual([]);
  });

  it("sends as usual when nothing is armed", async () => {
    addCard({ id: "c1" });
    runner.sendMessage("c1", "hello");
    await flush();
    expect(runner.isBusy("c1")).toBe(true);
    expect(h.queries[0]?.received).toEqual(["hello"]);
    expect(h.threads.get("c1")).toEqual([expect.objectContaining({ kind: "user", text: "hello" })]);
  });
});

describe("sendUserMessage while a restart is armed", () => {
  it("holds the message before its shell output and skills are taken", async () => {
    addCard({ id: "c1", column: "review" });
    skills.fn.mockReturnValue(["weft:preview"]);
    hold.fn.mockReturnValue(true);
    runner.sendUserMessage("c1", "/done");
    await flush();
    expect(hold.fn).toHaveBeenCalledWith("c1", "/done");
    expect(shellContext.fn).not.toHaveBeenCalled();
    expect(skills.fn).not.toHaveBeenCalled();
    expect(h.queries).toEqual([]);
    expect(h.threads.get("c1") ?? []).toEqual([]);
    expect(runner.isBusy("c1")).toBe(false);
    expect(card("c1").promptSkills).toBeUndefined();
    expect(card("c1").wrappingUp).toBeUndefined();
    expect(card("c1").archived).toBeUndefined();
  });

  it("passes the shell context and skills through when nothing is armed", async () => {
    addCard({ id: "c1" });
    skills.fn.mockReturnValue(["weft:preview"]);
    shellContext.fn.mockImplementation((_id, cli) => `SHELL ${cli}`);
    runner.sendUserMessage("c1", "make a page");
    await flush();
    expect(hold.fn).toHaveBeenCalledWith("c1", "make a page");
    expect(h.queries[0]?.received).toEqual(["SHELL make a page"]);
    expect(card("c1").promptSkills).toEqual(["weft:preview"]);
  });

  it("throws for an unknown card before asking", () => {
    expect(() => runner.sendUserMessage("nope", "x")).toThrow(/No such card/);
    expect(hold.fn).not.toHaveBeenCalled();
  });
});
