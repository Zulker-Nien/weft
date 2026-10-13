import type { Backend } from "./types";

// Subagents: when a board thread should hand work to the Agent tool, and on which model. The user picks
// the model in Settings ("Use … for subagents"); "choose" leaves it to the thread, with a short guide.
// A fixed pick goes to the Claude Code CLI as CLAUDE_CODE_SUBAGENT_MODEL plus _FORCE, which drops the
// Agent tool's model input and overrides agent definitions, so every subagent runs on it.

export const SUBAGENT_MODELS = ["choose", "haiku", "sonnet", "opus", "inherit"] as const;
export type SubagentModel = (typeof SUBAGENT_MODELS)[number];

export const SUBAGENT_MODEL_LABELS: Record<SubagentModel, string> = {
  choose: "Let the model choose",
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  inherit: "Same model as the thread",
};

export function isSubagentModel(value: unknown): value is SubagentModel {
  return typeof value === "string" && (SUBAGENT_MODELS as readonly string[]).includes(value);
}

const DELEGATE = `Use subagents (the Agent tool) more than you'd think: their file reads and long outputs stay out of this thread's context, and several run at once. Delegate when answering means reading across many files (the Explore agent), when the task splits into independent pieces (send them in one message so they run in parallel), for a test, lint or typecheck run where you only need the failures, and for a second-opinion review of a change you made. Do a single known lookup (one file, one grep) yourself. Give each subagent a self-contained prompt that says what to report back, and relay what matters: the user doesn't see its report.`;

const CHOOSE = `Pick each subagent's model with the Agent tool's model input:
- haiku: searches, file lookups, summarizing logs or test output, mechanical edits from a precise spec. Fast and cheap; the default for read-only fan-out.
- sonnet: most coding work: a well-scoped change, writing tests, a code review, research that needs judgment.
- opus: hard reasoning where a mistake is costly: architecture, subtle bugs, security review, a plan others will build from.
When unsure, pick sonnet.`;

// The model guide and the env only apply to Claude Code; puku-cli has its own model names.
export function subagentPrompt(model: SubagentModel, backend: Backend): string {
  if (backend !== "claude") return DELEGATE;
  if (model === "choose") return `${DELEGATE}\n\n${CHOOSE}`;
  const which = model === "inherit" ? "the same model as this thread" : SUBAGENT_MODEL_LABELS[model];
  return `${DELEGATE}\n\nSubagents run on ${which} (the user's Weft setting), so leave the Agent tool's model input out.`;
}

export function subagentEnv(model: SubagentModel, backend: Backend): Record<string, string> {
  if (backend !== "claude" || model === "choose") return {};
  return { CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" };
}
