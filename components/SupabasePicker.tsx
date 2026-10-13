"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import { defaultProjectName, defaultRegion, pickerList, type NewSupabaseProject, type SupabaseFolder, type SupabaseOrg, type SupabaseProject } from "@/lib/supabase-view";
import { SMALL } from "./supabase-ui";
import SupabaseNewProject from "./SupabaseNewProject";
import { Note } from "./VaultParts";

// The Supabase drawer's Link… picker (components/SupabaseDrawer.tsx): one of your Supabase projects, best fits
// first, or a new one made right here (components/SupabaseNewProject.tsx).
export default function SupabasePicker({
  folder,
  projects,
  orgs,
  busy,
  onPick,
  onCreate,
  onCancel,
}: {
  folder: SupabaseFolder;
  // null while main is still listing them.
  projects: SupabaseProject[] | null;
  orgs: SupabaseOrg[] | null;
  busy: boolean;
  onPick: (p: SupabaseProject) => Promise<void>;
  onCreate: (p: NewSupabaseProject) => Promise<void>;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const rows = projects ? pickerList(projects, folder, search).slice(0, 50) : [];
  return (
    <section className="mt-2 rounded-lg border border-accent/40 bg-card px-2 py-2" aria-label={`Link ${folderName(folder.folder)}`}>
      <div className="flex items-center gap-1 px-0.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Link {folderName(folder.folder)} to…</h3>
        <button onClick={onCancel} className={SMALL}>
          Cancel
        </button>
      </div>
      {creating ? (
        <SupabaseNewProject
          initialName={defaultProjectName(folder)}
          initialRegion={defaultRegion(projects ?? [])}
          orgs={orgs}
          busy={busy}
          onCreate={onCreate}
          onBack={() => setCreating(false)}
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mt-1.5 flex w-full items-center gap-1 rounded-md border border-dashed border-line-strong px-2 py-1 text-left text-[12px] text-accent hover:bg-accent-soft"
          title="Make a Supabase project for this folder and link it"
        >
          <span aria-hidden>+</span> New project
        </button>
      )}
      {!creating && <Projects projects={projects} rows={rows} search={search} busy={busy} onSearch={setSearch} onPick={onPick} onCancel={onCancel} />}
    </section>
  );
}

// The search box and the list of projects to link.
function Projects({
  projects,
  rows,
  search,
  busy,
  onSearch: setSearch,
  onPick,
  onCancel,
}: {
  projects: SupabaseProject[] | null;
  rows: ReturnType<typeof pickerList>;
  search: string;
  busy: boolean;
  onSearch: (search: string) => void;
  onPick: (p: SupabaseProject) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Search projects"
        aria-label="Search Supabase projects"
        className="mt-1.5 w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
      />
      {!projects && <Note>Loading your Supabase projects…</Note>}
      {projects && rows.length === 0 && <Note>{search ? "No project matches." : "No projects on Supabase yet: make one above."}</Note>}
      <ul className="mt-1 max-h-[320px] overflow-y-auto">
        {rows.map(({ project: p, score }) => (
          <li key={p.ref}>
            <button onClick={() => void onPick(p)} disabled={busy} className="w-full rounded px-1.5 py-1 text-left hover:bg-sunken disabled:opacity-40">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{p.name}</span>
                {score >= 2 && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] leading-[15px] text-accent">best fit</span>}
              </span>
              <span className="block truncate text-[10.5px] text-faint">
                {[p.org, p.region, p.status === "INACTIVE" ? "paused" : null].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
