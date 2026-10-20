"use client";

import { useState } from "react";
import { rankItems } from "@/lib/db-picker";
import { folderName } from "@/lib/format";
import { matchScore, projectNameFor, type CreateOptions, type VercelBridge, type VercelFolder, type VercelProject } from "@/lib/vercel-view";
import DbSelect, { DbNewButton, DbRowLines } from "./DbSelect";
import VercelCreate from "./VercelCreate";

// The ▲ drawer's Link… picker: links a folder to one of your Vercel projects (best fits first), or to a new
// one made by components/VercelCreate.tsx.
export default function VercelPicker({
  bridge,
  folder,
  projects,
  busy,
  onPick,
  onCreate,
  onCancel,
  notify,
}: {
  bridge: VercelBridge;
  folder: VercelFolder;
  // null while main is still listing them.
  projects: VercelProject[] | null;
  busy: boolean;
  onPick: (p: VercelProject) => Promise<void>;
  onCreate: (options: CreateOptions) => Promise<void>;
  onCancel: () => void;
  notify: (err: unknown) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = projects
    ? rankItems<VercelProject>({
        items: projects,
        folder,
        search,
        // 3 deploys from the folder's repo, then the name tiers (lib/vercel-view.ts matchScore).
        score: (p) => matchScore(p, folder),
        keys: (p) => [p.name, p.team, p.git ?? ""],
        newest: (p) => p.updatedAt,
        limit: 50,
      })
    : null;
  const title = folderName(folder.folder);

  return (
    <DbSelect
      title={creating ? "New Vercel project" : `Link ${title} to…`}
      ariaLabel={`Link ${title}`}
      rows={rows}
      loading="Loading your Vercel projects…"
      search={search}
      onSearch={setSearch}
      searchLabel="Search Vercel projects"
      searchPlaceholder="Search projects"
      emptyText={search ? "No project matches." : "No projects on Vercel yet: make one above."}
      busy={busy}
      hideSearch={creating}
      rowKey={(p) => p.id}
      onPick={(p) => void onPick(p)}
      onCancel={creating ? () => setCreating(false) : onCancel}
      extra={
        creating ? (
          <VercelCreate bridge={bridge} folder={folder} busy={busy} onCreate={onCreate} onBack={() => setCreating(false)} notify={notify} />
        ) : (
          <DbNewButton onClick={() => setCreating(true)} label="New project" hint={projectNameFor(folder)} />
        )
      }
      renderRow={(p, score) => (
        <DbRowLines name={p.name} score={score} detail={p.git ? `${p.team} · ${p.git}` : p.team} />
      )}
    />
  );
}