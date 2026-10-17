// lib/share-gate.ts: the share gate factory. The dev constant is used in non-production and a
// configured value in production; a missing value in production refuses to mint or verify.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookiesStore = vi.hoisted(() => ({
  jar: new Map<string, { name: string; value: string }>(),
}));

vi.mock("next/headers", () => ({
  cookies() {
    return Promise.resolve({
      get: (name: string) => cookiesStore.jar.get(name),
      set: (name: string, value: string) => {
        cookiesStore.jar.set(name, { name, value });
      },
    });
  },
}));

async function load(env: NodeJS.ProcessEnv, originalNodeEnv: string | undefined) {
  vi.resetModules();
  // Stub env BEFORE the module re-imports, so its module-scope reads see the right value.
  for (const k of Object.keys(env)) process.env[k] = env[k];
  if (originalNodeEnv !== undefined) (process.env as Record<string, string>).NODE_ENV = originalNodeEnv;
  else delete (process.env as Record<string, string | undefined>).NODE_ENV;
  return import("./share-gate");
}

beforeEach(() => {
  cookiesStore.jar.clear();
  _resetAllEnvs();
});

afterEach(() => {
  _resetAllEnvs();
});

function _resetAllEnvs() {
  delete process.env.SHARE_GATE_SECRET;
  delete (process.env as Record<string, string | undefined>).NODE_ENV;
}

describe("getShareGate", () => {
  it("returns a kit whose cookie name is namespaced and deterministic", async () => {
    const { getShareGate } = await load({ NODE_ENV: "development" }, "development");
    const kit = getShareGate();
    expect(kit.cookieName("share-abc")).toBe(kit.cookieName("share-abc"));
    expect(kit.cookieName("share-abc")).toMatch(/^weft_share_[0-9a-f]{16}$/);
  });

  it("mints a verifiable pass with the dev secret in development", async () => {
    const { getShareGate } = await load({ NODE_ENV: "development" }, "development");
    const kit = getShareGate();
    const value = kit.sign("share-abc");
    expect(value).toBeTruthy();
    expect(kit.verify("share-abc", value ?? undefined)).toBe(true);
  });

  it("refuses to sign in production with no SHARE_GATE_SECRET set", async () => {
    const { getShareGate } = await load({ NODE_ENV: "production" }, "production");
    const kit = getShareGate();
    expect(kit.sign("share-abc")).toBeNull();
  });

  it("refuses to verify with no SHARE_GATE_SECRET set in production", async () => {
    const { getShareGate } = await load({ NODE_ENV: "production" }, "production");
    const kit = getShareGate();
    expect(kit.verify("share-abc", "anything")).toBe(false);
  });

  it("uses an explicit SHARE_GATE_SECRET when set in production", async () => {
    const { getShareGate } = await load({ NODE_ENV: "production", SHARE_GATE_SECRET: "rotated-secret" }, "production");
    const kit = getShareGate();
    const value = kit.sign("share-abc");
    expect(value).toBeTruthy();
    expect(kit.verify("share-abc", value ?? undefined)).toBe(true);
  });

  it("refuses an expired pass", async () => {
    const { getShareGate } = await load({ NODE_ENV: "production", SHARE_GATE_SECRET: "sec" }, "production");
    const kit = getShareGate();
    // Build a pass that's already past the expiry by stuffing a tiny TTL on a fresh kit.
    const { createShareGate } = await import("@aimhuge/share/server");
    const fresh = createShareGate({ cookiePrefix: "weft_share_", secret: () => "sec", nameSecret: () => "sec", ttlMs: 1 });
    const value = fresh.sign("id");
    expect(value).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    expect(fresh.verify("id", value ?? undefined)).toBe(false);
    // The dev kit (with its default 30d ttl) still verifies a value it signed; the production
    // gate built with SHARE_GATE_SECRET="sec" shares the secret so it verifies the same value.
    expect(kit.verify("id", value ?? undefined)).toBe(false);
  });

  it("rebuilds the kit when the env value rotates", async () => {
    const { getShareGate, _resetShareGateCache } = await load({ NODE_ENV: "production", SHARE_GATE_SECRET: "v1" }, "production");
    const a = getShareGate();
    const v1Pass = a.sign("id");
    expect(v1Pass).toBeTruthy();
    expect(a.verify("id", v1Pass ?? undefined)).toBe(true);
    _resetShareGateCache();
    process.env.SHARE_GATE_SECRET = "v2";
    const b = getShareGate();
    // The new secret can't verify a v1 pass.
    expect(b.verify("id", v1Pass ?? undefined)).toBe(false);
  });

  it("caches the kit for the same env value", async () => {
    const { getShareGate } = await load({ NODE_ENV: "development" }, "development");
    const a = getShareGate();
    const b = getShareGate();
    expect(a).toBe(b);
  });
});
