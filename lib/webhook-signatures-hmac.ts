// HMAC helpers shared by the provider signature verifiers (lib/webhook-signatures.ts) and the
// GitHub/Vercel relays (lib/github-relay.ts, lib/vercel-relay.ts). Kept tiny so the dependency line
// stays obvious to a future reader; both relays used the Web Crypto variant and the new node:crypto
// path used by the relay — picking one keeps the relays consistent.

import { createHmac } from "node:crypto";

const HEX = (bytes: Buffer): string => bytes.toString("hex");

// HMAC-SHA256 of `data` keyed by `secret`, returned as lowercase hex.
export function hmacSha256Hex(secret: string, data: string): string {
  return HEX(createHmac("sha256", secret).update(data).digest());
}

// HMAC-SHA1, which Vercel uses for its webhook signature. The relay wants the same byte-exact body
// Vercel saw; the verifier below calls it the same way.
export function hmacSha1Hex(secret: string, data: string): string {
  return HEX(createHmac("sha1", secret).update(data).digest());
}

// HMAC algorithm picker used by lib/webhook-signatures.ts vercel provider.
export function hmacHex(secret: string, data: string, algo: "sha256" | "sha1" = "sha256"): string {
  return algo === "sha1" ? hmacSha1Hex(secret, data) : hmacSha256Hex(secret, data);
}
