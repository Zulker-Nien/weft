import { afterEach, describe, expect, it, vi } from "vitest";
import { cliEnv, guardedCli } from "./env";
import { GIT_GUARD_MATCHER } from "./git-guard";
import { IMPORT_GUARD_HOOKS } from "./import-check";
import { SECRET_GUARD_MATCHER } from "./secret-guard";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cliEnv", () => {
  it("strips a parent Claude Code session's variables and marks the CLI as an SDK session", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_SSE_PORT", "1234");
    vi.stubEnv("CLAUDE_AGENT_SDK_VERSION", "0.1");
    vi.stubEnv("CLAUDE_PID", "42");
    vi.stubEnv("CLAUDE_EFFORT", "high");
    vi.stubEnv("CLAUDE_PREVIEW_URL", "http://x");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");

    const env = cliEnv();

    for (const key of ["CLAUDECODE", "CLAUDE_CODE_SSE_PORT", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_PREVIEW_URL"]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-ts");
  });

  it("strips Weft's own keys, like the browser pane's control-server token", () => {
    vi.stubEnv("THREADBOARD_SHELL_URL", "http://127.0.0.1:5000");
    vi.stubEnv("THREADBOARD_SHELL_TOKEN", "secret");
    vi.stubEnv("THREADBOARD_DATA", "/tmp/weft");

    const env = cliEnv();

    expect(env).not.toHaveProperty("THREADBOARD_SHELL_URL");
    expect(env).not.toHaveProperty("THREADBOARD_SHELL_TOKEN");
    expect(env.THREADBOARD_DATA).toBe("/tmp/weft");
  });

  it("keeps unrelated and look-alike variables", () => {
    vi.stubEnv("CLAUDE_CONFIG_DIR", "/tmp/claude");
    vi.stubEnv("CLAUDE_PIDS", "keep");
    vi.stubEnv("CLAUDECODE_EXTRA", "keep");
    vi.stubEnv("PATH", "/usr/bin");

    const env = cliEnv();

    expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/claude");
    expect(env.CLAUDE_PIDS).toBe("keep");
    expect(env.CLAUDECODE_EXTRA).toBe("keep");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("drops ANTHROPIC_BASE_URL when started inside Claude Code", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9999");
    expect(cliEnv()).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("drops ANTHROPIC_BASE_URL when started from the Claude desktop app", () => {
    vi.stubEnv("CLAUDECODE", "");
    vi.stubEnv("CLAUDE_CODE_DESKTOP_APP_VERSION", "1.2.3");
    vi.stubEnv("ANTHROPIC_BASE_URL", "http://127.0.0.1:9999");
    expect(cliEnv()).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("keeps the user's own ANTHROPIC_BASE_URL outside Claude", () => {
    vi.stubEnv("CLAUDECODE", "");
    vi.stubEnv("CLAUDE_CODE_DESKTOP_APP_VERSION", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://proxy.example.com");
    expect(cliEnv().ANTHROPIC_BASE_URL).toBe("https://proxy.example.com");
  });

  it("returns a copy and leaves process.env alone", () => {
    vi.stubEnv("CLAUDECODE", "1");
    vi.stubEnv("CLAUDE_CODE_ENTRYPOINT", "cli");
    const env = cliEnv();
    expect(env).not.toBe(process.env);
    expect(process.env.CLAUDECODE).toBe("1");
    expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe("cli");
  });
});

describe("guardedCli", () => {
  it("starts a thread with the stripped env, the secret guard, the restart guard, the git guard and the import guard", () => {
    vi.stubEnv("THREADBOARD_SHELL_TOKEN", "secret");
    const opts = guardedCli(() => 0);
    expect(opts.env).not.toHaveProperty("THREADBOARD_SHELL_TOKEN");
    expect(opts.hooks?.PostToolUse).toEqual(IMPORT_GUARD_HOOKS.PostToolUse);
    const pre = opts.hooks?.PreToolUse ?? [];
    expect(pre[0]).toBe(SECRET_GUARD_MATCHER);
    expect(pre[1]?.matcher).toBe("Bash");
    expect(pre[2]).toBe(GIT_GUARD_MATCHER);
  });

  it("counts other cards' turns with the function it's given", async () => {
    vi.stubEnv("PORT", "1000");
    const others = vi.fn(() => 2);
    const hook = guardedCli(others).hooks?.PreToolUse?.[1]?.hooks[0];
    const input = { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "lsof -ti :1000 | xargs kill" }, cwd: "/tmp" };
    const out = await hook?.(input as never, undefined, { signal: new AbortController().signal });
    expect(others).toHaveBeenCalled();
    expect(JSON.stringify(out)).toContain("2 other turns");
  });
});
