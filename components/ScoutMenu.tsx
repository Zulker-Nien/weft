"use client";

import { useEffect, useRef } from "react";
import { timeAgo } from "@/lib/format";
import { useOverlay } from "@/lib/overlay";
import { openFindings, type Finding, type ScoutState, type Severity } from "@/lib/scout-view";
import { useEscape } from "@/lib/use-escape";
import { useNow } from "@/lib/use-now";

const DOT: Record<Severity, string> = { high: "bg-danger", medium: "bg-warn", low: "bg-muted" };

// The quality badge's menu: fix the checklist, or start one of the scout's findings as its own small card.
// The browser pane is a native view drawn above the board, so it hides while the menu is open.
export default function ScoutMenu({
  scout,
  checklistDone,
  onClose,
  onFixChecklist,
  onStart,
  onRescout,
}: {
  scout: ScoutState | null;
  checklistDone: boolean;
  onClose: () => void;
  onFixChecklist: () => void;
  onStart: (f: Finding) => void;
  onRescout: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const now = useNow();
  useOverlay(true);
  useEscape(true, onClose);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!root.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [onClose]);

  const report = scout?.report ?? null;
  const open = openFindings(report);
  const row = "flex w-full items-start gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";
  const status = scout?.running
    ? "Scouting the code… (a few minutes)"
    : scout?.error
      ? `Last run failed: ${scout.error}`
      : report
        ? `${String(open.length)} open · ran ${timeAgo(report.ranAt, now)}${report.commit ? ` on ${report.commit.slice(0, 7)}` : ""}`
        : "Not scouted yet";

  return (
    <div ref={root} className="absolute left-0 top-full z-30 mt-1 w-80 rounded-lg border border-line bg-panel p-1 text-[12.5px] shadow-lg">
      <button className={row} disabled={checklistDone} onClick={onFixChecklist}>
        <span className="flex-1 font-medium text-ink">Fix the checklist, weakest first</span>
      </button>
      <div className="my-1 border-t border-line" />
      <p className="px-2.5 pb-1 text-[11px] text-faint">Refactor scout · {status}{open.length ? ". Click one to start it as a card." : ""}</p>
      <div className="max-h-[50vh] overflow-y-auto">
        {open.map((f) => (
          <button key={f.id} className={row} onClick={() => onStart(f)}>
            <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${DOT[f.severity]}`} title={f.severity} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex gap-1.5">
                <span className="shrink-0 font-medium text-ink">{f.smell}</span>
                <span className="min-w-0 truncate font-mono text-[11px] leading-[18px] text-muted">
                  {f.file}:{f.line}
                </span>
              </span>
              <span className="line-clamp-2 text-[11.5px] text-muted">{f.fix}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-line" />
      <button className={row} disabled={scout?.running} onClick={onRescout}>
        <span className="flex-1 text-ink">{scout?.running ? "Scouting…" : "Re-scout now"}</span>
      </button>
    </div>
  );
}
