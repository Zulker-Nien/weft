"use client";

import { useState } from "react";
import { SHORTCUTS, bindingFromEvent, currentBinding, formatBinding, setBinding } from "@/lib/shortcuts";

// Click, then press the new combination. Escape cancels; Reset goes back to the default.
function ShortcutRow({ id, label }: { id: string; label: string }) {
  const [binding, setLocal] = useState(() => currentBinding(id));
  const [capturing, setCapturing] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-[200px] shrink-0 text-[13px] text-ink">{label}</span>
      <button
        type="button"
        onClick={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.key === "Escape") {
            setCapturing(false);
            return;
          }
          const next = bindingFromEvent(e.nativeEvent);
          if (!next) return;
          setBinding(id, next);
          setLocal(next);
          setCapturing(false);
        }}
        className="min-w-[96px] rounded-md border border-line-strong px-2.5 py-1 text-[12.5px] text-ink hover:bg-sunken"
      >
        {capturing ? "Press keys…" : formatBinding(binding)}
      </button>
      <button
        type="button"
        onClick={() => {
          setBinding(id, null);
          setLocal(currentBinding(id));
        }}
        className="text-[12px] text-muted hover:text-ink"
      >
        Reset
      </button>
    </div>
  );
}

// Settings → General → Shortcuts: every rebindable shortcut, one row each.
export default function ShortcutSettings({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className={titleClass}>Shortcuts</h3>
        <p className={hintClass}>Click a shortcut, then press the keys you want. Use at least one of Option, Control, or Command.</p>
      </div>
      {SHORTCUTS.map((s) => (
        <ShortcutRow key={s.id} id={s.id} label={s.label} />
      ))}
    </section>
  );
}
