// app/api/s/[id]/unlock/route.ts: the gate's submit. POST { password } for a password share,
// { email } for an email share. Wrong mode for the body, bad body, rate limit, unconfigured all
// have their own branch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadShare, grantGatePass, getShareGate, serviceClient, insertShareVisit, verifySharePassword, checkAndRecord, hashIp } = vi.hoisted(() => ({
  loadShare: vi.fn(),
  grantGatePass: vi.fn(),
  getShareGate: vi.fn(),
  serviceClient: vi.fn(),
  insertShareVisit: vi.fn(),
  verifySharePassword: vi.fn(),
  checkAndRecord: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock("@/lib/share-access", () => ({ loadShare, insertShareVisit }));
vi.mock("@/lib/share-gate", () => ({ getShareGate }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/share-unlock-rate", () => ({ checkAndRecord, hashIp }));
vi.mock("@aimhuge/share/server", () => ({ grantGatePass, verifySharePassword }));

const cookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies }));

async function load() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SHARE_UNLOCK_PEPPER = "pepper";
  process.env.VERCEL = "1";
  getShareGate.mockReturnValue({
    cookieName: (id: string) => `weft_share_${id.slice(0, 4)}`,
    sign: (id: string) => `signed:${id}`,
    verify: () => true,
    cookieOptions: () => ({ httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 60 }),
    ttlMs: 60_000,
  });
  grantGatePass.mockResolvedValue(true);
  serviceClient.mockReturnValue({ from: () => ({ insert: vi.fn(() => Promise.resolve({ error: null })) }) });
  // hashIp is deterministic on the input so a test can drive "same caller".
  hashIp.mockImplementation((ip: string) => `hash:${ip}`);
  // checkAndRecord default: allow. Tests that want to drive the 429 path override.
  checkAndRecord.mockResolvedValue({ allowed: true, windowResetAt: Date.now() + 60_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SHARE_UNLOCK_PEPPER;
  delete process.env.VERCEL;
});

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/s/x/unlock", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("POST /api/s/[id]/unlock", () => {
  it("answers 503 off Vercel, where x-real-ip is caller-controlled (F-6)", async () => {
    delete process.env.VERCEL;
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }, { "x-real-ip": "1.1.1.1" }), ctx("x"));
    expect(res.status).toBe(503);
    expect(checkAndRecord).not.toHaveBeenCalled();
    expect(loadShare).not.toHaveBeenCalled();
  });

  it("returns 429 when the shared rate limit denies the attempt", async () => {
    checkAndRecord.mockResolvedValue({ allowed: false, windowResetAt: Date.now() + 60_000 });
    const { POST } = await load();
    const res = await POST(postReq({ password: "wrong" }, { "x-real-ip": "1.1.1.1" }), ctx("x"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("trusts x-real-ip but not x-forwarded-for (the M-1 fix)", async () => {
    const { POST } = await load();
    // x-forwarded-for alone (no x-real-ip) is treated as the same unknown bucket, so both
    // requests collapse to one caller; x-real-ip is the only signal the route keys on.
    await POST(postReq({ password: "wrong" }, { "x-forwarded-for": "9.9.9.9" }), ctx("x"));
    await POST(postReq({ password: "wrong" }, { "x-forwarded-for": "8.8.8.8" }), ctx("x"));
    expect(hashIp).toHaveBeenLastCalledWith("unknown", "pepper");
    await POST(postReq({ password: "wrong" }, { "x-real-ip": "1.1.1.1" }), ctx("x"));
    expect(hashIp).toHaveBeenLastCalledWith("1.1.1.1", "pepper");
  });

  it("skips the rate check when SHARE_UNLOCK_PEPPER isn't set (route stays 503-able)", async () => {
    delete process.env.SHARE_UNLOCK_PEPPER;
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "scrypt$1$2" } });
    verifySharePassword.mockReturnValue(false);
    const { POST } = await load();
    const res = await POST(postReq({ password: "wrong" }, { "x-real-ip": "1.1.1.1" }), ctx("x"));
    expect(res.status).toBe(401);
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it("returns 503 when the share row is missing", async () => {
    loadShare.mockResolvedValue(null);
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("x"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when the service client is missing", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "scrypt$1$2" } });
    serviceClient.mockReturnValue(null);
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("x"));
    expect(res.status).toBe(503);
  });

  it("rejects a password gate with no body field", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: null } });
    const { POST } = await load();
    const res = await POST(postReq({ email: "x@y" }), ctx("x"));
    expect(res.status).toBe(400);
  });

  it("rejects a wrong password", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "scrypt$1$2" } });
    verifySharePassword.mockReturnValue(false);
    const { POST } = await load();
    const res = await POST(postReq({ password: "nope" }), ctx("x"));
    expect(res.status).toBe(401);
  });

  it("grants the gate pass and returns 200 on a correct password", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "scrypt$1$2" } });
    verifySharePassword.mockReturnValue(true);
    const { POST } = await load();
    const res = await POST(postReq({ password: "right" }), ctx("x"));
    expect(res.status).toBe(200);
    expect(grantGatePass).toHaveBeenCalled();
  });

  it("returns 503 when grantGatePass returns false (no secret configured)", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "scrypt$1$2" } });
    verifySharePassword.mockReturnValue(true);
    grantGatePass.mockResolvedValue(false);
    const { POST } = await load();
    const res = await POST(postReq({ password: "right" }), ctx("x"));
    expect(res.status).toBe(503);
  });

  it("rejects an email gate with an invalid email", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "email" } });
    const { POST } = await load();
    const res = await POST(postReq({ email: "not-an-email" }), ctx("x"));
    expect(res.status).toBe(400);
  });

  it("inserts a visit and grants a pass for a valid email", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "email" } });
    const { POST } = await load();
    const res = await POST(postReq({ email: "Ada@Example.com" }), ctx("x"));
    expect(res.status).toBe(200);
    expect(insertShareVisit).toHaveBeenCalledWith(expect.anything(), { shareId: "x", email: "ada@example.com" });
    expect(grantGatePass).toHaveBeenCalled();
  });

  it("rejects a body on a public share", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "public" } });
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("x"));
    expect(res.status).toBe(400);
  });

  it("rejects a body on a private share", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "private" } });
    const { POST } = await load();
    const res = await POST(postReq({ password: "x" }), ctx("x"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-JSON body", async () => {
    loadShare.mockResolvedValue({ share: { id: "x", org_id: "o", card_id: "c", mode: "password", password_hash: "x" } });
    const { POST } = await load();
    const res = await POST(new Request("http://localhost/api/s/x/unlock", { method: "POST", body: "not json" }), ctx("x"));
    expect(res.status).toBe(400);
  });
});
