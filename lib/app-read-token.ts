// app/api/a/[id]/read/route.ts: the GA4 read needs an OAuth access token, signed with the project's
// service-account JSON. We cache one token per client_email in a module-level Map (the Mac's app-data.cjs
// does the same). The OAuth exchange + the JWT sign are factored out so the route's POST handler stays
// under the lint complexity budget.
import { createSign } from "node:crypto";

const TIMEOUT_MS = 15_000;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const ROW_LIMIT = 5_000;
const BYTE_LIMIT = 2 * 1024 * 1024;

export class AppReadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// One cache entry per service-account email. The Mac's gaTokens map has the same shape.
const gaTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

// Signs an RS256 JWT for Google's OAuth JWT-bearer flow. The header + payload are base64url-encoded,
// the signature is the result of createSign("RSA-SHA256"). The Mac's signServiceAccountJwt in
// app-data.cjs is the same code, kept in sync by hand.
function signServiceAccountJwt(clientEmail: string, privateKey: string, now: number): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: GA4_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${b64(header)}.${b64(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  return `${signingInput}.${signer.end().sign(privateKey).toString("base64url")}`;
}

interface TimeoutHandle {
  signal: AbortSignal;
  cancel: () => void;
}

export function withTimeout(ms: number): TimeoutHandle {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// Best-effort parse of an upstream error body — `{ message, hint }` is what most APIs answer. Any other
// shape falls through to the truncated text.
export function upstreamMessage(text: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const body = parsed as { message?: unknown; error?: { message?: unknown }; error_description?: unknown; hint?: unknown };
      const candidate = body.message ?? body.error?.message ?? body.error_description;
      if (typeof candidate === "string" && candidate) {
        return typeof body.hint === "string" && body.hint ? `${candidate} (${body.hint})` : candidate;
      }
    }
  } catch {
    // fall through
  }
  return text ? text.slice(0, 300) : fallback;
}

// Parses the service-account JSON the app's secret store carries. A missing pair throws a 400.
function parseServiceAccount(saJson: string): { client_email: string; private_key: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(saJson);
  } catch {
    throw new AppReadError("GA4_SERVICE_ACCOUNT_JSON isn't valid JSON.", 400);
  }
  if (!parsed || typeof parsed !== "object") throw new AppReadError("GA4_SERVICE_ACCOUNT_JSON isn't valid JSON.", 400);
  const sa = parsed as { client_email?: unknown; private_key?: unknown };
  if (typeof sa.client_email !== "string" || typeof sa.private_key !== "string") {
    throw new AppReadError("GA4_SERVICE_ACCOUNT_JSON is missing client_email or private_key.", 400);
  }
  return { client_email: sa.client_email, private_key: sa.private_key };
}

// Exchanges a service-account assertion for an access token. Caches the token until 60 s before
// expiry; never goes stale on a single call.
export async function exchangeGa4Token(values: Record<string, string>): Promise<string> {
  const saJson = values.GA4_SERVICE_ACCOUNT_JSON;
  if (!saJson) throw new AppReadError("GA4_SERVICE_ACCOUNT_JSON has no value yet.", 400);
  const sa = parseServiceAccount(saJson);
  const cached = gaTokenCache.get(sa.client_email);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.accessToken;

  const assertion = signServiceAccountJwt(sa.client_email, sa.private_key, Math.floor(now / 1000));
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
      signal: t.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new AppReadError(upstreamMessage(text, `Google's token endpoint answered ${res.status}.`), res.status);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") throw new AppReadError("Google's token endpoint didn't return an access token.", 502);
    const json = parsed as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== "string") throw new AppReadError("Google's token endpoint didn't return an access token.", 502);
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    gaTokenCache.set(sa.client_email, { accessToken: json.access_token, expiresAt: now + expiresIn * 1000 - 60_000 });
    return json.access_token;
  } catch (err) {
    if (err instanceof AppReadError) throw err;
    const name = (err as { name?: unknown }).name;
    if (name === "AbortError") throw new AppReadError(`Google's token endpoint didn't answer in ${TIMEOUT_MS / 1000} s.`, 504);
    const message = err instanceof Error ? err.message : String(err);
    throw new AppReadError(`Couldn't reach Google's token endpoint: ${message}.`, 502);
  } finally {
    t.cancel();
  }
}

export { TIMEOUT_MS, BYTE_LIMIT, ROW_LIMIT };