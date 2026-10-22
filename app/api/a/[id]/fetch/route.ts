// POST /api/a/<id>/fetch — a hosted mini app's weft.fetch: the gated fetch that puts secret values in by
// reference (lib/app-bridge.ts, docs/architecture/mini-app-hosting.md). One AppFetchRequest in, one
// AppFetchResult out (or { error }). The gate, the rate limit and the runFetch are the three layers
// between the request and the network, run by lib/app-route-pipeline.ts; the runFetch is electron/app-fetch-run.cjs
// loaded through a dynamic import (CommonJS) so the same module the Mac uses answers weft.zip too.
// A viewer-secret check runs before the rate limit and the secret store so an anonymous visitor on a
// public share never reaches cloud_app_secrets. Refusals (400/403/409/429) answer { error, status }.
import { connection } from "next/server";
import dns from "node:dns";
import type { AppFetchRequest, AppFetchResult } from "@/lib/app-bridge";
import { gateShare, parseBoundedBody, rateLimitGuard, reject, requireService, resolveValues, runLogged } from "@/lib/app-route-pipeline";
import { splitByManifest } from "@/lib/app-secret-store";
import { webUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 1 * 1024 * 1024;

// The host + path for the cloud_app_fetches row. path is the URL's pathname (no query — those may carry a
// secret placeholder, never logged). An unparseable URL lands as empty strings so the log row never crashes.
function splitPathForLog(url: string): { host: string; path: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { host: "", path: "" };
  }
  return { host: parsed.hostname.toLowerCase(), path: parsed.pathname };
}

// The body the page posts, bounded at MAX_BODY_BYTES and shaped as an AppFetchRequest.
async function parseBody(req: Request): Promise<AppFetchRequest | Response> {
  const parsed = await parseBoundedBody(req, MAX_BODY_BYTES);
  if (parsed instanceof Response) return parsed;
  return parseFetchRequest(parsed.body) ?? reject(400, "request shape isn't valid.");
}

// The fetch handler: the shared pipeline (lib/app-route-pipeline.ts) with two middlewares, this route's
// parser and runFetch. One step of its own: the viewer-secret check runs before the rate limit and the
// secret store, so an anonymous visitor on a public share never reaches cloud_app_secrets.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  const request = await parseBody(req);
  if (request instanceof Response) return request;
  return handleFetch(req, id, request);
}

async function handleFetch(req: Request, id: string, request: AppFetchRequest): Promise<Response> {
  const share = await gateShare(id);
  if (share instanceof Response) return share;
  const service = requireService();
  if (service instanceof Response) return service;

  const viewer = await webUser();
  const viewerId = viewer?.id ?? null;
  const names = secretNamesForRequest(request);
  const secrets = (share.manifest as { secrets?: Record<string, { from?: "viewer" | "author" }> } | null)?.secrets ?? null;
  const split = splitByManifest(names, secrets);
  // A request that names a viewer-provided secret must belong to a signed-in viewer, on any share
  // mode including public.
  if (split.viewer.length > 0 && !viewer) return reject(401, "sign in to provide your value for this app.");

  const attempt = { shareId: id, viewerId, method: request.method, ...splitPathForLog(request.url) };
  const limited = await rateLimitGuard(service, req, attempt);
  if (limited) return limited;
  const values = await resolveValues(service, id, names, split, viewerId);
  if (values instanceof Response) return values;
  return runLogged(service, attempt, async () => {
    // Lazy-load the cjs runFetch so the route module is a thin shim until it's actually called.
    const { runFetch } = await loadRunFetch();
    const result = await runFetch({
      policy: share.manifest,
      request,
      getValues: () => Promise.resolve(values),
      fetch: globalThis.fetch.bind(globalThis),
      lookup: (hostname, options, callback) => {
        // dns.lookup has many overloads; the policy module passes us a (hostname, options, callback)
        // tuple, so we forward with `any` on the options boundary.
        dns.lookup(hostname, options as dns.LookupOptions, callback);
      },
    });
    return { status: result.status, body: result satisfies AppFetchResult };
  });
}

// Lazy import of the Mac's cjs runFetch + secretNames. The dynamic import keeps app/api/a/[id]/fetch/route.ts
// out of the Next.js server bundle's startup path: a route is only loaded on a real request. The first
// import resolves and caches the module for subsequent calls.
type LookupAddress = { address: string; family: number };
type LookupFn = (
  hostname: string,
  options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress | LookupAddress[], family?: number) => void,
) => void;
type RunFetch = (input: {
  policy: unknown;
  request: AppFetchRequest;
  getValues: (names: string[]) => Promise<Record<string, string>>;
  fetch: typeof fetch;
  lookup: LookupFn;
  timeoutMs?: number;
  maxBytes?: number;
}) => Promise<AppFetchResult>;
type NamesFn = (request: AppFetchRequest) => string[];

let cached: { runFetch: RunFetch; secretNames: NamesFn } | null = null;

async function loadRunFetch(): Promise<{ runFetch: RunFetch; secretNames: NamesFn }> {
  if (cached) return cached;
  const policy = await import("../../../../../electron/app-fetch-policy.cjs");
  const runner = await import("../../../../../electron/app-fetch-run.cjs");
  cached = {
    runFetch: (runner as { runFetch: RunFetch }).runFetch,
    secretNames: (policy as { secretNames: NamesFn }).secretNames,
  };
  return cached;
}

// The placeholder names in the request, in the order they appear, deduped. The same regex the policy's
// secretNames uses — the cache may be empty on the first call, in which case we re-derive.
function secretNamesForRequest(request: AppFetchRequest): string[] {
  if (cached) return cached.secretNames(request);
  const names = new Set<string>();
  const placeholders = (text: unknown): void => {
    if (typeof text !== "string" || !text) return;
    const re = /\{\{secret:([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[1] ?? "");
  };
  placeholders(request.url);
  for (const v of Object.values(request.headers)) placeholders(v);
  placeholders(request.body);
  return [...names].filter((n) => n.length > 0);
}

// A route-level parser for the body the page posts. The bridge's parseBridgeRequest requires the BRIDGE_TAG
// and an op/id, which the page's callFetch never sends: the body is the bare AppFetchRequest from the
// page's callFetch. We validate just the AppFetchRequest shape and return the typed object or null.
function parseFetchRequest(body: unknown): AppFetchRequest | null {
  if (!body || typeof body !== "object") return null;
  const m = body as Record<string, unknown>;
  if (typeof m.url !== "string" || !m.url) return null;
  if (typeof m.method !== "string" || !m.method) return null;
  if (!m.headers || typeof m.headers !== "object" || Array.isArray(m.headers)) return null;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.headers as Record<string, unknown>)) {
    if (typeof v !== "string") return null;
    headers[k] = v;
  }
  if (m.body !== undefined && typeof m.body !== "string") return null;
  return { url: m.url, method: m.method, headers, body: m.body };
}