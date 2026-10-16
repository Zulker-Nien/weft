// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { BRIDGE_TOKEN_ENV, bridgeServer, bridgeToken, codexMcpArgs, openBridge } from "./mcp-bridge";

const servers = () => ({ browser: createSdkMcpServer({ name: "browser", version: "0.1.0", tools: [] }) });

describe("openBridge", () => {
  it("gives a turn its own token that serves a fresh server per ask, until closed", () => {
    const a = openBridge(servers);
    const b = openBridge(servers);
    expect(a.token).not.toBe(b.token);
    const first = bridgeServer(a.token, "browser");
    expect(first).toBeDefined();
    expect(bridgeServer(a.token, "browser")).not.toBe(first);
    expect(bridgeServer(a.token, "nope")).toBeUndefined();
    a.close();
    expect(bridgeServer(a.token, "browser")).toBeUndefined();
    expect(bridgeServer(b.token, "browser")).toBeDefined();
    b.close();
  });
});

describe("bridgeToken", () => {
  it("reads a bearer token", () => {
    expect(bridgeToken("Bearer abc_-1")).toBe("abc_-1");
  });

  it.each([null, "", "abc", "Basic abc", "Bearer a b"])("refuses %j", (value) => {
    expect(bridgeToken(value)).toBeUndefined();
  });
});

describe("codexMcpArgs", () => {
  it("points each server at its route with the token read from the environment", () => {
    const args = codexMcpArgs("http://127.0.0.1:1024", ["browser", "board"]);
    expect(args.filter((a) => a === "--config")).toHaveLength(8);
    expect(args).toContain('mcp_servers.browser.url="http://127.0.0.1:1024/api/mcp/browser"');
    expect(args).toContain('mcp_servers.board.url="http://127.0.0.1:1024/api/mcp/board"');
    expect(args).toContain(`mcp_servers.browser.bearer_token_env_var="${BRIDGE_TOKEN_ENV}"`);
    expect(args).toContain('mcp_servers.board.default_tools_approval_mode="approve"');
    // The token itself never goes on the command line.
    const turn = openBridge(servers);
    expect(args.join(" ")).not.toContain(turn.token);
    turn.close();
  });

  it("is empty without servers", () => {
    expect(codexMcpArgs("http://x", [])).toEqual([]);
  });
});
