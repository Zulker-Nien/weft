"use client";

import { useMemo, useState } from "react";
import { isMac, useShortcutList } from "@/lib/hotkeys";
import { filterSections, shortcutSections } from "@/lib/shortcut-catalog";
import { bindingSpec, currentBinding } from "@/lib/shortcuts";
import Icon from "./Icon";
import KeyCaps, { Cap } from "./KeyCaps";
import Modal from "./Modal";

// Every shortcut in the app, searchable by what it does or by its keys ("archive", "cmd k", "esc").
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const registered = useShortcutList();
  const [query, setQuery] = useState("");
  const mac = isMac();

  const sections = useMemo(
    () =>
      shortcutSections(registered, {
        desktop: typeof window !== "undefined" && Boolean(window.threadboard),
        dictation: bindingSpec(currentBinding("dictation"), mac),
      }),
    [registered, mac],
  );
  const shown = filterSections(sections, query, mac);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const holdKey = mac ? "⌘" : "Ctrl";

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} placement="top" className="max-h-[80vh] w-full max-w-[780px]">
      <div className="relative shrink-0 border-b border-line px-5 py-2.5">
        <Icon name="search" size={14} className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
          placeholder={`Search ${total} shortcuts: archive, ${mac ? "cmd" : "ctrl"} k, esc…`}
          aria-label="Search shortcuts"
          className="w-full rounded-md border border-line-strong bg-canvas py-1.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {shown.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">No shortcut matches “{query.trim()}”</p>
        ) : (
          <div className="gap-6 sm:columns-2">
            {shown.map(({ group, items }) => (
              <section key={group} className="mb-5 break-inside-avoid">
                <h3 className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-muted">{group}</h3>
                <ul className="flex flex-col">
                  {items.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
                      <span className="text-[12.5px] leading-snug text-ink">{s.description}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {s.keys.map((spec, i) => (
                          <span key={spec} className="flex items-center gap-1">
                            {i > 0 && <span className="text-[10.5px] text-faint">or</span>}
                            <KeyCaps spec={spec} />
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <p className="shrink-0 border-t border-line px-5 py-2 text-[11.5px] text-muted">
        Hold <Cap small>{holdKey}</Cap> or <Cap small>{mac ? "⇧" : "Shift"}</Cap> on the board to see what they do · plain
        keys pause while you type · change the dictation key in Settings
      </p>
    </Modal>
  );
}
