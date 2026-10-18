"use client";

// The weft.zip board's top bar, laid out like the desktop's BoardHeader (components/BoardHeader.tsx): the Weft logo,
// "N running · M need you", the workspace, then the live dot, Share (WebShareBoard), New thread (N) and the account avatar on the right.
// Browser, Terminal and Settings stay on the Mac: a browser tab has no pane, shell or local settings to open.
import type { ReactNode } from "react";
import Icon from "../Icon";
import type { LiveStatus } from "./useWebBoard";

function LiveDot({ status }: { status: LiveStatus }) {
  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline";
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
      <span aria-hidden="true" className={`size-2 rounded-full ${status === "live" ? "bg-ok" : "bg-faint"}`} />
      {label}
    </span>
  );
}

export function WebBoardHeader({ workspace, running, waiting, live, onOpenNew, share, account }: {
  workspace: string;
  running: number;
  waiting: number;
  live: LiveStatus;
  onOpenNew: () => void;
  share?: ReactNode;
  account: ReactNode;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
      <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
        <img src="/app-icon.png" alt="" width={28} height={28} />
        Weft
      </h1>
      <span className="text-[12px] text-muted">
        {running} running
        {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
      </span>
      <span className="hidden truncate rounded-md border border-line-strong px-2 py-0.5 text-[11.5px] text-muted sm:inline" title="Workspace">
        {workspace}
      </span>
      <div className="flex-1" />
      <LiveDot status={live} />
      {share}
      <button
        onClick={onOpenNew}
        title="New thread (N)"
        aria-label="New thread"
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
      >
        <Icon name="plus" size={14} /> New thread
        <kbd className="ml-0.5 hidden rounded border border-current/30 px-1 font-mono text-[10.5px] leading-[15px] opacity-70 sm:inline">N</kbd>
      </button>
      {account}
    </header>
  );
}
