"use server";
// The /[orgSlug]/team page's server actions. Each one re-runs the gate (`requireTeam`), enforces the
// permission, mutates, and revalidates the team page. The gate is what makes "a non-member cannot
// touch this org" true; the permission check is what makes "an admin cannot demote an owner" true.
// `process.env.NEXT_PUBLIC_SITE_URL` is the lead adding to next.config so `createInvite`'s link is
// the right origin in production; on localhost the package's siteOrigin() falls back to localhost.
import { revalidatePath } from "next/cache";
import { ORG_ROLES, roleAtLeast, roleCan } from "@aimhuge/teams";
import type { OrgRole } from "@aimhuge/teams";
import { inviteMailer, isPlausibleEmail, normalizeEmail, requireTeam, roleOptions, createInvite, revokeInvite as revokeInviteRow } from "./teams";

export type TeamActionResult = { ok: boolean; message?: string };

// Read a single FormData field as a string. formData.get() returns FormDataEntryValue | null, and
// String() on a File would give "[object Object]" — narrow it here so the call sites can stay terse.
function formText(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
}

// The action result type Next's useActionState expects: a tuple of (state, formAction). We return the
// same shape, with the previous result carried through so the form keeps its state across submissions.
function ok(message: string): TeamActionResult {
  return { ok: true, message };
}
function fail(message: string): TeamActionResult {
  return { ok: false, message };
}

// The "this email already has a Weft account" branch of inviteMember. Two outcomes: they're already
// a member of THIS org (say so), or they're a member of Weft but not of this org (add them straight
// in, no email — they already opted in by signing up, so the seat is the only thing they're taking).
// Returns the action's verdict, or null to fall through to the "no account yet" invite-by-email path.
async function addExistingAccount(
  ctx: { service: import("@supabase/supabase-js").SupabaseClient; org: { id: string } },
  orgSlug: string,
  profile: { id: string },
  role: OrgRole,
  email: string,
): Promise<TeamActionResult | null> {
  const { data: existingMember } = await ctx.service
    .from("org_memberships")
    .select("user_id")
    .eq("org_id", ctx.org.id)
    .eq("user_id", profile.id)
    .maybeSingle<{ user_id: string }>();
  if (existingMember) {
    revalidatePath(`/${orgSlug}/team`);
    return ok(`Already on the team.`);
  }
  const { error } = await ctx.service
    .from("org_memberships")
    .insert({ org_id: ctx.org.id, user_id: profile.id, role });
  if (error) return fail(`Could not add member: ${error.message}`);
  revalidatePath(`/${orgSlug}/team`);
  return ok(`Added ${email}.`);
}

