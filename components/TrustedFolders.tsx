"use client";

// Settings → General: the folders outside any project that threads may use without asking. The guard itself
// is lib/folder-guard.ts, and "Always" on one of its prompts is what adds a folder here; what was missing was
// anywhere to see the list and take one back out. The list arrives in the settings view (allowedFolders), so
// this row needs no request of its own; only a revoke goes back.

import { useState } from "react";
import { api } from "@/lib/client";
import { folderName } from "@/lib/format";
import Icon, { Spinner } from "./Icon";
import { SettingsSectionHeader } from "./SettingsLayout";

const REMOVE = "rounded-md border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-sunken disabled:opacity-40";

export default function TrustedFolders({ folders }: { folders: string[] }) {
  const [left, setLeft] = useState(folders);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  // Drop the row the moment the revoke lands, so the button reads as done even before the server answers.
  function revoke(folder: string) {
    setBusy(folder);
    setError("");
    api
      .unallowFolder(folder)
      .then(() => setLeft((f) => f.filter((x) => x !== folder)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(null));
  }

  return (
    <section className="flex flex-col gap-2.5">
      <SettingsSectionHeader
        title="Trusted folders"
        hint="Threads may read these without asking, wherever their project points. You choose one on a folder-guard prompt with Always; take it back out here and they ask again. A thread already running keeps what it was given until this card's turn ends."
      />
      {left.length === 0 ? (
        <p className="text-[12.5px] text-muted">None. A thread reaches outside its project only by asking you first.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {left.map((folder) => (
            <li key={folder} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={folder}>
                {folderName(folder)}
              </span>
              <button
                type="button"
                // Named for the folder, so a screen reader says which trust this button takes back.
                aria-label={`Stop trusting ${folder}`}
                onClick={() => revoke(folder)}
                disabled={busy !== null}
                className={`flex shrink-0 items-center gap-1.5 ${REMOVE}`}
              >
                {busy === folder && <Spinner size={11} />}
                <Icon name="x" size={12} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </section>
  );
}