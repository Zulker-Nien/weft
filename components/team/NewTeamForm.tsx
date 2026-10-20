"use client";

// A team's name field with a submit and Cancel, inline in Settings → Teams' list: "New team" at its foot
// (NewTeamForm: actions.createTeam, then the caller switches to the new workspace's slug) and the pencil on a
// team you own (TeamNameForm with actions.renameTeam).
import { useState, useTransition, type SubmitEvent } from "react";
import { TEAM_NAME_MAX, type NewTeamResult, type TeamClientActions } from "@/lib/team-types";

export function TeamNameForm({
  initial = "",
  submitLabel,
  busyLabel,
  failed,
  submit,
  onDone,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  busyLabel: string;
  // What to say when the answer has no message of its own.
  failed: string;
  submit: (name: string) => Promise<NewTeamResult>;
  onDone: (result: NewTeamResult) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = name.trim();

  function send(e: SubmitEvent) {
    e.preventDefault();
    if (!trimmed) return;
    if (trimmed === initial) {
      onCancel();
      return;
    }
    startTransition(async () => {
      const result = await submit(trimmed);
      if (result.ok) onDone(result);
      else setError(result.message ?? failed);
    });
  }

  return (
    <form onSubmit={send} className="flex min-w-0 flex-col gap-1" noValidate>
      <div className="flex items-center gap-2">
        <input
          aria-label="Team name"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={name}
          maxLength={TEAM_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
          placeholder="Team name"
          className="w-48 min-w-0 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending || !trimmed}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
        >
          {pending ? busyLabel : submitLabel}
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

export function NewTeamForm({
  actions,
  onCreated,
  onCancel,
}: {
  actions: TeamClientActions;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  return (
    <TeamNameForm
      submitLabel="Create"
      busyLabel="Creating…"
      failed="Couldn't create the team."
      // A yes without a slug leaves nothing to switch to, so it reads as a failure.
      submit={(name) => actions.createTeam(name).then((r) => (r.ok && !r.slug ? { ...r, ok: false } : r))}
      onDone={(r) => onCreated(r.slug ?? "")}
      onCancel={onCancel}
    />
  );
}
