// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { openBridge } from "@/lib/mcp-bridge";
import { DELETE, GET, POST } from "./mcp/[server]/route";

// /api/mcp/[server]: Weft's tools for a Codex turn over streamable HTTP, behind the turn's bearer token.
const bridge = openBridge(() => ({
  probe: createSdkMcpServer({
    name: "probe",
    version: "0.1.0",
    tools: [tool("ping", "pong", { word: z.string() }, ({ word }) => Promise.resolve({ content: [{ type: "text" as const, text: `pong ${word}` }] }))],
  }),
}));

function call(body: unknown, { token = bridge.token, host = "127.0.0.1:1024", server = "probe" } = {}) {
  const headers: Record<string, string> = { host, "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  return POST(new Request(`http://${host}/api/mcp/${server}`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ server }) });
}
type Reply = { result: { serverInfo: { name: string }; tools: { name: string }[]; content: { text: string }[] } };
const reply = async (res: Response) => (await res.json()) as Reply;
const rpc = (method: string, params: unknown, id = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("POST /api/mcp/[server]", () => {
  it("answers initialize, lists the tools and runs one", async () => {
    const init = await call(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    expect(init.status).toBe(200);
    expect((await reply(init)).result.serverInfo.name).toBe("probe");
    const list = await reply(await call(rpc("tools/list", {}, 2)));
    expect(list.result.tools.map((t) => t.name)).toEqual(["ping"]);
    const ran = await reply(await call(rpc("tools/call", { name: "ping", arguments: { word: "weft" } }, 3)));
    expect(ran.result.content[0]?.text).toBe("pong weft");
  });

  it("turns away a host that isn't this machine", async () => {
    expect((await call(rpc("tools/list", {}), { host: "evil.example" })).status).toBe(403);
  });

  it.each([["no token", { token: "" }], ["a wrong token", { token: "nope" }], ["an unknown server", { server: "secrets" }]])("401s %s", async (_name, options) => {
    expect((await call(rpc("tools/list", {}), options)).status).toBe(401);
  });

  it("401s once the turn's bridge is closed", async () => {
    const turn = openBridge(() => ({}));
    turn.close();
    expect((await call(rpc("tools/list", {}), { token: turn.token })).status).toBe(401);
  });

  it("declines GET and DELETE, which the protocol makes optional", () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });
});
