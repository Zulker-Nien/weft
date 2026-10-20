// POST /api/a/<id>/fetch — a hosted mini app's weft.fetch: the gated fetch that puts secret values in by
// reference (lib/app-bridge.ts, docs/architecture/mini-app-hosting.md). One AppFetchRequest in, one
// AppFetchResult out (or { error }). The gate, the rate limit and the runFetch are the three layers
// between the request and the network: gate is lib/app-share-access.ts's appShareAccess, rate limit is
// lib/app-fetch-limit.ts's fetchLimitVerdict + insertFetchLog, the runFetch is electron/app-fetch-run.cjs
// loaded through a dynamic import (CommonJS) so the same module the Mac uses answers weft.zip too.
// A viewer-secret check runs before the rate limit and the secret store so an anonymous visitor on a
// public share never reaches cloud_app_secrets. Refusals (400/403/409/429) answer { error, status }.
import { connection } from "next/server";
import dns from "node:dns";
import { appShareAccess } from "@/lib/app-share-access";
import type { AppFetchRequest, AppFetchResult } from "@/lib/app-bridge";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog } from "@/lib/app-fetch-limit";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore, splitByManifest } from "@/lib/app-secret-store";
import { serviceClient, webUser } from "@/lib/web-session";

const MAX_BODY_BYTES = 1 * 1024 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };

function reject(status: number, error: string): Response {
  return Response.json({ error, status }, { status, headers: NO_STORE });
}

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

// Parses the body the page posts, validates it fits in MAX_BODY_BYTES, and returns the typed AppFetchRequest
// or an error Response ready to answer. Factored so POST stays under the complexity budget.
async function parseBody(req: Request): Promise<AppFetchRequest | Response> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return reject(413, "request body is too large.");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reject(400, "request body must be JSON.");
  }
  const request = parseFetchRequest(body);
  if (!request) return reject(400, "request shape isn't valid.");
  return request;
}

// Builds a 429 with Retry-After and the appropriate log row when the rate limit refuses.
async function rateLimitedResponse(
  service: NonNullable<ReturnType<typeof serviceClient>>,
  shareId: string,
  viewerId: string | null,
  request: AppFetchRequest,
  retryAfter: number,
): Promise<Response> {
  const logPath = splitPathForLog(request.url);
  await insertFetchLog(service, {
    shareId,
    viewerId,
    method: request.method,
    host: logPath.host,
    path: logPath.path,
    status: 429,
  });
  return new Response(JSON.stringify({ error: "rate limit exceeded", status: 429 }), {
    status: 429,
    headers: { ...NO_STORE, "Retry-After": String(retryAfter) },
  });
}

// The fetch handler: gate first, then viewer-secret check (so an anonymous visitor on a public share
// never reaches the secret store), then the rate limit, then the runFetch. Logs every attempt.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;

  const parsed = await parseBody(req);
  if (parsed instanceof Response) return parsed;
  const request = parsed;

  return handleFetch(req, id, request);
}

// After parseBody has approved the body and the page has its id, run the gate + viewer-secret check +
// rate limit + runFetch. Logged every attempt.
async function handleFetch(req: Request, id: string, request: AppFetchRequest): Promise<Response> {
  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");

  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");

  const viewer = await webUser();
  const names = secretNamesForRequest(request);
  const secrets = (access.share.manifest as { secrets?: Record<string, { from?: "viewer" | "author" }> } | null)?.secrets ?? null;
  const split = splitByManifest(names, secrets);
  const viewerRequired = split.viewer.length > 0;
  if (viewerRequired && !viewer) {
    // A request that names a viewer-provided secret must belong to a signed-in viewer, on any share
    // mode including public. Returned before the rate limit and the secret store so the route never
    // touches cloud_app_secrets for an anonymous visitor.
    return reject(401, "sign in to provide your value for this app.");
  }

  const clientIp = clientIpFromHeaders(req.headers);
  const verdict = await fetchLimitVerdict(service, id, viewer?.id ?? null, clientIp);
  if (!verdict.ok) return rateLimitedResponse(service, id, viewer?.id ?? null, request, verdict.retryAfter);

  return runWithSecrets(service, id, request, viewer?.id ?? null, access.share.manifest, names, split);
}

// Runs the runFetch with the (already-decrypted) values, logs the call's status. The viewer-secret 401
// ran above; here we still re-check that the secrets env is configured before sealing or unsealing.
async function runWithSecrets(
  service: NonNullable<ReturnType<typeof serviceClient>>,
  shareId: string,
  request: AppFetchRequest,
  viewerId: string | null,
  policy: unknown,
  names: string[],
  split: { author: string[]; viewer: string[] },
): Promise<Response> {
  if (names.length > 0 && !secretsConfigured()) {
    return reject(503, "App secrets aren't set up on this server.");
  }

  const store = createAppSecretStore(service);
  const values: Record<string, string> = names.length > 0
    ? await store.getValues(shareId, split, viewerId)
    : {};

  const logPath = splitPathForLog(request.url);
  try {
    // Lazy-load the cjs runFetch so the route module is a thin shim until it's actually called.
    const { runFetch } = await loadRunFetch();
    const result = await runFetch({
      policy,
      request,
      getValues: () => Promise.resolve(values),
      fetch: globalThis.fetch.bind(globalThis),
      lookup: (hostname, options, callback) => {
        // dns.lookup has many overloads; the policy module passes us a (hostname, options, callback)
        // tuple, so we forward with `any` on the options boundary.
        dns.lookup(hostname, options as dns.LookupOptions, callback);
      },
    });
    await insertFetchLog(service, {
      shareId,
      viewerId,
      method: request.method,
      host: logPath.host,
      path: logPath.path,
      status: result.status,
    });
    return Response.json(result satisfies AppFetchResult, { headers: NO_STORE });
  } catch (err) {
    const status = errStatus(err);
    await insertFetchLog(service, {
      shareId,
      viewerId,
      method: request.method,
      host: logPath.host,
      path: logPath.path,
      status,
    });
    return reject(status, errMessage(err));
  }
}

// The status from an error thrown by the policy or runFetch modules. The Mac's cjs files attach a .status
// to their failures; the page-side shape is what the bridge looks for.
function errStatus(err: unknown): number {
  if (err && typeof err === "object" && "status" in err) {
    const status = err.status;
    if (typeof status === "number") return status;
  }
  return 500;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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