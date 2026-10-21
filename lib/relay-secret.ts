// The signing secret a webhook relay verifies with, encrypted at rest on Weft's Supabase
// (pentest 2026-10-20, F-12). The plain secret lives only in the user's Mac vault; the deployed
// relay (Vercel) has to be able to verify a provider's HMAC, so the local Weft encrypts the secret
// on the way in and stores ciphertext + nonce + key id in webhook_relays. The deployed relay
// decrypts only inside the verify call, with WEFT_RELAY_SECRET_KEY from its environment. A key id
// the deployment doesn't recognise refuses the delivery rather than failing open.

import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The deployment's key. Absent means the relay can't verify anything (and refuses), not that it
// accepts unsigned deliveries.
export interface RelayKey {
  id: string;
  key: Buffer;
}

const NONCE_BYTES = 12;
const ALGO = "aes-256-gcm";

// Reads WEFT_RELAY_SECRET_KEY (64 hex chars) and WEFT_RELAY_SECRET_KEY_ID (defaults to "v1").
// Returns null when the deployment has no usable key — the caller then refuses every delivery.
export function relayKeyFromEnv(env: Record<string, string | undefined> = process.env): RelayKey | null {
  const hex = env.WEFT_RELAY_SECRET_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return { id: env.WEFT_RELAY_SECRET_KEY_ID?.trim() || "v1", key: Buffer.from(hex, "hex") };
}

export interface SealedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: string;
}

// AES-256-GCM with a fresh nonce per seal. The GCM tag rides on the end of the ciphertext, so
// decrypt throws on any tampering (the relay treats a throw as "signature cannot be verified").
export function sealSecret(plain: string, key: RelayKey): SealedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce, keyId: key.id };
}

// The plain secret, or null when the row is unsealed / the key is unknown / the bytes don't auth.
// Never throws; a null is the "refuse" signal.
export function openSecret(sealed: Partial<SealedSecret> | null | undefined, key: RelayKey | null): string | null {
  if (!key || !sealed?.ciphertext || !sealed.nonce || sealed.keyId !== key.id) return null;
  try {
    const data = Buffer.isBuffer(sealed.ciphertext) ? sealed.ciphertext : Buffer.from(sealed.ciphertext);
    const tag = data.subarray(data.length - 16);
    const body = data.subarray(0, data.length - 16);
    const decipher = createDecipheriv(ALGO, key.key, Buffer.from(sealed.nonce));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Hex form, for the tests and for anything crossing JSON. The Supabase REST row stores the
// ciphertext as bytea, so we hand the caller Buffers and let the store encode.
export const sealedToHex = (sealed: SealedSecret) => ({
  secret_ciphertext: sealed.ciphertext.toString("hex"),
  secret_nonce: sealed.nonce.toString("hex"),
  secret_key_id: sealed.keyId,
});

export const sealedFromHex = (row: Record<string, unknown>): SealedSecret | null => {
  const c = row.secret_ciphertext;
  const n = row.secret_nonce;
  const k = row.secret_key_id;
  if (typeof c !== "string" || typeof n !== "string" || typeof k !== "string") return null;
  return { ciphertext: Buffer.from(c, "hex"), nonce: Buffer.from(n, "hex"), keyId: k };
};