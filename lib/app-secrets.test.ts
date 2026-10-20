// lib/app-secrets.ts: AES-256-GCM with associated data ${shareId}|${name}|${viewerId ?? ""}. Round-trip plus the
// cases that should fail: a different key, a different share id, a different name, a different viewer, a
// flipped byte, a missing or short key, and a row that didn't carry the v1: prefix.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppSecretsNotConfigured, AppSecretsTampered, isConfigured, open, seal } from "./app-secrets";

const KEY = randomBytes(32).toString("base64");
const ENV = { WEFT_MINIAPP_KEY: KEY };
const CTX = { shareId: "sh-1", name: "STRIPE_KEY", viewerId: null };

function goodKeyEnv() {
  return { WEFT_MINIAPP_KEY: KEY };
}

describe("app-secrets", () => {
  it("round-trips a value with the configured key", () => {
    const sealed = seal("sk_live_abc123", CTX, ENV);
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(open(sealed, CTX, ENV)).toBe("sk_live_abc123");
  });

  it("round-trips an empty string and a long string", () => {
    const empty = seal("", CTX, ENV);
    expect(open(empty, CTX, ENV)).toBe("");
    const long = seal("x".repeat(4096), CTX, ENV);
    expect(open(long, CTX, ENV)).toBe("x".repeat(4096));
  });

  it("round-trips each call with a fresh iv", () => {
    const a = seal("sk_live_abc123", CTX, ENV);
    const b = seal("sk_live_abc123", CTX, ENV);
    expect(a).not.toBe(b);
    expect(open(a, CTX, ENV)).toBe("sk_live_abc123");
    expect(open(b, CTX, ENV)).toBe("sk_live_abc123");
  });

  it("refuses to seal when WEFT_MINIAPP_KEY is missing", () => {
    expect(() => seal("v", CTX, {})).toThrow(AppSecretsNotConfigured);
  });

  it("refuses to seal when WEFT_MINIAPP_KEY isn't 32 bytes of base64", () => {
    expect(() => seal("v", CTX, { WEFT_MINIAPP_KEY: "short" })).toThrow(AppSecretsNotConfigured);
    expect(() => seal("v", CTX, { WEFT_MINIAPP_KEY: randomBytes(16).toString("base64") })).toThrow(AppSecretsNotConfigured);
  });

  it("isConfigured follows the same rules", () => {
    expect(isConfigured({ WEFT_MINIAPP_KEY: KEY })).toBe(true);
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ WEFT_MINIAPP_KEY: "short" })).toBe(false);
  });

  it("refuses to open with a different key", () => {
    const sealed = seal("v", CTX, ENV);
    const other = randomBytes(32).toString("base64");
    expect(() => open(sealed, CTX, { WEFT_MINIAPP_KEY: other })).toThrow(AppSecretsTampered);
  });

  it("refuses to open when the share id differs (AAD mismatch)", () => {
    const sealed = seal("v", CTX, ENV);
    expect(() => open(sealed, { ...CTX, shareId: "sh-2" }, ENV)).toThrow(AppSecretsTampered);
  });

  it("refuses to open when the name differs (AAD mismatch)", () => {
    const sealed = seal("v", CTX, ENV);
    expect(() => open(sealed, { ...CTX, name: "OTHER_KEY" }, ENV)).toThrow(AppSecretsTampered);
  });

  it("refuses to open when the viewer id differs (AAD mismatch)", () => {
    const sealed = seal("v", CTX, ENV);
    expect(() => open(sealed, { ...CTX, viewerId: "user-1" }, ENV)).toThrow(AppSecretsTampered);
    // And a viewer→author swap is also a refusal.
    const viewer = seal("v", { ...CTX, viewerId: "user-1" }, ENV);
    expect(() => open(viewer, CTX, ENV)).toThrow(AppSecretsTampered);
  });

  it("refuses to open when the ciphertext is tampered with", () => {
    const sealed = seal("v", CTX, ENV);
    const body = sealed.slice("v1:".length);
    const decoded = Buffer.from(body, "base64");
    decoded[decoded.length - 1] = decoded[decoded.length - 1]! ^ 0x01;
    const tampered = "v1:" + decoded.toString("base64");
    expect(() => open(tampered, CTX, ENV)).toThrow(AppSecretsTampered);
  });

  it("refuses to open a sealed value that doesn't carry the v1: prefix", () => {
    expect(() => open("not-a-sealed-value", CTX, ENV)).toThrow(AppSecretsTampered);
    expect(() => open("v0:abc", CTX, ENV)).toThrow(AppSecretsTampered);
  });

  it("refuses to open a value that's too short to hold iv + tag", () => {
    expect(() => open("v1:" + Buffer.alloc(10).toString("base64"), CTX, ENV)).toThrow(AppSecretsTampered);
  });

  it("caches the key per env reference so the same config stays fast", () => {
    seal("a", CTX, goodKeyEnv());
    seal("b", CTX, goodKeyEnv());
    expect(open(seal("c", CTX, goodKeyEnv()), CTX, goodKeyEnv())).toBe("c");
  });
});
