"use client";

import { isMac } from "@/lib/hotkeys";

// How long a CountdownButton waits before a click takes, so a double-click can't confirm.
export const CONFIRM_WAIT_MS = 3000;

// The are-you-sure for a delete: a red button that counts down "Confirm in 3", 2, 1 with a fill sliding
// across and a grayed ⌘, ignoring clicks until it reads its label; ⌘-click (Ctrl off macOS) takes at
// once. left comes from useCountdown(CONFIRM_WAIT_MS) (lib/use-countdown.ts).
export default function CountdownButton({
  left,
  label,
  ariaLabel,
  title,
  onConfirm,
  className = "",
}: {
  left: number;
  label: string;
  ariaLabel: string;
  title: string;
  onConfirm: () => void;
  className?: string;
}) {
  const mod = isMac() ? "⌘" : "Ctrl";
  const waiting = left > 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        if (!waiting || e.metaKey || e.ctrlKey) onConfirm();
      }}
      aria-disabled={waiting}
      aria-label={ariaLabel}
      title={waiting ? `${title}; ${mod}-click to skip the wait` : title}
      className={`relative overflow-hidden rounded font-medium tabular-nums text-white ${waiting ? "cursor-default bg-danger/50" : "bg-danger"} ${className}`}
    >
      <span className="absolute inset-y-0 left-0 bg-danger" style={{ width: `${100 - (left / CONFIRM_WAIT_MS) * 100}%` }} />
      <span className="relative">
        {waiting ? `Confirm in ${Math.ceil(left / 1000)}` : label}
        {waiting && <span className="ml-1 text-white/50">{mod}</span>}
      </span>
    </button>
  );
}
