"use client";

import { useEffect, useState } from "react";
import { fetchPileReview } from "@/lib/pile-review";
import Tip from "./Tip";

type PileSummary = { root: string; files: number; added: number; removed: number; cards: number };

// One line of numbers, one line of pitch, and the click as a button (the bubble can't take clicks; the badge does).
function PileTip({ pile }: { pile: PileSummary }) {
  const { added, removed, cards } = pile;
  return (
    <span className="flex flex-col gap-1.5">
      <span>
        Uncommitted: <span className="text-ok">{added}</span> new lines of code, <span className="text-danger">-{removed}</span> removed
      </span>
      <span className="text-muted">Review your cards and push to production faster with Weft.</span>
      <span className="self-start rounded bg-accent px-2 py-0.5 font-medium text-on-accent">
        {cards ? `Review ${cards} card${cards === 1 ? "" : "s"}` : "Commit them"}
      </span>
    </span>
  );
}

// "+1211/-806" beside the code quality badge: the uncommitted pile in the project in view's repo.
// Click to start a card that walks through committing it, one Review card at a time (lib/commit-pile.ts).
// `refresh` changes when a turn ends somewhere, so the count follows the threads' edits.
export default function PileBadge({
  cwd,
  refresh,
  onStart,
  onError,
}: {
  cwd?: string | null;
  refresh?: unknown;
  onStart: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  onError: (err: unknown) => void;
}) {
  const [loaded, setLoaded] = useState<{ cwd: string; pile: PileSummary | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cwd) return;
    let live = true;
    const load = () => {
      fetch(`/api/pile?cwd=${encodeURIComponent(cwd)}`)
        .then((r) => r.json() as Promise<{ pile: PileSummary | null }>)
        .then((d) => {
          if (live) setLoaded({ cwd, pile: d.pile });
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
    };
  }, [cwd, refresh]);

  if (!cwd || !loaded || loaded.cwd !== cwd || !loaded.pile) return null;
  const p = loaded.pile;

  async function start() {
    if (busy || !cwd) return;
    setBusy(true);
    try {
      const { prompt, title } = await fetchPileReview(cwd);
      await onStart(cwd, prompt, title);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tip text={<PileTip pile={p} />}>
      <button
        onClick={() => void start().catch(onError)}
        disabled={busy}
        className="rounded-md px-1 py-0.5 font-mono text-[11.5px] text-muted hover:bg-hover disabled:opacity-60"
      >
        <span className="text-ok">+{p.added}</span>/<span className="text-danger">-{p.removed}</span>
      </button>
    </Tip>
  );
}
