"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { MenuItem } from "@/lib/card-menu";
import { libraryCounts, libraryGroups, libraryPinned, setLibraryPinned, todoProgress, type LibraryView } from "@/lib/library-view";
import { LIBRARY_KINDS, type Card, type LibraryItem, type LibraryKind } from "@/lib/types";
import Icon from "./Icon";
import { folderName } from "./ProjectBar";

// The library (lib/library.ts) on the board's left edge: a 38px rail of ↻ ☑ ✎ with counts, and a drawer
// that slides over the board (or, pinned, pushes it over). Drop a card on an icon to file it there.
export default function LibraryRail({
  open,
  onOpen,
  project,
  cards,
  version,
  onStar,
  onOpenItem,
  onRun,
  onOpenCard,
  notify,
}: {
  // Which drawer is open, if any.
  open: LibraryKind | null;
  onOpen: (kind: LibraryKind | null) => void;
  // The board's selected project folder, or null for all of them.
  project: string | null;
  cards: Card[];
  // Bumped when the library changes on the server ("library" events), to reload.
  version: number;
  onStar: (cardId: string, kind: LibraryKind) => void;
  // Shows a to-do's or note's page in the browser pane.
  onOpenItem: (item: LibraryItem) => void;
  // Opens the New thread dialog on a recipe.
  onRun: (item: LibraryItem) => void;
  onOpenCard: (cardId: string) => void;
  notify: (err: unknown) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [chosenView, setView] = useState<LibraryView>("project");
  const [pinned, setPinned] = useState(() => typeof window !== "undefined" && libraryPinned());
  const [dropOn, setDropOn] = useState<LibraryKind | null>(null);
  // With every project on the board, "This project" means nothing.
  const view: LibraryView = chosenView === "project" && !project ? "all" : chosenView;

  useEffect(() => {
    let live = true;
    api
      .library(project, view === "all")
      .then(({ items }) => live && setItems(items))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [project, view, version]);

  const counts = libraryCounts(items, view, project);
  const runs = (id: string) => cards.filter((c) => c.recipeId === id).length;

  function pin(next: boolean) {
    setPinned(next);
    setLibraryPinned(next);
  }

  function drop(kind: LibraryKind, e: React.DragEvent) {
    e.preventDefault();
    setDropOn(null);
    const id = e.dataTransfer.getData("text/plain");
    if (id && cards.some((c) => c.id === id)) onStar(id, kind);
  }

  async function itemMenu(item: LibraryItem, e: React.MouseEvent) {
    const shell = window.threadboard;
    if (!shell?.popupMenu) return;
    e.preventDefault();
    const card = item.cardId ? cards.find((c) => c.id === item.cardId) : undefined;
    const menu: MenuItem[] = [
      item.kind === "recipe" ? { id: "run", label: "Run Recipe…" } : { id: "open", label: "Open Page" },
      ...(item.kind === "recipe" ? [{ id: "open", label: "Show Recipe Page" }] : []),
      ...(card ? [{ id: "card", label: "Open the Original Thread" }] : []),
      { type: "separator" },
      item.scope === "mine"
        ? { id: "scope", label: `Move to ${folderName(item.folder)} (This Project Only)` }
        : { id: "scope", label: "Move to Mine (Every Project)" },
      ...(item.kind === "todo" ? [{ id: "kind", label: "Make It a Note" }] : item.kind === "note" ? [{ id: "kind", label: "Make It a To-do" }] : []),
      { type: "separator" },
      { id: "remove", label: item.kind === "recipe" ? "Remove Recipe (and Its Skill)" : "Remove from Library" },
    ];
    const picked = await shell.popupMenu(menu);
    try {
      if (picked === "run") onRun(item);
      if (picked === "open") onOpenItem(item);
      if (picked === "card" && card) onOpenCard(card.id);
      if (picked === "scope") await api.updateLibraryItem(item.id, { scope: item.scope === "mine" ? "project" : "mine" });
      if (picked === "kind") await api.updateLibraryItem(item.id, { kind: item.kind === "todo" ? "note" : "todo" });
      if (picked === "remove") await api.removeLibraryItem(item.id);
    } catch (err) {
      notify(err);
    }
  }

  const kind = LIBRARY_KINDS.find((k) => k.id === open);
  const groups = open ? libraryGroups(items, open, view, project) : [];

  const drawer = kind && (
    <aside
      className={`flex w-[260px] shrink-0 flex-col border-r border-line bg-panel ${pinned ? "" : "absolute bottom-0 left-full top-0 z-20 shadow-[6px_0_18px_rgb(0_0_0/0.12)]"}`}
      aria-label={`Library: ${kind.plural}`}
    >
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <span className="text-[14px]" aria-hidden>
          {kind.icon}
        </span>
        <h2 className="flex-1 text-[13px] font-semibold text-ink">{kind.plural}</h2>
        <button
          onClick={() => pin(!pinned)}
          title={pinned ? "Unpin: slide over the board" : "Pin: keep it open beside the board"}
          aria-pressed={pinned}
          className={`rounded px-1.5 py-0.5 text-[11px] ${pinned ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
        >
          {pinned ? "Pinned" : "Pin"}
        </button>
        <button onClick={() => onOpen(null)} aria-label="Close" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="mx-3 my-2 flex rounded-md border border-line-strong p-0.5 text-[11.5px]" role="group" aria-label="Show">
        {(
          [
            ["project", "This project"],
            ["mine", "Mine"],
            ["all", "All"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            disabled={id === "project" && !project}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            title={id === "project" && !project ? "Pick a project in the bar above first" : undefined}
            className={`flex-1 rounded px-1.5 py-0.5 disabled:opacity-40 ${view === id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-[11.5px] leading-snug text-faint">
            {open === "recipe"
              ? "Right-click a card and pick Save as Recipe, or drop it on ↻, to run it again later with new blanks."
              : open === "todo"
                ? "Star a card whose result is steps for you to do. Its page keeps your ticks."
                : "Star a card to keep its answer here."}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="px-1.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{group.label}</h3>
            {group.items.map((item) => (
              <Row key={item.id} item={item} runs={runs(item.id)} onClick={() => (item.kind === "recipe" ? onRun(item) : onOpenItem(item))} onContextMenu={(e) => itemMenu(item, e)} />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );

  return (
    <div className="relative flex shrink-0">
      <nav className="flex w-[38px] flex-col items-center gap-1 border-r border-line bg-panel pt-2" aria-label="Library">
        {LIBRARY_KINDS.map((k) => {
          const count = counts[k.id];
          return (
            <button
              key={k.id}
              onClick={() => onOpen(open === k.id ? null : k.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setDropOn(k.id);
              }}
              onDragLeave={() => setDropOn((d) => (d === k.id ? null : d))}
              onDrop={(e) => drop(k.id, e)}
              title={`${k.plural}${k.id === "recipe" ? ": cards to run again" : k.id === "todo" ? ": steps for you" : ": answers to keep"} · drop a card here to file it`}
              aria-pressed={open === k.id}
              className={`relative grid size-7 place-items-center rounded-md text-[14px] ${open === k.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"} ${dropOn === k.id ? "outline-2 outline-offset-2 outline-dashed outline-accent" : ""}`}
            >
              <span aria-hidden>{k.icon}</span>
              <span className="sr-only">{k.plural}</span>
              {count > 0 && (
                <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-accent px-1 text-center text-[9px] font-semibold leading-[14px] text-on-accent">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {drawer}
    </div>
  );
}

function Row({ item, runs, onClick, onContextMenu }: { item: LibraryItem; runs: number; onClick: () => void; onContextMenu: (e: React.MouseEvent) => void }) {
  const progress = todoProgress(item);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick();
      }}
      onContextMenu={onContextMenu}
      title={item.description || item.title}
      className="mb-1.5 cursor-pointer rounded-lg border border-line bg-card px-2.5 py-2 outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-ink">{item.title}</span>
        {item.kind === "recipe" && (
          <span className="shrink-0 rounded bg-accent px-1.5 text-[10.5px] font-medium leading-[18px] text-on-accent">Run</span>
        )}
      </div>
      {progress && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full rounded-full bg-ok" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
        </div>
      )}
      <div className="mt-1 text-[10.5px] text-faint">
        {item.kind === "recipe"
          ? `${item.blanks?.length ? item.blanks.map((b) => `{${b.name}}`).join(" ") + " · " : ""}${runs ? `used ${runs}×` : "not run yet"}`
          : progress
            ? progress.label
            : new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </div>
    </div>
  );
}
