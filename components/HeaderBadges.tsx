"use client";

import type { Card } from "@/lib/types";
import GameBadge from "./GameBadge";
import PileBadge from "./PileBadge";
import QualityBadge from "./QualityBadge";

// The header's badges for the project in view: code quality, the uncommitted pile, and your streak
// and level. They refresh whenever a turn ends or a card ships somewhere, so they follow the threads' work.
// `start` begins a card (an improvement, a commit walk, a "Set it up"); it rejects when that fails.
export default function HeaderBadges({
  cwd,
  cards,
  start,
  notify,
  toast,
}: {
  cwd?: string | null;
  cards: Card[];
  start: (cwd: string, prompt: string, title: string) => Promise<void>;
  notify: (err: unknown) => void;
  toast: (text: string) => void;
}) {
  const running = cards.filter((c) => c.column === "running" && !c.archived).length;
  const turnTick = `${running}:${cards.reduce((n, c) => n + (c.turns ?? 0), 0)}`;
  const done = cards.filter((c) => c.column === "done").length;
  const begin = (cwd: string, prompt: string, title: string) => void start(cwd, prompt, title).catch(notify);
  return (
    <>
      <QualityBadge cwd={cwd} onImprove={begin} />
      <PileBadge cwd={cwd} refresh={turnTick} onStart={start} onError={notify} />
      <GameBadge cwd={cwd} refresh={`${turnTick}:${done}`} onStart={begin} onToast={toast} />
    </>
  );
}
