"use client";

// The Team page inside the desktop's Settings. The same Roster /
// InviteForm / PendingInvites / LeaveButton the weft.zip team page uses
// (they take `actions: TeamClientActions` as a prop so the path is
// shared). The desktop can't use weft.zip's cookie session or the service
// key, so `useTeam(org?)` from lib/use-team.ts posts TeamOp bodies to
// /api/account/team, which forwards them to weft.zip with the desktop's
// bearer token, and refreshes the snapshot after each op.
//
// The dialog page header ("Team / Your Weft workspace and the people in
// it.") is rendered by SettingsDialog from lib/settings-nav.ts, so this
// component opens straight on its own cards, one per section. The team is
// usually there already: the top bar prefetches it once you're signed in
// (prefetchTeam in lib/use-team.ts), so "Loading your team" shows only on
// a cold start. The shared components' wz-* classes take the board's
// tokens from team/team-board.css under .wz-board.
import { type ReactNode } from "react";
import "./team/team-board.css";
import { openTeamPage } from "./board-palette";
import { Spinner } from "./Icon";
import { InviteForm, type RoleOption } from "./team/InviteForm";
import { LeaveButton } from "./team/LeaveButton";
import { PendingInvites, inviteRow } from "./team/PendingInvites";
import { Projects } from "./team/Projects";
import { Roster } from "./team/Roster";
import { TeamSwitcher } from "./team/TeamSwitcher";
import { useBoardRepos } from "@/lib/use-board-repos";
import { useManagedTeam } from "@/lib/use-managed-team";
import type { TeamRole } from "@/lib/team-types";

// The same card as the other Settings pages (SettingsDialog's Card).
const CARD = "wz-board rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint";
const SUBTLE = "text-[12.5px] text-muted";
const BUTTON = "rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken";

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={CARD} onMouseDown={(e) => e.stopPropagation()}>
      {title ? <h4 className={SECTION_TITLE}>{title}</h4> : null}
      {children}
    </section>
  );
}

// The role <select> in the roster only needs {role, label}. We hand the
// invite form the full RoleOption list (with descriptions).
function compactRoleOptions(opts: { role: TeamRole; label: string }[]): RoleOption[] {
  return opts.map((o) => ({ role: o.role, label: o.label, description: "" }));
}

// Invite as Member unless the list doesn't offer it; the list leads with Owner, too much to hand out by default.
function defaultInviteRole(opts: RoleOption[]): TeamRole | undefined {
  return opts.some((o) => o.role === "member") ? "member" : opts[0]?.role;
}

export default function TeamSettings() {
  const { state, refresh, actions, setOrg } = useManagedTeam();
  const boardRepos = useBoardRepos(state.kind === "ok");

  if (state.kind === "loading") {
    return (
      <Section>
        <div className={`flex items-center gap-2 ${SUBTLE}`}>
          <Spinner size={12} /> Loading your team
        </div>
      </Section>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <Section>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink">Sign in to your Weft account to see your team.</p>
          <p className={SUBTLE}>The sign-in lives in Settings → Accounts.</p>
          <div>
            <button type="button" onClick={openTeamPage} className={BUTTON}>
              Open on weft.zip
            </button>
          </div>
        </div>
      </Section>
    );
  }

  if (state.kind === "error") {
    return (
      <Section>
        <div className="flex flex-col gap-2">
          <p className="break-words text-[12.5px] text-danger">Couldn&apos;t load your team: {state.message}</p>
          <div>
            <button type="button" onClick={refresh} className={BUTTON}>
              Try again
            </button>
          </div>
        </div>
      </Section>
    );
  }

  // state.kind === "ok"
  const team = state.team;
  const isOwner = team.role === "owner";
  const roleOptions: RoleOption[] = team.roleOptions.map((o) => ({ role: o.role, label: o.label, description: o.description }));
  const compact = compactRoleOptions(roleOptions);
  const pending = team.pending.map((i) => inviteRow(i, team.roleLabels));
  const count = team.members.length;

  return (
    <div className="flex flex-col gap-4">
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[15px] font-semibold text-accent"
            >
              {team.org.name.trim().charAt(0).toUpperCase() || "W"}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate text-[15px] font-medium text-ink">Team: {team.org.name}</span>
                <span className="rounded-full border border-line-strong px-2 py-px text-[11px] text-muted">
                  {team.roleLabels[team.role]}
                </span>
              </span>
              <span className={SUBTLE}>
                {count} {count === 1 ? "member" : "members"}
                {pending.length > 0 ? ` · ${pending.length} invited` : ""}
                {team.projects.length > 0 ? ` · ${team.projects.length} ${team.projects.length === 1 ? "project" : "projects"}` : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TeamSwitcher
              orgs={team.orgs}
              current={team.org.slug}
              roleLabels={team.roleLabels}
              actions={actions}
              onSwitch={setOrg}
            />
            <button type="button" onClick={openTeamPage} className={BUTTON}>
              Open on weft.zip
            </button>
          </div>
        </div>
      </Section>

      <Section title="Projects">
        <Projects
          projects={team.projects}
          canManage={team.canManage}
          actions={actions}
          boardRepos={boardRepos}
          roleOptions={roleOptions}
          members={team.members}
          pending={team.pending}
        />
      </Section>

      <Section title="Members">
        <Roster
          members={team.members}
          canManage={team.canManage}
          roleOptions={compact}
          currentUserId={team.user.id}
          actions={actions}
        />
      </Section>

      {team.canManage ? (
        <Section title="Invite a teammate">
          <InviteForm roleOptions={roleOptions} defaultRole={defaultInviteRole(roleOptions)} actions={actions} />
        </Section>
      ) : null}

      {team.canManage && pending.length > 0 ? (
        <Section title="Pending invites">
          <PendingInvites invites={pending} roleLabels={team.roleLabels} actions={actions} />
        </Section>
      ) : null}

      {!isOwner ? (
        <Section title="Leave this workspace">
          <p className={`${SUBTLE} mb-3`}>
            You&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
          </p>
          <LeaveButton userId={team.user.id} actions={actions} />
        </Section>
      ) : null}
    </div>
  );
}
