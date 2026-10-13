import { describe, expect, it } from "vitest";
import { isSubagentModel, subagentEnv, subagentPrompt, SUBAGENT_MODELS, SUBAGENT_MODEL_LABELS } from "./subagents";

describe("subagents", () => {
  it("knows its models, each with a label", () => {
    expect(SUBAGENT_MODELS.every((m) => isSubagentModel(m) && SUBAGENT_MODEL_LABELS[m])).toBe(true);
    expect(isSubagentModel("gpt")).toBe(false);
    expect(isSubagentModel(undefined)).toBe(false);
  });

  it("asks a Claude thread to delegate and, when it chooses, how to pick the model", () => {
    const choose = subagentPrompt("choose", "claude");
    expect(choose).toMatch(/^Use subagents/);
    expect(choose).toMatch(/haiku:[\s\S]*sonnet:[\s\S]*opus:/);
    expect(subagentPrompt("opus", "claude")).toContain("Subagents run on Opus (the user's Weft setting)");
    expect(subagentPrompt("inherit", "claude")).toContain("Subagents run on the same model as this thread");
    expect(subagentPrompt("opus", "claude")).not.toContain("haiku:");
  });

  it("gives puku-cli only the delegation advice, since its model names differ", () => {
    expect(subagentPrompt("haiku", "puku")).toBe(subagentPrompt("choose", "puku"));
    expect(subagentPrompt("choose", "puku")).not.toContain("model");
  });

  it("forces a picked model through the CLI's env, and leaves the choice alone otherwise", () => {
    expect(subagentEnv("sonnet", "claude")).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect(subagentEnv("inherit", "claude")).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "inherit", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" });
    expect(subagentEnv("choose", "claude")).toEqual({});
    expect(subagentEnv("sonnet", "puku")).toEqual({});
  });
});
