"use client";

import { catchError, type ErrorInfo } from "next/error";

// Every thread edits this folder while Weft runs in dev mode, so a half-written component (a JSX tag
// before its import) reaches the board mid-edit. Wrapping each card and panel keeps one broken piece
// from blanking the whole board; Fast Refresh retries the boundary once the file is fixed.
type Props = {
  /** What failed to draw, as the user sees it: "card", "thread", "browser pane". */
  what: string;
  /** Which one, when there are many (a card's title). */
  name?: string;
  className?: string;
};

function CrashFallback({ what, name, className = "" }: Props, { error, reset }: ErrorInfo) {
  return (
    <div role="alert" className={`flex flex-col gap-1.5 rounded-lg border border-danger bg-danger-soft px-3 py-2.5 text-[12px] ${className}`}>
      <p className="font-medium text-danger">
        This {what} failed to draw{name ? `: ${name}` : ""}
      </p>
      <p className="break-words font-mono text-[11px] text-muted">{error instanceof Error ? error.message : String(error)}</p>
      <button onClick={reset} className="self-start rounded px-1.5 py-0.5 text-[11.5px] text-ink hover:bg-card">
        Try again
      </button>
    </div>
  );
}

export default catchError(CrashFallback);
