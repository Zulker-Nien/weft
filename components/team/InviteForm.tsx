"use client";

// The invite-a-teammate form on the Team page. A single email + role pair
// posts to lib/team-actions.ts inviteMember, which returns { ok, message }.
//
// The role <select> shows the actor's assignable roles (server-filtered
// before the form is rendered), and the description of whichever role is
// currently picked shows underneath so the inviter doesn't have to guess.
// On submit the action runs, the message renders inline (red on !ok,
// green on ok), the input keeps its value (so a typo is obvious in the
// same spot), and on success the email field is cleared.
//
// useActionState wires the form's action to the server action; the action
// is bound to orgSlug here on the client (inviteMember.bind(null, orgSlug))
// so the slug doesn't need to be a hidden field and the page doesn't have
// to pass a closure across the server → client boundary.
import { startTransition, useActionState, useState, type SubmitEvent } from "react";
import { inviteMember } from "@/lib/team-actions";

export type RoleOption = { role: string; label: string; description: string };

export type InviteActionState = { ok: boolean; message?: string };

const INITIAL: InviteActionState = { ok: false };

export function InviteForm({ orgSlug, roleOptions, defaultRole }: { orgSlug: string; roleOptions: RoleOption[]; defaultRole?: string }) {
  // useActionState (React 19) wires the form's action to the server, gives
  // back the current state and a pending flag. The bound action closes over
  // orgSlug here on the client; the slug never needs to leave the page
  // hidden-field. We wrap it so a successful invite clears the email field
  // synchronously in the action's handler — no effect needed.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(defaultRole ?? roleOptions[0]?.role ?? "member");
  const action = async (prev: InviteActionState, formData: FormData) => {
    const next = await inviteMember(orgSlug, prev, formData);
    if (next.ok) setEmail("");
    return next;
  };
  const [state, formAction, pending] = useActionState<InviteActionState, FormData>(action, INITIAL);

  // Submitted through onSubmit rather than <form action>: React 19 resets a form after its action runs, which
  // would throw away the picked role along with the email.
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };

  const currentRole = roleOptions.find((o) => o.role === role) ?? roleOptions[0];
  const message = state.message;

  return (
    <form onSubmit={submit} className="wz-inviteForm" noValidate>
      <div className="wz-inviteRow">
        <div className="wz-inviteField">
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            className="wz-inviteInput"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            autoComplete="email"
            required
            disabled={pending}
          />
        </div>
        <div className="wz-inviteField" style={{ flex: "0 0 180px" }}>
          <label htmlFor="invite-role">Role</label>
          <select
            id="invite-role"
            name="role"
            className="wz-inviteSelect"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={pending || roleOptions.length === 0}
            aria-describedby="invite-role-description"
          >
            {roleOptions.map((o) => (
              <option key={o.role} value={o.role}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {currentRole ? (
        <p id="invite-role-description" className="wz-inviteRoleDescription">
          {currentRole.description}
        </p>
      ) : null}
      <div>
        <button type="submit" className="wz-inviteSubmit" disabled={pending || !email.trim()}>
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      {message ? (
        <p
          className={`wz-inviteMessage ${state.ok ? "wz-inviteMessageOk" : "wz-inviteMessageError"}`}
          role={state.ok ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
