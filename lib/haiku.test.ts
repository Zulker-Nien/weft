import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ messages: [] as unknown[], calls: [] as unknown[] }));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (args: unknown) => {
    sdk.calls.push(args);
    return (function* () {
      yield* sdk.messages;
    })();
  },
}));

const { complete } = await import("./haiku");

beforeEach(() => {
  sdk.messages = [];
  sdk.calls = [];
});

describe("complete", () => {
  it("runs one bare Haiku turn: no tools, settings, MCP or session file", async () => {
    sdk.messages = [{ type: "result", subtype: "success", result: "hi" }];
    await complete("say hi");
    expect(sdk.calls).toEqual([
      {
        prompt: "say hi",
        options: { model: "haiku", tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, maxTurns: 1 },
      },
    ]);
  });

  it("returns the successful result's text, ignoring other messages", async () => {
    sdk.messages = [
      { type: "system", subtype: "init" },
      { type: "assistant", message: { content: [{ type: "text", text: "draft" }] } },
      { type: "result", subtype: "success", result: "final answer" },
    ];
    await expect(complete("q")).resolves.toBe("final answer");
  });

  it("returns an empty string when the turn ends in an error result", async () => {
    sdk.messages = [{ type: "result", subtype: "error_max_turns" }];
    await expect(complete("q")).resolves.toBe("");
  });

  it("returns an empty string when no result arrives", async () => {
    await expect(complete("q")).resolves.toBe("");
  });
});
