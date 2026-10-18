// A mini app link's access gate (lib/app-share-types.ts): one cloud_app_shares row, checked the way a card's link is
// (lib/share-access.ts gateVerdict: the mode, the workspace membership, the pass cookie). The viewer (app/a/[id]), its
// page route and its unlock route all go through it, so each request is re-checked.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareGateKit } from "@aimhuge/share/server";
import type { CloudAppShareRow } from "./app-share-types";
import { gateVerdict, type GateVerdict } from "./share-access";
import { SHARE_ID_RE } from "./share-types";
import { serviceClient } from "./web-session";

export type AppShareAccess = { kind: "ok"; share: CloudAppShareRow } | Exclude<GateVerdict, { kind: "ok" }> | { kind: "missing" };

// The row through the service client (a visitor isn't a member, so RLS would refuse). An id that can't be a share's
// never reaches Supabase.
export async function loadAppShare(service: SupabaseClient, id: string): Promise<CloudAppShareRow | null> {
  if (!SHARE_ID_RE.test(id)) return null;
  const { data, error } = await service.from("cloud_app_shares").select("*").eq("id", id).maybeSingle<CloudAppShareRow>();
  return error ? null : data;
}

export async function appShareAccess(id: string, opts: { gate?: ShareGateKit; hasPass?: boolean } = {}): Promise<AppShareAccess> {
  const service = serviceClient();
  if (!service) return { kind: "unconfigured" };
  const share = await loadAppShare(service, id);
  if (!share) return { kind: "missing" };
  const verdict = await gateVerdict(id, share, opts);
  return verdict.kind === "ok" ? { kind: "ok", share } : verdict;
}

// Who got through an app link's email gate. A repeat visit is fine; anything else is logged, not fatal.
export async function insertAppShareVisit(service: SupabaseClient, input: { shareId: string; email: string | null }): Promise<void> {
  const { error } = await service.from("cloud_app_share_visits").insert({ share_id: input.shareId, email: input.email });
  if (error && !/duplicate key|unique constraint/i.test(error.message)) console.error(`app-share-access: visit insert failed: ${error.message}`);
}
