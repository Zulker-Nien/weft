"use client";

import { useEffect, useRef, useState } from "react";
import { keyLabel } from "@/lib/hotkeys";
import { formatAt, toLocalInput, type SendLaterOption } from "@/lib/schedule";
import { useEscape } from "@/lib/use-escape";
import Icon from "./Icon";

// The reply box's clock: a small menu of times to send the message at, the first one the default
// (the next 5-hour reset on a Claude thread), plus a picker for any other time. Alt+Enter opens it
// with the default focused, so Alt+Enter, Enter schedules for the reset.
export default function SendLater({
  open,
  onOpenChange,
  options,
  onPick,
  now,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SendLaterOption[];
  onPick: (at: number) => void;
  // The clock from lib/use-now.ts, so render stays pure.
  now: number;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEscape(open, (e) => {
    e.stopPropagation();
    onOpenChange(false);
  });

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, onOpenChange]);

  // Until you pick one, the custom time starts at the default option's.
  const shown = custom || toLocalInput(options[0]?.at ?? now + 3600_000);
  const customAt = new Date(shown).getTime();
  const key = keyLabel("alt+Enter");

  return (
    <div ref={root} className="relative ml-1 shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        aria-label="Send later"
        aria-expanded={open}
        title={`Send later${options[0] ? `: ${options[0].label.toLowerCase()}, ${formatAt(options[0].at, now)}` : ""} (${key})`}
        className={`flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-muted hover:bg-sunken hover:text-ink disabled:opacity-40 ${open ? "bg-sunken text-ink" : ""}`}
      >
        <Icon name="clock" size={15} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-lg border border-line-strong bg-panel p-1 text-[12.5px] shadow-lg">
          <p className="px-2 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-faint">Send later</p>
          {options.map((option, i) => (
            <button
              key={option.label}
              ref={i === 0 ? first : undefined}
              type="button"
              onClick={() => onPick(option.at)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-sunken focus:bg-sunken focus:outline-none"
            >
              <span className={i === 0 ? "font-medium" : ""}>{option.label}</span>
              <span className="font-mono text-[11px] text-muted">{formatAt(option.at, now)}</span>
            </button>
          ))}
          <form
            className="mt-1 flex items-center gap-1.5 border-t border-line px-1 pb-0.5 pt-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (customAt > Date.now()) onPick(customAt);
            }}
          >
            <input
              type="datetime-local"
              value={shown}
              min={toLocalInput(now)}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Send at"
              className="min-w-0 flex-1 rounded-md border border-line bg-sunken px-1.5 py-1 font-mono text-[11px] text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!(customAt > now)}
              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11.5px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40"
            >
              Schedule
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
