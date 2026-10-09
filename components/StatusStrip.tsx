"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { folderName, formatReset, formatTokens } from "@/lib/format";
import type { CardStats, LimitWindow } from "@/lib/types";

// Green while plenty is left, then warn, then danger (same cut-offs as the terminal statusline).
function tone(left: number) {
  return left >= 60 ? "text-ok" : left >= 30 ? "text-warn" : "text-danger";
}

// A hover bubble above its child, kept inside the window. Native title tooltips don't show in the
// desktop app, so this draws its own, in a portal so no panel or dialog can clip it.
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const trigger = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !bubble.current) return setPos(null);
    const t = trigger.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const margin = 8;
    const left = Math.min(Math.max(margin, t.left), window.innerWidth - b.width - margin);
    const above = t.top - b.height - 6;
    setPos({ left, top: above >= margin ? above : t.bottom + 6 });
  }, [open, text]);

  return (
    <span
      ref={trigger}
      className="cursor-default"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={bubble}
            role="tooltip"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
            className="pointer-events-none fixed z-[100] w-max max-w-[260px] rounded-md border border-line-strong bg-panel px-2.5 py-1.5 font-sans text-[11.5px] leading-snug text-ink shadow-lg"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

function Limit({
  label,
  name,
  window,
}: {
  label: string;
  name: string;
  window?: LimitWindow;
}) {
  if (!window) return null;
  const left = Math.max(0, 100 - window.used);
  const reset = window.resetsAt
    ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })}.`
    : "";
  return (
    <Tip text={`${name}: ${left}% left (${window.used}% used). ${reset}`.trim()}>
      {label}:<span className={tone(left)}>{left}%</span>
      {window.resetsAt && (
        <span className="text-faint">
          {" "}
          reset {formatReset(window.resetsAt)}
        </span>
      )}
    </Tip>
  );
}

// Session numbers for the open thread: model, context left, tokens, changed lines, plan limits.
export default function StatusStrip({
  stats = {},
  cwd,
  className = "",
}: {
  stats?: CardStats;
  cwd?: string;
  className?: string;
}) {
  if (!stats && !cwd) return null;
  const left =
    stats.contextUsed === undefined ? undefined : 100 - stats.contextUsed;
  const hasLines = Boolean(stats.added || stats.removed);
  const limits = stats.fiveHour || stats.sevenDay;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted ${className}`}
    >
      <div className="flex items-center gap-x-3 whitespace-nowrap">
        {cwd && (
          <Tip text={stats.branch ? `${cwd} on branch ${stats.branch}` : cwd}>
            <span className="text-ok">{folderName(cwd)}</span>
            {stats.branch && <span className="text-accent"> ({stats.branch})</span>}
          </Tip>
        )}
        {stats.model && (
          <Tip text={`Model: ${stats.model}`}>
            <span className="text-warn">[{stats.model.replace(/^claude-/, "")}]</span>
          </Tip>
        )}
        {left !== undefined && (
          <Tip text={`Context window: ${left}% left (${stats.contextUsed}% filled by the last request). Near zero the thread is compacted or loses detail.`}>
            ctx:<span className={tone(left)}>{left}%</span>
          </Tip>
        )}
        {stats.tokens && (
          <Tip text={`${stats.tokens.toLocaleString()} input and output tokens used in this thread`}>
            tok:{formatTokens(stats.tokens)}
          </Tip>
        )}
        {hasLines && (
          <Tip text={`Uncommitted changes in the folder vs HEAD: ${stats.added} lines added, ${stats.removed} removed`}>
            <span className="text-ok">+{stats.added}</span>/
            <span className="text-danger">-{stats.removed}</span>
          </Tip>
        )}
      </div>
      {limits && (
        <div className="flex items-center gap-x-3 whitespace-nowrap">
          <Limit label="5hr" name="5-hour plan limit" window={stats.fiveHour} />
          <Limit label="7d" name="Weekly plan limit" window={stats.sevenDay} />
        </div>
      )}
    </div>
  );
}
