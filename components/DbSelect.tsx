"use client";

import { Note } from "./VaultParts";

// The "Link <folder> to…" picker every provider drawer (▲ Vercel, Supabase, Cloudflare, 🚀 BlastCP)
// shows: a search box over a list of rows the provider's API returned, the ones that fit the folder
// first under a "best fit" badge, and a Cancel to back out. Each drawer supplies its own rows,
// score, search columns and row markup; the shell around them is this component, so a fifth
// provider is one file that calls it rather than another list UI to write.
//
// The rows come already ranked: the caller passes `rank`, the output of `rankItems` (lib/db-picker.ts)
// with its own provider's score and tie-break. That keeps the ranking logic in the provider's view
// module, where its columns live, and this file purely presentational.

const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";
const FIELD = "w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink";

export interface DbRow<T> {
  item: T;
  score: number;
}

// The score at or above which a row is a best fit. Every provider scores on `nameScore`'s scale
// (lib/db-picker.ts) with extra tiers on top, so 2 is "carries the folder's name" everywhere.
export const BEST_FIT = 2;

export default function DbSelect<T>({
  title,
  rows,
  loading,
  search,
  onSearch,
  searchLabel,
  searchPlaceholder,
  emptyText,
  rowKey,
  onPick,
  renderRow,
  extra,
  onCancel,
  ariaLabel,
  busy = false,
  hideSearch = false,
}: {
  // The header line: "Link weft to…" or "New Vercel project".
  title: string;
  // null while the provider is still listing; the rows otherwise, already ranked and trimmed.
  rows: DbRow<T>[] | null;
  // The note under the search box while rows is null.
  loading: React.ReactNode;
  search: string;
  onSearch: (search: string) => void;
  // "Search projects", "Search BlastCP properties": the input's accessible name.
  searchLabel: string;
  searchPlaceholder: string;
  // What to say when the rows arrived but none match (or there are none).
  emptyText: React.ReactNode;
  // Stable React key per row.
  rowKey: (item: T) => string;
  // Clicking a row: the provider's own link call. `busy` disables the buttons while it's running.
  onPick: (item: T) => void;
  // One row's contents. The button around it is this component's.
  renderRow: (item: T, score: number) => React.ReactNode;
  // Optional slot above the list: the "+ New project" button, or a form once it's open.
  extra?: React.ReactNode;
  onCancel: () => void;
  // The section's accessible name, "Link weft to…".
  ariaLabel: string;
  busy?: boolean;
  // Suppress the search box and list — used by pickers whose `extra` is a "New project" form that
  // replaces the picker entirely, so the search input isn't a confusing dead end.
  hideSearch?: boolean;
}) {
  return (
    <section className="mt-2 rounded-lg border border-accent/40 bg-card px-2 py-2" aria-label={ariaLabel}>
      <div className="flex items-center gap-1 px-0.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{title}</h3>
        <button onClick={onCancel} className={SMALL}>
          Cancel
        </button>
      </div>
      {extra}
      {!hideSearch && (
        <>
          <input
            autoFocus
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancel();
            }}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            className={`mt-1.5 ${FIELD}`}
          />
          {!rows && <Note>{loading}</Note>}
          {rows && rows.length === 0 && <Note>{emptyText}</Note>}
          <ul className="mt-1 max-h-[320px] overflow-y-auto">
            {rows?.map(({ item, score }) => (
              <li key={rowKey(item)}>
                <button type="button" onClick={() => onPick(item)} disabled={busy} className="w-full rounded px-1.5 py-1 text-left hover:bg-sunken disabled:opacity-40">
                  {renderRow(item, score)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// A row's two lines: the provider's own name, a "best fit" chip when it scores at least BEST_FIT, and
// the muted detail line under it (team · repo, or org · region · state). Every provider's list is
// these two lines in some order, so they share one shape.
export function DbRowLines({ name, score, detail }: { name: string; score: number; detail?: React.ReactNode }) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{name}</span>
        {score >= BEST_FIT && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] leading-[15px] text-accent">best fit</span>}
      </span>
      {detail && <span className="block truncate text-[10.5px] text-faint">{detail}</span>}
    </>
  );
}

// The "+ New project" button a picker shows above its search box, and the form it swaps to. The
// button's dashed outline says it's a way to add one, not another row to pick.
export function DbNewButton({ onClick, label, hint, title, disabled }: { onClick: () => void; label: string; hint?: string; title?: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="mt-1.5 flex w-full items-center gap-1 rounded-md border border-dashed border-line-strong px-2 py-1 text-left text-[12px] text-accent hover:bg-accent-soft disabled:opacity-40"
    >
      <span aria-hidden>+</span> {label}
      {hint && <span className="ml-auto truncate text-[10.5px] text-faint">{hint}</span>}
    </button>
  );
}