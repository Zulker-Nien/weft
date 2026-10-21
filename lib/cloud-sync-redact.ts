// What leaves the Mac for Supabase: every free-text string in a synced card, thread item or tool output goes through
// the share redactor (lib/share-redact.ts) first, so a key that reached a thread (pasted, printed by a tool, echoed in
// an error) never lands in rows every workspace member can read (pentest 2026-10-20, P-2). The raw text stays local.
import { redactText } from "./share-redact";
import type { CloudCardRow, CloudThreadItemRow, CloudToolOutputRow } from "./cloud-sync-types";

// Identifiers and paths the rows and the web board key on. None of them is free text a key could be pasted into.
const KEEP = new Set(["id", "sessionId", "cwd", "thumb", "tool_id", "toolId", "pendingId"]);

export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, KEEP.has(k) ? v : redactValue(v)])) as T;
  }
  return value;
}

export const redactCardRow = (row: CloudCardRow): CloudCardRow => ({ ...row, card: redactValue(row.card) });

export const redactItemRow = (row: CloudThreadItemRow): CloudThreadItemRow => ({ ...row, item: redactValue(row.item) });

export const redactOutputRow = (row: CloudToolOutputRow): CloudToolOutputRow => ({ ...row, result: redactText(row.result) });
