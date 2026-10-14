import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { claimHooks } from "./claim-guard";
import { GIT_GUARD_MATCHER } from "./git-guard";
import { IMPORT_GUARD_MATCHER } from "./import-check";
import { restartGuardMatcher } from "./restart-guard";
import { ROUTE_IMPORT_GUARD_MATCHER } from "./route-import-guard";
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
// What Weft's own `next dev` sets in its process, and the NEXT_PUBLIC_ values it loads from Weft's .env:
// a thread's shell should look like your terminal. NODE_ENV=development breaks `next build` in any other
// project (its prerender fails), and PORT would point a thread's dev server at Weft's own port. Your own
// Next settings, like NEXT_TELEMETRY_DISABLED, stay.
const NEXT_SERVER = /^(NODE_ENV|PORT|NEXT_RUNTIME|NEXT_DEPLOYMENT_ID)$|^(__NEXT_|NEXT_PRIVATE_|NEXT_PUBLIC_|NEXT_CPU_PROF|NEXT_TURBOPACK_|TURBOPACK|WATCHPACK_)/;
// Your own secrets: Weft starts from your login shell's env, so a key exported in ~/.zshrc would reach
// every thread, where `node -e` can print it past the guard. A name that sounds secret goes, and so does
// any value that looks like a key (lib/secret-detect.ts), except what the CLIs sign in with. A command
// that needs one gets it from the vault through mcp__secrets__run.
const SECRET_NAME = /(^|_)(KEYS?|TOKENS?|SECRETS?|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|PRIVATE|PAT|DSN)(_|$)|(^|_)DATABASE_URL$/i;
const CLI_SIGN_IN = /^(ANTHROPIC_|PUKU_)|^CODEX_API_KEY$/;

function isSecretVar(key: string, value: string | undefined): boolean {
  if (CLI_SIGN_IN.test(key)) return false;
  return SECRET_NAME.test(key) || (value !== undefined && findSecret(value) !== null);
}

export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const insideClaude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_DESKTOP_APP_VERSION);
  for (const [key, value] of Object.entries(env)) if (INHERITED.test(key) || INTERNAL.test(key) || NEXT_SERVER.test(key) || isSecretVar(key, value)) Reflect.deleteProperty(env, key);
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
// work, the one that refuses an edit making a route file import a module that isn't there yet, the one that
// reports an edit breaking an import, and symbol claims, which ask before an edit to what
// another busy card is editing (cardId names the session's card, once it has one).
export function guardedCli(otherTurns: () => number, cardId: () => string | undefined): Pick<Options, "env" | "hooks"> {
  const claims = claimHooks(cardId);
  return {
    env: cliEnv(),
    hooks: {
      PreToolUse: [SECRET_GUARD_MATCHER, restartGuardMatcher(otherTurns), GIT_GUARD_MATCHER, ROUTE_IMPORT_GUARD_MATCHER, claims.pre],
      PostToolUse: [IMPORT_GUARD_MATCHER, claims.post],
    },
  };
}
