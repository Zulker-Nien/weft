import { afterEach, describe, expect, it, vi } from "vitest";
import { cliEnv } from "./env";

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
