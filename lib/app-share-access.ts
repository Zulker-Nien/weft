// A mini app link's access gate (lib/app-share-types.ts): one cloud_app_shares row, checked the way a card's link is
// (lib/share-access.ts gateVerdict: the mode, the workspace membership, the pass cookie). The viewer (app/a/[id]),
// its page route, its folder file route and its unlock route all go through it, so each request is re-checked.
//
// A user link in private mode is for the link's creator only, not the whole workspace: loadAppShareBySlug
// resolves the username to a profile id, then loads the row whose created_by is that id, owner 'user',
// and the requested slug. The gate then checks that the visitor IS the creator, not just a workspace
// member.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareGateKit } from "@aimhuge/share/server";
import { APP_SLUG_RE, type AppOwner, type CloudAppShareRow } from "./app-share-types";
import { gateVerdict, type GateVerdict } from "./share-access";
import { SHARE_ID_RE } from "./share-types";
import { serviceClient, webUser, type WebUser } from "./web-session";

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

// Look up a share by its owner path (user: profiles.username → created_by, org: orgs.slug → org_id)
// and the slug. Returns null when the username or org slug doesn't match an account/workspace, or
// when the share row doesn't exist with that combination. SHAREs with slug = null never match:
// those are pre-slug links reachable only through /a/<id>.
export async function loadAppShareBySlug(
  service: SupabaseClient,
  lookup: { owner: AppOwner; ownerSlug: string; slug: string },
): Promise<CloudAppShareRow | null> {
  if (!APP_SLUG_RE.test(lookup.slug)) return null;
  if (lookup.owner === "user") {
    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("id")
      .eq("username", lookup.ownerSlug)
      .maybeSingle<{ id: string }>();
    if (profileError || !profile) return null;
    const { data, error } = await service
      .from("cloud_app_shares")
      .select("*")
      .eq("owner", "user")
      .eq("created_by", profile.id)
      .eq("slug", lookup.slug)
      .maybeSingle<CloudAppShareRow>();
    return error ? null : data;
  }
  const { data: org, error: orgError } = await service
    .from("orgs")
    .select("id")
    .eq("slug", lookup.ownerSlug)
    .maybeSingle<{ id: string }>();
  if (orgError || !org) return null;
  const { data, error } = await service
    .from("cloud_app_shares")
    .select("*")
    .eq("owner", "org")
    .eq("org_id", org.id)
    .eq("slug", lookup.slug)
    .maybeSingle<CloudAppShareRow>();
  return error ? null : data;
}

// The access gate by owner path. Adds the user-private check: a user-owned link in private mode
// is open to its creator only, not every member of the org it lives in. The public/gated modes
// still go through gateVerdict so the unlock route and the pass cookie work the same way.
export async function appShareAccessBySlug(
  lookup: { owner: AppOwner; ownerSlug: string; slug: string },
  opts: { gate?: ShareGateKit; hasPass?: boolean } = {},
): Promise<AppShareAccess> {
  const service = serviceClient();
  if (!service) return { kind: "unconfigured" };
  const share = await loadAppShareBySlug(service, lookup);
  if (!share) return { kind: "missing" };
  if (share.owner === "user" && share.mode === "private") {
    // A user-owned private link is the link's creator only, not the whole org_memberships list.
    const user = await webUser();
    const verdict = userPrivateVerdict(user, share);
    if (verdict.kind === "ok") return { kind: "ok", share };
    return verdict;
  }
  // For org-owned and non-private user links, the gate is the same as for /a/<id>: the row's mode,
  // the workspace membership for private, the pass cookie for the gated modes.
  const verdict = await gateVerdict(share.id, share, opts);
  return verdict.kind === "ok" ? { kind: "ok", share } : verdict;
}

// A user-owned private link: only the visitor whose user id matches the row's created_by. The
// service client is used for the membership check because a non-member visitor can't read
// cloud_app_shares under RLS. Anonymous visitors are sent to sign-in with ?next= the link's public
// URL, which the page returns.
function userPrivateVerdict(user: WebUser | null, share: CloudAppShareRow): GateVerdict {
  if (!user) return { kind: "login" };
  if (user.id === share.created_by) return { kind: "ok" };
  return { kind: "denied" };
}

// Who got through an app link's email gate. A repeat visit is fine; anything else is logged, not fatal.
export async function insertAppShareVisit(service: SupabaseClient, input: { shareId: string; email: string | null }): Promise<void> {
  const { error } = await service.from("cloud_app_share_visits").insert({ share_id: input.shareId, email: input.email });
  if (error && !/duplicate key|unique constraint/i.test(error.message)) console.error(`app-share-access: visit insert failed: ${error.message}`);
}
