// Make a new workspace the caller owns (POST /api/teams {action:"create"} and the createTeam server action).
// The slug mirrors private.org_slug_for in the teams migration: slugify, skip reserved names, -2, -3... on a clash.
import "server-only";
import { isReservedSlug, setCurrentOrg, slugify } from "@aimhuge/teams";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewTeamResult } from "./team-types";
import { serviceClient, type WebUser } from "./web-session";

const MAX_NAME = 60;

async function freeSlug(service: SupabaseClient, name: string): Promise<string> {
  const base = slugify(name).slice(0, 40).replace(/-+$/, "") || "workspace";
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (candidate.length < 2 || isReservedSlug(candidate)) continue;
    const { data } = await service.from("orgs").select("id").eq("slug", candidate).maybeSingle<{ id: string }>();
    if (!data) return candidate;
  }
}

export async function runCreateTeam(user: WebUser, nameRaw: string): Promise<NewTeamResult> {
  const name = nameRaw.trim();
  if (name.length < 1 || name.length > MAX_NAME) return { ok: false, message: `Name the team in 1 to ${MAX_NAME} characters.` };
  const service = serviceClient();
  if (!service) return { ok: false, message: "Teams aren't set up on this Weft." };
  const slug = await freeSlug(service, name);
  const created: { data: { id: string } | null; error: { message: string } | null } = await service
    .from("orgs")
    .insert({ slug, name })
    .select("id")
    .single<{ id: string }>();
  const org = created.data;
  if (created.error || !org) return { ok: false, message: `Could not create team: ${created.error?.message ?? "unknown"}` };
  const { error: memberError } = await service.from("org_memberships").insert({ org_id: org.id, user_id: user.id, role: "owner" });
  if (memberError) {
    await service.from("orgs").delete().eq("id", org.id);
    return { ok: false, message: `Could not create team: ${memberError.message}` };
  }
  await setCurrentOrg(service, user.id, org.id);
  return { ok: true, message: `Created ${name}.`, slug };
}
