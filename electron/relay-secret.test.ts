import { describe, expect, it } from "vitest";
import { relayKeyFromEnv, sealSecret, sealedToHex } from "./relay-secret.cjs";

// The Electron-side secret sealing (electron/relay-secret.cjs): the same AES-256-GCM shape the
// deployed relay opens (lib/relay-secret.ts), so main can hand back ciphertext the deployed
// relay's WEFT_RELAY_SECRET_KEY opens (pentest 2026-10-20, F-12).

const KEY = Buffer.from("11".repeat(32), "hex");

describe("relayKeyFromEnv", () => {
  it("reads 64 hex chars and an optional key id, defaulting to v1", () => {
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: KEY.toString("hex") })).toEqual({ id: "v1", key: KEY });
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: KEY.toString("hex"), WEFT_RELAY_SECRET_KEY_ID: " v2 " })).toEqual({ id: "v2", key: KEY });
  });

  it("returns null when the env isn't set, isn't 64 chars, or isn't hex", () => {
    expect(relayKeyFromEnv({})).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "" })).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: "11".repeat(31) })).toBeNull();
    expect(relayKeyFromEnv({ WEFT_RELAY_SECRET_KEY: `${"11".repeat(32)}z` })).toBeNull();
  });
});

describe("sealSecret", () => {
  it("returns a sealed triple the server-side lib/relay-secret.ts can open with the same key", () => {
    const s = sealSecret("whsec_test", { id: "v1", key: KEY });
    const hex = sealedToHex(s);
    expect(hex.secret_key_id).toBe("v1");
    expect(hex.secret_ciphertext).toHaveLength(2 * ("whsec_test".length + 16)); // ciphertext + 16-byte GCM tag
    expect(hex.secret_nonce).toHaveLength(2 * 12);
  });

  it("uses a fresh nonce for every seal", () => {
    const a = sealSecret("whsec_test", { id: "v1", key: KEY });
    const b = sealSecret("whsec_test", { id: "v1", key: KEY });
    expect(a.nonce.equals(b.nonce)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
});
