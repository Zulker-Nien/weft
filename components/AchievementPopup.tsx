"use client";

import type { Badge } from "@/lib/game-badges";
import type { GameState } from "@/lib/game-server";
import Confetti from "./Confetti";
import Modal from "./Modal";
import { useState } from "react";

// What GameBadge hands the popup: the badges just earned and, if the level went up, the new one.
export interface Achievement {
  fresh: Badge[];
  level: GameState["level"] | null;
}

// The popup a new badge or level-up opens, with a burst of confetti behind it. One badge gets the stage
// (big icon, name, what earned it); several share it as a list. "See your profile" opens the Wefter Profile.
export default function AchievementPopup({ achievement, onProfile, onClose }: { achievement: Achievement; onProfile: () => void; onClose: () => void }) {
  const [confetti, setConfetti] = useState(true);
  const { fresh, level } = achievement;
  const [only] = fresh.length === 1 ? fresh : [];
  const heading = fresh.length === 0 ? "Level up!" : fresh.length === 1 ? "Achievement unlocked!" : `${fresh.length} achievements unlocked!`;

  return (
    <>
      <Modal label={heading} onClose={onClose} className="w-full max-w-[340px]">
        <div className="flex flex-col items-center gap-3 px-6 pb-5 pt-7 text-center">
          <span className="achievement-pop flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-[44px] leading-none">
            {only?.icon ?? (fresh.length ? "🏅" : "⬆️")}
          </span>
          <p className="text-[11px] font-medium uppercase tracking-wide text-accent">{heading}</p>
          {only && (
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] font-semibold text-ink">{only.name}</h2>
              <p className="text-[12.5px] text-muted">{only.desc}</p>
            </div>
          )}
          {fresh.length > 1 && (
            <ul className="flex w-full flex-col gap-1.5 text-left">
              {fresh.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-1.5">
                  <span className="text-[20px] leading-none">{b.icon}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[12.5px] font-medium text-ink">{b.name}</span>
                    <span className="truncate text-[11px] text-muted">{b.desc}</span>
                  </span>
                </li>
              ))}
              {fresh.length > 5 && <li className="text-center text-[11.5px] text-muted">and {fresh.length - 5} more</li>}
            </ul>
          )}
          {level && (
            <p className={fresh.length ? "text-[12px] text-muted" : "text-[17px] font-semibold text-ink"}>
              Level {level.level} · {level.title}
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <button onClick={onProfile} className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-sunken">
              See your profile
            </button>
            <button autoFocus onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent">
              Nice!
            </button>
          </div>
        </div>
      </Modal>
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
    </>
  );
}