// Invite by email. If the address already has a profile, add them straight in (no email); otherwise
// mint a pending invite and email it. The mailer is required for the "no account yet" path; without
// it the action returns a clear error rather than a silently-dropped invite.
export async function inviteMember(orgSlug: string, _prev: TeamActionResult, formData: FormData): Promise<TeamActionResult> {
  const ctx = await requireTeam(orgSlug);
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to invite members.");
  const emailRaw = formText(formData, "email");
  const roleRaw = formText(formData, "role") || "member";
  if (!isPlausibleEmail(emailRaw)) return fail("Enter a valid email address.");
  if (!ORG_ROLES.includes(roleRaw as OrgRole)) return fail("Pick a role from the list.");
  const role = roleRaw as OrgRole;
  const allowed = roleOptions(ctx.role).map((o) => o.role);
  if (!allowed.includes(role)) return fail(`You can't assign the ${role} role.`);
  const email = normalizeEmail(emailRaw);
  // Self-invite is a no-op; say so instead of pretending.
  if (ctx.user.email && normalizeEmail(ctx.user.email) === email) return fail("That's you.");
  // Look up an existing profile by normalized email. The publishable key can't read profiles here
  // (RLS scopes it to the cookie's user), so this goes through the service client.
  const { data: existingProfile } = await ctx.service
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle<{ id: string }>();
  if (existingProfile) {
    const result = await addExistingAccount(ctx, orgSlug, existingProfile, role, email);
    if (result) return result;
  }
  // No account yet: the email is the only way in. Refuse cleanly if the mailer isn't set up — the
  // alternative is a silent drop, which would confuse the inviter.
  const mailer = inviteMailer();
  if (!mailer) return fail("Email isn't set up on this Weft (RESEND_API_KEY).");
  try {
    const { alreadyPending } = await createInvite({
      service: ctx.service,
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      orgSlug: ctx.org.slug,
      invitedEmail: email,
      role,
      invitedBy: ctx.user.id,
      inviterEmail: ctx.user.email,
      email: mailer,
      appName: "Weft",
    });
    revalidatePath(`/${orgSlug}/team`);
    return ok(alreadyPending ? `Invite re-sent… (${email})` : `Invite sent to ${email}.`);
  } catch (err) {
    return fail(`Could not create invite: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

// Re-role an existing member. The actor can only set roles they could assign themselves
// (assignableRoles) and only touch members whose current role is at or below the actor's
// (roleAtLeast). An owner can't be demoted away from being the last owner.
export async function changeMemberRole(orgSlug: string, userId: string, formData: FormData): Promise<TeamActionResult> {
  const ctx = await requireTeam(orgSlug);
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to change roles.");
  if (!userId) return fail("Missing member id.");
  if (userId === ctx.user.id) return fail("You can't change your own role. Hand the workspace to someone else first.");
  const newRoleRaw = formText(formData, "role");
  if (!ORG_ROLES.includes(newRoleRaw as OrgRole)) return fail("Pick a role from the list.");
  const newRole = newRoleRaw as OrgRole;
  const allowed = roleOptions(ctx.role).map((o) => o.role);
  if (!allowed.includes(newRole)) return fail(`You can't assign the ${newRole} role.`);
  const { data: target } = await ctx.service
    .from("org_memberships")
    .select("role")
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return fail("That person isn't a member of this workspace.");
  if (!roleAtLeast(ctx.role, target.role as OrgRole)) {
    return fail("You can't change the role of someone at or above your own.");
  }
  // Never leave the org with zero owners: count the remaining owners if we're about to demote one.
  if (target.role === "owner" && newRole !== "owner") {
    const { count } = await ctx.service
      .from("org_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return fail("You can't demote the workspace's only owner. Promote someone else first.");
  }
  const { error } = await ctx.service
    .from("org_memberships")
    .update({ role: newRole })
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId);
  if (error) return fail(`Could not change role: ${error.message}`);
  revalidatePath(`/${orgSlug}/team`);
  return ok("Role updated.");
}

// Remove a member, or yourself (leave). Self-leave is always allowed unless it would strand the
// workspace with no owners. Clearing `profiles.current_org_id` keeps the switcher from pointing at an
// org the user is no longer in.
export async function removeMember(orgSlug: string, userId: string): Promise<TeamActionResult> {
  const ctx = await requireTeam(orgSlug);
  if (!userId) return fail("Missing member id.");
  const isSelf = userId === ctx.user.id;
  if (!isSelf && !roleCan(ctx.role, "members.manage")) {
    return fail("You don't have permission to remove members.");
  }
  const { data: target } = await ctx.service
    .from("org_memberships")
    .select("role")
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return fail("That person isn't a member of this workspace.");
  // The actor must be at least as senior as the target — but only when the actor isn't leaving
  // themselves.
  if (!isSelf && !roleAtLeast(ctx.role, target.role as OrgRole)) {
    return fail("You can't remove someone at or above your own role.");
  }
  // Last owner check applies to self-leave too: a sole owner can't leave without first handing the
  // workspace to someone else.
  if (target.role === "owner") {
    const { count } = await ctx.service
      .from("org_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return fail("You can't leave the workspace as its only owner. Promote someone else first.");
  }
  const { error } = await ctx.service
    .from("org_memberships")
    .delete()
    .eq("org_id", ctx.org.id)
    .eq("user_id", userId);
  if (error) return fail(`Could not remove member: ${error.message}`);
  // Clear the active-workspace pointer if it named this org. Best-effort: the membership is already
  // gone, so the worst case is a switcher that points at a workspace the user can no longer open,
  // which the gate will heal.
  await ctx.service.from("profiles").update({ current_org_id: null }).eq("id", userId).eq("current_org_id", ctx.org.id);
  revalidatePath(`/${orgSlug}/team`);
  return ok(isSelf ? "You left the workspace." : "Removed.");
}

// Revoke a pending invite. The invite must belong to the same org as the ctx (membership writes
// would let a malicious actor revoke invites for an org they don't belong to otherwise — they
// can't, because the gate already filters by orgSlug, but the belt-and-braces check is cheap).
export async function revokeInvite(orgSlug: string, inviteId: string): Promise<TeamActionResult> {
  const ctx = await requireTeam(orgSlug);
  if (!roleCan(ctx.role, "members.manage")) return fail("You don't have permission to revoke invites.");
  if (!inviteId) return fail("Missing invite id.");
  const { data: invite } = await ctx.service.from("invitations").select("org_id").eq("id", inviteId).maybeSingle();
  if (!invite || invite.org_id !== ctx.org.id) return fail("That invite isn't from this workspace.");
  try {
    await revokeInviteRow(ctx.service, inviteId);
  } catch (err) {
    return fail(`Could not revoke invite: ${err instanceof Error ? err.message : "unknown"}`);
  }
  revalidatePath(`/${orgSlug}/team`);
  return ok("Invite revoked.");
}
