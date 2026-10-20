"use client";

import { useState } from "react";
import { newPropertyName, propertyOptions, SITE, type BlastcpWorkspace, type PropertyOption } from "@/lib/blastcp-view";
import { folderName } from "@/lib/format";
import { SMALL } from "./BlastcpConnect";
import DbSelect, { DbRowLines } from "./DbSelect";

// Links a folder to one property in one of your workspaces, or to a new one it makes.
export default function BlastcpPicker({
  folder,
  workspaces,
  busy,
  onPick,
  onCreate,
  onCancel,
  onOpenUrl,
}: {
  folder: string;
  workspaces: BlastcpWorkspace[] | null;
  busy: boolean;
  onPick: (o: PropertyOption) => Promise<void>;
  onCreate: (org: string, name: string) => Promise<void>;
  onCancel: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [search, setSearch] = useState("");
  // The new property's name while you're making one, else null.
  const [creating, setCreating] = useState<string | null>(null);
  const options = workspaces ? propertyOptions(workspaces, folder, search) : null;
  const many = options ? new Set(options.map((r) => r.org)).size > 1 : false;
  const title = folderName(folder);

  return (
    <DbSelect
      title={`Link ${title} to…`}
      ariaLabel={`Link ${title}`}
      // propertyOptions has already filtered and ranked; DbSelect takes it as-is.
      rows={options ? options.map((item) => ({ item, score: item.score })) : null}
      loading="Loading your BlastCP properties…"
      search={search}
      onSearch={setSearch}
      searchLabel="Search BlastCP properties"
      searchPlaceholder="Search properties"
      emptyText={
        search ? (
          "No property matches."
        ) : workspaces?.length ? (
          "No properties yet."
        ) : (
          <>
            No workspace yet.{" "}
            <button onClick={() => onOpenUrl(SITE)} className="text-accent underline">
              Make one on BlastCP
            </button>
          </>
        )
      }
      busy={busy}
      rowKey={(o) => `${o.org}/${o.slug}`}
      onPick={(o) => void onPick(o)}
      onCancel={onCancel}
      extra={
        workspaces && workspaces.length > 0 ? (
          creating === null ? (
            <button
              onClick={() => setCreating(newPropertyName(folder, search))}
              disabled={busy}
              className="mt-1 w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-accent hover:bg-sunken disabled:opacity-40"
              title="Make a new property in BlastCP (it starts with a starter voice and playbooks) and link this folder to it"
            >
              + New property{search.trim() ? ` “${search.trim()}”` : "…"}
            </button>
          ) : (
            <NewProperty name={creating} workspaces={workspaces} busy={busy} onName={setCreating} onCreate={onCreate} onBack={() => setCreating(null)} />
          )
        ) : undefined
      }
      renderRow={(o, score) => <DbRowLines name={o.name} score={score} detail={many ? `${o.slug} · ${o.orgName}` : o.slug} />}
    />
  );
}

// The picker's "New property" form: a name and, with more than one, which workspace it goes in.
function NewProperty({
  name,
  workspaces,
  busy,
  onName,
  onCreate,
  onBack,
}: {
  name: string;
  workspaces: BlastcpWorkspace[];
  busy: boolean;
  onName: (name: string) => void;
  onCreate: (org: string, name: string) => Promise<void>;
  onBack: () => void;
}) {
  const [org, setOrg] = useState(workspaces[0]?.slug ?? "");
  const ready = !busy && name.trim() !== "" && org !== "";
  const create = () => ready && void onCreate(org, name.trim());
  return (
    <div className="mt-1.5 space-y-1.5 border-t border-line px-0.5 pt-2" aria-label="New BlastCP property">
      <input
        autoFocus
        value={name}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
          if (e.key === "Escape") onBack();
        }}
        placeholder="What you post as"
        aria-label="New property name"
        className="w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
      />
      {workspaces.length > 1 && (
        <select value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Workspace" className="w-full rounded-md border border-line-strong bg-panel px-1.5 py-1 text-[12px] text-ink">
          {workspaces.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-1">
        <button onClick={create} disabled={!ready} className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40">
          {busy ? "Creating…" : "Create & link"}
        </button>
        <button onClick={onBack} className={SMALL}>
          Back
        </button>
      </div>
    </div>
  );
}