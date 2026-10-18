// Grants for data mini apps (docs/architecture/mini-apps.md). A grant says: this app's folder, in this
// env, with these vault names, may read weft-app.json that hashes to this value. The file is 0600
// because the env label + the names still tell you what the user agreed to. Lives in its own file so
// app-data.cjs can stay focused on grants-then-IPC.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const GRANTS_FILE = "app-grants.json";

// Reads <dataDir>/app-grants.json. Empty/missing/garbage all mean "no grants". The on-disk shape
// is { grants: {...}, savedAt: ... } (savedGrants wraps it) so this unwraps to the grants map.
function loadGrants(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, GRANTS_FILE), "utf8"));
    const grants = raw && typeof raw === "object" ? raw.grants : undefined;
    return grants && typeof grants === "object" ? grants : {};
  } catch {
    return {};
  }
}

// 0600: a grants file lists vault names plus the env; values stay in the vault, but the env
// label plus the names still say what was granted.
function saveGrants(dataDir, grants, now = Date.now) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, GRANTS_FILE), JSON.stringify({ grants, savedAt: new Date(now()).toISOString() }, null, 2), { mode: 0o600 });
}

// The vault names a read kind needs (never values), unioned across all the app's reads.
function deriveNeeds(reads) {
  const needs = new Set();
  for (const read of Object.values(reads)) {
    if (read.supabase) needs.add("SUPABASE_SECRET_KEY");
    if (read.ga4) {
      needs.add("GA4_PROPERTY_ID");
      needs.add("GA4_SERVICE_ACCOUNT_JSON");
    }
  }
  return [...needs].sort();
}

// A hash over the reads object (and the supabaseUrl, since changing it changes what a supabase read
// would talk to). Order-independent: a manifest that reorders its reads is the same data app. The
// replacer sorts object keys at every level so two manifests with the same content but different
// key order hash to the same value.
function manifestHash(manifest) {
  const sorted = (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((acc, k) => { acc[k] = value[k]; return acc; }, {});
    }
    return value;
  };
  const obj = { env: manifest.env, folder: manifest.folder, supabaseUrl: manifest.supabaseUrl, reads: manifest.reads };
  return crypto.createHash("sha256").update(JSON.stringify(obj, sorted)).digest("hex").slice(0, 16);
}

// Compares a saved grant to the live manifest. A change in env, folder or needs voids it; the
// readsHash covers reads + supabaseUrl + folder + env so a manifest edit is caught too.
function effectiveGrant(grant, manifest, needs) {
  if (!grant) return null;
  if (grant.env !== manifest.env) return null;
  if (grant.folder !== manifest.folder) return null;
  if (grant.needs.length !== needs.length || needs.some((n, i) => grant.needs[i] !== n)) return null;
  if (grant.readsHash !== manifestHash(manifest)) return null;
  return grant;
}

module.exports = {
  loadGrants,
  saveGrants,
  deriveNeeds,
  manifestHash,
  effectiveGrant,
  GRANTS_FILE,
};
