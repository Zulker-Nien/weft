"use client";

import { catchError, type ErrorInfo } from "next/error";
import Icon from "./Icon";
import Tip from "./Tip";

// Every thread edits this folder while Weft runs in dev mode, so a half-written component (a JSX tag
// before its import) reaches the board mid-edit. Wrapping each card and panel keeps one broken piece
// from blanking the whole board; Fast Refresh retries the boundary once the file is fixed.
export type CrashGuardProps = {
  /** What failed to draw, as the user sees it: "card", "thread", "browser pane". */
  what: string;
  /** Which one, when there are many (a card's title). */
  name?: string;
  className?: string;
  /** A one-line chip instead of the box, for small spots: a header badge, a button, a message. */
  inline?: boolean;
  /** Offered beside Try again, so a broken dialog or drawer can still be put away. */
  onClose?: () => void;
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function CrashFallback({ what, name, className = "", inline = false, onClose }: CrashGuardProps, { error, reset }: ErrorInfo) {
  const title = `This ${what} failed to draw${name ? `: ${name}` : ""}`;
  if (inline) {
    return (
      <Tip text={<>{title}<br /><span className="font-mono text-muted">{errorText(error)}</span><br />Click to try again</>} className={className}>
        <button
          role="alert"
          onClick={reset}
          aria-label={`${title}. Try again`}
          className="inline-flex items-center gap-1 rounded border border-danger bg-danger-soft px-1.5 py-0.5 text-[11.5px] text-danger"
        >
          <Icon name="alert" size={12} /> {what}
        </button>
      </Tip>
    );
  }
  return (
    <div role="alert" className={`flex flex-col gap-1.5 rounded-lg border border-danger bg-danger-soft px-3 py-2.5 text-[12px] ${className}`}>
      <p className="font-medium text-danger">{title}</p>
      <p className="break-words font-mono text-[11px] text-muted">{errorText(error)}</p>
      <div className="flex gap-1">
        <button onClick={reset} className="rounded px-1.5 py-0.5 text-[11.5px] text-ink hover:bg-card">
          Try again
        </button>
        {onClose && (
          <button onClick={onClose} className="rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-card hover:text-ink">
            Close
          </button>
        )}
      </div>
    </div>
  );
}

export default catchError(CrashFallback);
