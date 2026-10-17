// POST /api/s/[id]/unlock — the gate's submit. The body matches what ShareGateForm posts
// (@aimhuge/share/client): a JSON object with EITHER `password` (a password gate) or `email` (an
// email gate). On success the route grants the gate pass; on a bad mode for the body it answers
// 400. A best-effort in-memory rate limit per (ip, id) keeps the route from being a brute force.
//
// No localhost guard: the route is the public gate. SUPABASE_SECRET_KEY is set on the deployed
// site only, so a local Weft that hasn't set the key answers 503 for "Sharing isn't set up" —
// the same fallback a misconfigured deployment answers with.
import { grantGatePass, verifySharePassword } from "@aimhuge/share/server";
import { getShareGate } from "@/lib/share-gate";
import { insertShareVisit, loadShare } from "@/lib/share-access";
import { serviceClient } from "@/lib/web-session";
import { isPlausibleEmail } from "@aimhuge/teams";

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;

interface Bucket {
  count: number;
  resetAt: number;
}
const rate = new Map<string, Bucket>();

function rateCheck(key: string): boolean {
  const now = Date.now();
  const entry = rate.get(key);
  if (!entry || entry.resetAt <= now) {
    rate.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count += 1;
  return true;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface UnlockBody {
  password?: unknown;
  email?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!rateCheck(`${clientIp(req)}:${id}`)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429, headers: NO_STORE });
  }
  let body: UnlockBody;
  try {
    body = (await req.json()) as UnlockBody;
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400, headers: NO_STORE });
  }
  const loaded = await loadShare(id);
  if (!loaded) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
  const mode = loaded.share.mode;
  const service = serviceClient();
  if (!service) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });

  if (mode === "password") {
    const value = asString(body.password);
    if (value === null) return Response.json({ error: "This share is password-protected." }, { status: 400, headers: NO_STORE });
    const ok = verifySharePassword(value, loaded.share.password_hash);
    if (!ok) return Response.json({ error: "That password didn't work." }, { status: 401, headers: NO_STORE });
    const granted: boolean = await grantGatePass(getShareGate(), id);
    if (!granted) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  if (mode === "email") {
    const value = asString(body.email);
    if (!value || !isPlausibleEmail(value)) {
      return Response.json({ error: "Enter a valid email." }, { status: 400, headers: NO_STORE });
    }
    await insertShareVisit(service, { shareId: id, email: value.toLowerCase() });
    const granted: boolean = await grantGatePass(getShareGate(), id);
    if (!granted) return Response.json({ error: "Sharing isn't set up on this server." }, { status: 503, headers: NO_STORE });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  // public/private don't take a body — the visitor shouldn't be on this route at all. A private
  // share is "sign in" (handled by the page); a public share is no gate.
  return Response.json({ error: "This share doesn't take an unlock." }, { status: 400, headers: NO_STORE });
}
