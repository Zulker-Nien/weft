import { useEffect, useEffectEvent } from "react";

// Open dialogs, menus, and side panels, oldest first. Escape closes only the last one.
const layers: Array<(e: KeyboardEvent) => void> = [];

function onKeyDown(e: KeyboardEvent) {
  // A key something closer already handled (clearing a filter, cancelling dictation, an IME) is spent.
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  e.preventDefault();
  top(e);
}

// Escape runs onEscape while `active`, if nothing opened after this layer is still up. Layers stack in
// the order they became active.
export function useEscape(active: boolean, onEscape: (e: KeyboardEvent) => void) {
  const run = useEffectEvent(onEscape);

  useEffect(() => {
    if (!active) return;
    const layer = (e: KeyboardEvent) => run(e);
    if (layers.length === 0) window.addEventListener("keydown", onKeyDown);
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);
}

// Whether Escape was pressed in a field holding text that closing would lose. Blurs the field instead,
// so a second Escape closes.
export function keepTypedText(e: KeyboardEvent): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return false;
  const typed =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value.trim() !== ""
      : el.isContentEditable && (el.textContent ?? "").trim() !== "";
  if (!typed) return false;
  el.blur();
  return true;
}
