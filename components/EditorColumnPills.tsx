"use client";

import Icon from "./Icon";
import { allowedModes, fileName, type EditorMode, type EditorTab } from "@/lib/editor-tabs";

// The tab pill, the empty-state hint, the diff empty state, the conflict banner and the source
// textarea for a markdown file in source mode. Splitting these out keeps the column itself under
// the 300-line cap.

export function TabPill({ tab, active, dirty, onClick, onClose, onMode }: TabPillProps) {
  const modes = allowedModes(tab.path);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`group flex shrink-0 cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[12px] ${active ? "bg-sunken text-ink" : "text-muted hover:bg-sunken/60 hover:text-ink"}`}
    >
      <span className="truncate font-medium">{fileName(tab.path)}</span>
      {dirty && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn" />}
      {active && modes.length > 1 && (
        <select
          value={tab.mode}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onMode(e.target.value as EditorMode)}
          aria-label="Editor mode"
          className="ml-1 rounded border border-line bg-canvas px-1 py-0 text-[10.5px] text-ink"
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {m === "edit" ? "Edit" : m === "changes" ? "Changes" : "Source"}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${fileName(tab.path)}`}
        className="ml-0.5 rounded p-0.5 text-faint opacity-0 hover:bg-line hover:text-ink group-hover:opacity-100"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}

export function EmptyHint() {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-faint">
      <div>
        <div className="mb-1 text-ink">No file open</div>
        Click a file path in the thread, or press{" "}
        <kbd className="rounded border border-line bg-sunken px-1 text-[11px]">⌘P</kbd>.
      </div>
    </div>
  );
}

export function DiffEmptyView({ state }: { state: "no-changes" | "untracked" | "loading" }) {
  const message =
    state === "no-changes" ? "No changes vs HEAD." : state === "untracked" ? "Untracked file — the diff is everything." : "Loading…";
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-muted">
      <div className="rounded-md border border-line bg-sunken px-3 py-2">{message}</div>
    </div>
  );
}

export function ConflictBanner({ diskPath, onReload, onOverwrite }: { diskPath: string; onReload: () => void; onOverwrite: () => void }) {
  return (
    <div role="alert" className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-warn-soft px-3 py-1.5 text-[12px] text-warn">
      <span>
        <span className="font-medium">{fileName(diskPath)}</span> changed on disk.
      </span>
      <span className="flex shrink-0 gap-1.5">
        <button type="button" onClick={onReload} className="rounded border border-line bg-panel px-2 py-0.5 hover:bg-sunken">
          Reload theirs
        </button>
        <button type="button" onClick={onOverwrite} className="rounded border border-warn bg-warn px-2 py-0.5 text-on-accent hover:opacity-90">
          Overwrite
        </button>
      </span>
    </div>
  );
}

export function SourceView({ text, onChange, onSave }: { text: string; onChange: (next: string) => void; onSave: () => void }) {
  return (
    <textarea
      value={text}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          onSave();
        }
      }}
      className="h-full w-full resize-none border-0 bg-canvas px-3.5 py-3 font-mono text-[13px] text-ink outline-none"
      spellCheck={false}
    />
  );
}

interface TabPillProps {
  tab: EditorTab;
  active: boolean;
  dirty: boolean;
  onClick: () => void;
  onClose: () => void;
  onMode: (mode: EditorMode) => void;
}
