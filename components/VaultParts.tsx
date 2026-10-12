"use client";

import { useState } from "react";
import {
  ENVIRONMENTS,
  filterOptions,
  importGroups,
  importLabel,
  pickKey,
  STATUS_LABEL,
  toggleEnvironment,
  trackedWarning,
  validName,
  type ImportScan,
  type VaultEnvironment,
  type VaultSummary,
} from "@/lib/vault-view";
import Icon from "./Icon";

// The pieces of the 🔐 drawer (components/VaultDrawer.tsx): the form that types a secret in, the project
// filter, and the .env import's preview. A secret's row is components/SecretRow.tsx.

// A secret being added to one or more environments (fixed false), or given a new value (fixed true: name
// and its one environment stay).
export interface Editing {
  vault: string;
  folder: string;
  name: string;
  environments: VaultEnvironment[];
  value: string;
  fixed: boolean;
}

// The three environments as toggles, in any combination. only limits which can be ticked: removing a
// secret offers just the environments it's in (components/RemoveSecretDialog.tsx).
export function EnvironmentPicker({
  value,
  onChange,
  only,
  disabled = false,
}: {
  value: VaultEnvironment[];
  onChange: (next: VaultEnvironment[]) => void;
  only?: VaultEnvironment[];
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Environments" className="flex gap-1">
      {ENVIRONMENTS.map((env) => {
        const on = value.includes(env.id);
        return (
          <button
            key={env.id}
            type="button"
            aria-pressed={on}
            disabled={disabled || (only !== undefined && !only.includes(env.id))}
            onClick={() => onChange(toggleEnvironment(value, env.id))}
            className={`flex-1 rounded-md border px-1 py-0.5 text-[11px] disabled:opacity-40 ${on ? "border-accent bg-accent/15 text-ink" : "border-line-strong text-muted hover:text-ink"}`}
          >
            {env.label}
          </button>
        );
      })}
    </div>
  );
}

