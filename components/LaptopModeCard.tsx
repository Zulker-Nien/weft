"use client";

// Settings → General → Laptop mode: the same Keep Working feature the menu bar tray already exposes,
// surfaced as a card in the app body. The tray still drives the same underlying state
// (electron/keep-working.cjs), so a chip here flips the cup in the menu bar and vice versa.
import { useEffect, useState } from "react";
import { useNow } from "@/lib/use-now";

// Mirrors HOUR_CHOICES in electron/keep-working.cjs; keep in lockstep if either list changes.
const HOURS = [1, 2, 3, 8] as const;

type Mode = "off" | "threads" | "hours";

interface KwState {
  mode: Mode;
  hours?: number;
  until?: number;
  running?: number | null;
}

function leftText(until: number, now: number): string {
  const mins = Math.max(0, Math.round((until - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

function statusText(state: KwState, now: number): string {
  if (state.mode === "off") return "Off: shutting the lid puts the Mac to sleep.";
  if (state.mode === "threads") {
    if (state.running === null || state.running === undefined) return "On until threads finish.";
    if (state.running === 0) return "On until threads finish (nothing running).";
    return `On until threads finish (${state.running} running).`;
  }
  if (!state.until) return "On.";
  const at = new Date(state.until).toTimeString().slice(0, 5);
  return `On until ${at} (${leftText(state.until, now)} left).`;
}

// The five choices shown as a row of chips: "Until threads finish" then the four hour options,
// matching the tray's Keep Working submenu so the UI stays familiar.
const CHOICES: { key: "threads" | "hours"; hours?: number; label: string }[] = [
  { key: "threads", label: "Until threads finish" },
  ...HOURS.map((h) => ({ key: "hours" as const, hours: h, label: h === 1 ? "1 hour" : `${h} hours` })),
];

const TITLE = "text-[13px] font-medium text-ink";
const HINT = "text-[12.5px] text-muted";

function ChipButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-md border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-accent bg-accent-soft text-ink"
          : "border-line-strong text-muted hover:bg-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function LaptopModeCard() {
  // The card is the only consumer; when the bridge is missing (Linux/Windows or a dev shell), it shows
  // a hint and disables its chips. Otherwise it reads the current state on mount and again on every
  // "keep-working:changed" event, and uses useNow for the live "1h 30m left" countdown.
  const [state, setState] = useState<KwState>({ mode: "off" });
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const bridge = typeof window !== "undefined" ? window.weft?.keepWorking : undefined;
  const available = Boolean(bridge);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.state().then((s) => {
      if (!cancelled) setState(s);
    });
    const unsubscribe = bridge.onChange(() => {
      void bridge.state().then((s) => {
        if (!cancelled) setState(s);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  async function pick(key: "threads" | "hours", hours?: number) {
    if (!bridge || busy) return;
    setBusy(true);
    try {
      await bridge.start(key, hours);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!bridge || busy) return;
    setBusy(true);
    try {
      await bridge.stop();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className={TITLE}>Laptop mode</h3>
        <p className={HINT}>
          Keep your Mac awake with the lid shut, so threads keep running in a bag. Sleep comes back
          at the deadline, when threads finish, or at 10% battery.
        </p>
      </div>
      {!available ? (
        <p className="text-[12.5px] text-faint">Only available on macOS.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((c) => {
              const active = state.mode === c.key && (c.key === "threads" || state.hours === c.hours);
              return (
                <ChipButton key={`${c.key}-${c.hours ?? 0}`} active={active} disabled={busy} onClick={() => void pick(c.key, c.hours)}>
                  {c.key === "threads" ? c.label : `For ${c.label}`}
                </ChipButton>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 text-[12.5px]">
            <p className="text-muted" data-testid="laptop-mode-status">{statusText(state, now)}</p>
            {state.mode !== "off" && (
              <button
                type="button"
                onClick={() => void turnOff()}
                disabled={busy}
                className="rounded-md border border-line-strong px-3 py-1 text-[12.5px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
              >
                Turn off
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
