"use client";

// Settings → Laptop mode: the same Keep Working feature the menu bar tray already exposes,
// surfaced as its own page. The tray still drives the same underlying state
// (electron/keep-working.cjs), so a chip here flips the cup in the menu bar and vice versa.
import { useEffect, useState } from "react";
import { useNow } from "@/lib/use-now";
import ChoiceChip from "./ChoiceChip";
import LaptopModeRules, { type KwPrefs } from "./LaptopModeRules";

// Mirrors HOUR_CHOICES in electron/keep-working.cjs; keep in lockstep if either list changes.
const HOURS = [1, 2, 3, 8] as const;

type Mode = "off" | "threads" | "hours";

interface KwState {
  mode: Mode;
  hours?: number;
  until?: number;
  running?: number | null;
  auto?: boolean;
  minBattery?: number;
  onlineOnly?: boolean;
}

function leftText(until: number, now: number): string {
  const mins = Math.max(0, Math.round((until - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

function statusText(state: KwState, now: number): string {
  if (state.mode === "off") return state.auto ? "Off: turns on by itself when a thread runs." : "Off: shutting the lid puts the Mac to sleep.";
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

export default function LaptopModeCard() {
  // The card is the only consumer; when the bridge is missing (Linux/Windows or a dev shell), it shows
  // a hint and disables its chips. Otherwise it reads the current state on mount and again on every
  // "keep-working:changed" event, and uses useNow for the live "1h 30m left" countdown.
  const [state, setState] = useState<KwState>({ mode: "off" });
  const [busy, setBusy] = useState(false);
  // A board window newer than Electron main (a preload change before the restart) has no handler to call.
  const [prefsError, setPrefsError] = useState<string | null>(null);
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

  async function setPrefs(patch: KwPrefs) {
    if (!bridge?.setPrefs || busy) return;
    setBusy(true);
    setPrefsError(null);
    try {
      await bridge.setPrefs(patch);
    } catch (err) {
      const stale = /No handler registered/.test(String(err));
      setPrefsError(stale ? "Weft needs a restart to change these settings." : `Couldn't change it: ${String(err)}`);
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
        <h3 className={TITLE}>Keep awake now</h3>
        <p className={HINT}>
          Sleep comes back at the deadline, when threads finish, or by the rules below.
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
                <ChoiceChip key={`${c.key}-${c.hours ?? 0}`} active={active} disabled={busy} onClick={() => void pick(c.key, c.hours)}>
                  {c.key === "threads" ? c.label : `For ${c.label}`}
                </ChoiceChip>
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
          {bridge?.setPrefs && <LaptopModeRules prefs={state} busy={busy} onChange={(patch) => void setPrefs(patch)} />}
          {prefsError && (
            <p role="alert" className="text-[12.5px] text-danger">
              {prefsError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
