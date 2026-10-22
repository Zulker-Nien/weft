// The one pipeline behind a hosted mini app's server calls (app/api/a/[id]/read and app/api/a/[id]/fetch):
//
//   parseBoundedBody → gateShare → requireService → rateLimitGuard → resolveValues → runLogged
//
// Each route supplies only its two middlewares: a parser for its body (a read name, a fetch request) and
// a runner for its upstream call (a Supabase RPC or GA4 report, the Mac's runFetch). Every step answers
// a refusal as a Response through lib/app-share-reply.ts, so a step's caller just returns it.
//
// Its own module rather than more of app-share-reply.ts: that one is plain Response shapes, imported by
// routes with no vault or rate limit (unlock, the share page, the web board's pages); this one pulls in
// the service client, the fetch log and the secret store.
import type { SupabaseClient } from "@supabase/supabase-js";
import { appShareAccess } from "@/lib/app-share-access";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog, type FetchLog } from "@/lib/app-fetch-limit";
import { NO_STORE, rateLimited, reject } from "@/lib/app-share-reply";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { serviceClient } from "@/lib/web-session";

export { NO_STORE, reject };

type Share = Extract<Awaited<ReturnType<typeof appShareAccess>>, { kind: "ok" }>["share"];
type Service = NonNullable<ReturnType<typeof serviceClient>>;

// The body the page posted, as JSON, refused with a 413 when its declared length is over maxBytes.
// Wrapped in { body } so a JSON body can never be mistaken for the refusal.
export async function parseBoundedBody(req: Request, maxBytes: number): Promise<{ body: unknown } | Response> {
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) return reject(413, "request body is too large.");
  try {
    return { body: await req.json() };
  } catch {
    return reject(400, "request body must be JSON.");
  }
}

// The share behind the link, or a 404 (gone) / 403 (not yours to open).
export async function gateShare(id: string): Promise<Share | Response> {
  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");
  return access.share;
}

export function requireService(): Service | Response {
  return serviceClient() ?? reject(503, "this server isn't configured to run apps.");
}

// One attempt's log row, less its status: each step that ends the attempt adds the status it answered.
export type Attempt = Omit<FetchLog, "status">;

type LimitVerdict = (service: SupabaseClient, shareId: string, viewerId: string | null, clientIp: string) => Promise<{ ok: boolean; retryAfter: number }>;

// A 429 with Retry-After and a log row when the attempt is over its budget; null lets it through. The
// budget (fetchLimitVerdict unless a route passes its own) and the message are the route's to choose.
export async function rateLimitGuard(
  service: Service,
  req: Request,
  attempt: Attempt,
  { limit = fetchLimitVerdict, message }: { limit?: LimitVerdict; message?: string } = {},
): Promise<Response | null> {
  const verdict = await limit(service, attempt.shareId, attempt.viewerId, clientIpFromHeaders(req.headers));
  if (verdict.ok) return null;
  await insertFetchLog(service, { ...attempt, status: 429 });
  return rateLimited(verdict.retryAfter, message);
}

// The vault values for the names the call uses, read as the manifest splits them (author's, viewer's).
// No names never touches the store; names on a server without the app-secrets key is a 503.
export async function resolveValues(
  service: Service,
  shareId: string,
  names: string[],
  split: { author: string[]; viewer: string[] },
  viewerId: string | null,
): Promise<Record<string, string> | Response> {
  if (names.length === 0) return {};
  if (!secretsConfigured()) return reject(503, "App secrets aren't set up on this server.");
  return createAppSecretStore(service).getValues(shareId, split, viewerId);
}

// The status an upstream failure carries: AppReadError and the Mac's cjs modules both put a numeric
// .status on what they throw; anything else is a 500.
export function errStatus(err: unknown): number {
  if (err && typeof err === "object" && "status" in err && typeof err.status === "number") return err.status;
  return 500;
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Runs the route's upstream call and logs the attempt with the status it ended on: the call's own
// status and body on success, `{ error, status }` from the thrown error on failure.
export async function runLogged(
  service: Service,
  attempt: Attempt,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<Response> {
  try {
    const { status, body } = await run();
    await insertFetchLog(service, { ...attempt, status });
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    const status = errStatus(err);
    await insertFetchLog(service, { ...attempt, status });
    return reject(status, errMessage(err));
  }
}
