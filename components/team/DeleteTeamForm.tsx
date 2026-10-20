"use client";

// The trash on a team you own in Settings → Teams' list opens this in the row's place: what goes with the team,
// and its name to type before Delete team lights up. weft.zip checks the name again (lib/team-delete.ts).
import { useState, useTransition, type SubmitEvent } from "react";
import type { TeamActionResult, TeamOrg } from "@/lib/team-types";

export function DeleteTeamForm({
  org,
  submit,
  onDone,
  onCancel,
}: {
  org: TeamOrg;
  submit: (confirm: string) => Promise<TeamActionResult>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === org.name.trim();

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!matches) return;
    startTransition(async () => {
      const result = await submit(typed.trim());
      if (result.ok) onDone();
      else setError(result.message ?? "Couldn't delete the team.");
    });
  }

  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3">
      <p className="text-[13px] text-ink">
        Delete <b>{org.name}</b>? Its synced cards, projects, mini apps, share links and invites go with it, and everyone in
        it loses access. This can&apos;t be undone.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Type the team's name to confirm"
          autoFocus
          value={typed}
          placeholder={org.name}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          className="w-48 min-w-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-danger"
        />
        <button
          type="submit"
          disabled={!matches || pending}
          className="rounded-md bg-danger px-2.5 py-1 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {pending ? "Deleting…" : "Delete team"}
        </button>
        <button type="button" onClick={onCancel} className="text-[12.5px] text-muted hover:text-ink">
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
