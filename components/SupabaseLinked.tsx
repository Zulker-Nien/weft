"use client";

import { migrationLine, migrationOwner, projectState, supabaseActions, type SupabaseFolder, type SupabaseLink } from "@/lib/supabase-view";
import type { Card } from "@/lib/types";
import SupabaseLogo from "./SupabaseLogo";
import { external } from "./supabase-ui";

const TONE = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger", muted: "bg-sunken text-muted" } as const;

// A Supabase drawer folder's linked project (components/SupabaseDrawer.tsx): its state, API URL, migrations (each
// unapplied one linked to the card that wrote it) and the dashboard shortcuts.
export default function SupabaseLinked({
  folder,
  link,
  busy,
  onRestore,
  onOpenUrl,
  cards,
  onOpenCard,
}: {
  folder: SupabaseFolder;
  link: SupabaseLink;
  busy: boolean;
  onRestore: (ref: string) => void;
  onOpenUrl: (url: string) => void;
  cards: Card[];
  onOpenCard: (card: Card) => void;
}) {
  const state = link.status ? projectState(link.status) : null;
  const migrations = migrationLine(folder, link);
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted">
      <div className="flex items-center gap-1.5">
        <SupabaseLogo size={12} />
        <span className="truncate text-[12px] text-ink">{link.name ?? link.ref}</span>
        {link.org && <span className="truncate text-faint">{link.org}</span>}
      </div>
      {state && (
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-1 text-[10px] leading-[15px] ${TONE[state.tone]}`}>{state.label}</span>
          {link.region && <span className="text-faint">{link.region}</span>}
          {link.status === "INACTIVE" && (
            <button onClick={() => onRestore(link.ref)} disabled={busy} className="ml-auto text-accent hover:underline disabled:opacity-40" title="Wake the paused project">
              Restore
            </button>
          )}
        </div>
      )}
      {link.url && (
        <button onClick={() => onOpenUrl(`https://supabase.com/dashboard/project/${link.ref}`)} className="block max-w-full truncate text-left text-accent hover:underline" title="The project's API URL; opens its dashboard in the browser pane">
          {link.url.replace(/^https:\/\//, "")}
        </button>
      )}
      {migrations && (
        <p className={migrations.warn ? "text-warn" : ""}>
          {migrations.text}
          {migrations.names.length > 0 && ": "}
          {migrations.names.map((name, i) => (
            <span key={name}>
              {i > 0 && ", "}
              <MigrationName name={name} owner={migrationOwner(cards, folder.folder, name)} onOpenCard={onOpenCard} />
            </span>
          ))}
          {migrations.more && ", …"}
        </p>
      )}
      {link.source === "mcp" && <p className="text-faint">Linked in .mcp.json</p>}
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
        {supabaseActions(link.ref).map((a) => (
          <button key={a.label} onClick={() => external(a.url)} className="text-faint hover:text-ink" title={a.url}>
            {a.label} ↗
          </button>
        ))}
      </div>
    </div>
  );
}

// An unapplied migration's name: a link to the card that wrote it, when one on the board did.
function MigrationName({ name, owner, onOpenCard }: { name: string; owner: Card | undefined; onOpenCard: (card: Card) => void }) {
  if (!owner) return <>{name}</>;
  return (
    <button onClick={() => onOpenCard(owner)} className="underline decoration-dotted underline-offset-2 hover:decoration-solid" title={`Open the card that wrote it: ${owner.title}`}>
      {name}
    </button>
  );
}
