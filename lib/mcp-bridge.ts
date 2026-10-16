import { randomBytes } from "node:crypto";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { globalSingleton } from "./global-singleton";

// Codex can't take Weft's MCP servers in-process the way Claude Code and puku-cli do, so it reaches them over
// HTTP: app/api/mcp/[server] serves the same tools to a Codex turn that holds that turn's token. The token
// stands for one turn of one card and is dropped when the process ends; it travels in the process's
// environment (WEFT_MCP_TOKEN, which Codex's shell policy hides from commands), never on its command line.
export type WeftServers = Record<string, McpSdkServerConfigWithInstance>;

// The registry sits on globalThis because each API route can load its own copy of these modules, while the
// runner that opens a bridge lives in another.
const bridges = globalSingleton("__weftMcpBridges", () => new Map<string, () => WeftServers>());

export const BRIDGE_TOKEN_ENV = "WEFT_MCP_TOKEN";

// `servers` builds fresh ones each call (an MCP server instance serves one connection).
export function openBridge(servers: () => WeftServers): { token: string; close: () => void } {
  const token = randomBytes(24).toString("base64url");
  bridges.set(token, servers);
  return { token, close: () => void bridges.delete(token) };
}

// A fresh instance of one of the turn's servers, or undefined for an unknown token or server.
export function bridgeServer(token: string, name: string) {
  return bridges.get(token)?.()[name]?.instance;
}

export function bridgeToken(authorization: string | null) {
  return /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
}

// The `codex exec --config` pairs that make each of the turn's servers one of Codex's MCP servers.
// Approval is "approve" because `codex exec` has nobody to ask; the tools that need the user (a vault fill) ask
// through Weft themselves.
export function codexMcpArgs(origin: string, names: string[]): string[] {
  return names.flatMap((name) => {
    const key = `mcp_servers.${name}`;
    return [
      ["url", JSON.stringify(`${origin}/api/mcp/${name}`)],
      ["bearer_token_env_var", JSON.stringify(BRIDGE_TOKEN_ENV)],
      ["default_tools_approval_mode", JSON.stringify("approve")],
      ["tool_timeout_sec", "600"],
    ].flatMap(([field, value]) => ["--config", `${key}.${field}=${value}`]);
  });
}
