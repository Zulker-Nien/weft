"use client";

// The "Leave this workspace" button. Calls removeMember for the current
// user's own id. Confirm first (irreversible) and show the action's
// message inline.
import { useState, useTransition } from "react";
import { removeMember } from "@/lib/team-actions";

export function LeaveButton({ orgSlug, userId }: { orgSlug: string; userId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function handleClick() {
    if (typeof window !== "undefined" && !window.confirm("Leave this workspace? You\u2019ll need a new invite to come back.")) return;
    startTransition(async () => {
      const result = await removeMember(orgSlug, userId);
      if (result.ok) {
        // The action is supposed to redirect on success; if it didn't,
        // show whatever message it returned (likely an error).
        setMessage({ kind: "ok", text: result.message ?? "Left the workspace." });
      } else {
        setMessage({ kind: "err", text: result.message ?? "Couldn\u2019t leave the workspace." });
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
