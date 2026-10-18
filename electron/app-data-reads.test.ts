import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exchangeToken, flattenGa4, runGa4, runSupabase, signServiceAccountJwt, TIMEOUT_MS } from "./app-data-reads.cjs";

// A real RS256 keypair so the JWT sign/verify round-trip runs; the token endpoint is faked.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
if (typeof pem !== "string") throw new Error("expected PEM string");
const PRIVATE_KEY_PEM = pem;
const CLIENT_EMAIL = "sa@test.iam.gserviceaccount.com";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

// The exact shape every read fn calls fetch with: (url, { method, headers, body, signal }).
type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
type FetchReturn = { ok: boolean; status: number; text: () => Promise<string> };
type FetchLike = (url: string, init?: FetchInit) => Promise<FetchReturn>;

// A fake fetch that matches the shape our reads pass through: a calls list and an answer table.
type Answer = { status?: number; body?: unknown };
type Route = (body: string, headers: Record<string, string>) => Answer | Promise<Answer>;
function fakeFetch(routes: Record<string, Route>): { fetch: FetchLike; calls: { url: string; method: string; headers: Record<string, string>; body: string }[] } {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body: init?.body ?? "" });
    // Supabase reads carry their args in the query; route on the path.
    const handler = routes[url.replace(/\?.*$/, "")];
    if (!handler) return { ok: false, status: 404, text: () => Promise.resolve("Not found") };
    const answer = await handler(init?.body ?? "", init?.headers ?? {});
    const status = answer.status ?? 200;
    const bodyText = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? "");
    return { ok: status < 400, status, text: () => Promise.resolve(bodyText) };
  };
  return { fetch, calls };
}

const SA = { client_email: CLIENT_EMAIL, private_key: PRIVATE_KEY_PEM };
const URL = "https://lqjyravglujyizyqypxq.supabase.co";

describe("runSupabase", () => {
  it("GETs the RPC (a read-only transaction) with apikey + Bearer and the args in the query", async () => {
    const rpc = `${URL}/rest/v1/rpc/growth_signups_by_day`;
    const { fetch, calls } = fakeFetch({
      [rpc]: (body, headers) => {
        expect(headers.apikey).toBe("secret-1");
        expect(headers.authorization).toBe("Bearer secret-1");
        expect(body).toBe("");
        return { body: [{ day: "2026-10-18", signups: 3 }] };
      },
    });
    const rows = await runSupabase({ supabaseUrl: URL, fn: "growth_signups_by_day", declaredArgs: { days: 30 }, pageArgs: { days: 7 }, values: { SUPABASE_SECRET_KEY: "secret-1" }, fetch });
    expect(rows).toEqual([{ day: "2026-10-18", signups: 3 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(`${rpc}?days=7`);
  });

  it("sends the manifest's args as defaults when the page passes none", async () => {
    const { fetch, calls } = fakeFetch({ [`${URL}/rest/v1/rpc/fn`]: () => ({ body: [] }) });
    await runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: { days: 30, label: "x" }, pageArgs: null, values: { SUPABASE_SECRET_KEY: "k" }, fetch });
    expect(calls[0]?.url).toBe(`${URL}/rest/v1/rpc/fn?days=30&label=x`);
  });

  it("refuses a non-primitive, a type-changed arg and an arg the manifest didn't declare", async () => {
    const { fetch } = fakeFetch({ [`${URL}/rest/v1/rpc/fn`]: () => ({ body: {} }) });
    const base = { supabaseUrl: URL, fn: "fn", values: { SUPABASE_SECRET_KEY: "x" }, fetch };
    await expect(runSupabase({ ...base, declaredArgs: { days: 30 }, pageArgs: { days: { not: "primitive" } } })).rejects.toMatchObject({ kind: "bad-args" });
    await expect(runSupabase({ ...base, declaredArgs: { days: 30 }, pageArgs: { days: "30" } })).rejects.toMatchObject({ kind: "bad-args" });
    await expect(runSupabase({ ...base, declaredArgs: {}, pageArgs: { days: 30 } })).resolves.toBeDefined();
    await expect(runSupabase({ ...base, declaredArgs: { days: 30 }, pageArgs: null })).resolves.toBeDefined();
  });

  it("rejects a bad function name and a missing secret", async () => {
    const { fetch } = fakeFetch({});
    await expect(runSupabase({ supabaseUrl: URL, fn: "BAD-fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" }, fetch })).rejects.toMatchObject({ kind: "bad-request" });
    await expect(runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: {}, pageArgs: {}, values: {}, fetch })).rejects.toMatchObject({ kind: "missing" });
  });

  it("passes Supabase's error message through", async () => {
    const { fetch } = fakeFetch({
      [`${URL}/rest/v1/rpc/fn`]: () => ({ status: 400, body: "function fn does not exist" }),
    });
    await expect(runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" }, fetch })).rejects.toThrow("function fn does not exist");
  });

  it("caps the array at 5,000 rows and refuses a 2 MB payload", async () => {
    const big = Array.from({ length: 6_000 }, (_, i) => ({ i }));
    const { fetch } = fakeFetch({ [`${URL}/rest/v1/rpc/fn`]: () => ({ body: big }) });
    const rows = await runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" }, fetch });
    expect(Array.isArray(rows) ? rows.length : -1).toBe(5_000);

    const giant = "x".repeat(2 * 1024 * 1024 + 100);
    const { fetch: fetch2 } = fakeFetch({ [`${URL}/rest/v1/rpc/fn`]: () => ({ body: giant }) });
    await expect(runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" }, fetch: fetch2 })).rejects.toMatchObject({ kind: "too-large" });
  });

  it("times out on a slow fetch", { timeout: 20_000 }, async () => {
    const fetch: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
      if (!init?.signal) { reject(new Error("missing signal")); return; }
      init.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
    await expect(runSupabase({ supabaseUrl: URL, fn: "fn", declaredArgs: {}, pageArgs: {}, values: { SUPABASE_SECRET_KEY: "x" }, fetch })).rejects.toMatchObject({ kind: "timeout" });
    expect(TIMEOUT_MS).toBe(15_000);
  });
});

