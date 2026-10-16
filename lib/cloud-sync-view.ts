// What the Settings → Sync page shows (lib/use-cloud-sync.ts, components/SyncSettings.tsx). Mirrors the
// JSON the local /api/cloud-sync route returns. Kept in its own view file so the client and the server
// share the type without either side pulling in the other's modules (lib/cloud-sync.ts reads ~/.weft).

export interface CloudSyncStatus {
  // Entries still in the outbox, waiting to ship.
  waiting: number;
  // Unix ms the last successful flush ended; null if it never has.
  lastSyncAt: number | null;
  // Items uploaded since cloud sync started, across every flush.
  uploaded: number;
  // The last error's message, cleared on the next success. null when there's none yet.
  lastError: string | null;
  // True when the account client threw (a build with no accounts) or signed out.
  signedOut: boolean;
  // True when the signed-in user has no workspace yet.
  noWorkspace: boolean;
}
