"use client";

import { useEffect, useState } from "react";
import { projectNameFor, startScope, validProjectName, type CreateOptions, type VercelBridge, type VercelFolder, type VercelScopes } from "@/lib/vercel-view";
import { Note } from "./VaultParts";

// The link picker's "New project" form: a name (the repo's, by default), the team it goes in, and whether
// to connect the folder's GitHub repo so pushes deploy. Main makes the project and links the folder.
export default function VercelCreate({
  bridge,
  folder,
  busy,
  onCreate,
  onBack,
  notify,
}: {
  bridge: VercelBridge;
  folder: VercelFolder;
  busy: boolean;
  onCreate: (options: CreateOptions) => Promise<void>;
  onBack: () => void;
  notify: (err: unknown) => void;
}) {
  const [name, setName] = useState(() => projectNameFor(folder));
  const [scopes, setScopes] = useState<VercelScopes | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [git, setGit] = useState(Boolean(folder.repo));

  useEffect(() => {
    let live = true;
    bridge.scopes().then(
      (s) => {
        if (!live) return;
        setScopes(s);
        setTeamId(startScope(s));
      },
      (err: unknown) => live && notify(err),
    );
    return () => {
      live = false;
    };
  }, [bridge, notify]);

  const valid = validProjectName(name);
  return (
    <form
      className="mt-1.5 flex flex-col gap-1.5 px-0.5 text-[11.5px] text-muted"
      aria-label="New Vercel project"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && scopes) void onCreate({ name: name.trim(), teamId, git });
      }}
    >
      <label className="flex flex-col gap-0.5">
        <span>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          onKeyDown={(e) => {
            if (e.key === "Escape") onBack();
          }}
          aria-invalid={!valid}
          className="rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink aria-[invalid=true]:border-danger"
        />
      </label>
      {!valid && name && <span className="text-[10.5px] text-danger">Lowercase letters, digits, &apos;.&apos;, &apos;_&apos; and &apos;-&apos;; no &apos;---&apos;.</span>}
      {!scopes ? (
        <Note>Loading your teams…</Note>
      ) : (
        <label className="flex flex-col gap-0.5">
          <span>Team</span>
          <select
            value={teamId ?? ""}
            onChange={(e) => setTeamId(e.target.value || null)}
            className="rounded-md border border-line-strong bg-card px-1.5 py-1 text-[12px] text-ink"
          >
            {scopes.scopes.map((s) => (
              <option key={s.id ?? ""} value={s.id ?? ""}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {folder.repo ? (
        <label className="flex items-start gap-1.5 leading-snug">
          <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} className="mt-0.5" />
          <span>
            Deploy from GitHub <b className="font-medium text-ink">{folder.repo}</b> on every push
          </span>
        </label>
      ) : (
        <span className="text-[10.5px] text-faint">No GitHub remote: deploy with the Vercel CLI, or connect a repo later.</span>
      )}
      <div className="mt-0.5 flex gap-1.5">
        <button type="submit" disabled={busy || !valid || !scopes} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {busy ? "Creating…" : "Create and link"}
        </button>
        <button type="button" onClick={onBack} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
          Back
        </button>
      </div>
    </form>
  );
}
