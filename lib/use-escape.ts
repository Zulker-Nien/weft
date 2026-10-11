import { useEffect, useRef } from "react";

// Open dialogs, menus, and side panels, oldest first. Escape closes only the last one, and the board's own
// panels (an open thread, the browser, the library) only once no dialog or menu is up.
type Layer = { run: (e: KeyboardEvent) => void; panel: boolean };
const layers: Layer[] = [];

function onKeyDown(e: KeyboardEvent) {
  // Something closer that wants Escape for itself (clearing a filter, cancelling dictation, closing a
  // dropdown) stops its propagation. defaultPrevented isn't that signal: ProseMirror prevents every
  // Escape typed in an editor, which kept dialogs with a composer from closing.
  if (e.key !== "Escape" || e.isComposing) return;
  const top = layers.findLast((l) => !l.panel) ?? layers[layers.length - 1];
  if (!top) return;
  e.preventDefault();
  top.run(e);
}

// Escape runs onEscape while `active`, if nothing opened after this layer is still up. Layers stack in
// the order they became active. A `panel` sits under every dialog and menu, even one opened before it
// (an agent can open the browser while a dialog is up).
export function useEscape(active: boolean, onEscape: (e: KeyboardEvent) => void, { panel = false } = {}) {
  // The handler fires from a keydown listener on window, not from inside an effect, so a ref is the
  // right tool to read the latest callback (useEffectEvent is reserved for effect-fired events).
  const latest = useRef(onEscape);
  useEffect(() => {
    latest.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const layer: Layer = { run: (e) => latest.current(e), panel };
    if (layers.length === 0) window.addEventListener("keydown", onKeyDown);
    layers.push(layer);
    return () => {
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, panel]);
}
