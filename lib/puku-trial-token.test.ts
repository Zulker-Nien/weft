import { afterEach, describe, expect, it, vi } from "vitest";
import { accountUserId, issueTrialToken, readTrialToken, signTrialToken, TRIAL_TOKEN_MS, verifyTrialToken } from "./puku-trial-token";

// The Puku trial's tokens: signing, reading, verifying, and the route's issuing logic.

const SECRET = "s3cret";
const NOW = 1_700_000_000_000;

afterEach(() => vi.restoreAllMocks());

describe("signTrialToken", () => {
  it("makes a wpt1 token that expires a day out", async () => {
    const { token, expiresAt } = await signTrialToken("u1", SECRET, NOW);
    expect(token).toMatch(/^wpt1\.[\w-]+\.[\w-]+$/);
    expect(expiresAt).toBe(NOW + TRIAL_TOKEN_MS);
    expect(readTrialToken(token)).toEqual({ sub: "u1", exp: expiresAt });
  });

  it("defaults to the current time and honors a ttl", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    expect((await signTrialToken("u1", SECRET)).expiresAt).toBe(NOW + TRIAL_TOKEN_MS);
    expect((await signTrialToken("u1", SECRET, NOW, 1000)).expiresAt).toBe(NOW + 1000);
  });
});

describe("readTrialToken", () => {
  const payload = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

  it("reads claims, trimming whitespace", async () => {
    const { token } = await signTrialToken("u1", SECRET, NOW);
    expect(readTrialToken(`  ${token}\n`)).toEqual({ sub: "u1", exp: NOW + TRIAL_TOKEN_MS });
  });

  it("rejects malformed tokens", () => {
    expect(readTrialToken("")).toBeNull();
    expect(readTrialToken("nope.a.b")).toBeNull();
    expect(readTrialToken("wpt1.a")).toBeNull();
    expect(readTrialToken("wpt1..b")).toBeNull();
    expect(readTrialToken("wpt1.a.b.c")).toBeNull();
    expect(readTrialToken("wpt1.%%%.sig")).toBeNull();
    expect(readTrialToken(`wpt1.${payload({ sub: "", exp: 1 })}.sig`)).toBeNull();
    expect(readTrialToken(`wpt1.${payload({ sub: "u", exp: "1" })}.sig`)).toBeNull();
    expect(readTrialToken(`wpt1.${payload({ exp: 1 })}.sig`)).toBeNull();
  });
});

describe("verifyTrialToken", () => {
  it("accepts a good token", async () => {
    const { token } = await signTrialToken("u1", SECRET, NOW);
    expect(await verifyTrialToken(token, SECRET, NOW + 1)).toEqual({ sub: "u1", exp: NOW + TRIAL_TOKEN_MS });
  });

  it("defaults now to the clock", async () => {
    const { token } = await signTrialToken("u1", SECRET, Date.now());
    expect(await verifyTrialToken(token, SECRET)).toMatchObject({ sub: "u1" });
  });

  it("rejects an expired token, a wrong secret, a tampered payload and garbage", async () => {
    const { token } = await signTrialToken("u1", SECRET, NOW);
    expect(await verifyTrialToken(token, SECRET, NOW + TRIAL_TOKEN_MS)).toBeNull();
    expect(await verifyTrialToken(token, "other", NOW)).toBeNull();
    const [prefix, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "u2", exp: NOW + TRIAL_TOKEN_MS })).toString("base64url");
    expect(await verifyTrialToken(`${prefix}.${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyTrialToken("garbage", SECRET, NOW)).toBeNull();
  });
});

describe("accountUserId", () => {
  const stub = (res: Partial<Response> & { json?: () => Promise<unknown> }) => {
    const f = vi.fn(() => Promise.resolve(res as Response));
    vi.stubGlobal("fetch", f);
    return f;
  };
  afterEach(() => vi.unstubAllGlobals());

  it("asks Supabase Auth who the token belongs to", async () => {
    const f = stub({ ok: true, json: () => Promise.resolve({ id: "u1" }) });
    expect(await accountUserId("tok", "https://x.supabase.co", "key")).toBe("u1");
    expect(f).toHaveBeenCalledWith("https://x.supabase.co/auth/v1/user", { headers: { apikey: "key", authorization: "Bearer tok" } });
  });

  it("is null without an id or when Supabase refuses", async () => {
    stub({ ok: true, json: () => Promise.resolve({}) });
    expect(await accountUserId("t", "u", "k")).toBeNull();
    stub({ ok: true, json: () => Promise.resolve({ id: "" }) });
    expect(await accountUserId("t", "u", "k")).toBeNull();
    stub({ ok: false });
    expect(await accountUserId("t", "u", "k")).toBeNull();
  });
});

describe("issueTrialToken", () => {
  const req = (init: RequestInit = { method: "POST", headers: { authorization: "Bearer abc" } }) => new Request("https://weft.example/api/puku/trial-token", init);

  it("only answers POST", async () => {
    const res = await issueTrialToken(new Request("https://x/y"), SECRET, vi.fn());
    expect(res.status).toBe(405);
  });

  it("needs a bearer token", async () => {
    const verify = vi.fn();
    expect((await issueTrialToken(req({ method: "POST" }), SECRET, verify)).status).toBe(401);
    expect((await issueTrialToken(req({ method: "POST", headers: { authorization: "Basic x" } }), SECRET, verify)).status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
  });

  it("is 401 when the sign-in doesn't check out", async () => {
    const res = await issueTrialToken(req(), SECRET, () => Promise.resolve(null));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
  });

  it("returns a token for the verified user", async () => {
    const verify = vi.fn(() => Promise.resolve("u1"));
    const res = await issueTrialToken(req(), SECRET, verify, NOW);
    expect(verify).toHaveBeenCalledWith("abc");
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.expiresAt).toBe(NOW + TRIAL_TOKEN_MS);
    expect(await verifyTrialToken(body.token, SECRET, NOW)).toMatchObject({ sub: "u1" });
  });

  it("defaults now to the clock", async () => {
    const res = await issueTrialToken(req(), SECRET, () => Promise.resolve("u1"));
    expect(((await res.json()) as { expiresAt: number }).expiresAt).toBeGreaterThan(Date.now());
  });
});
