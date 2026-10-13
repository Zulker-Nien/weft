"use client";

import { useEffect, useState } from "react";
import { askAnswered, vaultBridge, type SecretAsk, type VaultEnvironment } from "@/lib/vault-view";
import Icon from "./Icon";
import { EnvironmentPicker } from "./VaultParts";

// A thread's mcp__secrets__ask_add, drawn in place of the tool call (docs/architecture/secrets.md): the key's name,
// its environments and a hidden value field, right where the user is reading. Add to vault hands the value to
// Electron main (the same vault.set as the 🔐 drawer) and tells the thread it's in; the value never reaches the
// thread. Once the vault has it, the input folds to a one-line ✓.
export default function SecretAskInput({ ask, onAdded }: { ask: SecretAsk; onAdded?: (text: string) => Promise<void> | void }) {
  const bridge = vaultBridge();
  const [state, setState] = useState<"checking" | "open" | "done">("checking");
  const [environments, setEnvironments] = useState<VaultEnvironment[]>([ask.environment]);
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let on = true;
    bridge.overview([ask.folder]).then(
      (o) => on && setState(askAnswered(o.vaults, ask) ? "done" : "open"),
      () => on && setState("open"),
    );
    return () => {
      on = false;
    };
  }, [bridge, ask]);

  const line = "flex items-center gap-2 rounded-md border border-line bg-sunken px-2.5 py-1.5 text-[12px] text-muted";
  const name = <code className="font-mono font-medium text-ink">{ask.name}</code>;
  if (!bridge)
    return (
      <div className={line}>
        <Icon name="lock" size={12} className="text-warn" />
        <span>Claude needs {name}: add it with 🔐 on the board&apos;s left rail.</span>
      </div>
    );
  if (state === "checking") return null;
  if (state === "done")
    return (
      <div className={line}>
        <Icon name="lock" size={12} className="text-ok" />
        <span>{name} is in the 🔐 vault</span>
        <span className="text-ok">✓</span>
      </div>
    );

  async function add() {
    if (!bridge || !value || !environments.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      for (const env of environments) await bridge.set(ask.folder, ask.name, env, value);
      setValue("");
      setState("done");
      await onAdded?.(`I added ${ask.name} (${environments.join(", ")}) to the 🔐 vault.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      aria-label={`Add ${ask.name} to the vault`}
      className="flex w-[22rem] max-w-full flex-col gap-2 rounded-lg border border-accent/50 bg-sunken p-2.5"
    >
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Icon name="lock" size={12} className="text-warn" />
        <span className="min-w-0 flex-1 truncate">Claude needs {name}</span>
      </div>
      <EnvironmentPicker value={environments} onChange={setEnvironments} />
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          placeholder="Paste the value"
          aria-label="Value"
          data-secret
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded-md border border-line-strong bg-card px-2 py-1 pr-6 font-mono text-[12px] text-ink outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "Hide value" : "Show value"}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
        >
          <Icon name="eye" size={12} />
        </button>
      </div>
      {error && <p className="text-[11px] leading-snug text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!value || !environments.length || busy}
        className="rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-on-accent disabled:opacity-50"
      >
        {environments.length > 1 ? `Add to ${environments.length} environments` : "Add to vault"}
      </button>
      <p className="text-[10.5px] leading-snug text-faint">Goes straight into the vault; Claude never sees it.</p>
    </form>
  );
}
