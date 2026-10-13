"use client";

import { useEffect, useState } from "react";
import { keyLabel } from "@/lib/hotkeys";
import { useEscape } from "@/lib/use-escape";
import { onSecretAsk, useIdle } from "@/lib/use-vault";
import {
  askedVault,
  copiedText,
  defaultPicks,
  environmentsOf,
  filterVaults,
  groupSecrets,
  nudgeText,
  picksOf,
  secretKey,
  secretMenu,
  manageOffer,
  takeOver,
  vaultFilter,
  type ImportScan,
  type SecretAction,
  type VaultBridge,
  type VaultFilterPick,
  type VaultOverview,
  type VaultSecret,
  type VaultSummary,
} from "@/lib/vault-view";
import Icon from "./Icon";
import RemoveSecretDialog from "./RemoveSecretDialog";
import { SecretRow, type RowAction } from "./SecretRow";
import { ImportPreview, Note, ProjectFilter, SecretForm, type Editing } from "./VaultParts";

// The 🔐 drawer's body (docs/architecture/secrets.md): every project's vault (filtered to the top bar's
// project unless you pick another), names by environment with masked tails, secrets typed in by hand or
// copied from another project, and the .env import with its preview. Values reach this page only from
// reveal, after Touch ID, or as you type them, and leave it again when the drawer sits idle.
export default function VaultDrawer({
  bridge,
  overview,
  error,
  reload,
  project,
  notify,
}: {
  bridge: VaultBridge | null;
  overview: VaultOverview | null;
  error: string | null;
  reload: () => Promise<void>;
  // The top bar's project, which the filter follows by default.
  project: string | null;
  // Shows an error or a short message as a toast.
  notify: (err: unknown) => void;
}) {
  const [importing, setImporting] = useState<{
    folder: string;
    scan: ImportScan;
    picked: Set<string>;
    // Offered when the project's .env.local isn't Weft's yet; null when there's nothing to offer.
    manage: boolean | null;
  } | null>(null);
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<VaultFilterPick | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // The secret whose environments the remove dialog is asking about.
  const [removing, setRemoving] = useState<{ v: VaultSummary; s: VaultSecret } | null>(null);

  const lock = () => {
    setRevealed(new Map());
    setUnlocked(false);
    setEditing(null);
    void bridge?.lock();
  };
  useIdle(unlocked || revealed.size > 0 || Boolean(editing?.value), lock);
  useEscape(Boolean(editing), () => setEditing(null));
  // ⇧S (lib/use-vault.ts): the Add form opens on the first vault shown, once there is one. A thread's ask
  // opens it in its project's vault, shown by the filter, with the name and environment filled in.
  useEffect(
    () =>
      onSecretAsk((ask) => {
        if (!overview) return false;
        const shown = filterVaults(overview.vaults, vaultFilter(project, pick));
        const v = askedVault(overview.vaults, shown, ask?.folder);
        if (!v) return false;
        if (!shown.includes(v)) setPick({ top: project, folder: v.folder });
        setEditing({ ...newSecret(v), ...(ask && { name: ask.name, environments: [ask.environment] }) });
        return true;
      }),
    [overview, project, pick],
  );

  if (!bridge) return <Note>The vault lives in Weft&apos;s desktop app, where Electron keeps its key in the Keychain.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!overview) return <Note>Opening the vault…</Note>;
  if (!overview.vaults.length) return <Note>Add a project to the board to keep its secrets here.</Note>;

  const vault = bridge;
  const all = overview.vaults;
  const filter = vaultFilter(project, pick);
  const shown = filterVaults(all, filter);
  // The select names a vault by its first folder, so a second clone of the same repo still selects it.
  const filterValue = (filter && shown[0]?.folder) || "";

  // Runs a change against the vault, then shows the vaults again; errors become a toast.
  async function change(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      await reload();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(false);
    }
  }

  async function startImport(v: VaultSummary) {
    try {
      const scan = await vault.scan(v.folder);
      setImporting({ folder: v.folder, scan, picked: defaultPicks(scan), manage: manageOffer(vault, scan, v.managed) });
    } catch (err) {
      notify(err);
    }
  }

  async function act(v: VaultSummary, s: VaultSecret, action: SecretAction | RowAction) {
    const key = `${v.id}\n${secretKey(s)}`;
    if (action === "choose-remove") {
      setRemoving({ v, s });
      return;
    }
    if (action === "edit") {
      setEditing({ vault: v.id, folder: v.folder, name: s.name, environments: [s.environment], value: "", fixed: true, from: s.environment, blank: s.missing });
      return;
    }
    if (action.startsWith("copy-to:"))
      return change(async () => {
        const result = await vault.copyTo(v.id, s.name, s.environment, action.slice("copy-to:".length));
        if ("copied" in result) notify(copiedText(s.name, result));
      });
    if (action === "remove") return change(() => vault.remove(v.id, s.name, s.environment));
    if (action === "reveal" && revealed.has(key)) {
      const next = new Map(revealed);
      next.delete(key);
      setRevealed(next);
      return;
    }
    try {
      const result = action === "reveal" ? await vault.reveal(v.id, s.name, s.environment) : await vault.copy(v.id, s.name, s.environment);
      if ("denied" in result) return;
      setUnlocked(true);
      if ("value" in result) setRevealed(new Map(revealed).set(key, result.value));
    } catch (err) {
      notify(err);
    }
  }

  async function menu(v: VaultSummary, s: VaultSecret, e: React.MouseEvent) {
    const shell = window.threadboard;
    if (!shell?.popupMenu) return;
    e.preventDefault();
    const others = all.filter((o) => o.id !== v.id);
    const picked = (await shell.popupMenu(secretMenu(s, others))) as SecretAction | null;
    // The menu's Remove from Vault… asks which environments, the same as 🗑 on a name in several.
    if (picked) await act(v, s, picked === "remove" ? "choose-remove" : picked);
  }

  if (importing) {
    const toggle = (key: string) => {
      const next = new Set(importing.picked);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setImporting({ ...importing, picked: next });
    };
    const finish = () =>
      change(async () => {
        await vault.import(importing.folder, picksOf(importing.scan, importing.picked));
        const took = await takeOver(vault, importing.folder, importing.manage);
        if (took) notify(took);
        setImporting(null);
      });
    return (
      <ImportPreview
        scan={importing.scan}
        picked={importing.picked}
        busy={busy}
        onToggle={toggle}
        onImport={() => void finish()}
        onClose={() => setImporting(null)}
        manage={importing.manage}
        onManage={(on) => setImporting({ ...importing, manage: on })}
      />
    );
  }

  const save = (e: Editing) =>
    change(async () => {
      const name = e.name.trim();
      // No value: a blank in each ticked environment, filled in later from 🔐. Unticking its own moves it out.
      for (const env of e.environments)
        await (e.value === "" && vault.addBlank ? vault.addBlank(e.folder, name, env) : vault.set(e.folder, name, env, e.value));
      if (e.fixed && e.from && !e.environments.includes(e.from)) await vault.remove(e.vault, name, e.from);
      setEditing(null);
    });
  const canBlank = Boolean(vault.addBlank);
  const form = editing && (
    <SecretForm editing={editing} busy={busy} canBlank={canBlank} onChange={setEditing} onSave={() => { void save(editing); }} onCancel={() => { setEditing(null); }} />
  );

  const remove = (r: typeof removing) =>
    r && (
      <RemoveSecretDialog
        name={r.s.name}
        environments={environmentsOf(r.v.secrets, r.s.name)}
        initial={r.s.environment}
        busy={busy}
        onRemove={(environments) =>
          void change(async () => {
            for (const env of environments) await vault.remove(r.v.id, r.s.name, env);
            setRemoving(null);
          })
        }
        onClose={() => setRemoving(null)}
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {remove(removing)}
      <ProjectFilter vaults={all} value={filterValue} picked={pick?.top === project} onPick={(folder) => setPick({ top: project, folder })} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.map((v) => (
          <VaultSection
            key={v.id}
            vault={v}
            editing={editing?.vault === v.id ? editing : null}
            form={form}
            revealed={revealed}
            onAdd={() => setEditing(newSecret(v))}
            onImport={() => void startImport(v)}
            onAct={(s, action) => void act(v, s, action)}
            onMenu={(s, e) => void menu(v, s, e)}
          />
        ))}
        {unlocked && (
          <button onClick={lock} className="mx-1 mt-3 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
            <Icon name="lock" size={11} /> Lock now
          </button>
        )}
      </div>
    </div>
  );
}

