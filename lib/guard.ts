// The API can start agents with shell access, so only this machine's own pages may call it.
// The Host check blocks DNS rebinding; the custom header makes cross-site POSTs fail CORS preflight.
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function guard(req: Request, { write = true } = {}): Response | null {
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!LOCAL_HOSTS.has(host)) return Response.json({ error: "Forbidden host" }, { status: 403 });
  if (write && req.headers.get("x-threadboard") !== "1") {
    return Response.json({ error: "Missing x-threadboard header" }, { status: 403 });
  }
  return null;
}

export function fail(err: unknown, status = 400) {
  return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}
