// The Weft team gate and the helpers its server actions and pages share. The package's `requireOrg` and
// `sessionClaims` (and therefore its server actions) are broken under Next 16 ("use cache" + a Supabase
// client throws "Cannot access from on the server... temporary client reference"), so Weft uses ONLY the
// package's pure helpers and re-implements the gate in this file. Plain queries per request are fine —
// cacheComponents is on in next.config.ts, but a "use cache" function may not close over a Supabase
// client, so caching happens at a different layer (the proxy refreshes the session cookie; membership
// writes invalidate via revalidatePath in the server actions). The /api/teams JSON API and the desktop's
// local forwarder share the same gate through `teamAccessFor(user, slug)`: the cookie path's
// `teamAccess` is just `teamAccessFor(await webUser(), slug)`.
import "server-only";
import type { Org, OrgRole } from "@aimhuge/teams";
import { inviteHtmlFor } from "./invite-email";
import { ROLE_DESCRIPTIONS } from "./team-types";
import { ORG_ROLES, assignableRoles, createInvite, isPlausibleEmail, listUserOrgs, normalizeEmail, revokeInvite, roleLabel, setCurrentOrg } from "@aimhuge/teams";
import type { InviteEmailTransport } from "@aimhuge/teams";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { SUPABASE_KEY } from "./supabase-project";
import { serviceClient, webUser, type WebUser } from "./web-session";

// The gate's verdict, in 4 cases. Same shape `signed-out`/`denied`/`unconfigured`/`ok` so the page can
// branch without throwing. Membership is folded into `denied` so a non-member can't tell whether the
// org exists.
export type TeamAccess = { kind: "ok"; ctx: TeamContext } | { kind: "signed-out" } | { kind: "denied" } | { kind: "unconfigured" };

// What a page or server action needs to do its work: the signed-in user, the org they asked about, their
// role in it, the rest of their workspaces, and the service client for the data work.
export type TeamContext = {
  user: WebUser;
  org: Org;
  role: OrgRole;
  orgs: Org[];
  // The viewer's role in each of `orgs`, by org id (the switcher shows it).
  orgRoles?: Record<string, OrgRole>;
  service: SupabaseClient;
};

