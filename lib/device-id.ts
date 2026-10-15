// A stable random id for this Mac, used as the "owner_device" on every cloud_cards row it uploads
// (lib/cloud-sync-types.ts). One per machine: created on first read, chmod 0o600, never reused.
// Reads on every call so tests that rm the file see a fresh id; the lazy value lives in the module.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

export const DEVICE_ID_FILE = path.join(DATA_DIR, "device-id");

// 32 random bytes as 64 hex chars; 128 bits is plenty to keep two devices apart forever.
function mint(): string {
  return randomBytes(32).toString("hex");
}

export function deviceId(): string {
  if (fs.existsSync(DEVICE_ID_FILE)) {
    const saved = fs.readFileSync(DEVICE_ID_FILE, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return saved;
  }
  fs.mkdirSync(path.dirname(DEVICE_ID_FILE), { recursive: true });
  const id = mint();
  fs.writeFileSync(DEVICE_ID_FILE, id, { mode: 0o600 });
  return id;
}
