import { useEffect, useState } from "react";
import { isMac } from "./hotkeys";

export type HeldModifiers = { mod: boolean; ctrl: boolean };

// Which of ⌘ (Ctrl off macOS) and, on macOS, ⌃ are held right now, for controls that change what a key or
// click does while they are: the New thread dialog's Start button names what ⌘↵ and ⌃↵ do. Off macOS
// Ctrl is the mod key, so ctrl stays false. Leaving the window lets go, since the key-up would land elsewhere.
export function useHeldModifiers(): HeldModifiers {
  const [held, setHeld] = useState<HeldModifiers>({ mod: false, ctrl: false });
  useEffect(() => {
    const mac = isMac();
    const track = (e: KeyboardEvent) => {
      const next = { mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac && e.ctrlKey && !e.metaKey };
      setHeld((h) => (h.mod === next.mod && h.ctrl === next.ctrl ? h : next));
    };
    const release = () => setHeld({ mod: false, ctrl: false });
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", release);
    };
  }, []);
  return held;
}

// Whether ⌘ (Ctrl off macOS) is held: the 🔐 drawer's 🗑 turns red and removes at once.
export function useModHeld(): boolean {
  return useHeldModifiers().mod;
}
