// The environment for the CLIs Weft starts. When Weft itself was started from inside a Claude Code
// session (the Claude app's terminal, say), it inherits that session's variables — its session id,
// messaging socket, entrypoint — and its CLIs would act as that session's children. Strip them, and
// mark Weft's sessions as SDK sessions so they stay out of other apps' session lists.
const INHERITED = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/;

export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const insideClaude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_DESKTOP_APP_VERSION);
  for (const key of Object.keys(env)) if (INHERITED.test(key)) Reflect.deleteProperty(env, key);
  // The Claude app routes its own sessions through a local proxy; that address isn't ours to use.
  if (insideClaude) delete env.ANTHROPIC_BASE_URL;
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  return env;
}
