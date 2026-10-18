// lib/share-unlock.ts: the share gate's submit, used by both /api/s/[id]/unlock (cards) and
// /api/a/[id]/unlock (mini apps). The body matches what ShareGateForm posts: { password } for a
// password gate, { email } for an email gate. Every branch — off Vercel, rate-limited, missing
// pepper, bad JSON, missing share / service, password / email / public / private modes, grant
// failing — gets its own test, the same set covered in app/api/s/[id]/unlock/routes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockTarget } from "./share-unlock";

const { grantGatePass, verifySharePassword, getShareGate, serviceClient, checkAndRecord, hashIp } = vi.hoisted(() => ({
  grantGatePass: vi.fn(),
  verifySharePassword: vi.fn(),
  getShareGate: vi.fn(),
  serviceClient: vi.fn(),
  checkAndRecord: vi.fn(),
  hashIp: vi.fn(),
}));

vi.mock("@/lib/share-gate", () => ({ getShareGate }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/share-unlock-rate", () => ({ checkAndRecord, hashIp }));
vi.mock("@aimhuge/share/server", () => ({ grantGatePass, verifySharePassword }));

async function load() {
  vi.resetModules();
  return import("./share-unlock");
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
  hashIp.mockImplementation((ip: string) => `hash:${ip}`);
  checkAndRecord.mockResolvedValue({ allowed: true, windowResetAt: Date.now() + 60_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SHARE_UNLOCK_PEPPER;
  delete process.env.VERCEL;
});

// vi.fn() mocks stand in for the target's two functions.
function target(load: ReturnType<typeof vi.fn>, recordVisit: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve())): UnlockTarget {
  return { load, recordVisit } as unknown as UnlockTarget;
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/unlock", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

describe("unlockShare", () => {
  it("answers 503 off Vercel, where x-real-ip is caller-controlled (F-6)", async () => {
    delete process.env.VERCEL;
    const { unlockShare } = await load();
    const t = target(vi.fn(), vi.fn());
    const res = await unlockShare(postReq({ password: "x" }, { "x-real-ip": "1.1.1.1" }), "x", t);
    expect(res.status).toBe(503);
    expect(checkAndRecord).not.toHaveBeenCalled();
    expect(t.load).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when the shared rate limit denies the attempt", async () => {
    checkAndRecord.mockResolvedValue({ allowed: false, windowResetAt: Date.now() + 30_000 });
    const { unlockShare } = await load();
    const t = target(vi.fn(), vi.fn());
    const res = await unlockShare(postReq({ password: "wrong" }, { "x-real-ip": "1.1.1.1" }), "x", t);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("skips the rate check when SHARE_UNLOCK_PEPPER isn't set (route stays 503-able)", async () => {
    delete process.env.SHARE_UNLOCK_PEPPER;
    const { unlockShare } = await load();
    const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: "scrypt$1$2" }), vi.fn());
    verifySharePassword.mockReturnValue(false);
    const res = await unlockShare(postReq({ password: "wrong" }, { "x-real-ip": "1.1.1.1" }), "x", t);
    expect(res.status).toBe(401);
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-JSON body", async () => {
    const { unlockShare } = await load();
    const t = target(vi.fn(), vi.fn());
    const res = await unlockShare(new Request("http://localhost/unlock", { method: "POST", body: "not json" }), "x", t);
    expect(res.status).toBe(400);
  });

  it("returns 503 when target.load returns null (no such share)", async () => {
    const { unlockShare } = await load();
    const t = target(vi.fn().mockResolvedValue(null), vi.fn());
    const res = await unlockShare(postReq({ password: "x" }), "x", t);
    expect(res.status).toBe(503);
  });

  it("returns 503 when the service client is missing", async () => {
    serviceClient.mockReturnValue(null);
    const { unlockShare } = await load();
    const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: "scrypt$1$2" }), vi.fn());
    const res = await unlockShare(postReq({ password: "x" }), "x", t);
    expect(res.status).toBe(503);
  });

  describe("password mode", () => {
    it("returns 400 when the body has no password", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: null }), vi.fn());
      const res = await unlockShare(postReq({ email: "x@y" }), "x", t);
      expect(res.status).toBe(400);
    });

    it("returns 401 for a wrong password", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: "scrypt$1$2" }), vi.fn());
      verifySharePassword.mockReturnValue(false);
      const res = await unlockShare(postReq({ password: "nope" }), "x", t);
      expect(res.status).toBe(401);
    });

    it("checks against no hash when the row carries none", async () => {
      const { unlockShare } = await load();
      verifySharePassword.mockReturnValue(false);
      const res = await unlockShare(postReq({ password: "nope" }), "x", target(vi.fn().mockResolvedValue({ mode: "password" }), vi.fn()));
      expect(verifySharePassword).toHaveBeenCalledWith("nope", null);
      expect(res.status).toBe(401);
    });

    it("grants the gate pass on a correct password", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: "scrypt$1$2" }), vi.fn());
      verifySharePassword.mockReturnValue(true);
      const res = await unlockShare(postReq({ password: "right" }), "x", t);
      expect(res.status).toBe(200);
      expect(grantGatePass).toHaveBeenCalled();
    });

    it("returns 503 when grantGatePass returns false (no secret configured)", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "password", password_hash: "scrypt$1$2" }), vi.fn());
      verifySharePassword.mockReturnValue(true);
      grantGatePass.mockResolvedValue(false);
      const res = await unlockShare(postReq({ password: "right" }), "x", t);
      expect(res.status).toBe(503);
    });
  });

  describe("email mode", () => {
    it("returns 400 for an invalid email", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "email" }), vi.fn());
      const res = await unlockShare(postReq({ email: "not-an-email" }), "x", t);
      expect(res.status).toBe(400);
    });

    it("inserts a visit (lowercased) and grants a pass for a valid email", async () => {
      const recordVisit = vi.fn(() => Promise.resolve());
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "email" }), recordVisit);
      const res = await unlockShare(postReq({ email: "Ada@Example.com" }), "x", t);
      expect(res.status).toBe(200);
      expect(recordVisit).toHaveBeenCalledWith(expect.anything(), { shareId: "x", email: "ada@example.com" });
      expect(grantGatePass).toHaveBeenCalled();
    });

    it("returns 503 when grantGatePass fails on an email share", async () => {
      const { unlockShare } = await load();
      const t = target(vi.fn().mockResolvedValue({ mode: "email" }), vi.fn());
      grantGatePass.mockResolvedValue(false);
      const res = await unlockShare(postReq({ email: "ada@example.com" }), "x", t);
      expect(res.status).toBe(503);
    });
  });

  it("returns 400 for a body on a public share", async () => {
    const { unlockShare } = await load();
    const t = target(vi.fn().mockResolvedValue({ mode: "public" }), vi.fn());
    const res = await unlockShare(postReq({ password: "x" }), "x", t);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a body on a private share", async () => {
    const { unlockShare } = await load();
    const t = target(vi.fn().mockResolvedValue({ mode: "private" }), vi.fn());
    const res = await unlockShare(postReq({ password: "x" }), "x", t);
    expect(res.status).toBe(400);
  });
});
