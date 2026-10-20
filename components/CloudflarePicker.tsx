"use client";

import { useState } from "react";
import { KIND_LABEL, matchScore, type CloudflareFolder, type CloudflareProject } from "@/lib/cloudflare-view";
import { rankItems } from "@/lib/db-picker";
import { folderName } from "@/lib/format";
import DbSelect, { DbRowLines } from "./DbSelect";

// The Cloudflare drawer's Link… picker: links a folder to one of your Workers or Pages projects, best fits
// first (the one its wrangler config names, then its repo's or folder's name).
export default function CloudflarePicker({
  folder,
  projects,
  busy,
  onPick,
  onCancel,
}: {
  folder: CloudflareFolder;
  // null while main is still listing them.
  projects: CloudflareProject[] | null;
  busy: boolean;
  onPick: (p: CloudflareProject) => Promise<void>;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const rows = projects
    ? rankItems<CloudflareProject>({
        items: projects,
        folder,
        search,
        // 4 the wrangler config names it, 3 it builds from the folder's repo, then the name tiers.
        score: (p) => matchScore(p, folder),
        keys: (p) => [p.name, p.account, KIND_LABEL[p.kind], p.git ?? ""],
        newest: (p) => p.updatedAt,
        limit: 50,
      })
    : null;

  return (
    <DbSelect
      title={`Link ${folderName(folder.folder)} to…`}
      ariaLabel={`Link ${folderName(folder.folder)}`}
      rows={rows}
      loading="Loading your Workers and Pages…"
      search={search}
      onSearch={setSearch}
      searchLabel="Search Cloudflare projects"
      searchPlaceholder="Search Workers and Pages"
      emptyText={search ? "No project matches." : "No Workers or Pages projects on this account yet. Deploy one with wrangler, then link it."}
      busy={busy}
      rowKey={(p) => `${p.accountId}/${p.kind}/${p.name}`}
      onPick={(p) => void onPick(p)}
      onCancel={onCancel}
      renderRow={(p, score) => (
        <DbRowLines
          name={p.name}
          score={score}
          detail={
            <>
              {KIND_LABEL[p.kind]} · {p.account}
              {p.git ? ` · ${p.git}` : ""}
            </>
          }
        />
      )}
    />
  );
}