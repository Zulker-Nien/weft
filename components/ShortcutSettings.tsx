"use client";

import { useMemo, useState } from "react";
import { isMac, useShortcutList } from "@/lib/hotkeys";
import { filterSections, shortcutSections, splitDescription, type ShortcutSection } from "@/lib/shortcut-catalog";
import { bindingSpec, currentBinding, SHORTCUTS, bindingFromEvent, formatBinding, setBinding } from "@/lib/shortcuts";
import KeyCaps from "./KeyCaps";

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

// One row in the full list: description on the left, the keys on the right. Same primitives as the
// "?" sheet (KeyCaps + splitDescription), so the two stay in step.
function ShortcutListRow({ entry }: { entry: ShortcutSection["items"][number] }) {
  const { main, detail } = splitDescription(entry.description);
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] leading-snug text-ink">{main}</span>
        {detail && <span className="mt-0.5 text-[12px] leading-snug text-muted">{detail}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {entry.keys.map((spec, i) => (
          <span key={spec} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-[11px] text-faint">or</span>}
            <KeyCaps spec={spec} />
          </span>
        ))}
      </span>
    </li>
  );
}

// Settings → Shortcuts: every rebindable shortcut (today just dictation) and, below it, every other
// shortcut in the app. The full list is the same data the "?" sheet shows, so it stays in step with
// the registry (lib/hotkeys.ts) and the fixed keys in lib/shortcut-catalog.ts without a separate copy.
export default function ShortcutSettings({ titleClass, hintClass }: { titleClass: string; hintClass: string }) {
  const registered = useShortcutList();
  const mac = isMac();
  // The dictation row's current binding, fed into shortcutSections so the row in the full list
  // reflects whatever the user rebound it to (not just the default).
  const dictation = bindingSpec(currentBinding("dictation"), mac);
  const sections = useMemo(
    () => shortcutSections(registered, { desktop: true, dictation }),
    [registered, dictation],
  );
  // An empty filter would just be the same list; this component shows the full list directly.
  const shown = useMemo(() => filterSections(sections, "", mac), [sections, mac]);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className={titleClass}>Shortcuts</h3>
        <p className={hintClass}>Click a shortcut, then press the keys you want. Use at least one of Option, Control, or Command.</p>
      </div>
      <div className="flex flex-col gap-2">
        {SHORTCUTS.map((s) => (
          <ShortcutRow key={s.id} id={s.id} label={s.label} />
        ))}
      </div>
      <div className="flex flex-col gap-1 border-t border-line-strong pt-4">
        <h4 className="text-[12.5px] font-semibold uppercase tracking-wider text-accent">All keyboard shortcuts</h4>
        <p className="text-[12px] text-muted">Every shortcut in the app, grouped by what they do. Press <KeyCaps spec="?" /> anywhere to open this list as a sheet.</p>
      </div>
      <div className="flex flex-col gap-3">
        {shown.map(({ group, items }) => (
          <section key={group} className="flex flex-col gap-1">
            <h5 className="text-[11.5px] font-medium uppercase tracking-wider text-faint">{group}</h5>
            <ul className="flex flex-col divide-y divide-line">
              {items.map((entry) => (
                <ShortcutListRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
