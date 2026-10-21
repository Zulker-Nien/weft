import { describe, expect, it } from "vitest";
import { PROVIDERS, isKnownProvider } from "./webhook-signatures";
import { hmacHex, hmacSha1Hex, hmacSha256Hex } from "./webhook-signatures-hmac";

// The provider signature registry (lib/webhook-signatures.ts): each verifier must accept exactly what its
// provider signs and refuse everything else. These are the checks the deployed relay runs before it saves
// a delivery (pentest 2026-10-20, F-12); if one of them let a bad signature through, a stranger who guessed
// a relay id could write to the owner's localhost target.

const NOW = 1_700_000_000_000;
const body = '{"id":"evt_1","type":"ping"}';
const headers = (over: Record<string, string>) => over;

describe("hmac helpers", () => {
  it("matches the RFC test vectors for SHA-256 and SHA-1", () => {
    // RFC 4231 case 2: key "Jefe", data "what do ya want for nothing?".
    expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    // RFC 2202 case 2, the same key and data under SHA-1.
    expect(hmacSha1Hex("Jefe", "what do ya want for nothing?")).toBe("effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
  });

  it("hmacHex picks the algorithm, defaulting to SHA-256", () => {
    expect(hmacHex("k", "d")).toBe(hmacSha256Hex("k", "d"));
    expect(hmacHex("k", "d", "sha1")).toBe(hmacSha1Hex("k", "d"));
  });
});

describe("stripe", () => {
  const t = 1_700_000_000;
  const signed = (secret: string, b = body, ts = t) => headers({ "stripe-signature": `t=${ts},v1=${hmacHex(secret, `${ts}.${b}`)}` });

  it("accepts the signature Stripe would have sent", () => {
    expect(PROVIDERS.get("stripe")!.verify("whsec", body, signed("whsec"), NOW)).toBe(true);
  });

  it("refuses a signature from another secret, and one over a different body", () => {
    const v = PROVIDERS.get("stripe")!;
    expect(v.verify("whsec", body, signed("other"), NOW)).toBe(false);
    expect(v.verify("whsec", body, signed("whsec", `${body}x`), NOW)).toBe(false);
  });

  it("refuses a malformed or missing header without throwing", () => {
    const v = PROVIDERS.get("stripe")!;
    expect(v.verify("whsec", body, {}, NOW)).toBe(false);
    expect(v.verify("whsec", body, headers({ "stripe-signature": "garbage" }), NOW)).toBe(false);
    expect(v.verify("whsec", body, headers({ "stripe-signature": "t=1" }), NOW)).toBe(false);
  });

  it("takes the last v1 when Stripe sends more than one (key rotation)", () => {
    const good = hmacHex("whsec", `${t}.${body}`);
    const h = headers({ "stripe-signature": `t=${t},v1=${hmacHex("old", `${t}.${body}`)},v1=${good}` });
    expect(PROVIDERS.get("stripe")!.verify("whsec", body, h, NOW)).toBe(true);
  });
});

describe("github", () => {
  const good = headers({ "x-hub-signature-256": `sha256=${hmacSha256Hex("ghs", body)}` });

  it("accepts sha256= and refuses anything else", () => {
    const v = PROVIDERS.get("github")!;
    expect(v.verify("ghs", body, good, NOW)).toBe(true);
    expect(v.verify("other", body, good, NOW)).toBe(false);
    expect(v.verify("ghs", body, headers({ "x-hub-signature-256": hmacSha256Hex("ghs", body) }), NOW)).toBe(false);
    expect(v.verify("ghs", body, {}, NOW)).toBe(false);
  });
});

describe("vercel", () => {
  it("accepts the lowercase hex SHA-1 Vercel signs the body with", () => {
    const v = PROVIDERS.get("vercel")!;
    const h = headers({ "x-vercel-signature": hmacSha1Hex("vsec", body) });
    expect(v.verify("vsec", body, h, NOW)).toBe(true);
    expect(v.verify("other", body, h, NOW)).toBe(false);
    expect(v.verify("vsec", body, {}, NOW)).toBe(false);
  });
});

describe("svix", () => {
  const t = Math.floor(NOW / 1000);
  const id = "msg_2KxQp";
  const good = (skew = 0) =>
    headers({
      "svix-id": id,
      "svix-timestamp": String(t + skew),
      "svix-signature": `v1,${hmacSha256Hex("whsec", `${id}.${t + skew}.${body}`)}`,
    });

  it("accepts a fresh signature over id.timestamp.body", () => {
    const v = PROVIDERS.get("svix")!;
    expect(v.verify("whsec", body, good(), NOW)).toBe(true);
    expect(v.verify("whsec", body, good(120), NOW)).toBe(true);
    expect(v.verify("whsec", body, good(-120), NOW)).toBe(true);
  });

  it("refuses anything outside the 5-minute window, either way", () => {
    const v = PROVIDERS.get("svix")!;
    expect(v.verify("whsec", body, good(301), NOW)).toBe(false);
    expect(v.verify("whsec", body, good(-301), NOW)).toBe(false);
  });

  it("refuses a wrong secret, a missing part, and a wrong body", () => {
    const v = PROVIDERS.get("svix")!;
    expect(v.verify("other", body, good(), NOW)).toBe(false);
    expect(v.verify("whsec", `${body}x`, good(), NOW)).toBe(false);
    expect(v.verify("whsec", body, headers({ "svix-signature": "v1,ab", "svix-timestamp": String(t) }), NOW)).toBe(false);
    expect(v.verify("whsec", body, {}, NOW)).toBe(false);
  });

  it("accepts a space-separated list when the provider lists more than one signature", () => {
    const v = PROVIDERS.get("svix")!;
    const sig = hmacSha256Hex("whsec", `${id}.${t}.${body}`);
    const h = headers({ "svix-id": id, "svix-timestamp": String(t), "svix-signature": `v1,deadbeef v1,${sig}` });
    expect(v.verify("whsec", body, h, NOW)).toBe(true);
  });
});

describe("isKnownProvider", () => {
  it("knows the four providers the relay verifies, and nothing else", () => {
    for (const name of ["stripe", "github", "vercel", "svix"]) expect(isKnownProvider(name)).toBe(true);
    expect(isKnownProvider("generic")).toBe(false);
    expect(isKnownProvider("")).toBe(false);
  });
});