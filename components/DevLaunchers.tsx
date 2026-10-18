"use client";

import { useEffect, useState } from "react";
import { launchedWord, launcherRow, pickCommand, type LauncherRow } from "@/lib/dev-launchers-view";
import { STATE_TONE } from "@/lib/services-view";
import type { DevLauncher } from "@/lib/types";
import Icon from "./Icon";

type Props = {
  // Already filtered to the board's project.
  launchers: DevLauncher[];
  launch: (cwd: string, command: string) => Promise<"started" | "restarted">;
  // Ends a run by its Services row id ("dev:<key>"); without it there's no Stop.
  stop?: (id: string) => Promise<void>;
  // Opens the card that started a run, when it is still on the board.
  onOpenCard?: (cardId: string) => void;
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
};

const BUTTON = "shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel disabled:opacity-50";

// How long a row's "✓ Restarted" chip stays after its click.
const FLASH_MS = 4000;

// The Services drawer's Dev servers section, first in the drawer: each working folder's dev command
// (found in its package.json, Procfile and the like), with Start, or Stop and Restart when Weft already
// runs it, and what happened: started or restarted, when, by which card, and whether it answers yet.
// Weft's own folder is listed last, as the board itself, with no buttons.
export default function DevLaunchers({ launchers, launch, stop, onOpenCard, onOpenUrl, notify }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ key: string; word: string } | null>(null);
  // The command each folder's row shows, when the user picked another than pickCommand's.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  if (!launchers.length) return null;
  const run = (key: string, work: () => Promise<string>) => () => {
    setBusy(key);
    void work()
      .then((word) => setFlash({ key, word }))
      .catch(notify)
      .finally(() => setBusy(null));
  };
  const go = (key: string, cwd: string, command: string) => run(key, () => launch(cwd, command).then(launchedWord));
  const end = (key: string, id: string) => run(key, () => (stop ? stop(id) : Promise.resolve()).then(() => "Stopped"));
  return (
    <section aria-label="Dev servers" className="border-b border-line px-1.5 pb-1.5">
      <h3 className="px-2 pt-1 pb-0.5 text-[10.5px] font-medium tracking-wide text-faint uppercase">Dev servers</h3>
      <ul className="flex flex-col gap-px">
        {launchers.map((l) => {
            const c = pickCommand(l, chosen[l.cwd]);
            const row = launcherRow(l.cwd, c, l.self, l.url);
            return (
              <li key={l.cwd} className="rounded-md px-2 py-1 text-[12px] hover:bg-sunken">
                <div className="flex items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-full ${STATE_TONE[row.state]}`} title={row.state} />
                  <span className="shrink-0 text-ink" title={l.cwd}>{row.folder}</span>
                  <CommandPick launcher={l} row={row} onPick={(command) => setChosen((prev) => ({ ...prev, [l.cwd]: command }))} />
                  {flash?.key === row.key && (
                    <span role="status" className="flex shrink-0 items-center gap-0.5 text-[11px] text-ok">
                      <Icon name="check" size={10} />
                      {flash.word}
                    </span>
                  )}
                  {stop && row.canStop && row.runId && (
                    <button type="button" disabled={busy === row.key} onClick={end(row.key, row.runId)} className={`${BUTTON} hover:text-danger`}>
                      Stop
                    </button>
                  )}
                  {row.action && (
                    <button type="button" disabled={busy === row.key} onClick={go(row.key, l.cwd, row.command)} className={`${BUTTON} hover:text-ink`}>
                      {busy === row.key ? "…" : row.action}
                    </button>
                  )}
                </div>
                <StatusLine row={row} onOpenCard={onOpenCard} onOpenUrl={onOpenUrl} />
              </li>
            );
          })}
      </ul>
    </section>
  );
}

// Weft's own address goes to the system browser: the pane won't show Weft inside itself.
function openOutside(url: string) {
  if (window.weft) window.weft.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

// The folder's command: a select when it has several, else the command itself.
function CommandPick({ launcher, row, onPick }: { launcher: DevLauncher; row: LauncherRow; onPick: (command: string) => void }) {
  if (launcher.commands.length < 2) return <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={`${row.command} (${row.label})`}>{row.command}</span>;
  return (
    <select aria-label={`Dev command for ${row.folder}`} value={row.command} onChange={(e) => onPick(e.target.value)} className="min-w-0 flex-1 truncate bg-transparent font-mono text-[11px] text-muted hover:text-ink">
      {launcher.commands.map((o) => (
        <option key={o.command} value={o.command}>
          {o.command}
        </option>
      ))}
    </select>
  );
}

// The row's second line: what happened and when, the card that started it, and its url.
function StatusLine({ row, onOpenCard, onOpenUrl }: { row: LauncherRow; onOpenCard?: (cardId: string) => void; onOpenUrl: (url: string) => void }) {
  const url = row.live ? row.url : undefined;
  if (!row.status && !url) return null;
  const owner = onOpenCard && row.owner;
  return (
    <div className="flex items-center gap-1 pl-3.5 text-[11px] text-muted">
      <span className={`min-w-0 flex-1 truncate ${row.state === "failed" ? "text-danger" : ""}`} title={row.status}>
        {row.status}
        {owner && (
          <>
            {" · by "}
            <button type="button" onClick={() => onOpenCard(owner.cardId)} className="rounded text-accent hover:underline" title={`Open the card ${owner.title}`}>
              {owner.title}
            </button>
          </>
        )}
      </span>
      {url && (
        <button type="button" onClick={() => (row.self ? openOutside(url) : onOpenUrl(url))} className="shrink-0 rounded px-1 text-accent hover:bg-panel" title={row.self ? `Open ${url} in your browser` : `Open ${url} in the browser pane`}>
          {url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)/, "")}
          {row.self && " ↗"}
        </button>
      )}
    </div>
  );
}
