"use client";

// The workspace roster. For every member: display name (or email, or a
// "—" placeholder when neither is set), role, joined date, and a "you" pill
// on the visitor's own row. Managers also get a role <select> (calling
// changeMemberRole) and a Remove button (calling removeMember). Non-managers
// see the same table without the controls.
//
// Each row imports its actions from @/lib/team-actions, so the page only
// hands the component the orgSlug (a plain string). The action result shows
// inline below the row so a manager who runs into a permission change mid-
// rotation sees it without navigating away. The change-role select fires
// the action on change with a tiny FormData; remove uses a button + confirm
// because removing is a one-way door.
//
// A row's controls are disabled while its action is in flight, so a
// double-click can't double-fire. The role <select> only shows roles the
// actor can assign (the server bakes that into the options list passed in
// as `roleOptions`); the table here doesn't decide who's assignable.
import { useState, useTransition } from "react";
import { changeMemberRole, removeMember } from "@/lib/team-actions";

// The shape the server hands down. We don't import `OrgRole` from
// @aimhuge/teams here — that package's root pulls node:crypto and breaks
// the "use client" boundary, even for a type-only import that the bundler
// may still evaluate. `role` is a string; the type union lives in the
// server's domain.

export type RosterMember = {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  roleLabel: string;
  joinedAt: string;
  isYou: boolean;
};

// The role <select>'s options. The server filters the list to the roles
// the actor can assign (an owner sees all three, an admin sees admin +
// member, a member is never shown the select because canManage is false).
export type RoleOption = { role: string; label: string };

function formatJoined(iso: string): string {
  // A short, locale-agnostic "Mon DD, YYYY" — the table is a list, not a
  // ledger, so absolute precision isn't useful and full ISO would dominate
  // the column.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function displayName(member: RosterMember): string {
  return member.displayName?.trim() || member.email?.trim() || "—";
}

function RosterRow({
  orgSlug,
  member,
  canManage,
  roleOptions,
}: {
  orgSlug: string;
  member: RosterMember;
  canManage: boolean;
  roleOptions: RoleOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // The role select fires the action on change. The action is idempotent
  // for the same (orgId, userId) pair, so we don't disable the select
  // while the change is in flight — a second click would just re-save the
  // same value. A small "Saving…" label on the right is enough feedback.
  function handleChangeRole(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!canManage) return;
    const formData = new FormData();
    formData.set("role", e.target.value);
    startTransition(async () => {
      const result = await changeMemberRole(orgSlug, member.userId, formData);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Saved." : "Couldn\u2019t save."),
      });
    });
  }

  function handleRemove() {
    if (!canManage) return;
    const display = member.displayName?.trim() || member.email || "this member";
    if (typeof window !== "undefined" && !window.confirm(`Remove ${display} from this workspace?`)) return;
    startTransition(async () => {
      const result = await removeMember(orgSlug, member.userId);
      setMessage({
        kind: result.ok ? "ok" : "err",
        text: result.message ?? (result.ok ? "Removed." : "Couldn\u2019t remove."),
      });
    });
  }

  return (
    <>
      <tr>
        <td>
          <div className="wz-rosterName">
            <span className="wz-rosterNamePrimary">
              {displayName(member)}
              {member.isYou ? <span className="wz-rosterYou">You</span> : null}
            </span>
            {member.email && displayName(member) !== member.email ? (
              <span className="wz-rosterNameSecondary">{member.email}</span>
            ) : null}
          </div>
        </td>
        <td>
          {canManage ? (
            <select
              className="wz-rosterSelect"
              value={member.role}
              onChange={handleChangeRole}
              disabled={pending}
              aria-label={`Role for ${displayName(member)}`}
            >
              {roleOptions.map((o) => (
                <option key={o.role} value={o.role}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <span>{member.roleLabel}</span>
          )}
        </td>
        <td className="wz-rosterDate">{formatJoined(member.joinedAt)}</td>
        <td>
          {canManage ? (
            <button
              type="button"
              className="wz-rosterButton wz-rosterButtonDanger"
              onClick={handleRemove}
              disabled={pending || member.isYou}
              aria-label={`Remove ${displayName(member)}`}
              title={member.isYou ? "You can\u2019t remove yourself; use Leave instead" : `Remove ${displayName(member)}`}
            >
              {pending ? "Working…" : "Remove"}
            </button>
          ) : (
            <span className="wz-rosterDash">—</span>
          )}
        </td>
      </tr>
      {message ? (
        <tr>
          <td colSpan={4}>
            <p className={`wz-rosterMessage ${message.kind === "err" ? "wz-rosterMessageError" : "wz-rosterMessageOk"}`}>
              {message.text}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function Roster({
  orgSlug,
  members,
  canManage,
  roleOptions,
  currentUserId,
}: {
  orgSlug: string;
  members: RosterMember[];
  canManage: boolean;
  roleOptions: RoleOption[];
  currentUserId: string;
}) {
  if (members.length === 0) {
    return <p className="wz-teamSub">No members yet. Invite the first teammate below.</p>;
  }

  return (
    <table className="wz-roster">
      <thead>
        <tr>
          <th scope="col">Member</th>
          <th scope="col">Role</th>
          <th scope="col">Joined</th>
          <th scope="col" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <RosterRow
            key={m.userId}
            orgSlug={orgSlug}
            member={m}
            canManage={canManage && m.userId !== currentUserId}
            roleOptions={roleOptions}
          />
        ))}
      </tbody>
    </table>
  );
}
