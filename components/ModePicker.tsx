"use client";

import { MODE_OPTIONS, type PermissionMode } from "@/lib/types";
import Icon from "./Icon";

// The permission mode select: in the new-thread dialog, and small in a thread's header, where a
// change applies to the running CLI right away. YOLO shows in the warning colour.
export default function ModePicker({
  value,
  onChange,
  small = false,
  yolo = true,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  small?: boolean;
  // Left out where the thread can't skip prompts (the puku backend).
  yolo?: boolean;
}) {
  const mode = MODE_OPTIONS.find((m) => m.id === value) ?? MODE_OPTIONS[0];
  const options = MODE_OPTIONS.filter((m) => yolo || m.id !== "bypassPermissions" || m.id === value);
  const loose = value === "bypassPermissions";
  return (
    <label
      className={`relative flex items-center rounded-md border ${
        small ? "gap-1 py-px pl-1.5 pr-1 text-[11px]" : "gap-1.5 py-1.5 pl-2.5 pr-1.5 text-[12px]"
      } ${loose ? "border-warn/50 bg-warn-soft text-warn" : small ? "border-line text-muted" : "border-line-strong text-ink"}`}
      title={`Permissions: ${mode.hint}`}
    >
      <Icon name={loose ? "zap" : "shield"} size={small ? 11 : 13} />
      <span className="sr-only">Permissions</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PermissionMode)}
        className={`cursor-pointer appearance-none bg-transparent font-medium outline-none ${small ? "pr-3.5" : "pr-4"}`}
      >
        {options.map((m) => (
          <option key={m.id} value={m.id} title={m.hint}>
            {m.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={small ? 10 : 12} className={`pointer-events-none absolute ${small ? "right-1" : "right-1.5"}`} />
    </label>
  );
}
