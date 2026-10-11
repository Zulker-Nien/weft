"use client";

import { useEffect, useState } from "react";
import { folderName } from "@/lib/format";
import Tip from "./Tip";

type PileSummary = { root: string; files: number; added: number; removed: number; cards: number };

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
  onStart: (cwd: string, prompt: string, title: string) => Promise<void>;
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
      const r = await fetch(`/api/pile?cwd=${encodeURIComponent(cwd)}&prompt=1`);
      const d = (await r.json()) as { prompt?: string; title?: string; error?: string };
      if (!d.prompt) throw new Error(d.error ?? "Nothing uncommitted to walk through.");
      await onStart(cwd, d.prompt, d.title ?? "Commit the uncommitted pile");
    } finally {
      setBusy(false);
    }
  }

  const tip = `Uncommitted changes in ${folderName(p.root)} vs HEAD: ${p.files} file${p.files === 1 ? "" : "s"}, ${p.added} lines added, ${p.removed} removed${p.cards ? `, from ${p.cards} card${p.cards === 1 ? "" : "s"} in Review` : ""}. Click to start a card that commits them one card at a time.`;
  return (
    <Tip text={tip}>
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
