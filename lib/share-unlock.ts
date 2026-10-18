// The share gate's submit for a mini app's link (app/api/a/[id]/unlock), the same steps as a card's
// (app/api/s/[id]/unlock, which moves onto this once the pentest's F-6 change there is committed).
// The body matches what ShareGateForm posts (@aimhuge/share/client): a JSON object with EITHER `password` (a password
// gate) or `email` (an email gate). On success it grants the gate pass; on a bad mode for the body it answers 400.
// The rate limit per (ip, share_id) lives in Supabase (lib/share-unlock-rate) so it survives redeploys and
// load-balanced instances, and the IP itself is read from `x-real-ip` (Vercel rewrites it on the edge) — not the
// `x-forwarded-for` chain, which any client can forge.
//
// SUPABASE_SECRET_KEY and SHARE_UNLOCK_PEPPER are set on the deployed site only; a local Weft that hasn't set them
// answers 503 for "Sharing isn't set up on this server" — the same fallback a misconfigured deployment answers with.
import type { SupabaseClient } from "@supabase/supabase-js";
import { grantGatePass, verifySharePassword } from "@aimhuge/share/server";
import { isPlausibleEmail } from "@aimhuge/teams";
import { getShareGate } from "./share-gate";
import { checkAndRecord, hashIp } from "./share-unlock-rate";
import { serviceClient } from "./web-session";

// The link's gate as its table holds it, and where an email that got through is written down.
export interface UnlockTarget {
  // null when the row can't be read (no such share, no service key).
  load: (id: string) => Promise<{ mode: string; password_hash?: string | null } | null>;
  recordVisit: (service: SupabaseClient, input: { shareId: string; email: string | null }) => Promise<void>;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

// x-real-ip is set by Vercel at the edge (and by a few other trusted proxies); it is the only
// trustworthy source for the client's IP. x-forwarded-for is whatever the client put there, so an
// attacker can pick a new value per request and slip past an in-memory rate limit. Falling back to
// "unknown" collapses all unverified callers into one bucket — the limit still bites, just per
// share rather than per caller.
//
// Off Vercel (`next dev`, a local Weft) nothing rewrites x-real-ip, so any caller can set it and get a
// fresh bucket per request (pentest 2026-10-18, F-6). Share links always point at weft.zip, so the
// route refuses to unlock anywhere VERCEL isn't set rather than run a rate limit it can't trust. Not
// `isDeployed()` (lib/home.ts): WEFT_HOME=1 turns that on for a local server too.
function onVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

function clientIp(req: Request): string {
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

interface UnlockBody {
  password?: unknown;
  email?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// What `tryUnlockRateLimit` needs from the runtime: clock and pepper. `pepper` is read off the
// service env so a misconfigured deployment (no SHARE_UNLOCK_PEPPER) answers 503 with the rest of
// the route, not a silently-broken rate limit.
interface RateEnv {
  now: number;
  pepper: string | null;
}

async function tryUnlockRateLimit(req: Request, id: string, env: RateEnv): Promise<Response | null> {
  if (!env.pepper) return null;
  const service = serviceClient();
  if (!service) return null;
  const ip = clientIp(req);
  const ipHash = await hashIp(ip, env.pepper);
  const verdict = await checkAndRecord(service, ipHash, id, env.now);
  if (verdict.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((verdict.windowResetAt - env.now) / 1000));
  return Response.json(
    { error: "Too many attempts. Try again in a few minutes." },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } },
  );
}

// Through the gate: the signed pass cookie for this share, or 503 when the gate can't sign one (no SHARE_GATE_SECRET).
async function grant(id: string): Promise<Response> {
  const granted: boolean = await grantGatePass(getShareGate(), id);
  if (!granted) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
  return Response.json({ ok: true }, { headers: NO_STORE });
}

export async function unlockShare(req: Request, id: string, target: UnlockTarget): Promise<Response> {
  if (!onVercel()) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
  const blocked = await tryUnlockRateLimit(req, id, { now: Date.now(), pepper: process.env.SHARE_UNLOCK_PEPPER ?? null });
  if (blocked) return blocked;

  let body: UnlockBody;
  try {
    body = (await req.json()) as UnlockBody;
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400, headers: NO_STORE });
  }
  const share = await target.load(id);
  if (!share) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
  const mode = share.mode;
  const service = serviceClient();
  if (!service) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });

  if (mode === "password") {
    const value = asString(body.password);
    if (value === null) return Response.json({ error: "This share is password-protected." }, { status: 400, headers: NO_STORE });
    const ok = verifySharePassword(value, share.password_hash ?? null);
    if (!ok) return Response.json({ error: "That password didn't work." }, { status: 401, headers: NO_STORE });
    return grant(id);
  }
  if (mode === "email") {
    const value = asString(body.email);
    if (!value || !isPlausibleEmail(value)) {
      return Response.json({ error: "Enter a valid email." }, { status: 400, headers: NO_STORE });
    }
    await target.recordVisit(service, { shareId: id, email: value.toLowerCase() });
    return grant(id);
  }
  // public/private don't take a body — the visitor shouldn't be on this route at all. A private
  // share is "sign in" (handled by the page); a public share is no gate.
  return Response.json({ error: "This share doesn't take an unlock." }, { status: 400, headers: NO_STORE });
}