// Same-origin sanitizer for a `?next=` value (the package's `safeNextPath` does the same job). The plain
// `startsWith("/") && !startsWith("//")` check is the contract: anything more elaborate is a "use cache"
// surrogate. A workspace switcher is a server action — returnPath comes from the action's own caller.
function safeReturnPath(raw: string | undefined, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

// The membership gate, parameterized by the user. Server pages call this with the cookie's user
// (teamAccess does the lookup for them); /api/teams calls it with the bearer-token user. The
// unconfigured cases come first so a Weft without a service key is indistinguishable from "the
// deployed project isn't set up" (a 404 from /[orgSlug] is the right outcome either way, but we still
// want the distinct kind for the "Email isn't set up" branch in the invite action).
export async function teamAccessFor(user: WebUser | null, orgSlug: string): Promise<TeamAccess> {
  if (!SUPABASE_KEY) return { kind: "unconfigured" };
  const service = serviceClient();
  if (!service) return { kind: "unconfigured" };
  if (!user) return { kind: "signed-out" };
  // Look up the org by slug and the membership for this user in one round trip each. `orgs` has RLS
  // on with no policies, so the publishable key can't read it; the service client is required. The
  // same "denied" is returned whether the org doesn't exist or the user just isn't a member — that
  // way an attacker can't probe membership by varying the slug. Super-admins do NOT get a bypass in
  // Weft (this is the production app, not an admin tool): a super-admin who's also a member falls
  // through as a normal member; a super-admin who isn't gets the same "denied" as anyone else.
  const { data: org } = await service
    .from("orgs")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle<{ id: string; slug: string; name: string }>();
  if (!org) return { kind: "denied" };
  const { data: membership } = await service
    .from("org_memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: OrgRole }>();
  if (!membership) return { kind: "denied" };
  // The user's workspaces, oldest first; `orgs` (the workspace switcher) reads off the same list. A
  // separate query would be wasted round-trips.
  const memberships = await listUserOrgs(service, user.id);
  return {
    kind: "ok",
    ctx: {
      user,
      org: { id: org.id, slug: org.slug, name: org.name },
      role: membership.role,
      orgs: memberships.map((m) => m.org),
      orgRoles: Object.fromEntries(memberships.map((m) => [m.org.id, m.role])),
      service,
    },
  };
}

// The cookie path's wrapper around teamAccessFor: pulls the user from the request's cookies. Pages and
// server actions call this; /api/teams calls teamAccessFor directly with the bearer user.
export async function teamAccess(orgSlug: string): Promise<TeamAccess> {
  return teamAccessFor(await webUser(), orgSlug);
}

// The version server components and server actions call: signed-out → redirect to /login, denied or
// unconfigured → notFound(). `returnPath` is the URL to come back to after sign-in; it must be a same-
// origin path (the open-redirect guard above).
export async function requireTeam(orgSlug: string, returnPath?: string): Promise<TeamContext> {
  const access = await teamAccess(orgSlug);
  if (access.kind === "signed-out") {
    const safe = safeReturnPath(returnPath, `/${orgSlug}/team`);
    redirect(`/login?next=${encodeURIComponent(safe)}`);
  }
  if (access.kind !== "ok") notFound();
  return access.ctx;
}

// The signed-in user's active workspace, healing the pointer when it's stale. A tagged result so the
// caller branches on `kind` without "did they mean signed-out or null" string-comparisons.
export type CurrentWorkspace = { kind: "signed-out" } | { kind: "none" } | { kind: "ok"; slug: string };

// The active-workspace resolver, parameterized by the user. /api/teams and the cookie path both reach
// in here: the cookie path uses currentWorkspaceSlug() so it doesn't have to fetch the user twice.
export async function currentWorkspaceFor(user: WebUser | null): Promise<CurrentWorkspace> {
  if (!SUPABASE_KEY) return { kind: "none" };
  const service = serviceClient();
  if (!service) return { kind: "none" };
  if (!user) return { kind: "signed-out" };
  const memberships = await listUserOrgs(service, user.id);
  const oldest = memberships[0];
  if (!oldest) return { kind: "none" };
  const { data: profile } = await service
    .from("profiles")
    .select("current_org_id")
    .eq("id", user.id)
    .maybeSingle<{ current_org_id: string | null }>();
  const currentId = profile?.current_org_id ?? null;
  const pointed = currentId ? memberships.find((m) => m.org.id === currentId) : null;
  if (pointed) return { kind: "ok", slug: pointed.org.slug };
  // Pointer missing or stale: set it to the oldest membership (the personal workspace) and return its
  // slug. The setCurrentOrg write is a no-op when the pointer already points there, but the row is read
  // first to keep the round-trip down.
  await setCurrentOrg(service, user.id, oldest.org.id);
  return { kind: "ok", slug: oldest.org.slug };
}

export async function currentWorkspaceSlug(): Promise<CurrentWorkspace> {
  return currentWorkspaceFor(await webUser());
}

// Switch the active workspace from a workspace switcher. `requireTeam` re-verifies membership, so a
// user can't switch into an org they've been removed from; the redirect / notFound are the same paths
// the gate already uses, so the UX is identical to typing the URL.
export async function setActiveWorkspace(orgSlug: string): Promise<{ org: Org }> {
  const ctx = await requireTeam(orgSlug);
  await setCurrentOrg(ctx.service, ctx.user.id, ctx.org.id);
  return { org: ctx.org };
}

// What the invite form's role select offers — the roles `actor` is allowed to assign, with the label
// and one-line description. ALL_ROLES is the unfiltered list (Owner, Admin, Member top-to-bottom) for
// pages that want to render the role hierarchy without filtering.
export interface RoleOption {
  role: OrgRole;
  label: string;
  description: string;
}

export const ALL_ROLES: RoleOption[] = ORG_ROLES.map((role) => ({ role, label: roleLabel(role), description: ROLE_DESCRIPTIONS[role] }));

export function roleOptions(actor: OrgRole): RoleOption[] {
  return assignableRoles(actor).map((role) => ({ role, label: roleLabel(role), description: ROLE_DESCRIPTIONS[role] }));
}

// The mailer an invite action hands to the package. Resend REST, RESEND_API_KEY. The from address is
// fixed; the message body and subject come from the package, and an invite also gets the Salt Flats HTML
// (lib/invite-email.ts). `fetchFn` is for tests.
export function inviteMailer(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): InviteEmailTransport | null {
  const key = env.RESEND_API_KEY;
  if (!key) return null;
  return {
    async send({ to, subject, text }) {
      const res = await fetchFn("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ from: "Weft <team@weft.zip>", to: [to], subject, text, html: inviteHtmlFor(text) }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

// Re-exported so team-actions.ts and the test files can `import { … } from "./teams"` instead of also
// importing the package; keeps the surface in one place.
export { createInvite, isPlausibleEmail, normalizeEmail, revokeInvite };