// Typing a secret in: its name, the environments it goes into (as many as you tick; fixed when changing
// one), and the value, hidden unless you show it. Enter saves, Escape cancels (the drawer listens for it).
export function SecretForm({
  editing,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  editing: Editing;
  busy: boolean;
  onChange: (next: Editing) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [show, setShow] = useState(false);
  const name = editing.name.trim();
  const badName = name !== "" && !validName(name);
  const ready = validName(name) && editing.environments.length > 0 && editing.value !== "" && !busy;
  const field = "w-full rounded-md border border-line-strong bg-card px-2 py-1 text-[12px] text-ink outline-none focus:border-accent disabled:opacity-60";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave();
      }}
      className="mx-1 mt-1.5 flex flex-col gap-2 rounded-md border border-line bg-sunken p-2.5"
    >
      <input
        value={editing.name}
        onChange={(e) => onChange({ ...editing, name: e.target.value })}
        disabled={editing.fixed}
        autoFocus={!editing.fixed}
        placeholder="NAME"
        aria-label="Name"
        title={editing.name}
        spellCheck={false}
        autoComplete="off"
        className={`${field} font-mono ${badName ? "border-warn" : ""}`}
      />
      {badName && <p className="-mt-1 text-[10.5px] leading-snug text-warn">Letters, digits and _, not starting with a digit.</p>}
      <EnvironmentPicker value={editing.environments} disabled={editing.fixed} onChange={(environments) => onChange({ ...editing, environments })} />
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={editing.value}
          onChange={(e) => onChange({ ...editing, value: e.target.value })}
          autoFocus={editing.fixed}
          placeholder={editing.fixed ? "New value" : "Value"}
          aria-label="Value"
          data-secret
          spellCheck={false}
          autoComplete="off"
          className={`${field} pr-6 font-mono`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "Hide value" : "Show value"}
          title={show ? "Hide" : "Show"}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
        >
          <Icon name="eye" size={12} />
        </button>
      </div>
      <div className="flex gap-1.5">
        <button type="submit" disabled={!ready} className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50">
          {editing.fixed ? "Save" : editing.environments.length > 1 ? `Add to ${editing.environments.length} environments` : "Add to vault"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-card hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

// The import's preview: every name in the project's .env files, ticked by default where it's new or changed.
export function ImportPreview({
  scan,
  picked,
  busy,
  onToggle,
  onImport,
  onClose,
  manage,
  onManage,
}: {
  scan: ImportScan;
  picked: Set<string>;
  busy: boolean;
  onToggle: (key: string) => void;
  onImport: () => void;
  onClose: () => void;
  // Offered (true or false) when the project has a .env.local Weft doesn't write yet: on, Weft takes it over
  // after the import. null hides it.
  manage?: boolean | null;
  onManage?: (on: boolean) => void;
}) {
  const warning = trackedWarning(scan);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2 text-[12px]">
        <button onClick={onClose} aria-label="Back" className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink">
          <Icon name="back" size={13} />
        </button>
        <span className="min-w-0 flex-1 truncate font-medium text-ink">Import into {scan.label}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {warning && <p className="mx-1 mt-2 rounded-md border border-warn/40 bg-warn-soft px-2 py-1.5 text-[11px] leading-snug text-warn">{warning}</p>}
        {scan.rows.length === 0 && <Note>No .env files here (looked in the folder, apps/* and packages/*).</Note>}
        {importGroups(scan).map((group) => (
          <section key={group.file}>
            <h3 className="px-1.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
              {group.file} · {group.namesOnly ? "names only" : group.environment}
            </h3>
            {group.rows.map((row) => (
              <label
                key={pickKey(row)}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11.5px] hover:bg-sunken ${row.skipped ? "opacity-50" : ""}`}
              >
                <input type="checkbox" checked={picked.has(pickKey(row))} onChange={() => onToggle(pickKey(row))} className="accent-[var(--color-accent)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={row.name}>
                  {row.name}
                </span>
                {row.public && <Tag>public</Tag>}
                {row.tail && <span className="font-mono text-[10.5px] text-faint">••••{row.tail}</span>}
                <Tag tone={row.status === "differs" || row.status === "missing" ? "warn" : row.status === "new" ? "accent" : undefined}>
                  {row.skipped ? "short-lived" : STATUS_LABEL[row.status]}
                </Tag>
              </label>
            ))}
          </section>
        ))}
      </div>
      {typeof manage === "boolean" && (
        <label
          className="flex items-start gap-1.5 border-t border-line px-3 pt-2 text-[11px] leading-snug text-muted"
          title="Weft rewrites .env.local from the vault (gitignored, readable only by you) and offers to import your hand edits."
        >
          <input type="checkbox" checked={manage} onChange={(e) => onManage?.(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
          Then let Weft write .env.local from the vault
        </label>
      )}
      <div className={`flex gap-1.5 px-3 py-2 ${typeof manage === "boolean" ? "" : "border-t border-line"}`}>
        <button
          onClick={onImport}
          disabled={busy || picked.size === 0}
          className="flex-1 rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50"
        >
          {importLabel(picked.size)}
        </button>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunken hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-4 text-center text-[11.5px] leading-snug text-faint">{children}</p>;
}

export function Tag({ children, tone }: { children: React.ReactNode; tone?: "warn" | "accent" }) {
  const color = tone === "warn" ? "bg-warn-soft text-warn" : tone === "accent" ? "bg-accent-soft text-accent" : "bg-sunken text-muted";
  return <span className={`shrink-0 rounded px-1 text-[10px] leading-[15px] ${color}`}>{children}</span>;
}

// The drawer's "Filter by project": follows the top bar's project until you pick here (picked). Hidden
// with only one project on the board.
export function ProjectFilter({
  vaults,
  value,
  picked,
  onPick,
}: {
  vaults: VaultSummary[];
  value: string;
  picked: boolean;
  onPick: (folder: string | null) => void;
}) {
  if (vaults.length < 2) return null;
  return (
    <label className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-muted">
      <span className="shrink-0">Project</span>
      <select
        value={value}
        onChange={(e) => onPick(e.target.value || null)}
        aria-label="Filter by project"
        title={picked ? "Picked here; choosing a project in the top bar sets it again" : "Follows the project picked in the top bar"}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-card px-1.5 py-0.5 text-[11.5px] text-ink"
      >
        {filterOptions(vaults).map((o) => (
          <option key={o.folder} value={o.folder}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
