"use client";

// The "Join <org>" form on /invite/[token]. Renders a single submit button
// and posts to app/invite/[token]/actions.ts's joinWorkspace. The action
// calls acceptInvite, setCurrentOrg and redirects to /[orgSlug]/team?joined=1.
//
// We render this as a form rather than mutating in the page render so link
// preview bots (Slack, iMessage, Twitter, Discord) — which fetch the URL on
// the inviter's behalf and are perfectly happy to follow a redirect — can't
// burn a single-use token just because someone pasted it in a chat.
//
// The token travels in a hidden field; the action re-looks it up to derive
// the org slug, so a forged token just shows the "expired" message.
import { useActionState } from "react";

export type JoinActionState = { ok: false; message: string };

// The bound action's signature matches useActionState's contract:
// (prevState, formData) => Promise<state>. The action in actions.ts
// ignores prevState and reads the token from the form data.
export type JoinAction = (prev: JoinActionState, formData: FormData) => Promise<JoinActionState>;

const INITIAL: JoinActionState = { ok: false, message: "" };

export function JoinForm({
  token,
  orgName,
  action,
}: {
  token: string;
  orgName: string;
  action: JoinAction;
}) {
  const [state, formAction, pending] = useActionState<JoinActionState, FormData>(action, INITIAL);

  return (
    <form action={formAction} className="wz-joinForm">
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="wz-joinSubmit" disabled={pending}>
        {pending ? "Joining…" : `Join ${orgName}`}
      </button>
      {state.message ? (
        <p className="wz-joinMessage" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
