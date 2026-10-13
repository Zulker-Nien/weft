"use client";

// The "Leave this workspace" button. Calls actions.remove with the
// current user's own id (the server checks the actor is asking for
// themselves). Confirm first (irreversible) and show the action's
// message inline.
//
// The actions object comes in as a prop (lib/team-types.ts's
// TeamClientActions) so this component is shared by the weft.zip server
// page and the desktop's Settings → Team.
import { useState, useTransition } from "react";
import type { TeamClientActions } from "@/lib/team-types";

export function LeaveButton({ userId, actions }: { userId: string; actions: TeamClientActions }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function handleClick() {
    if (typeof window !== "undefined" && !window.confirm("Leave this workspace? You’ll need a new invite to come back.")) return;
    startTransition(async () => {
      const result = await actions.remove(userId);
      if (result.ok) {
        // The action is supposed to redirect on success; if it didn't,
        // show whatever message it returned (likely an error).
        setMessage({ kind: "ok", text: result.message ?? "Left the workspace." });
      } else {
        setMessage({ kind: "err", text: result.message ?? "Couldn’t leave the workspace." });
      }
    });
  }

  return (
    <>
      <button type="button" className="wz-leaveButton" onClick={handleClick} disabled={pending}>
        {pending ? "Leaving…" : "Leave workspace"}
      </button>
      {message ? (
        <p className={`wz-leaveMessage ${message.kind === "err" ? "wz-leaveMessageError" : ""}`} role={message.kind === "err" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}
    </>
  );
}
