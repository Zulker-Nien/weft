"use client";

import type { LocalRepo } from "@/lib/types";
import Icon from "./Icon";

// The New thread dialog's folder button (the folder's name, its branch and a short path), and the
// plain rows at the foot of its picker.

export function shortPath(folder: string, home: string) {
  return home && (folder === home || folder.startsWith(`${home}/`)) ? `~${folder.slice(home.length)}` : folder;
}

function baseName(folder: string) {
  return folder.replace(/\/+$/, "").split("/").pop() || folder;
}

export default function RepoPickerButton({
  value,
  home,
  current,
  open,
  onClick,
}: {
  value: string;
  home: string;
  current: LocalRepo | undefined;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-haspopup="listbox"
      title={value}
      className={`flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12.5px] ${
        open ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-sunken"
      }`}
    >
      <Icon name={current?.github ? "github" : current?.git ? "branch" : "folder"} size={14} className="text-muted" />
      <span className="max-w-[200px] truncate font-medium text-ink">{baseName(value)}</span>
      {current?.branch && (
        <span className="flex shrink-0 items-center gap-1 rounded bg-sunken px-1.5 py-px font-mono text-[11px] text-muted">
          <Icon name="branch" size={10} />
          {current.branch}
        </span>
      )}
      {/* Right-to-left so a long path loses its start, not the folder name. */}
      <span className="hidden max-w-[240px] truncate font-mono text-[11px] text-faint sm:inline" dir="rtl">
        <span dir="ltr">{shortPath(value, home)}</span>
      </span>
      <Icon name="chevronDown" size={13} className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export function PickerRow({
  active,
  icon,
  children,
  onHover,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-active={active}
      onMouseEnter={onHover}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink ${active ? "bg-sunken" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}
