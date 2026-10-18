"use client";

import { useState } from "react";
import { cacheMinutesLeft, formatTokens } from "@/lib/format";
import type { CacheState } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import Tip from "./Tip";

export interface StaleProps {
  cache: CacheState;
  // Starts the new card with the reply box's text and resolves to its title.
  onContinue: (message: string) => Promise<string>;
}

// Above the reply box when the prompt cache has gone cold: the next message here re-sends the whole thread at
// full price, so offer to carry the work into a new card (a summary, the touched files, what's typed in the box).
export default function StaleCache({ cache, onContinue }: StaleProps) {
  const now = useNow();
  const [state, setState] = useState<{ busy: boolean; note?: string; error?: string }>({ busy: false });
  if (!now || cacheMinutesLeft(cache, now) > 0) return null;
  const size = formatTokens(cache.tokens);

  async function start() {
    setState({ busy: true });
    try {
      setState({ busy: false, note: `Started “${await onContinue("")}”` });
    } catch (err) {
      setState({ busy: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px]">
      <Tip text={`Stale cache: this thread's ${size} tokens are re-sent at full price with your next message. A new card starts from a short summary and the files this one touched, with whatever you've typed below.`}>
        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn">stale cache · {size}</span>
      </Tip>
      <button
        type="button"
        disabled={state.busy}
        onClick={() => void start()}
        className="rounded px-1.5 py-0.5 text-ink hover:bg-sunken disabled:opacity-60"
      >
        {state.busy ? "Summarizing…" : "Continue in new card"}
      </button>
      {state.note && <span className="text-muted">{state.note}</span>}
      {state.error && <span className="text-danger">{state.error}</span>}
    </div>
  );
}
