"use client";

// The ✏︎ in an open card's header, beside its X: opens or closes the editor column. It stands in for
// the closed editor's strip, so the thread and the browser pane meet at one drag divider.

import Icon from "./Icon";

// Draws nothing without onClick (the copilot, weft.zip), which keeps that check out of ThreadPanel.
export default function EditorToggle({ open = false, onClick }: { open?: boolean; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? "Close the editor (⌥⌘2)" : "Open the editor (⌥⌘2)"}
      aria-label={open ? "Close editor" : "Open editor"}
      aria-pressed={open}
      className={`rounded-md p-1.5 hover:bg-sunken hover:text-ink ${open ? "bg-accent/15 text-accent" : "text-muted"}`}
    >
      <Icon name="pencil" size={15} />
    </button>
  );
}
