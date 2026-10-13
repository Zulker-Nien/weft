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
// component opens straight on the content. The loading, signed-out and
// error states still need a line on their own, because there's no
// workspace to show yet — a "Loading your team" line is enough for that
// state, and a "Sign in to your Weft account" hint for signed-out.
import { useState } from "react";
import { openTeamPage } from "./board-palette";
import { Spinner } from "./Icon";
import { InviteForm, type RoleOption } from "./team/InviteForm";
import { LeaveButton } from "./team/LeaveButton";
import { PendingInvites, inviteRow } from "./team/PendingInvites";
import { Roster } from "./team/Roster";
import { useTeam } from "@/lib/use-team";
import type { TeamRole } from "@/lib/team-types";

// Match the look of the other Settings pages: cards holding the roster,
// invite form, etc. The wz-* classes belong to weft.zip's stylesheet; we
// override the bits that need to match the board's Settings card style
// (rounded border, panel/85 background, the same text colours).
const CARD = "rounded-xl border border-line-strong bg-panel/85 p-5 shadow-lg backdrop-blur-xl";
const SECTION_TITLE = "text-[12.5px] font-semibold uppercase tracking-[0.16em] text-muted";
const SUBTLE = "text-[12.5px] text-muted";

// The role <select> in the roster only needs {role, label}. We hand the
// invite form the full RoleOption list (with descriptions).
function compactRoleOptions(opts: { role: TeamRole; label: string }[]): RoleOption[] {
  return opts.map((o) => ({ role: o.role, label: o.label, description: "" }));
}

export default function TeamSettings() {
  const [org, setOrg] = useState<string | undefined>(undefined);
  const { state, refresh, actions } = useTeam(org);

  if (state.kind === "loading") {
    return (
      <div className={`flex items-center gap-2 ${SUBTLE}`}>
        <Spinner size={12} /> Loading your team
      </div>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-ink">
          Sign in to your Weft account to see your team.
        </p>
        <p className={SUBTLE}>
          The sign-in lives in Settings → Accounts.
        </p>
        <div>
          <button
            type="button"
            onClick={openTeamPage}
            className="rounded-md border border-line-strong bg-panel/80 px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken"
          >
            Open on weft.zip
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex flex-col gap-2">
        <p className="break-words text-[12.5px] text-danger">Couldn&apos;t load your team: {state.message}</p>
        <div>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-line-strong bg-panel/80 px-3 py-1.5 text-[12.5px] text-ink hover:bg-sunken"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // state.kind === "ok"
  const team = state.team;
  const isOwner = team.role === "owner";
  const roleOptions: RoleOption[] = team.roleOptions.map((o) => ({ role: o.role, label: o.label, description: o.description }));
  const compact = compactRoleOptions(roleOptions);
  const pending = team.pending.map((i) => inviteRow(i, team.roleLabels));

  return (
    <div className="flex flex-col gap-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium text-ink">{team.org.name}</span>
            <span className={SUBTLE}>· you&apos;re a {team.roleLabels[team.role].toLowerCase()}</span>
          </div>
          <div className="flex items-center gap-2">
            {team.orgs.length > 1 ? (
              <select
                aria-label="Switch workspace"
                value={team.org.slug}
                onChange={(e) => setOrg(e.target.value)}
                className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                {team.orgs.map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              onClick={openTeamPage}
              className="rounded-md border border-line-strong bg-panel/80 px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
            >
              Open on weft.zip
            </button>
          </div>
        </div>
      </div>

      <div className={CARD}>
        <h4 className={`${SECTION_TITLE} mb-3`}>Members</h4>
        <Roster
          members={team.members}
          canManage={team.canManage}
          roleOptions={compact}
          currentUserId={team.user.id}
          actions={actions}
        />
      </div>

      {team.canManage ? (
        <div className={CARD}>
          <h4 className={`${SECTION_TITLE} mb-3`}>Invite a teammate</h4>
          <InviteForm roleOptions={roleOptions} actions={actions} />
        </div>
      ) : null}

      {team.canManage && pending.length > 0 ? (
        <div className={CARD}>
          <h4 className={`${SECTION_TITLE} mb-3`}>Pending invites</h4>
          <PendingInvites invites={pending} roleLabels={team.roleLabels} actions={actions} />
        </div>
      ) : null}

      {!isOwner ? (
        <div className={CARD}>
          <h4 className={`${SECTION_TITLE} mb-3`}>Leave this workspace</h4>
          <p className={`${SUBTLE} mb-3`}>
            You&apos;ll lose access to its boards, billing and shared vaults. You can be re-invited later.
          </p>
          <LeaveButton userId={team.user.id} actions={actions} />
        </div>
      ) : null}
    </div>
  );
}
