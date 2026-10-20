// The crypto layer for cloud_app_secrets (supabase/migrations/20261019095618_app_hosting.sql): AES-256-GCM with a
// server-only key (process.env.WEFT_MINIAPP_KEY, base64 of 32 bytes). The same key never ships to a viewer or to
// the desktop: the value sits encrypted at rest and only this module unseals it on weft.zip. Associated data is
// `${shareId}|${name}|${viewerId ?? ""}` so a row moved to another app, name or viewer fails to open. The on-the-wire
// shape is "v1:" + base64(iv(12) | ciphertext | tag(16)) — one string per row.
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "v1:";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

// The fingerprint of a misconfigured key: wrong length, not base64, or just absent. Routes use it to answer 503
// instead of trying to seal a value that would round-trip wrong.
export class AppSecretsNotConfigured extends Error {
  constructor(message = "App secrets aren't set up on this server.") {
    super(message);
    this.name = "AppSecretsNotConfigured";
  }
}

// Reads WEFT_MINIAPP_KEY (base64 of 32 bytes). Caches the Buffer so the base64 decode only runs once per process.
let cached: { env: string | undefined; key: Buffer | null } = { env: undefined, key: null };
function loadKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  if (cached.env === env.WEFT_MINIAPP_KEY) return cached.key;
  const raw = env.WEFT_MINIAPP_KEY;
  if (!raw) {
    cached = { env: raw, key: null };
    return null;
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    cached = { env: raw, key: null };
    return null;
  }
  const ok = key.length === KEY_LEN && key.toString("base64") === raw.replace(/\s+/g, "");
  cached = { env: raw, key: ok ? key : null };
  return cached.key;
}

// The context that binds a ciphertext to its row: share id, name, and viewer id (null for the author's own value).
// A row copied to another share, name or viewer fails to open because the AAD changes.
export interface SecretContext {
  shareId: string;
  name: string;
  viewerId: string | null;
}

// AAD = "${shareId}|${name}|${viewerId ?? \"\"}" — three parts so swapping any one breaks the tag.
function aad(ctx: SecretContext): Buffer {
  const viewer = ctx.viewerId ?? "";
  return Buffer.from(`${ctx.shareId}|${ctx.name}|${viewer}`, "utf8");
}

// seal(plain, ctx) → "v1:" + base64(iv(12) | ciphertext | tag(16)). Throws AppSecretsNotConfigured when the key
// is missing or malformed, so the route can return 503 instead of saving a value that won't open.
export function seal(plain: string, ctx: SecretContext, env: Record<string, string | undefined> = process.env): string {
  const key = loadKey(env);
  if (!key) throw new AppSecretsNotConfigured();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(ctx));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, enc, tag]).toString("base64");
}

// open(sealed, ctx) → plain. Throws AppSecretsNotConfigured when the key is missing, AppSecretsTampered when the
// prefix, the AAD, the tag, or any byte of the ciphertext is wrong. Both errors are caught at the route boundary
// and answered as 503 / 500 — a wrong value is never returned as a value.
export class AppSecretsTampered extends Error {
  constructor(message = "Secret was tampered with.") {
    super(message);
    this.name = "AppSecretsTampered";
  }
}

export function open(sealed: string, ctx: SecretContext, env: Record<string, string | undefined> = process.env): string {
  const key = loadKey(env);
  if (!key) throw new AppSecretsNotConfigured();
  if (typeof sealed !== "string" || !sealed.startsWith(PREFIX)) throw new AppSecretsTampered();
  let blob: Buffer;
  try {
    blob = Buffer.from(sealed.slice(PREFIX.length), "base64");
  } catch {
    throw new AppSecretsTampered();
  }
  if (blob.length < IV_LEN + TAG_LEN) throw new AppSecretsTampered();
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const enc = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    throw new AppSecretsTampered();
  }
}

// Whether the server is set up to seal or open a value at all. Used by routes that need a 503 answer on the gate
// (an env route shouldn't 500 just because WEFT_MINIAPP_KEY is missing).
export function isConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return loadKey(env) !== null;
}
