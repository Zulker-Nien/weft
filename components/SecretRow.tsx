"use client";

import { isMac } from "@/lib/hotkeys";
import { useCountdown } from "@/lib/use-countdown";
import { useModHeld } from "@/lib/use-mod-held";
import { masked, type VaultSecret } from "@/lib/vault-view";
import CountdownButton, { CONFIRM_WAIT_MS } from "./CountdownButton";
import Icon from "./Icon";
import { Tag } from "./VaultParts";

// A row in the 🔐 drawer (components/VaultDrawer.tsx).

// choose-remove asks which environments to remove it from (components/RemoveSecretDialog.tsx).
export type RowAction = "reveal" | "copy" | "edit" | "remove" | "choose-remove";

// One secret: its name and masked tail, with change, reveal, copy and remove on hover and its value once
// revealed. 🗑 turns into the countdown's red button (components/CountdownButton.tsx); leaving the row
// calls it off. When the name is in other environments too (spread), 🗑 asks which to remove it from.
export function SecretRow({
  secret: s,
  value,
  spread,
  onAct,
  onMenu,
}: {
  secret: VaultSecret;
  value: string | undefined;
  spread: boolean;
  onAct: (action: RowAction) => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { left, arm, disarm } = useCountdown(CONFIRM_WAIT_MS);
  return (
    <div onContextMenu={onMenu} onMouseLeave={disarm} className="group rounded px-1.5 py-1 hover:bg-sunken">
      <div className="flex items-center gap-1.5 text-[11.5px]">
        <span className="min-w-0 flex-1 truncate font-mono text-ink" title={s.source ? `${s.name} · from ${s.source}` : s.name}>
          {s.name}
        </span>
        {s.missing ? <Tag tone="warn">missing</Tag> : <span className="font-mono text-[10.5px] text-faint group-hover:hidden">{masked(s)}</span>}
        {left !== null ? (
          <CountdownButton
            left={left}
            label="Remove"
            ariaLabel={`Confirm removing ${s.name}`}
            title={`Remove ${s.name} (${s.environment}) from the vault`}
            onConfirm={() => {
              disarm();
              onAct("remove");
            }}
            className="px-1.5 text-[10.5px]"
          />
        ) : (
          <span className="hidden gap-0.5 group-hover:flex">
            <HoverButton
              icon="pencil"
              label={`${s.missing ? "Set" : "Change"} ${s.name}`}
              title={s.missing ? "Set its value" : "Change its value"}
              onClick={() => onAct("edit")}
            />
            {!s.missing && (
              <>
                <HoverButton
                  icon="eye"
                  label={value ? `Hide ${s.name}` : `Reveal ${s.name}`}
                  title={value ? "Hide" : "Reveal (Touch ID)"}
                  onClick={() => onAct("reveal")}
                />
                <HoverButton
                  icon="copy"
                  label={`Copy ${s.name}`}
                  title="Copy (Touch ID); clears from the clipboard after a minute"
                  onClick={() => onAct("copy")}
                />
              </>
            )}
            {spread ? (
              <TrashButton name={s.name} title="Remove from one or more of its environments…" onArm={() => onAct("choose-remove")} />
            ) : (
              <TrashButton name={s.name} onArm={arm} onRemove={() => onAct("remove")} />
            )}
          </span>
        )}
      </div>
      {value !== undefined && <div className="mt-0.5 select-text break-all font-mono text-[10.5px] text-ink">{value}</div>}
    </div>
  );
}

function HoverButton({ icon, label, title, onClick }: { icon: "pencil" | "eye" | "copy"; label: string; title: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={title} className="rounded p-0.5 text-muted hover:text-ink">
      <Icon name={icon} size={12} />
    </button>
  );
}

// 🗑 starts the countdown; with ⌘ (Ctrl off macOS) held it turns red, and a click removes at once. Without
// onRemove, a held click arms too (the dialog it opens has its own countdown).
function TrashButton({ name, title, onArm, onRemove = onArm }: { name: string; title?: string; onArm: () => void; onRemove?: () => void }) {
  const hot = useModHeld();
  const mod = isMac() ? "⌘" : "Ctrl";
  return (
    <button
      onClick={(e) => (e.metaKey || e.ctrlKey ? onRemove() : onArm())}
      aria-label={`Remove ${name}`}
      title={title ?? (hot ? "Remove now" : `Remove from the vault (${mod}-click removes at once)`)}
      className={`rounded p-0.5 ${hot ? "text-danger" : "text-muted hover:text-ink"}`}
    >
      <Icon name="trash" size={12} />
    </button>
  );
}
