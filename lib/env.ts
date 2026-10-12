import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { GIT_GUARD_MATCHER } from "./git-guard";
import { IMPORT_GUARD_HOOKS } from "./import-check";
import { restartGuardMatcher } from "./restart-guard";
import { findSecret } from "./secret-detect";
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
// Your own secrets: Weft starts from your login shell's env, so a key exported in ~/.zshrc would reach
// every thread, where `node -e` can print it past the guard. A name that sounds secret goes, and so does
// any value that looks like a key (lib/secret-detect.ts), except what the CLIs sign in with. A command
// that needs one gets it from the vault through mcp__secrets__run.
const SECRET_NAME = /(^|_)(KEYS?|TOKENS?|SECRETS?|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|PRIVATE|PAT|DSN)(_|$)|(^|_)DATABASE_URL$/i;
const CLI_SIGN_IN = /^(ANTHROPIC_|PUKU_)/;

function isSecretVar(key: string, value: string | undefined): boolean {
  if (CLI_SIGN_IN.test(key)) return false;
  return SECRET_NAME.test(key) || (value !== undefined && findSecret(value) !== null);
}

export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const insideClaude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_DESKTOP_APP_VERSION);
  for (const [key, value] of Object.entries(env)) if (INHERITED.test(key) || INTERNAL.test(key) || isSecretVar(key, value)) Reflect.deleteProperty(env, key);
  // The Claude app routes its own sessions through a local proxy; that address isn't ours to use.
  if (insideClaude) delete env.ANTHROPIC_BASE_URL;
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  return env;
}

// The thread prompt's line that goes with the restart guard below.
export { RESTART_PROMPT } from "./restart-guard";

// What a board thread's CLI is started with: that env, the hook that turns away reads of .env files and
// environment dumps in every permission mode, the one that won't restart Weft while other cards' turns
// run (otherTurns counts them), the one that won't stash, reset --hard or clean away other cards' uncommitted
// work, and the one that reports an edit breaking an import.
export function guardedCli(otherTurns: () => number): Pick<Options, "env" | "hooks"> {
  return { env: cliEnv(), hooks: { PreToolUse: [SECRET_GUARD_MATCHER, restartGuardMatcher(otherTurns), GIT_GUARD_MATCHER], ...IMPORT_GUARD_HOOKS } };
}
