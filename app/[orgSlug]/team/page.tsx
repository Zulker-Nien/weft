// The Team page: the workspace's roster, the invite form (for managers), the
// pending-invites list (for managers), and a Leave button (for non-owners).
// The switcher is in the workspace layout (app/[orgSlug]/layout.tsx) so every
// /[orgSlug]/* page has it; this page is roster + invite.
//
// Data: listOrgMembers + (when the caller can manage members) listPendingInvites,
// both through the service client ctx.service — the @aimhuge/teams package
// documents that org_memberships and invitations RLS is locked down to the
// service role, so the cookie-bound client reads nothing here.
//
// The snapshot is plain data (lib/team-types.ts), built here on the server
// from the gate's ctx, and handed to the WebTeam client wrapper
// (components/team/WebTeam.tsx). The wrapper builds the TeamClientActions
// from the org slug and passes them to the team components (Roster,
// InviteForm, PendingInvites, LeaveButton). The team components themselves
// import nothing server-side, so they render in either weft.zip or the
// desktop's Settings page (lib/use-team.ts posts to the local forwarder
// there).
//
// Wrapped in <Suspense> (cacheComponents) because listOrgMembers and the
// listPendingInvites call go through a service client that proxy.ts didn't
// pre-warm — these reads are explicitly NOT under the prerender set, and a
// cookies()/await connection() would be required otherwise. The layout
// already wrapped itself in Suspense, so the page body could re-enter; the
// layout's fallback is the one a slow loader will see.
import type { Metadata } from "next";
import { Suspense } from "react";
import { listOrgMembers, listPendingInvites, roleCan } from "@aimhuge/teams";
import { WebTeam } from "@/components/team/WebTeam";
import { isDeployed } from "@/lib/home";
import { requireTeam, roleOptions as buildRoleOptions } from "@/lib/teams";
import type { RoleOption, TeamSnapshot } from "@/lib/team-types";

export const metadata: Metadata = {
  title: "Team",
  description: "The people in your Weft workspace and the invites waiting on them.",
};

function NotDeployedCard({ slug }: { slug: string }) {
  return (
    <div className="wz-root wz-auth">
      <main className="wz-authCard">
        <h1 className="wz-authTitle">Team · {slug}</h1>
        <p className="wz-authSub">Workspaces live on weft.zip. In the desktop app, the board&apos;s account button is the way in.</p>
      </main>
    </div>
  );
}

async function TeamPageBody({ orgSlug }: { orgSlug: string }) {
  const ctx = await requireTeam(orgSlug, `/${orgSlug}/team`);
  const canManage = roleCan(ctx.role, "members.manage");
  // Read members + pending invites in parallel; both go through the service
  // client because RLS is off. The package's helpers return oldest-first, so
  // the roster renders with the workspace's creator at the top.
  const [members, pending] = await Promise.all([
    listOrgMembers(ctx.service, ctx.org.id),
    canManage ? listPendingInvites(ctx.service, ctx.org.id) : Promise.resolve([]),
  ]);

  // What this caller can assign, with each role's label and description the
  // form shows beside the select. We pass plain strings down so the client
  // bundle doesn't import @aimhuge/teams (its root pulls node:crypto and
  // breaks the "use client" boundary).
  const roleOpts: RoleOption[] = buildRoleOptions(ctx.role).map((o) => ({
    role: o.role,
    label: o.label,
    description: o.description,
  }));
  // The full label table for every role, for the read-only "you are …" line
  // and the pending-invite role pill.
  const ALL_ROLES = ["owner", "admin", "member"] as const;
  const roleLabels = Object.fromEntries(
    ALL_ROLES.map((r) => [r, roleOpts.find((o) => o.role === r)?.label ?? r]),
  ) as Record<(typeof ALL_ROLES)[number], string>;

  const snapshot: TeamSnapshot = {
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, avatar: ctx.user.avatar },
    org: { id: ctx.org.id, slug: ctx.org.slug, name: ctx.org.name },
    role: ctx.role,
    orgs: ctx.orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
    canManage,
    members: members.map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.display_name,
      role: m.role,
      joinedAt: m.created_at,
    })),
    pending: pending.map((i) => ({
      id: i.id,
      email: i.invited_email,
      role: i.role,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    })),
    roleOptions: roleOpts,
    roleLabels,
  };

  return <WebTeam orgSlug={orgSlug} snapshot={snapshot} />;
}

function TeamPageFallback() {
  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader">
        <h1 className="wz-teamTitle">Team</h1>
        <p className="wz-teamSub">Loading the roster…</p>
      </header>
    </div>
  );
}

// The route params are request data under cacheComponents, so they're read inside the <Suspense>, not before it.
async function TeamPageFor({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  if (!isDeployed()) return <NotDeployedCard slug={orgSlug} />;
  return <TeamPageBody orgSlug={orgSlug} />;
}

export default function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  return (
    <Suspense fallback={<TeamPageFallback />}>
      <TeamPageFor params={params} />
    </Suspense>
  );
}