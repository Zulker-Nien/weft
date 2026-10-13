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
// The actions live in lib/team-actions.ts ("use server"). Client components
// import the actions themselves and receive only serializable props
// (orgSlug + the row's id); the page no longer passes bound closures across
// the server → client boundary, which React can't serialize. The form uses
// useActionState directly with the bound action on the client.
//
// Wrapped in <Suspense> (cacheComponents) because listOrgMembers and the
// listPendingInvites call go through a service client that proxy.ts didn't
// pre-warm — these reads are explicitly NOT under the prerender set, and a
// cookies()/await connection() would be required otherwise. The layout
// already wrapped itself in Suspense, so the page body could re-enter; the
// layout's fallback is the one a slow loader will see.
import type { Metadata } from "next";
import { Suspense } from "react";
import { listOrgMembers, listPendingInvites, roleCan, roleLabel } from "@aimhuge/teams";
import { isDeployed } from "@/lib/home";
import { requireTeam, roleOptions as buildRoleOptions } from "@/lib/teams";
import { Roster, type RosterMember } from "@/components/team/Roster";
import { PendingInvites, type PendingInviteRow } from "@/components/team/PendingInvites";
import { InviteForm, type RoleOption } from "@/components/team/InviteForm";
import { LeaveButton } from "@/components/team/LeaveButton";

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
  const roster: RosterMember[] = members.map((m) => ({
    userId: m.user_id,
    email: m.email,
    displayName: m.display_name,
    role: m.role,
    roleLabel: roleLabel(m.role),
    joinedAt: m.created_at,
    isYou: m.user_id === ctx.user.id,
  }));

  // What this caller can assign, with each role's label and description the
  // form shows beside the select. We pass plain strings down so the client
  // bundle doesn't import @aimhuge/teams (its root pulls node:crypto and
  // breaks the "use client" boundary).
  const roleOpts: RoleOption[] = buildRoleOptions(ctx.role).map((o) => ({
    role: o.role,
    label: o.label,
    description: o.description,
  }));

  const pendingRows: PendingInviteRow[] = pending.map((i) => ({
    id: i.id,
    email: i.invited_email,
    role: i.role,
    roleLabel: roleLabel(i.role),
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }));

  const isOwner = ctx.role === "owner";

  return (
    <div className="wz-teamPage">
      <header className="wz-teamHeader">
        <h1 className="wz-teamTitle">Team</h1>
        <p className="wz-teamSub">
          {roster.length} {roster.length === 1 ? "person" : "people"} in <strong>{ctx.org.name}</strong>. You&apos;re signed in
          as a {roleLabel(ctx.role).toLowerCase()}.
        </p>
      </header>

      <section className="wz-teamSection">
        <h2 className="wz-teamSectionTitle">Members</h2>
        <Roster
          orgSlug={orgSlug}
          members={roster}
          canManage={canManage}
          roleOptions={roleOpts.map((o) => ({ role: o.role, label: o.label }))}
          currentUserId={ctx.user.id}
        />
      </section>

      {canManage ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Invite a teammate</h2>
          <InviteForm orgSlug={orgSlug} roleOptions={roleOpts} />
        </section>
      ) : null}

      {canManage && pendingRows.length > 0 ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Pending invites</h2>
          <PendingInvites orgSlug={orgSlug} invites={pendingRows} />
        </section>
      ) : null}

      {!isOwner ? (
        <section className="wz-teamSection">
          <h2 className="wz-teamSectionTitle">Leave this workspace</h2>
          <p className="wz-teamSub">
            You&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
          </p>
          <LeaveButton orgSlug={orgSlug} userId={ctx.user.id} />
        </section>
      ) : null}

      <footer className="wz-teamFooter">
        Shared vaults for this workspace are coming next: secrets your teammates&apos; Weft can use without ever
        seeing them on our servers.
      </footer>
    </div>
  );
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

export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  if (!isDeployed()) return <NotDeployedCard slug={orgSlug} />;
  return (
    <Suspense fallback={<TeamPageFallback />}>
      <TeamPageBody orgSlug={orgSlug} />
    </Suspense>
  );
}
