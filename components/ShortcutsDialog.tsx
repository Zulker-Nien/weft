"use client";

import { keyCaps, SHORTCUT_GROUPS, useShortcutList } from "@/lib/hotkeys";
import Modal from "./Modal";

function Keys({ spec }: { spec: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keyCaps(spec).map((cap, i) => (
        <kbd
          key={i}
          className="min-w-[22px] rounded border border-line-strong bg-sunken px-1.5 py-0.5 text-center font-mono text-[11.5px] text-ink"
        >
          {cap}
        </kbd>
      ))}
    </span>
  );
}

export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const shortcuts = useShortcutList();

  const groups = [
    ...SHORTCUT_GROUPS,
    ...new Set(shortcuts.map((s) => s.group).filter((g) => !SHORTCUT_GROUPS.includes(g))),
  ]
    .map((group) => ({ group, items: shortcuts.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} className="max-h-full w-full max-w-[560px]">
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-5 py-4">
          {groups.map(({ group, items }) => (
            <section key={group}>
              <h3 className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-muted">{group}</h3>
              <ul className="flex flex-col">
                {items.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
                    <span className="text-[13px] text-ink">{s.description}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {s.keys.map((spec, i) => (
                        <span key={spec} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-[11.5px] text-faint">or</span>}
                          <Keys spec={spec} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
    </Modal>
  );
}