describe("flattenGa4", () => {
  it("flattens dimensions and metrics, turning metric values into numbers", () => {
    const rows = flattenGa4({
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "screenPageViews" }, { name: "sessions" }],
      rows: [
        { dimensionValues: [{ value: "20261018" }], metricValues: [{ value: "12" }, { value: "5" }] },
        { dimensionValues: [{ value: "20261017" }], metricValues: [{ value: "8.5" }, { value: "not-a-number" }] },
      ],
    });
    expect(rows).toEqual([
      { date: "20261018", screenPageViews: 12, sessions: 5 },
      { date: "20261017", screenPageViews: 8.5, sessions: "not-a-number" },
    ]);
  });

  it("caps at 5,000 rows", () => {
    const many = Array.from({ length: 6_000 }, (_, i) => ({ dimensionValues: [{ value: String(i) }], metricValues: [{ value: "1" }] }));
    const rows = flattenGa4({ dimensionHeaders: [{ name: "i" }], metricHeaders: [{ name: "v" }], rows: many });
    expect(rows).toHaveLength(5_000);
  });
});

describe("signServiceAccountJwt", () => {
  it("produces a JWT the matching public key verifies, with the right claims", () => {
    const iat = 1_700_000_000;
    const jwt = signServiceAccountJwt({ clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM, now: () => iat });
    const parts = jwt.split(".");
    const h = parts[0];
    const p = parts[1];
    const s = parts[2];
    if (!h || !p || !s) throw new Error("jwt split");
    const dec = (part: string): { iss?: string; scope?: string; aud?: string; iat?: number; exp?: number; alg?: string; typ?: string } =>
      JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { iss?: string; scope?: string; aud?: string; iat?: number; exp?: number; alg?: string; typ?: string };
    expect(dec(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dec(p)).toEqual({ iss: CLIENT_EMAIL, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: TOKEN_URI, iat, exp: iat + 3600 });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("exchangeToken", () => {
  it("POSTs the JWT to the token URI and returns expiresAt 60 s before expiry", async () => {
    const nowRef = { value: 1_000_000 };
    const tokenRoute: Route = (body) => {
      const params = new URLSearchParams(body);
      const jwt = params.get("assertion") ?? "";
      const parts = jwt.split(".");
      const claims = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as { iss?: string; scope?: string; aud?: string };
      expect(claims.iss).toBe(CLIENT_EMAIL);
      expect(claims.scope).toBe("https://www.googleapis.com/auth/analytics.readonly");
      expect(claims.aud).toBe(TOKEN_URI);
      expect(parts[2]).toBeTruthy();
      return { body: { access_token: "tok-1", expires_in: 3600 } };
    };
    const { fetch, calls } = fakeFetch({ [TOKEN_URI]: tokenRoute });
    const now = () => nowRef.value;
    const a = await exchangeToken({ clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM, fetch, now });
    expect(a.accessToken).toBe("tok-1");
    expect(a.expiresAt).toBe(nowRef.value + 3600 * 1000 - 60_000);
    expect(calls).toHaveLength(1);
  });

  it("passes through Google's error", async () => {
    const { fetch } = fakeFetch({ [TOKEN_URI]: () => ({ status: 400, body: "invalid_grant" }) });
    await expect(exchangeToken({ clientEmail: CLIENT_EMAIL, privateKey: PRIVATE_KEY_PEM, fetch, now: () => 0 })).rejects.toMatchObject({ kind: "upstream" });
  });
});

describe("runGa4", () => {
  const PROP = "123456789";
  const REPORT_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${PROP}:runReport`;
  const SA_VALUES = { GA4_PROPERTY_ID: PROP, GA4_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) };

  it("calls runReport with a Bearer token and flattens the rows", async () => {
    const nowRef = { value: 1_000_000 };
    const tokens = new Map<string, { accessToken: string; expiresAt: number }>();
    const { fetch, calls } = fakeFetch({
      [TOKEN_URI]: () => ({ body: { access_token: "tok-1", expires_in: 3600 } }),
      [REPORT_URL]: (body, headers) => {
        expect(headers.authorization).toBe("Bearer tok-1");
        expect(JSON.parse(body)).toEqual({ dateRanges: [{ startDate: "30daysAgo", endDate: "today" }] });
        return { body: { dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "screenPageViews" }], rows: [{ dimensionValues: [{ value: "20261018" }], metricValues: [{ value: "12" }] }] } };
      },
    });
    const now = () => nowRef.value;
    const rows = await runGa4({ body: { dateRanges: [{ startDate: "30daysAgo", endDate: "today" }] }, values: SA_VALUES, fetch, now, tokens });
    expect(rows).toEqual([{ date: "20261018", screenPageViews: 12 }]);
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(1);
    expect(calls.filter((c) => c.url === REPORT_URL)).toHaveLength(1);

    // A second call inside the cache window skips the token endpoint.
    nowRef.value += 1000;
    await runGa4({ body: { dateRanges: [{ startDate: "30daysAgo", endDate: "today" }] }, values: SA_VALUES, fetch, now, tokens });
    expect(calls.filter((c) => c.url === TOKEN_URI)).toHaveLength(1);
    expect(calls.filter((c) => c.url === REPORT_URL)).toHaveLength(2);
  });

  it("refuses with the env's label when GA4 names are missing or invalid", async () => {
    const tokens = new Map<string, { accessToken: string; expiresAt: number }>();
    const { fetch } = fakeFetch({});
    await expect(runGa4({ body: {}, values: { GA4_PROPERTY_ID: PROP, GA4_SERVICE_ACCOUNT_JSON: "not-json" }, fetch, tokens })).rejects.toMatchObject({ kind: "missing" });
    await expect(runGa4({ body: {}, values: { GA4_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) }, fetch, tokens })).rejects.toMatchObject({ kind: "missing" });
    await expect(runGa4({ body: {}, values: { GA4_PROPERTY_ID: PROP }, fetch, tokens })).rejects.toMatchObject({ kind: "missing" });
  });
});
