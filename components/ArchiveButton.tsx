"use client";

import Icon from "./Icon";

// The Archive button on Done cards (or an already-archived card): hides on rest and appears on hover,
// like the ☆ next to it. The card itself opens the thread on click; the button stops the event so it
// archives instead.
export default function ArchiveButton({ archived, onClick }: { archived: boolean; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={archived ? "Unarchive" : "Archive"}
      aria-label={archived ? "Unarchive" : "Archive"}
      className="-my-1 shrink-0 rounded p-1 text-muted opacity-0 hover:bg-sunken hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Icon name="archive" size={12} />
    </button>
  );
}
