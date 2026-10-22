// How every provider integration keeps its token in the Keychain, written once. Vercel, Supabase and
// Cloudflare each had a byte-identical `token()` reader and a `setToken()` whose last four lines were the
// same persist step; BlastCP had the reader plus an `expiresAt` beside it. Four copies of the code that
// guards a secret file's mode is four places for a fix to land in three.
//
// A token record is `{ token, savedAt }` in ~/.weft, the token base64 of safeStorage's encrypted bytes and
// the file 0600. BlastCP's record adds `expiresAt` and `clientId` (its OAuth sign-in) — writeToken takes
// those as `extra`, so the reader here is the one that knows nothing about them.
//
// CommonJS in electron/ because main can't import a .ts module and only electron/** ships in the packaged
// app. safeStorage is injected (Electron's, or a fake in a test), never required from electron here.

const fs = require("node:fs");
const path = require("node:path");

/**
 * A saved token record. `token` is base64 of safeStorage's encrypted bytes, never the token in plain;
 * `expiresAt` and `clientId` are BlastCP's OAuth sign-in, absent for the plain API tokens.
 * @typedef {{ token: string, savedAt: string, expiresAt?: string | null, clientId?: string }} TokenRecord
 */

/**
 * Electron's safeStorage, or a fake of the three methods used here.
 * @typedef {{ isEncryptionAvailable(): boolean, encryptString(text: string): Buffer, decryptString(buf: Buffer): string }} Keychain
 */

// The token, or null when there is none saved yet. A corrupt or half-written record throws: a token the
// user thinks they saved but that can't be read is a problem worth seeing, not a silent sign-out.
/** @returns {string | null} */
function readToken(file, safeStorage) {
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  return safeStorage.decryptString(Buffer.from(saved.token, "base64"));
}

// Same, plus the extra fields a record carries beside the token (BlastCP's expiresAt and clientId).
// Returns null or the whole record with its token already decrypted.
/** @returns {TokenRecord | null} */
function readTokenRecord(file, safeStorage) {
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return { ...data, token: safeStorage.decryptString(Buffer.from(data.token, "base64")) };
}

// Refuse before anything is written when the Keychain can't encrypt, so no plaintext token ever reaches
// disk. `what` names the credential in the refusal ("token", "BlastCP sign-in"), because that sentence is
// the only thing a user sees when their Keychain is locked.
function requireKeychain(safeStorage, what = "token") {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`The Keychain isn't available, so Weft can't keep the ${what} safely.`);
  }
}

// Encrypt and write the record at 0600, creating ~/.weft if it's the first one. The mode is the point of
// this module: a token readable by another account on the Mac is a leaked token. writeFileSync's `mode`
// only applies when it CREATES the file — a rewrite of an existing file keeps whatever mode that file has
// — so it's chmod'd after the write as well, or a record loosened once (a stray chmod, a restore from a
// backup, a copy in from another machine) stays readable through every later rewrite. `extra` merges into
// the record (expiresAt).
/** @returns {TokenRecord} */
function writeToken(file, safeStorage, token, extra = {}) {
  const record = {
    token: safeStorage.encryptString(token).toString("base64"),
    ...extra,
    savedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return record;
}

module.exports = { readToken, readTokenRecord, requireKeychain, writeToken };