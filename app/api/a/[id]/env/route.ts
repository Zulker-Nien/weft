// GET /api/a/<id>/env — a hosted mini app's weft.env: the values the manifest declared as `public` (the names a
// page may read with no gate beyond the share's access check). Same author-only split as the read route's
// SUPABASE / GA4 values: viewer_id null rows, never that viewer's own. A name that's in `public` but not in the
// table is silently absent from the map (Mac's app-data-fetch.cjs env() does the same). The route logs each
// call the same way /fetch and /read do; an absent `public` array short-circuits to {} with no log row.
import { connection } from "next/server";
import { appShareAccess } from "@/lib/app-share-access";
import { clientIpFromHeaders, fetchLimitVerdict, insertFetchLog } from "@/lib/app-fetch-limit";
import { NO_STORE, reject } from "@/lib/app-share-reply";
import { isConfigured as secretsConfigured } from "@/lib/app-secrets";
import { createAppSecretStore } from "@/lib/app-secret-store";
import { serviceClient, webUser } from "@/lib/web-session";

const PUBLIC_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

// The names the manifest declared as `public`. Invalid entries are dropped, never silently broadened — same
// rule as the Mac's parsePolicy.
function publicNames(manifest: unknown): string[] {
  const list = manifest && typeof manifest === "object" ? (manifest as { public?: unknown }).public : undefined;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !PUBLIC_NAME_RE.test(item)) continue;
    out.push(item);
  }
  return out;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;

  const access = await appShareAccess(id);
  if (access.kind === "missing") return reject(404, "this app link no longer exists.");
  if (access.kind !== "ok") return reject(403, "you don't have access to this app link.");

  const service = serviceClient();
  if (!service) return reject(503, "this server isn't configured to run apps.");

  const names = publicNames(access.share.manifest);
  if (names.length === 0) return Response.json({ values: {} }, { headers: NO_STORE });

  const viewer = await webUser();
  const clientIp = clientIpFromHeaders(req.headers);
  const verdict = await fetchLimitVerdict(service, id, viewer?.id ?? null, clientIp);
  if (!verdict.ok) {
    await insertFetchLog(service, { shareId: id, viewerId: viewer?.id ?? null, method: "ENV", host: "", path: "/env", status: 429 });
    return new Response(JSON.stringify({ error: "rate limit exceeded", status: 429 }), { status: 429, headers: { ...NO_STORE, "Retry-After": String(verdict.retryAfter) } });
  }

  if (!secretsConfigured()) return reject(503, "App secrets aren't set up on this server.");

  const store = createAppSecretStore(service);
  const values = await store.getValues(id, { author: names, viewer: [] }, null);
  await insertFetchLog(service, { shareId: id, viewerId: viewer?.id ?? null, method: "ENV", host: "", path: "/env", status: 200 });
  return Response.json({ values }, { headers: NO_STORE });
}