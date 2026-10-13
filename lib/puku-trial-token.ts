import { sameSignature } from "./github-relay";

// The Puku trial's tokens (docs/architecture/puku-trial.md): what the deployed Weft gives a signed-in Weft account
// so its puku threads can use Weft's own Puku key through the proxy, without that key ever leaving Vercel. A token
// is `wpt1.<payload>.<signature>`: the payload names the Weft user and when the token expires, the signature is an
// HMAC of it with PUKU_TRIAL_SIGNING_SECRET, so the proxy checks one with no database call.

export const TRIAL_TOKEN_MS = 24 * 60 * 60 * 1000;
const PREFIX = "wpt1";

export interface TrialClaims {
  sub: string;
  exp: number;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text))));
}

export async function signTrialToken(userId: string, secret: string, now = Date.now(), ttl = TRIAL_TOKEN_MS): Promise<{ token: string; expiresAt: number }> {
  const claims: TrialClaims = { sub: userId, exp: now + ttl };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  return { token: `${PREFIX}.${payload}.${await hmac(secret, `${PREFIX}.${payload}`)}`, expiresAt: claims.exp };
}

// What a token says, without checking its signature: the desktop reads its own token's expiry with this.
export function readTrialToken(token: string): TrialClaims | null {
  const [prefix, payload, signature, ...rest] = token.trim().split(".");
  if (prefix !== PREFIX || !payload || !signature || rest.length) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<TrialClaims>;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number") return null;
    return { sub: claims.sub, exp: claims.exp };
  } catch {
    return null;
  }
}

// The token's claims if its signature checks out and it hasn't expired; null for anything else.
export async function verifyTrialToken(token: string, secret: string, now = Date.now()): Promise<TrialClaims | null> {
  const claims = readTrialToken(token);
  if (!claims || claims.exp <= now) return null;
  const [prefix, payload, signature] = token.trim().split(".");
  return sameSignature(signature ?? "", await hmac(secret, `${prefix}.${payload}`)) ? claims : null;
}

// The Weft user an access token belongs to, asked of Supabase Auth (it checks the JWT and that the session is live).
export async function accountUserId(accessToken: string, url: string, key: string): Promise<string | null> {
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: unknown };
  return typeof user.id === "string" && user.id ? user.id : null;
}

// POST /api/puku/trial-token with the caller's Weft access token as the bearer: a fresh trial token for that account.
export async function issueTrialToken(req: Request, secret: string, verify: (accessToken: string) => Promise<string | null>, now = Date.now()): Promise<Response> {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  const accessToken = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!accessToken) return Response.json({ error: "Sign in to your Weft account first." }, { status: 401 });
  const userId = await verify(accessToken);
  if (!userId) return Response.json({ error: "Your Weft sign-in has expired. Sign in again." }, { status: 401 });
  return Response.json(await signTrialToken(userId, secret, now));
}
