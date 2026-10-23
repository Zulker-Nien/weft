// Keep Working's settings, in ~/.weft/keep-working.json: auto (Always while threads run), the battery
// floor sleep comes back at, and whether it holds only while the Mac is online.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PREFS_FILE = path.join(os.homedir(), ".weft", "keep-working.json");
const BATTERY_CHOICES = [5, 10, 20, 30, 50];
const DEFAULT_PREFS = { auto: false, minBattery: 10, onlineOnly: false };

// Keeps only known keys with sane values, so a hand-edited file or a stray IPC patch can't set odd ones.
function cleanPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const out = {};
  if (typeof p.auto === "boolean") out.auto = p.auto;
  if (BATTERY_CHOICES.includes(p.minBattery)) out.minBattery = p.minBattery;
  if (typeof p.onlineOnly === "boolean") out.onlineOnly = p.onlineOnly;
  return out;
}

function readPrefs(file) {
  try {
    return { ...DEFAULT_PREFS, ...cleanPrefs(JSON.parse(fs.readFileSync(file, "utf8"))) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(file, prefs) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(prefs)}\n`);
  } catch (err) {
    console.error("keep-working prefs:", err);
  }
}

module.exports = { BATTERY_CHOICES, DEFAULT_PREFS, PREFS_FILE, cleanPrefs, readPrefs, writePrefs };
