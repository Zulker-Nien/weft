import { createHash } from "node:crypto";
import { COPILOT_PROMPT } from "./board-tools";
import { BROWSER_PROMPT } from "./browser-tools";
import { RESTART_PROMPT } from "./env";
import { REVIEW_PROMPT } from "./review";
import { SECRETS_PROMPT } from "./secret-tools";
import { DEFAULT_THREAD_PROMPT, subagentModel, threadPrompt } from "./settings";
import { CHOOSE, DELEGATE, subagentPrompt } from "./subagents";
import { WEBHOOKS_PROMPT } from "./webhook-tools";
import type { Backend } from "./types";

// Everything Weft adds to a thread's system prompt, in one place. The CLI reads its system prompt only
// when it starts, so the content of these strings counts toward the runner's build (lib/runner-session.ts
// currentBuild()): editing one replaces idle sessions instead of leaving them on the old text.

// Where Weft's identity and conventions live, so a thread can find them even if a later refactor drops a piece of this prompt.
export const WEFT_SOUL_PROMPT = `This system prompt comes from Weft. Who Weft is and how it works are written down in SOUL.md and AGENTS.md at the root of Weft's own repo; when you work there, they are the source of truth for Weft's identity and conventions. In any project, read its own CLAUDE.md, AGENTS.md and SOUL.md when present.`;

export const WEFT_PINNED_PROMPTS = {
  WEFT_SOUL_PROMPT,
  BROWSER_PROMPT,
  COPILOT_PROMPT,
  SECRETS_PROMPT,
  WEBHOOKS_PROMPT,
  RESTART_PROMPT,
  DEFAULT_THREAD_PROMPT,
  REVIEW_PROMPT,
  SUBAGENT_PROMPT: DELEGATE,
  SUBAGENT_CHOOSE_PROMPT: CHOOSE,
} as const;

const sha = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 12);

// The pinned strings are constants, so their hash is taken once per load of this module.
const PINNED = sha(Object.entries(WEFT_PINNED_PROMPTS).map(([name, text]) => `${name}\n${text}`).join("\n\0\n"));

export function pinnedPromptsHash() {
  return PINNED;
}

// The pinned prompts plus the settings the prompt is built from (thread instructions, subagent model).
export function promptsBuild() {
  return `${PINNED}:${sha(`${threadPrompt()}\n${subagentModel()}`)}`;
}

export type PromptSpec = { backend: Backend; copilot?: boolean };

const built = new Map<string, string>();

// Weft's part of the system prompt. Puku's gateway drops it, so a puku session sends it in its first message (lib/puku-context.ts).
export function weftSystemPrompt(spec: PromptSpec): string {
  const key = `${promptsBuild()}|${spec.copilot ? "copilot" : spec.backend}`;
  const cached = built.get(key);
  if (cached !== undefined) return cached;
  const parts = spec.copilot
    ? [WEFT_SOUL_PROMPT, BROWSER_PROMPT, COPILOT_PROMPT]
    : [WEFT_SOUL_PROMPT, BROWSER_PROMPT, SECRETS_PROMPT, WEBHOOKS_PROMPT, RESTART_PROMPT, subagentPrompt(subagentModel(), spec.backend), threadPrompt(), REVIEW_PROMPT];
  // A settings change makes a new key; the old prompts are of no further use.
  if (built.size >= 8) built.clear();
  const text = parts.join("\n\n");
  built.set(key, text);
  return text;
}
