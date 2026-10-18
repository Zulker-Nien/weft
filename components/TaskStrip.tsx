"use client";

import { useState } from "react";
import type { CardTask } from "@/lib/tasks";
import { taskStripView, type TaskRow } from "@/lib/tasks-view";
import { useNow } from "@/lib/use-now";
import Icon, { Spinner } from "./Icon";

// The thread's subagents and background commands above the reply box: one line ("3 subagents running ·
// 2 done") that opens to a row per task with how long it's run, its tool count and its latest line,
// and a Stop on each one still running where the thread's transport can stop one (onStop; not on weft.zip).
export default function TaskStrip({ cardId, tasks, onStop }: { cardId: string; tasks?: CardTask[]; onStop?: (cardId: string, taskId: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const view = now ? taskStripView(tasks, now) : undefined;
  if (!view) return null;
  return (
    <div className="border-t border-line px-3 py-1.5 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-full items-center gap-1.5 text-left text-muted hover:text-ink"
      >
        {view.running > 0 ? <span className="text-accent"><Spinner size={10} /></span> : <Icon name="check" size={11} className="text-faint" />}
        <span className="truncate">{view.headline}</span>
        <Icon name="chevronRight" size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <ul className="mt-1.5 flex max-h-56 flex-col gap-1.5 overflow-auto border-l-2 border-line pl-3">
          {view.rows.map((r) => <Row key={r.id} cardId={cardId} row={r} onStop={onStop} />)}
          {view.hint && <li className="text-[11px] text-warn">{view.hint}</li>}
        </ul>
      )}
    </div>
  );
}

function Row({ cardId, row: r, onStop }: { cardId: string; row: TaskRow; onStop?: (cardId: string, taskId: string) => Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const stop = () => {
    if (!onStop) return;
    setStopping(true);
    // The CLI's "stopped" notification updates the row; on a failed call it can be tried again.
    onStop(cardId, r.id).catch(() => setStopping(false));
  };
  return (
    <li className="min-w-0">
      <div className="flex items-center gap-2">
        <span className={`shrink-0 font-medium ${r.tone}`}>{stopping && r.status === "running" ? "stopping" : r.label}</span>
        <span className="min-w-0 flex-1 truncate text-ink" title={r.description}>{r.description}</span>
        <span className="shrink-0 font-mono text-[11px] text-faint">{r.meta}</span>
        {r.status === "running" && onStop && (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            aria-label={`Stop ${r.description}`}
            title="Stop"
            className="shrink-0 rounded p-0.5 text-faint hover:bg-sunken hover:text-danger disabled:opacity-50"
          >
            <Icon name="stop" size={11} />
          </button>
        )}
      </div>
      <div className="truncate font-mono text-[11px] text-faint" title={r.outputFile ?? r.detail}>
        {r.kind}
        {r.detail && ` · ${r.detail}`}
      </div>
    </li>
  );
}
