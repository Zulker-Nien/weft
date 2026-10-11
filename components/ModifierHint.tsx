"use client";

import { useEffect, useMemo, useState } from "react";
import { isMac, isTyping, useShortcutList } from "@/lib/hotkeys";
import { shortcutSections } from "@/lib/shortcut-catalog";
import KeyCaps, { Cap } from "./KeyCaps";

// Hold a modifier on the board and a card in the bottom-left corner lists what it does with it.
// Shift shows at once (it arms keys like ⇧A); ⌘ (Ctrl off macOS) waits a moment, so a quick ⌘K never
// flashes it. Pressing any other key, clicking, or typing in a field hides it.

const MOD_DELAY_MS = 600;
// Every app has these; they'd only push the board's own keys down the list.
const SKIP = new Set(["terminal-split", "reload", "close-window", "full-screen"]);

type Kind = "shift" | "mod";

export default function ModifierHint() {
  // null until a modifier is first held, so the server render (which can't tell macOS) draws nothing. After
  // that kind outlives `on`, so the card keeps its rows while it fades out.
  const [hint, setHint] = useState<{ kind: Kind; on: boolean } | null>(null);
  const registered = useShortcutList();
  const mac = isMac();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const modKey = mac ? "Meta" : "Control";
    const show = (kind: Kind) => setHint({ kind, on: true });
    const hide = () => setHint((h) => (h?.on ? { ...h, on: false } : h));
    const reset = () => {
      clearTimeout(timer);
      hide();
    };
    const down = (e: KeyboardEvent) => {
      // A held modifier repeats on some systems; that's still the same hold.
      if (e.repeat) return;
      clearTimeout(timer);
      if (isTyping(e.target)) {
        hide();
        return;
      }
      if (e.key === "Shift" && !e.metaKey && !e.ctrlKey && !e.altKey) show("shift");
      else if (e.key === modKey && !e.shiftKey && !e.altKey) {
        hide();
        timer = setTimeout(() => show("mod"), MOD_DELAY_MS);
      } else hide();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.key === modKey) reset();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("mousedown", reset);
    window.addEventListener("blur", reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("mousedown", reset);
      window.removeEventListener("blur", reset);
    };
  }, [mac]);

  const rows = useMemo(() => {
    const desktop = typeof window !== "undefined" && Boolean(window.threadboard);
    // Keys that only work while typing can't apply here: the card hides as soon as a field has focus.
    const all = shortcutSections(registered, { desktop })
      .filter((s) => s.group !== "Writing")
      .flatMap((s) => s.items)
      .filter((s) => !s.id.startsWith("reply-") && !SKIP.has(s.id));
    const pick = (prefix: string) =>
      all.flatMap((s) => {
        const spec = s.keys.find((k) => k.startsWith(prefix));
        return spec ? [{ id: s.id, spec, description: s.description }] : [];
      });
    return { shift: pick("shift+"), mod: pick("mod+") };
  }, [registered]);

  if (!hint) return null;
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed bottom-10 left-3 z-50 transition-all duration-150 ${
        hint.on ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <div className="w-[280px] rounded-lg border border-line-strong bg-panel p-2.5 shadow-lg">
        <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
          <Cap>{hint.kind === "mod" ? (mac ? "⌘" : "Ctrl") : mac ? "⇧ shift" : "Shift"}</Cap>
          shortcuts
        </div>
        <ul className="flex flex-col gap-1">
          {rows[hint.kind].map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-[12px] text-ink">{r.description}</span>
              <KeyCaps spec={r.spec} small />
            </li>
          ))}
        </ul>
        <p className="mt-2 border-t border-line pt-1.5 text-[11px] text-faint">
          Every shortcut: <Cap small>?</Cap>
        </p>
      </div>
    </div>
  );
}
