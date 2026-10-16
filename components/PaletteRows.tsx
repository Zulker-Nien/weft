"use client";

// The command palette's row pieces: the column pill, a project chip, the matched-snippet text,
// the row's title block and its key caps.
import { projectHue } from "@/lib/format";
import { keyCaps } from "@/lib/hotkeys";
import type { PaletteItem } from "@/lib/palette";
import type { Column } from "@/lib/types";

export const COLUMN_PILL: Record<Column, string> = {
  running: "bg-accent-soft text-accent",
  needs_you: "bg-warn-soft text-warn",
  review: "bg-ok-soft text-ok",
  backlog: "bg-sunken text-muted",
  done: "bg-sunken text-muted",
};
export const COLUMN_LABEL: Record<Column, string> = {
  running: "Running",
  needs_you: "Needs you",
  review: "Review",
  backlog: "Backlog",
  done: "Done",
};

export // The project's own color: deeper on light themes, lighter on dark, same hue on both.
function projectInk(name: string) {
  const hue = projectHue(name);
  return `light-dark(oklch(0.5 0.15 ${hue}), oklch(0.8 0.12 ${hue}))`;
}

export function ProjectChip({ name }: { name: string }) {
  const hue = projectHue(name);
  return (
    <span
      title={`Project: ${name}`}
      className="flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[13.5px] font-semibold"
      style={{ color: projectInk(name), background: `oklch(0.65 0.14 ${hue} / 0.16)` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: "currentColor" }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

// A snippet with its matched words in bold.
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split("\u0001").map((part, i) => {
        const [hit, rest] = i === 0 ? ["", part] : part.split("\u0002");
        return (
          <span key={i}>
            {hit && <mark className="rounded-[3px] bg-accent-soft px-0.5 font-semibold text-ink">{hit}</mark>}
            {rest}
          </span>
        );
      })}
    </>
  );
}

// The row's title with its status pill and detail, and the matched prompt line or the card's last output below.
export function ItemText({ item }: { item: PaletteItem }) {
  return (
    <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-ink">
      {item.label}
      {item.column && (
        <span className={`ml-2 rounded px-1.5 py-px align-[1px] text-[12.5px] font-semibold ${COLUMN_PILL[item.column]}`}>
          {COLUMN_LABEL[item.column]}
        </span>
      )}
      {item.detail && <span className="ml-2 text-[14px] font-normal text-faint">{item.detail}</span>}
      {item.snippet ? (
        <span className="mt-1 block truncate text-[14.5px] font-normal text-muted">
          <Snippet text={item.snippet} />
        </span>
      ) : (
        item.preview && <span className="mt-0.5 block truncate text-[14.5px] font-normal text-muted">{item.preview}</span>
      )}
    </span>
  );
}

export function KeyCaps({ keys }: { keys: string }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {keyCaps(keys).map((cap, i) => (
        <kbd key={i} className="min-w-[24px] rounded border border-line-strong bg-canvas px-1 py-px text-center font-mono text-[13px] text-muted">
          {cap}
        </kbd>
      ))}
    </span>
  );
}

