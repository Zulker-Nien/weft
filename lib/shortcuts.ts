// User-rebindable shortcuts (today just dictation), kept in this browser's localStorage. Fixed keys that
// aren't configurable live in the registry in ./hotkeys.

export type Binding = { code: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };

export const SHORTCUTS = [{ id: "dictation", label: "Start or stop dictation" }];

const DEFAULTS: Record<string, Binding> = {
  dictation: { code: "Quote", alt: true, ctrl: false, meta: false, shift: false },
};

const STORAGE_KEY = "threadboard.shortcuts";

function readAll(): Record<string, Binding> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function currentBinding(id: string): Binding {
  return readAll()[id] ?? DEFAULTS[id];
}

// null puts the default back.
export function setBinding(id: string, binding: Binding | null) {
  const all = readAll();
  if (binding) all[id] = binding;
  else delete all[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

const MODIFIER_CODES = /^(Alt|Control|Meta|Shift|OS)(Left|Right)?$/;

// The binding a key press describes, or null while it can't be one: only modifiers so far, or none of
// Option, Control, and Command (a bare letter would steal typing).
export function bindingFromEvent(e: KeyboardEvent): Binding | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return null;
  return { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
}

// Matches on the physical key, since Option changes the character a key types on macOS.
export function matches(
  e: { code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  b: Binding,
) {
  return e.code === b.code && e.altKey === b.alt && e.ctrlKey === b.ctrl && e.metaKey === b.meta && e.shiftKey === b.shift;
}

const CODE_LABELS: Record<string, string> = {
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
};

export function formatBinding(b: Binding) {
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const key = CODE_LABELS[b.code] ?? b.code.replace(/^(Key|Digit)/, "");
  const mods = [
    b.ctrl && (mac ? "⌃" : "Ctrl+"),
    b.alt && (mac ? "⌥" : "Alt+"),
    b.shift && (mac ? "⇧" : "Shift+"),
    b.meta && (mac ? "⌘" : "Win+"),
  ].filter(Boolean);
  return mods.join("") + key;
}
