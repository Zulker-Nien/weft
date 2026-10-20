// The owners the dialog can pick for an app link: the signed-in user (their profiles.username)
// and each workspace they belong to (orgs joined through org_memberships, RLS-gated). Pure helpers,
// so the test can fake the supabase client.
import type { SupabaseClient } from "@supabase/supabase-js";
import { appPublicUrl, type AppOwner, type AppOrgOption, type AppUserOption } from "./app-share-types";

export interface AppOwners {
  user: AppUserOption | null;
  orgs: AppOrgOption[];
}

// The username on the sharer's own profile, and the workspaces they're a member of. The user
// option stays null until a profile row exists; most accounts get one on first sign-in.
export async function listOwners(ctx: { client: SupabaseClient; userId: string; orgId: string }): Promise<AppOwners> {
  const [profileRes, orgsRes] = await Promise.all([
    ctx.client.from("profiles").select("username").eq("id", ctx.userId).maybeSingle<{ username: string }>(),
    ctx.client.from("org_memberships").select("org_id, orgs(id, slug, name)").eq("user_id", ctx.userId),
  ]);
  const user: AppUserOption | null = profileRes.data?.username ? { username: profileRes.data.username } : null;
  const orgs: AppOrgOption[] = [];
  for (const row of (orgsRes.data ?? []) as unknown as Array<{ orgs: AppOrgOption | null }>) {
    if (row.orgs) orgs.push(row.orgs);
  }
  return { user, orgs };
}

// The public URL for a link with the given owner, slug, and the list of available owners. Returns
// null when the owner isn't a known option (no profile, a workspace the user left).
export function publicUrlFor(
  owner: AppOwner,
  slug: string,
  owners: AppOwners,
  orgId: string,
): string | null {
  if (owner === "user") return owners.user ? appPublicUrl("user", owners.user.username, slug) : null;
  const match = owners.orgs.find((o) => o.id === orgId);
  return match ? appPublicUrl("org", match.slug, slug) : null;
}
