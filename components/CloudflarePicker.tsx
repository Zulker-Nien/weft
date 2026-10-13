"use client";

import { useState } from "react";
import { KIND_LABEL, pickerList, type CloudflareFolder, type CloudflareProject } from "@/lib/cloudflare-view";
import { folderName } from "@/lib/format";
import { Note } from "./VaultParts";

const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

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
  const rows = projects ? pickerList(projects, folder, search).slice(0, 50) : [];
  return (
    <section className="mt-2 rounded-lg border border-accent/40 bg-card px-2 py-2" aria-label={`Link ${folderName(folder.folder)}`}>
      <div className="flex items-center gap-1 px-0.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Link {folderName(folder.folder)} to…</h3>
        <button onClick={onCancel} className={SMALL}>
          Cancel
        </button>
      </div>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Search Workers and Pages"
        aria-label="Search Cloudflare projects"
        className="mt-1.5 w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
      />
      {!projects && <Note>Loading your Workers and Pages…</Note>}
      {projects && rows.length === 0 && <Note>{search ? "No project matches." : "No Workers or Pages projects on this account yet. Deploy one with wrangler, then link it."}</Note>}
      <ul className="mt-1 max-h-[320px] overflow-y-auto">
        {rows.map(({ project: p, score }) => (
          <li key={`${p.accountId}/${p.kind}/${p.name}`}>
            <button onClick={() => void onPick(p)} disabled={busy} className="w-full rounded px-1.5 py-1 text-left hover:bg-sunken disabled:opacity-40">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{p.name}</span>
                {score >= 2 && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] leading-[15px] text-accent">best fit</span>}
              </span>
              <span className="block truncate text-[10.5px] text-faint">
                {KIND_LABEL[p.kind]} · {p.account}
                {p.git ? ` · ${p.git}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
