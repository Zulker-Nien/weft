import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { bridgeServer, bridgeToken } from "@/lib/mcp-bridge";

// Weft's tools for a Codex turn, as a streamable-HTTP MCP server (lib/mcp-bridge.ts). Not the guard()'s
// x-threadboard header: Codex isn't a page, and the turn's bearer token is what says whose tools these are.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function deny(status: number, error: string) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: error }, id: null }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ server: string }> }) {
  if (!LOCAL_HOSTS.has((req.headers.get("host") ?? "").replace(/:\d+$/, ""))) return deny(403, "Forbidden host");
  const token = bridgeToken(req.headers.get("authorization"));
  const { server: name } = await params;
  const server = token ? bridgeServer(token, name) : undefined;
  if (!server) return deny(401, "Unknown token or server");
  try {
    // Stateless: one server and transport per request, answered as plain JSON rather than a stream.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    return deny(500, err instanceof Error ? err.message : String(err));
  }
}

// The spec lets a server decline the optional GET stream and the DELETE that ends a session.
export const GET = () => deny(405, "Method not allowed");
export const DELETE = GET;
