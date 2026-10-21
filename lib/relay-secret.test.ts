import { describe, expect, it } from "vitest";
import { openSecret, relayKeyFromEnv, sealSecret, sealedFromHex, sealedToHex } from "./relay-secret";

// The relay's signing secret encryption (lib/relay-secret.ts). AES-256-GCM with a fresh nonce and the tag
// on the end of the ciphertext. Anything that tampers with the bytes refuses to open: that's the same
// signal the relay reads as "I can't verify this delivery, drop it".

const KEY = { id: "v1", key: Buffer.from("11".repeat(32), "hex") };

describe("relayKeyFromEnv", () => {
  it("reads 64 hex chars and an optional key id from the environment, falling back to v1", () => {
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "11".repeat(32) })).toEqual({ id: "v1", key: Buffer.from("11".repeat(32), "hex") });
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "11".repeat(32), WEFT_RELAY_SECRET_KEY_ID: " v2 " })).toEqual({ id: "v2", key: Buffer.from("11".repeat(32), "hex") });
  });

  it("returns null when the key isn't set, isn't 64 chars, or isn't hex", () => {
    expect(relayKeyFromEnv({})).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "" })).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "11".repeat(31) })).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "11".repeat(32) + "z" })).toBeNull();
  });
});

describe("seal / open", () => {
  it("round-trips the plaintext under the same key", () => {
    const s = sealSecret("whsec_test", KEY);
    expect(openSecret(s, KEY)).toBe("whsec_test");
  });

  it("never reuses a nonce: every seal of the same plaintext produces different ciphertext bytes", () => {
    const a = sealSecret("whsec_test", KEY);
    const b = sealSecret("whsec_test", KEY);
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("refuses to open when the key id doesn't match (key rotation in flight)", () => {
    const s = sealSecret("whsec_test", KEY);
    expect(openSecret(s, { id: "v2", key: KEY.key })).toBeNull();
  });

  it("refuses to open when a byte of ciphertext is flipped (GCM auth tag)", () => {
    const s = sealSecret("whsec_test", KEY);
    s.ciphertext[0] = s.ciphertext[0]! ^ 0x01;
    expect(openSecret(s, KEY)).toBeNull();
  });

  it("refuses to open when the key is unknown or the sealed parts are absent", () => {
    const s = sealSecret("whsec_test", KEY);
    expect(openSecret(s, null)).toBeNull();
    expect(openSecret(null, KEY)).toBeNull();
    expect(openSecret({}, KEY)).toBeNull();
    expect(openSecret({ ...s, nonce: undefined }, KEY)).toBeNull();
  });

  it("rejects forged ciphertext bytes carried in from JSON (string form)", () => {
    const s = sealSecret("whsec_test", KEY);
    s.ciphertext = "not-hex" as unknown as Buffer;
    expect(openSecret(s, KEY)).toBeNull();
  });
});

describe("hex (de)serialisation", () => {
  it("carries the row form Supabase will store", () => {
    const s = sealSecret("whsec_test", KEY);
    const hex = sealedToHex(s);
    expect(hex).toEqual({
      secret_ciphertext: s.ciphertext.toString("hex"),
      secret_nonce: s.nonce.toString("hex"),
      secret_key_id: "v1",
    });
    const back = sealedFromHex(hex)!;
    expect(openSecret(back, KEY)).toBe("whsec_test");
  });

  it("returns null from sealedFromHex when any required part is missing or not a string", () => {
    expect(sealedFromHex({})).toBeNull();
    expect(sealedFromHex({ secret_ciphertext: "ab", secret_nonce: "cd", secret_key_id: 5 })).toBeNull();
  });
});