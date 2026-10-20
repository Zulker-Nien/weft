"use client";

import { useState } from "react";
import { useServerFatal, useServerStatus } from "@/lib/server-status";
import Icon from "./Icon";

// Stands in for a stalled dev server (lib/server-status.ts): the supervisor's restart budget tripped
// while the board was up, so the board is still on screen but the Next server is gone. Mirrors
// components/BuildErrorBar.tsx in shape (small fixed bar, dismiss until a different fatal shows)
// and offers three actions: Restart the server, Open the log, Fix with a thread (queues a
// weft://new link the next time the server is back — main drops it into pendingLinks).
export default function ServerErrorBar() {
  const fatal = useServerFatal();
  const status = useServerStatus();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "retry" | "fix">(null);
  const key = fatal?.message ?? null;
  if (!fatal || key === dismissed) return null;

  const bridge = () => {
    if (typeof window === "undefined") return null;
    return (window as unknown as { weft?: { server?: { retry: () => Promise<{ ok: boolean }>; openLogs: () => Promise<void>; createFixCard: () => Promise<void> } } }).weft?.server ?? null;
  };

  const onRetry = async () => {
    const b = bridge();
    if (!b) return;
    setBusy("retry");
    try {
      const res = await b.retry();
      if (res.ok) setDismissed(key);
    } finally {
      setBusy(null);
    }
  };
  const onFix = async () => {
    const b = bridge();
    if (!b) return;
    setBusy("fix");
    try {
      await b.createFixCard();
      setDismissed(key);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="alert"
      className="fixed bottom-16 left-4 z-50 flex max-w-md flex-col gap-1.5 rounded-lg border border-danger/40 bg-panel px-3.5 py-2.5 text-[12.5px] text-ink shadow-lg"
    >
      <div className="flex items-start gap-2">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-danger" />
        <span className="flex-1">
          {status ? (
            <span>
              <span className="font-medium">{status}.</span> {fatal.message}
            </span>
          ) : (
            <span>{fatal.message}. The board is on the last data the server returned; restart to refresh it.</span>
          )}
        </span>
        <button
          onClick={() => { void onRetry(); }}
          disabled={busy !== null}
          className="shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {busy === "retry" ? "Restarting…" : "Restart server"}
        </button>
        <button
          onClick={() => { void bridge()?.openLogs(); }}
          className="shrink-0 font-medium text-accent hover:underline"
          title="Open the dev server log"
        >
          Open logs
        </button>
        <button
          onClick={() => { void onFix(); }}
          disabled={busy !== null}
          className="shrink-0 font-medium text-accent hover:underline disabled:opacity-50"
          title="Start a thread with the error and the log tail in its prompt"
        >
          {busy === "fix" ? "Opening…" : "Fix with a thread"}
        </button>
        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 font-medium text-accent hover:underline"
        >
          {open ? "Hide" : "Details"}
        </button>
        <button
          onClick={() => setDismissed(key)}
          aria-label="Dismiss"
          title="Dismiss until a different error"
          className="-mr-1 shrink-0 text-muted hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {open && (
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded bg-sunken p-2 font-mono text-[11px]">
          {fatal.message}
        </pre>
      )}
    </div>
  );
}
