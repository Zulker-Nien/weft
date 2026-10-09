"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// One registry for the app's keyboard shortcuts. Components register theirs with useShortcuts, a single
// window listener dispatches, and the "?" dialog lists whatever is registered.
//
// A key is written like "n", "?", "ArrowDown" or "mod+k": "mod" is Cmd on macOS and Ctrl elsewhere, and
// "alt" and "shift" work as written. Letters and digits compare case-insensitively; for a symbol like "?"
// Shift is whatever it takes to type it.
//
// Plain keys are ignored while typing in an input, textarea, select, or editor. A shortcut with "mod" or
// "alt" still fires there, and allowInInput lets one opt in outright (Escape will want that).
//
// When several shortcuts share a key, the one registered last runs first (so a dialog can claim Escape
// ahead of the board). A handler that returns false passes the key on to the next one and leaves the
// browser's default alone; any other return counts as handled and prevents the default.

export type ShortcutGroup = "General" | "Board" | "Thread";

// The order the help dialog lists groups in.
export const SHORTCUT_GROUPS: ShortcutGroup[] = ["General", "Board", "Thread"];

export type ShortcutDef = {
  // Unique and stable; hooks match their handlers to the registered shortcut by it.
  id: string;
  // Alternatives for the same action, e.g. ["j", "ArrowDown"].
  keys: string[];
  description: string;
  group: ShortcutGroup;
  allowInInput?: boolean;
  // Checked on each key press, so it can follow state. A disabled shortcut stays in the help list.
  enabled?: boolean;
  handler: (e: KeyboardEvent) => void | false;
};

// What the help dialog sees.
export type ShortcutInfo = Pick<ShortcutDef, "id" | "keys" | "description" | "group">;

type Combo = { key: string; mod: boolean; alt: boolean; shift: boolean };

type Entry = ShortcutInfo & {
  combos: Combo[];
  allowInInput: boolean;
  isEnabled: () => boolean;
  run: (e: KeyboardEvent) => void | false;
};

function parse(spec: string): Combo {
  const parts = spec.split("+");
  const key = parts.pop() || "+";
  const mods = parts.map((p) => p.toLowerCase());
  return { key, mod: mods.includes("mod"), alt: mods.includes("alt"), shift: mods.includes("shift") };
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
}

function matches(combo: Combo, e: KeyboardEvent, mac: boolean) {
  if ((mac ? e.metaKey : e.ctrlKey) !== combo.mod) return false;
  // The other platform's primary modifier would be a different shortcut.
  if (mac ? e.ctrlKey : e.metaKey) return false;
  if (e.altKey !== combo.alt) return false;
  if (combo.key.length === 1) {
    if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false;
    // Shift is part of typing a symbol, but it tells "n" from "N".
    return !/[a-z0-9]/i.test(combo.key) || e.shiftKey === combo.shift;
  }
  return e.key === combo.key && e.shiftKey === combo.shift;
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "time", ""]);

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

let entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function register(add: Entry[]) {
  entries = [...entries, ...add];
  emit();
  return () => {
    entries = entries.filter((e) => !add.includes(e));
    emit();
  };
}

function dispatch(e: KeyboardEvent) {
  // Something nearer the key already took it, or an IME is composing.
  if (e.defaultPrevented || e.isComposing) return;
  const mac = isMac();
  const typing = isTyping(e.target);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const combo = entry.combos.find((c) => matches(c, e, mac));
    if (!combo) continue;
    if (typing && !(entry.allowInInput || combo.mod || combo.alt)) continue;
    if (!entry.isEnabled()) continue;
    if (entry.run(e) === false) continue;
    e.preventDefault();
    return;
  }
}

// Attaches the window listener. Mount it once, in the root of the UI.
export function useShortcutListener() {
  useEffect(() => {
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, []);
}

// Registers shortcuts for as long as the component is mounted. The list must have the same ids on every
// render; keys and descriptions are read once, while handlers and enabled follow the latest render, so
// they can use current state without any memoizing.
export function useShortcuts(defs: ShortcutDef[]) {
  const latest = useRef(defs);
  useEffect(() => {
    latest.current = defs;
  });
  const first = useRef(defs);

  useEffect(() => {
    const current = (id: string) => latest.current.find((d) => d.id === id);
    return register(
      first.current.map((def) => ({
        id: def.id,
        keys: def.keys,
        description: def.description,
        group: def.group,
        combos: def.keys.map(parse),
        allowInInput: Boolean(def.allowInInput),
        isEnabled: () => current(def.id)?.enabled !== false,
        run: (e) => current(def.id)?.handler(e),
      })),
    );
  }, []);
}

const NONE: ShortcutInfo[] = [];
let snapshot: ShortcutInfo[] = NONE;
let snapshotOf: Entry[] | null = null;

function getSnapshot() {
  if (snapshotOf !== entries) {
    snapshotOf = entries;
    snapshot = entries.map(({ id, keys, description, group }) => ({ id, keys, description, group }));
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Every registered shortcut, for the help dialog.
export function useShortcutList() {
  return useSyncExternalStore(subscribe, getSnapshot, () => NONE);
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Enter: "Enter",
  " ": "Space",
};

// The key caps to draw for one key spec, e.g. "mod+k" -> ["⌘", "K"].
export function keyCaps(spec: string, mac = isMac()): string[] {
  const combo = parse(spec);
  const caps: string[] = [];
  if (combo.mod) caps.push(mac ? "⌘" : "Ctrl");
  if (combo.alt) caps.push(mac ? "⌥" : "Alt");
  if (combo.shift) caps.push(mac ? "⇧" : "Shift");
  caps.push(KEY_LABELS[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key));
  return caps;
}
