// This device's vault keypair (docs/architecture/secrets.md): made on first use, the public half kept as is
// and the private half encrypted by Electron's safeStorage, whose key lives in the macOS Keychain. Without
// safeStorage there's nowhere safe to keep it, so Weft refuses rather than writing the key in the clear.
const fs = require("node:fs");
const path = require("node:path");

const FILE = "device-key.json";

/** @returns {{ publicKey: string, privateKey: string }} */
function loadDeviceKey({ dir, safeStorage, crypto }) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("The Keychain isn't available, so the vault can't keep its key safely.");
  const file = path.join(dir, FILE);
  if (fs.existsSync(file)) {
    /** @type {{ publicKey: string, privateKey: string }} */
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return { publicKey: saved.publicKey, privateKey: safeStorage.decryptString(Buffer.from(saved.privateKey, "base64")) };
  }
  const pair = crypto.newKeypair();
  fs.mkdirSync(dir, { recursive: true });
  const sealed = safeStorage.encryptString(pair.privateKey).toString("base64");
  fs.writeFileSync(file, JSON.stringify({ publicKey: pair.publicKey, privateKey: sealed, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  return pair;
}

module.exports = { loadDeviceKey, DEVICE_KEY_FILE: FILE };