// The Add form's start: a new name for development in vault v.
const newSecret = (v: VaultSummary): Editing => ({ vault: v.id, folder: v.folder, name: "", environments: ["development"], value: "", fixed: false });

// One project's vault: its name with Add and Import…, the nudge, and its secrets by environment. editing is
// set when the form is open in this vault: at the top when adding, in place of the row when changing one.
function VaultSection({
  vault: v,
  editing,
  form,
  revealed,
  onAdd,
  onImport,
  onAct,
  onMenu,
}: {
  vault: VaultSummary;
  editing: Editing | null;
  form: React.ReactNode;
  revealed: Map<string, string>;
  onAdd: () => void;
  onImport: () => void;
  onAct: (s: VaultSecret, action: RowAction) => void;
  onMenu: (s: VaultSecret, e: React.MouseEvent) => void;
}) {
  const changing = (s: VaultSecret) => editing?.fixed && editing.name === s.name && editing.from === s.environment;
  return (
    <section className="mt-2">
      <div className="flex items-center gap-1 px-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={`${v.folders.join("\n")}${v.managed ? "\nWeft writes .env.local from this vault" : ""}`}>
          {v.label}
        </h3>
        <button
          onClick={onAdd}
          title={`Add a secret by hand (${keyLabel("shift+s")})`}
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
        >
          <Icon name="plus" size={11} /> Add
        </button>
        <button onClick={onImport} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink">
          Import…
        </button>
      </div>
      {editing && !editing.fixed && form}
      {v.nudge && (
        <button
          onClick={onImport}
          className="mx-1 mt-1.5 block w-[calc(100%-0.5rem)] rounded-md border border-accent/40 bg-accent-soft px-2 py-1.5 text-left text-[11px] leading-snug text-accent"
        >
          {nudgeText(v.nudge)}
        </button>
      )}
      {v.secrets.length === 0 && !v.nudge && !editing && <Note>No secrets yet. Add one, or import this project&apos;s .env files.</Note>}
      {groupSecrets(v.secrets).map((group) => (
        <div key={group.id}>
          <h4 className="px-1.5 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{group.label}</h4>
          {group.secrets.map((s) =>
            changing(s) ? (
              <div key={secretKey(s)}>{form}</div>
            ) : (
              <SecretRow
                key={secretKey(s)}
                secret={s}
                value={revealed.get(`${v.id}\n${secretKey(s)}`)}
                spread={environmentsOf(v.secrets, s.name).length > 1}
                onAct={(action) => onAct(s, action)}
                onMenu={(e) => onMenu(s, e)}
              />
            ),
          )}
        </div>
      ))}
    </section>
  );
}
