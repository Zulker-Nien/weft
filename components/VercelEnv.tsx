"use client";

import { useCallback, useEffect, useState } from "react";
import { ENV_SHORT, envLine, pushText, toPush, type VercelBridge, type VercelEnvRow, type VercelEnvStatus } from "@/lib/vercel-view";

// A linked project's 🔐 secrets against its Vercel variables (electron/vercel-env.cjs), under its deploy in the ▲
// drawer. Push sends one vault value to Vercel inside Electron main after Touch ID; the board sees names only.
export default function VercelEnv({ folder, bridge, notify }: { folder: string; bridge: VercelBridge; notify: (err: unknown) => void }) {
  const [env, setEnv] = useState<VercelEnvStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const status = bridge.envStatus;

  const load = useCallback(() => {
    if (!status) return Promise.resolve();
    return status(folder).then(
      (s) => {
        setEnv(s);
        setError(null);
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, [status, folder]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status || !bridge.envPush) return <p className="text-faint">Restart Weft to push 🔐 secrets to Vercel</p>;
  if (error) return <p className="text-danger">Secrets: {error}</p>;
  if (!env) return <p className="text-faint">Secrets: checking…</p>;

  const push = bridge.envPush;
  // Opens by itself when there's something to push, until you toggle it.
  const shown = open ?? toPush(env.rows).length > 0;

  async function send(row: VercelEnvRow) {
    const key = `${row.environment}\n${row.name}`;
    setBusy(key);
    try {
      notify(pushText(row.name, row.environment, await push(folder, row.name, row.environment)));
      await load();
    } catch (err) {
      notify(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <button onClick={() => setOpen(!shown)} className="flex w-full items-center gap-1 text-left hover:text-ink" aria-expanded={shown}>
        <span aria-hidden>🔐</span>
        <span className="min-w-0 flex-1 truncate">{envLine(env.rows)}</span>
        <span aria-hidden className="text-faint">
          {shown ? "▾" : "▸"}
        </span>
      </button>
      {shown && (
        <ul className="mt-1 space-y-0.5">
          {env.rows.map((r) => (
            <li key={`${r.environment}\n${r.name}`} className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink" title={r.name}>
                {r.name}
              </span>
              <span className="text-[10px] text-faint">{ENV_SHORT[r.environment]}</span>
              <RowAction row={r} busy={busy === `${r.environment}\n${r.name}`} onPush={() => void send(r)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RowAction({ row, busy, onPush }: { row: VercelEnvRow; busy: boolean; onPush: () => void }) {
  if (!row.inVault) return <span className="text-[10px] text-faint">{row.onVercel ? "Vercel only" : "no value"}</span>;
  if (row.onVercel)
    return (
      <button onClick={onPush} disabled={busy} className="text-[10px] text-faint hover:text-ink disabled:opacity-40" title="Replace Vercel's value with the vault's (Touch ID)">
        {busy ? "Pushing…" : "on Vercel · push again"}
      </button>
    );
  return (
    <button onClick={onPush} disabled={busy} className="rounded bg-accent px-1.5 text-[10px] leading-[16px] font-medium text-on-accent disabled:opacity-40" title="Send the vault's value to Vercel (Touch ID)">
      {busy ? "Pushing…" : "Push"}
    </button>
  );
}
