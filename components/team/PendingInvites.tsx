"use client";

// The pending-invites list: every invitation that hasn't been accepted or
// revoked yet, oldest first. A "Revoke" button on each row posts to
// actions.revoke. The action's result shows in a small status line below
// the row so a manager who revokes several in a row sees each result
// without losing their place.
//
// The actions object comes in as a prop (lib/team-types.ts's
// TeamClientActions) so this component is shared by the weft.zip server
// page and the desktop's Settings → Team. No server-only imports here, so
// the bundle stays browser-safe.
import { useState, useTransition } from "react";
import type { TeamClientActions, TeamInvite, TeamRole } from "@/lib/team-types";

export type PendingInviteRow = {
  id: string;
  email: string;
  role: TeamRole;
  roleLabel: string;
  createdAt: string;
  expiresAt: string;
};

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function PendingInviteRowItem({ invite, roleLabels, actions }: { invite: PendingInviteRow; roleLabels: Record<TeamRole, string>; actions: TeamClientActions }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function handleRevoke() {
    startTransition(async () => {
      const result = await actions.revoke(invite.id);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Revoked." : "Couldn’t revoke."),
      });
    });
  }

  return (
    <>
      <div className="wz-pendingRow">
        <span className="wz-pendingEmail">{invite.email}</span>
        <span className="wz-pendingRole">{invite.roleLabel || roleLabels[invite.role]}</span>
        <span className="wz-pendingExpiry" title={`Sent ${formatShort(invite.createdAt)} · expires ${formatShort(invite.expiresAt)}`}>
          {formatShort(invite.expiresAt)}
        </span>
        <button
          type="button"
          className="wz-pendingRevoke"
          onClick={handleRevoke}
          disabled={pending}
          aria-label={`Revoke invite for ${invite.email}`}
        >
          {pending ? "Working…" : "Revoke"}
        </button>
      </div>
      {message ? (
        <div className="wz-pendingRow" style={{ paddingTop: 0, paddingBottom: 6 }}>
          <span
            className={`wz-rosterMessage ${message.kind === "err" ? "wz-rosterMessageError" : "wz-rosterMessageOk"}`}
            style={{ gridColumn: "1 / -1" }}
          >
            {message.text}
          </span>
        </div>
      ) : null}
    </>
  );
}

export function PendingInvites({
  invites,
  roleLabels,
  actions,
}: {
  invites: PendingInviteRow[];
  roleLabels: Record<TeamRole, string>;
  actions: TeamClientActions;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="wz-pendingList" role="list">
      {invites.map((i) => (
        <PendingInviteRowItem key={i.id} invite={i} roleLabels={roleLabels} actions={actions} />
      ))}
    </div>
  );
}

// PendingInviteRow from a TeamInvite, with roleLabel filled in by the page.
export function inviteRow(invite: TeamInvite, roleLabels: Record<TeamRole, string>): PendingInviteRow {
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    roleLabel: roleLabels[invite.role],
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  };
}
