"use client";

import { useState } from "react";
import { NEW_PROJECT_URL, REGIONS, type NewSupabaseProject, type SupabaseOrg } from "@/lib/supabase-view";
import { external, SMALL } from "./supabase-ui";

const FIELD = "w-full rounded-md border border-line-strong bg-panel px-1.5 py-1 text-[12px] text-ink";

// The Link… picker's New project form (components/SupabasePicker.tsx): a name, the organization (with more than
// one) and a region. Main makes the database password and keeps it in the 🔐 vault, so there's no field for it.
export default function SupabaseNewProject({
  initialName,
  initialRegion,
  orgs,
  busy,
  onCreate,
  onBack,
}: {
  initialName: string;
  initialRegion: string;
  // null while main is still listing them.
  orgs: SupabaseOrg[] | null;
  busy: boolean;
  onCreate: (project: NewSupabaseProject) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [org, setOrg] = useState<string | null>(null);
  const [region, setRegion] = useState(initialRegion);
  const chosenOrg = org ?? orgs?.[0]?.slug ?? "";
  const ready = !busy && name.trim() !== "" && chosenOrg !== "";
  const create = () => ready && void onCreate({ name: name.trim(), org: chosenOrg, region });
  return (
    <div className="mt-1.5 space-y-1.5 border-t border-line px-0.5 pt-2" aria-label="New Supabase project">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") create();
          if (e.key === "Escape") onBack();
        }}
        placeholder="Project name"
        aria-label="New project name"
        className={`${FIELD} px-2`}
      />
      {orgs && orgs.length > 1 && (
        <select value={chosenOrg} onChange={(e) => setOrg(e.target.value)} aria-label="Organization" className={FIELD}>
          {orgs.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className={FIELD}>
        {REGIONS.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>
      {orgs?.length === 0 && <p className="text-[10.5px] leading-snug text-warn">Weft couldn&apos;t list your Supabase organizations. If Weft was just updated, restart it.</p>}
      <p className="text-[10.5px] leading-snug text-faint">
        Weft makes the database password and keeps it in this project&apos;s 🔐 vault as SUPABASE_DB_PASSWORD.
      </p>
      <div className="flex items-center gap-1">
        <button onClick={create} disabled={!ready} className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40">
          {busy ? "Creating…" : "Create & link"}
        </button>
        <button onClick={onBack} className={SMALL}>
          Back
        </button>
        <button onClick={() => external(NEW_PROJECT_URL)} className={`${SMALL} ml-auto`} title="Make it on supabase.com instead, then come back and link it">
          supabase.com ↗
        </button>
      </div>
    </div>
  );
}
