"use client";

// The board's top bar: logo, "N running / M need you" status, restart chip, header badges, the
// browser / terminal / settings / new-thread buttons, and the account button. Each button gets
// the keyboard hint that lives in the hotkeys registry.
import type { ReactNode } from "react";
import Icon from "./Icon";

export interface BoardHeaderProps {
  mac: boolean;
  running: number;
  waiting: number;
  browserOpen: boolean;
  terminalOpen: boolean;
  hint: (id: string, fallback: string) => string;
  onToggleBrowser: () => void;
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenNew: () => void;
  // The three load-in-CrashGuard elements; each is a guarded() component from Board.tsx.
  restartChip: ReactNode;
  headerBadges: ReactNode;
  copilotButton: ReactNode;
  accountButton: ReactNode;
}

export default function BoardHeader({
  mac,
  running,
  waiting,
  browserOpen,
  terminalOpen,
  hint,
  onToggleBrowser,
  onToggleTerminal,
  onOpenSettings,
  onOpenNew,
  restartChip,
  headerBadges,
  copilotButton,
  accountButton,
}: BoardHeaderProps) {
  return (
    <header
      className={`flex shrink-0 items-center gap-3 border-b border-line bg-panel ${mac ? "app-drag mac-title-bar pr-4" : "px-4 py-2.5"}`}
    >
      <h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
        <img src="/app-icon.png" alt="" width={28} height={28} />
        Weft
      </h1>
      <span className="text-[12px] text-muted">
        {running} running
        {waiting > 0 && <span className="text-warn"> · {waiting} need{waiting === 1 ? "s" : ""} you</span>}
      </span>
      {restartChip}
      {headerBadges}
      <div className="flex-1" />
      {copilotButton}
      <button
        onClick={onToggleBrowser}
        title={hint("browser", "Browser")}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] ${browserOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-ink hover:bg-sunken"}`}
      >
        <Icon name="globe" size={14} /> Browser
      </button>
      <button
        onClick={onToggleTerminal}
        title={hint("terminal", "Terminal")}
        aria-label="Terminal"
        className={`rounded-md border p-1.5 ${terminalOpen ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:bg-sunken hover:text-ink"}`}
      >
        <Icon name="terminal" size={15} />
      </button>
      <button
        onClick={onOpenSettings}
        title={hint("settings", "Settings")}
        aria-label="Settings"
        className="rounded-md border border-line-strong p-1.5 text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon name="sliders" size={15} />
      </button>
      <button
        onClick={onOpenNew}
        title={hint("new-thread", "New thread")}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent hover:opacity-90"
      >
        <Icon name="plus" size={14} /> New thread
        <kbd className="ml-0.5 rounded border border-current/30 px-1 font-mono text-[10.5px] leading-[15px] opacity-70">N</kbd>
      </button>
      {accountButton}
    </header>
  );
}
