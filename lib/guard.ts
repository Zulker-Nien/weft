import crypto from "node:crypto";
import { shellToken } from "./shell-token";

// The API can start agents with shell access, so only this machine's own pages may call it.
// The Host check blocks DNS rebinding; the custom header makes cross-site POSTs fail CORS preflight.
// `sensitive` reads (account, settings, services…) also need the launch's token, which the desktop app adds to the
// board window's own requests (electron/api-token.cjs); a process that only reaches the port can't read them.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hasToken(req: Request): boolean {
  const want = shellToken();
  if (!want) return true; // not the desktop app (dev in a browser, tests): no token exists
  const got = req.headers.get("x-weft-token") ?? "";
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function guard(req: Request, { write = true, sensitive = false } = {}): Response | null {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return Response.json({ error: "Forbidden host" }, { status: 403 });
  if (write && req.headers.get("x-threadboard") !== "1") {
    return Response.json({ error: "Missing x-threadboard header" }, { status: 403 });
  }
  if (sensitive && !hasToken(req)) return Response.json({ error: "Missing token" }, { status: 403 });
  return null;
}

export function fail(err: unknown, status = 400) {
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}
