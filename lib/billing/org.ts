import "server-only";

// The workspace a user is on for billing (docs/architecture/billing.md, supabase/migrations/20261013170000_teams.sql).
// `profiles.current_org_id` is the user's active workspace, but the user might be a member of others; if the
// active one has gone away, fall back to their oldest owner membership. Returns null when the user has no
// workspace at all — every account gets a personal one on sign-up, so this is rare.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
}

export async function orgForUser(service: SupabaseClient, userId: string): Promise<OrgRow | null> {
  // 1. The active workspace, if it still exists and the user is still a member.
  const { data: profile } = await service.from("profiles").select("current_org_id").eq("id", userId).maybeSingle();
  const current = profile?.current_org_id as string | null | undefined;
  if (current) {
    const { data: org } = await service.from("orgs").select("id,slug,name").eq("id", current).maybeSingle();
    if (org) {
      const { data: member } = await service.from("org_memberships").select("org_id").eq("org_id", current).eq("user_id", userId).maybeSingle();
      if (member) return org;
    }
  }

  // 2. Oldest owner membership — the user's first workspace if the active one is gone.
  const { data: owner } = await service
    .from("org_memberships")
    .select<string, { org_id: string }>("org_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const orgId = owner?.org_id;
  if (!orgId) return null;
  const { data: org } = await service.from("orgs").select("id,slug,name").eq("id", orgId).maybeSingle();
  return (org) ?? null;
}