"use client";

import { MODE_OPTIONS, permissionOptions, type Backend, type PermissionMode } from "@/lib/types";
import Icon from "./Icon";

function currentMode(backend: Backend, value: PermissionMode) {
  const options = permissionOptions(backend);
  return options.find((m) => m.id === value) ?? MODE_OPTIONS.find((m) => m.id === value) ?? MODE_OPTIONS[0];
}

function visibleModes(backend: Backend, yolo: boolean, value: PermissionMode) {
  return permissionOptions(backend).filter((m) => yolo || m.id !== "bypassPermissions" || m.id === value);
}

function titleFor(disabled: boolean, hint: string) {
  return disabled ? "Codex keeps its sandbox mode for this session. Start a new Codex session to change it." : `Permissions: ${hint}`;
}

// The permission mode select: in the new-thread dialog, and small in a thread's header, where a
// change applies to the running CLI right away. YOLO shows in the warning colour.
export default function ModePicker({
  value,
  onChange,
  small = false,
  yolo = true,
  backend = "claude",
  disabled = false,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  small?: boolean;
  backend?: Backend;
  disabled?: boolean;
  // Hide full access for the copilot, which cannot skip permission prompts.
  yolo?: boolean;
}) {
  const mode = currentMode(backend, value);
  const options = visibleModes(backend, yolo, value);
  const loose = value === "bypassPermissions";
  return (
    <label
      data-human-only
      className={`relative flex items-center rounded-md border ${
        small ? "gap-1 py-px pl-1.5 pr-1 text-[11px]" : "gap-1.5 py-1.5 pl-2.5 pr-1.5 text-[12px]"
      } ${loose ? "border-warn/50 bg-warn-soft text-warn" : small ? "border-line text-muted" : "border-line-strong text-ink"}`}
      title={titleFor(disabled, mode?.hint ?? "")}
    >
      <Icon name={loose ? "zap" : "shield"} size={small ? 11 : 13} />
      <span className="sr-only">Permissions</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as PermissionMode)}
        className={`cursor-pointer appearance-none bg-transparent font-medium outline-none disabled:cursor-not-allowed ${small ? "pr-3.5" : "pr-4"}`}
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
