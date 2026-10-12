"use client";

import { useState } from "react";
import { restartWeft } from "@/lib/blastcp-view";

// The drawer's small text buttons.
export const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

// The BlastCP drawer before you're signed in (components/BlastcpDrawer.tsx).
// BlastCP arrived after this Weft started: one restart loads it, then Connect.
export function BlastcpRestart() {
  const [asked, setAsked] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted">
      <p className="text-[12px] font-medium text-ink">Restart Weft to turn on BlastCP</p>
      <p>BlastCP was added after this Weft started. Restart once, then come back here and click Connect BlastCP. Running cards pick up where they left off.</p>
      <div>
        <button onClick={() => setAsked(restartWeft())} disabled={asked} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {asked ? "Restarting…" : "Restart Weft"}
        </button>
      </div>
      {asked && <p className="text-faint">If Weft closes instead of coming back, open it again.</p>}
    </div>
  );
}

export function BlastcpConnect({ error, busy, onConnect, onForget }: { error: string | null; busy: boolean; onConnect: () => void; onForget?: () => void }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted">
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p>See what each project has queued on BlastCP. Connect opens BlastCP in your browser to sign in and approve Weft; Weft keeps the sign-in in your Keychain, and threads never see it.</p>
      <div className="flex gap-1.5">
        <button onClick={onConnect} disabled={busy} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {busy ? "Waiting for your browser…" : "Connect BlastCP"}
        </button>
        {onForget && (
          <button type="button" onClick={onForget} disabled={busy} className={SMALL}>
            Forget it
          </button>
        )}
      </div>
    </div>
  );
}

