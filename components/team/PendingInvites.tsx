"use client";

// The pending-invites list: every invitation that hasn't been accepted or
// revoked yet, oldest first. A "Revoke" button on each row posts to
// revokeInvite. The action's result shows in a small status line below
// the row so a manager who revokes several in a row sees each result
// without losing their place.
import { useState, useTransition } from "react";
import { revokeInvite } from "@/lib/team-actions";

export type PendingInviteRow = {
  id: string;
  email: string;
  role: string;
  roleLabel: string;
  createdAt: string;
  expiresAt: string;
};

function formatShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function PendingInviteRowItem({ orgSlug, invite }: { orgSlug: string; invite: PendingInviteRow }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function handleRevoke() {
    startTransition(async () => {
      const result = await revokeInvite(orgSlug, invite.id);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Revoked." : "Couldn\u2019t revoke."),
      });
    });
  }

  return (
    <>
      <div className="wz-pendingRow">
        <span className="wz-pendingEmail">{invite.email}</span>
        <span className="wz-pendingRole">{invite.roleLabel}</span>
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

export function PendingInvites({ orgSlug, invites }: { orgSlug: string; invites: PendingInviteRow[] }) {
  if (invites.length === 0) return null;

  return (
    <div className="wz-pendingList" role="list">
      {invites.map((i) => (
        <PendingInviteRowItem key={i.id} orgSlug={orgSlug} invite={i} />
      ))}
    </div>
  );
}
