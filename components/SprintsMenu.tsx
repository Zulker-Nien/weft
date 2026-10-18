"use client";

import { useState } from "react";
import { sprintViews, type SprintView } from "@/lib/sprints";
import { useEscape } from "@/lib/use-escape";
import { sprintActions, useSprints } from "@/lib/use-sprints";
import type { BacklogLane } from "./BacklogActions";
import Icon from "./Icon";

// The Backlog column's title is a button: it drops the list of saved sprints, each with what became of its
// cards, Restore for the archived ones, rename (double-click the name) and delete (the sprint, never its cards).
export default function SprintsMenu({ label, lane }: { label: string; lane: BacklogLane }) {
  const [open, setOpen] = useState(false);
  const sprints = useSprints();
  useEscape(open, () => setOpen(false));
  const views = open ? sprintViews(sprints, lane.allCards) : [];
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1 truncate rounded text-[12.5px] font-medium text-ink hover:text-accent"
      >
        <span className="truncate">{label}</span>
        <Icon name="chevronDown" size={11} className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setOpen(false)} aria-hidden="true" />
          <div role="menu" aria-label="Sprints" className="absolute inset-x-2 top-full z-40 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-line-strong bg-panel p-1.5 shadow-xl">
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">Sprints</div>
            {views.length === 0 ? (
              <p className="px-2 pb-1.5 text-[12px] leading-snug text-muted">
                None yet. The flag in this header saves the Backlog&apos;s cards as a sprint.
              </p>
            ) : (
              views.map((v) => <SprintRow key={v.sprint.id} view={v} lane={lane} />)
            )}
          </div>
        </>
      )}
    </>
  );
}

function sprintLine({ sprint, cards, archived, started }: SprintView) {
  const gone = sprint.cardIds.length - cards.length;
  return [
    `${sprint.cardIds.length} card${sprint.cardIds.length === 1 ? "" : "s"}`,
    archived.length ? `${archived.length} archived` : "",
    started ? `${started} started` : "",
    gone ? `${gone} deleted` : "",
  ].filter(Boolean).join(" · ");
}

function SprintRow({ view, lane }: { view: SprintView; lane: BacklogLane }) {
  const [renaming, setRenaming] = useState(false);
  const { sprint, archived } = view;
  const act = (p: Promise<unknown>) => void p.catch(lane.notify);
  return (
    <div className="group/sprint flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-hover">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            defaultValue={sprint.name}
            aria-label="Sprint name"
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                setRenaming(false);
              }
            }}
            onBlur={(e) => {
              const name = e.currentTarget.value.trim();
              setRenaming(false);
              if (name && name !== sprint.name) act(sprintActions.rename(sprint.id, name));
            }}
            className="w-full rounded border border-line-strong bg-card px-1 text-[12.5px] text-ink outline-none"
          />
        ) : (
          <div onDoubleClick={() => setRenaming(true)} title="Double-click to rename" className="truncate text-[12.5px] text-ink">
            {sprint.name}
          </div>
        )}
        <div className="truncate text-[11px] text-faint">{sprintLine(view)}</div>
      </div>
      {archived.length > 0 && (
        <button
          onClick={() => lane.onRestore(archived.map((c) => c.id))}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-medium text-accent hover:bg-sunken"
          title="Unarchive this sprint's archived cards"
        >
          Restore {archived.length}
        </button>
      )}
      <button
        onClick={() => act(sprintActions.remove(sprint.id))}
        aria-label={`Delete ${sprint.name}`}
        title="Delete the sprint (its cards stay)"
        className="shrink-0 rounded p-1 text-muted opacity-0 hover:bg-sunken hover:text-danger focus-visible:opacity-100 group-hover/sprint:opacity-100"
      >
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}
