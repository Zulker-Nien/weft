"use client";

import { api } from "@/lib/client";
import type { RestartStatus } from "@/lib/types";
import Tip from "./Tip";

// The header's red "⟳ Restart requested · N" while a restart waits for the running threads (lib/restart-when-idle.ts):
// hovering names them, clicking cancels it. Nothing shows while no restart is armed.
export default function RestartChip({ restart, notify }: { restart: RestartStatus | null; notify: (err: unknown) => void }) {
  if (!restart?.armed) return null;
  const n = restart.waiting.length;
  const what = restart.then === "update" ? "Update" : "Restart";
  const label = n ? `⟳ ${what} requested · ${n}` : `⟳ ${what === "Update" ? "Updating" : "Restarting"}…`;
  const tip = n ? (
    <span className="block max-w-xs">
      Waiting for {n === 1 ? "this thread" : "these threads"} to finish; nothing new starts until then:
      {restart.waiting.map((w) => (
        <span key={w.id} className="block truncate">
          · {w.title}
        </span>
      ))}
      <span className="mt-1 block text-muted">Click to cancel. Messages you sent meanwhile go out then.</span>
    </span>
  ) : (
    "Every thread has finished; Weft is restarting."
  );
  return (
    <Tip text={tip} className="inline-flex">
      <button
        onClick={() => void api.cancelRestart().catch(notify)}
        className="rounded-full border border-danger/40 bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger hover:bg-danger/20"
      >
        {label}
      </button>
    </Tip>
  );
}

// The New thread dialog's red "Restart requested" pill: a thread started now waits for the restart (holdForRestart).
export function RestartRequested({ restart }: { restart?: RestartStatus | null }) {
  if (!restart?.armed) return null;
  return (
    <Tip text="Weft restarts once the running threads finish. A thread you start now begins right after the restart." className="inline-flex">
      <span className="rounded-full border border-danger/40 bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
        Restart requested
      </span>
    </Tip>
  );
}
