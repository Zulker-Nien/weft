import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { IMPORT_GUARD_HOOKS } from "./import-check";
import { restartGuardMatcher } from "./restart-guard";
import { SECRET_GUARD_MATCHER } from "./secret-guard";

// The environment for the CLIs Weft starts. When Weft itself was started from inside a Claude Code
// session (the Claude app's terminal, say), it inherits that session's variables — its session id,
// messaging socket, entrypoint — and its CLIs would act as that session's children. Strip them, and
// mark Weft's sessions as SDK sessions so they stay out of other apps' session lists.
const INHERITED = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/;
// Weft's own keys, which the server needs and its CLIs mustn't see: the browser pane's control-server
// token (any thread holding it could drive the pane without Weft's tools). Every CLI gets this env, so
// nothing secret may live in the server's environment unless it's stripped here
// (docs/architecture/secrets.md).
const INTERNAL = /^THREADBOARD_SHELL_/;

export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const insideClaude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_DESKTOP_APP_VERSION);
  for (const key of Object.keys(env)) if (INHERITED.test(key) || INTERNAL.test(key)) Reflect.deleteProperty(env, key);
  // The Claude app routes its own sessions through a local proxy; that address isn't ours to use.
  if (insideClaude) delete env.ANTHROPIC_BASE_URL;
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  return env;
}

// The thread prompt's line that goes with the restart guard below.
export { RESTART_PROMPT } from "./restart-guard";

// What a board thread's CLI is started with: that env, the hook that turns away reads of .env files and
// environment dumps in every permission mode, the one that won't restart Weft while other cards' turns
// run (otherTurns counts them), and the one that reports an edit breaking an import.
export function guardedCli(otherTurns: () => number): Pick<Options, "env" | "hooks"> {
  return { env: cliEnv(), hooks: { PreToolUse: [SECRET_GUARD_MATCHER, restartGuardMatcher(otherTurns)], ...IMPORT_GUARD_HOOKS } };
}
