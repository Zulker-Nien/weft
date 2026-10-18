"use client";

// "+ New team" in the switcher: a name field, then actions.createTeam; on success the caller switches to the
// new workspace's slug.
import { useState, useTransition, type SubmitEvent } from "react";
import type { TeamClientActions } from "@/lib/team-types";

export function NewTeamForm({
  actions,
  onCreated,
  onCancel,
}: {
  actions: TeamClientActions;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await actions.createTeam(trimmed);
      if (result.ok && result.slug) onCreated(result.slug);
      else setError(result.message ?? "Couldn't create the team.");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" noValidate>
      <div className="flex items-center gap-2">
        <input
          aria-label="Team name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Team name"
          className="w-40 rounded-md border border-line-strong bg-canvas px-2 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create"}
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
