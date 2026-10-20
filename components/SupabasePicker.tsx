"use client";

import { useState } from "react";
import { rankItems } from "@/lib/db-picker";
import { folderName } from "@/lib/format";
import { defaultProjectName, defaultRegion, matchScore, type NewSupabaseProject, type SupabaseFolder, type SupabaseOrg, type SupabaseProject } from "@/lib/supabase-view";
import DbSelect, { DbNewButton, DbRowLines } from "./DbSelect";
import SupabaseNewProject from "./SupabaseNewProject";

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
  const rows = projects
    ? rankItems<SupabaseProject>({
        items: projects,
        folder,
        search,
        score: (p) => matchScore(p, folder),
        keys: (p) => [p.name, p.org ?? "", p.ref],
        newest: (p) => p.createdAt,
        limit: 50,
      })
    : null;
  const title = folderName(folder.folder);

  return (
    <DbSelect
      title={creating ? "New Supabase project" : `Link ${title} to…`}
      ariaLabel={`Link ${title}`}
      rows={rows}
      loading="Loading your Supabase projects…"
      search={search}
      onSearch={setSearch}
      searchLabel="Search Supabase projects"
      searchPlaceholder="Search projects"
      emptyText={search ? "No project matches." : "No projects on Supabase yet: make one above."}
      busy={busy}
      hideSearch={creating}
      rowKey={(p) => p.ref}
      onPick={(p) => void onPick(p)}
      onCancel={creating ? () => setCreating(false) : onCancel}
      extra={
        creating ? (
          <SupabaseNewProject
            initialName={defaultProjectName(folder)}
            initialRegion={defaultRegion(projects ?? [])}
            orgs={orgs}
            busy={busy}
            onCreate={onCreate}
            onBack={() => setCreating(false)}
          />
        ) : (
          <DbNewButton onClick={() => setCreating(true)} label="New project" title="Make a Supabase project for this folder and link it" />
        )
      }
      renderRow={(p, score) => (
        <DbRowLines
          name={p.name}
          score={score}
          detail={[p.org, p.region, p.status === "INACTIVE" ? "paused" : null].filter(Boolean).join(" · ")}
        />
      )}
    />
  );
}