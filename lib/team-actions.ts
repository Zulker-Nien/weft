"use server";
// The /[orgSlug]/team page's server actions, called by the form components
// over the "use server" boundary. Each action re-runs the gate
// (requireTeam), then delegates to lib/team-ops.ts. The gate is what makes
// "a non-member cannot touch this org" true; the lib/team-ops.ts checks
// are what make "an admin cannot demote an owner" true.
//
// These take plain arguments (not FormData) because the UI agent S3 is
// switching the components to call them through TeamClientActions, which
// matches lib/team-types.ts. Server actions are public endpoints, so each
// argument is validated at the boundary (string, isTeamRole, non-empty).
//
// `process.env.NEXT_PUBLIC_SITE_URL` is the lead adding to next.config so
// `createInvite`'s link is the right origin in production; on localhost
// the package's siteOrigin() falls back to localhost.
import { revalidatePath } from "next/cache";
import { isTeamRole } from "./team-types";
import { requireTeam } from "./teams";
import { runTeamOp } from "./team-ops";
import type { TeamActionResult } from "./team-types";
import type { TeamContext } from "./teams";

export type { TeamActionResult };

// A short, structured gate: run requireTeam and wrap the result. Throws on
// signed-out (redirect) or denied/unconfigured (notFound), as requireTeam
// already does; returns the TeamContext the ops need. Pulled out so the
// four actions are 4-line wrappers with the same shape.
async function gate(orgSlug: string): Promise<TeamContext> {
  return requireTeam(orgSlug, `/${orgSlug}/team`);
}

// Coerce a string-or-anything to a trimmed string; the helper the route
// already uses for body parsing. Server actions receive `string | undefined`
// from the framework when the argument isn't a string, so we narrow here.
function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function inviteMember(orgSlug: string, email: string, role: string): Promise<TeamActionResult> {
  const ctx = await gate(orgSlug);
  const cleanEmail = asString(email);
  // A bad role short-circuits before the email shape check so the user
  // sees "Pick a role from the list." even when the email is also bad —
  // matching the previous FormData-bound behavior where the unknown-role
  // check came after the email check (and never ran with a bogus email,
  // since the form was server-validated). The isPlausibleEmail check
  // inside runTeamOp still produces "Enter a valid email address." for
  // a valid role + bad email.
  if (!isTeamRole(role)) return { ok: false, message: "Pick a role from the list." };
  const result = await runTeamOp(ctx, { org: orgSlug, action: "invite", email: cleanEmail, role });
  if (result.ok) revalidatePath(`/${orgSlug}/team`);
  return result;
}

export async function changeMemberRole(orgSlug: string, userId: string, role: string): Promise<TeamActionResult> {
  const ctx = await gate(orgSlug);
  const cleanId = asString(userId);
  if (!isTeamRole(role)) return { ok: false, message: "Pick a role from the list." };
  const result = await runTeamOp(ctx, { org: orgSlug, action: "role", userId: cleanId, role });
  if (result.ok) revalidatePath(`/${orgSlug}/team`);
  return result;
}

export async function removeMember(orgSlug: string, userId: string): Promise<TeamActionResult> {
  const ctx = await gate(orgSlug);
  const cleanId = asString(userId);
  const result = await runTeamOp(ctx, { org: orgSlug, action: "remove", userId: cleanId });
  if (result.ok) revalidatePath(`/${orgSlug}/team`);
  return result;
}

export async function revokeInvite(orgSlug: string, inviteId: string): Promise<TeamActionResult> {
  const ctx = await gate(orgSlug);
  const cleanId = asString(inviteId);
  const result = await runTeamOp(ctx, { org: orgSlug, action: "revoke", inviteId: cleanId });
  if (result.ok) revalidatePath(`/${orgSlug}/team`);
  return result;
}
