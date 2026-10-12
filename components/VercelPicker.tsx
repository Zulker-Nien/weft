"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import { pickerList, projectNameFor, type CreateOptions, type VercelBridge, type VercelFolder, type VercelProject } from "@/lib/vercel-view";
import { Note } from "./VaultParts";
import VercelCreate from "./VercelCreate";

const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

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
  const rows = projects ? pickerList(projects, folder, search).slice(0, 50) : [];
  return (
    <section className="mt-2 rounded-lg border border-accent/40 bg-card px-2 py-2" aria-label={`Link ${folderName(folder.folder)}`}>
      <div className="flex items-center gap-1 px-0.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{creating ? "New Vercel project" : `Link ${folderName(folder.folder)} to…`}</h3>
        <button onClick={onCancel} className={SMALL}>
          Cancel
        </button>
      </div>
      {creating ? (
        <VercelCreate bridge={bridge} folder={folder} busy={busy} onCreate={onCreate} onBack={() => setCreating(false)} notify={notify} />
      ) : (
        <>
          <button
            onClick={() => setCreating(true)}
            className="mt-1.5 flex w-full items-center gap-1 rounded-md border border-dashed border-line-strong px-2 py-1 text-left text-[12px] text-accent hover:bg-accent-soft"
          >
            <span aria-hidden>+</span> New project
            <span className="ml-auto truncate text-[10.5px] text-faint">{projectNameFor(folder)}</span>
          </button>
          <ProjectList search={search} onSearch={setSearch} projects={projects} rows={rows} busy={busy} onPick={onPick} onCancel={onCancel} />
        </>
      )}
    </section>
  );
}

function ProjectList({
  search,
  onSearch,
  projects,
  rows,
  busy,
  onPick,
  onCancel,
}: {
  search: string;
  onSearch: (s: string) => void;
  projects: VercelProject[] | null;
  rows: ReturnType<typeof pickerList>;
  busy: boolean;
  onPick: (p: VercelProject) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <>
      <input
        autoFocus
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Search projects"
        aria-label="Search Vercel projects"
        className="mt-1.5 w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
      />
      {!projects && <Note>Loading your Vercel projects…</Note>}
      {projects && rows.length === 0 && <Note>{search ? "No project matches." : "No projects on Vercel yet: make one above."}</Note>}
      <ul className="mt-1 max-h-[320px] overflow-y-auto">
        {rows.map(({ project: p, score }) => (
          <li key={p.id}>
            <button onClick={() => void onPick(p)} disabled={busy} className="w-full rounded px-1.5 py-1 text-left hover:bg-sunken disabled:opacity-40">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{p.name}</span>
                {score >= 2 && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] leading-[15px] text-accent">best fit</span>}
              </span>
              <span className="block truncate text-[10.5px] text-faint">
                {p.team}
                {p.git ? ` · ${p.git}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
