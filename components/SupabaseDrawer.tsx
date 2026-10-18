"use client";

import { useState } from "react";
import { folderName } from "@/lib/format";
import type { Card } from "@/lib/types";
import {
  needsRestart,
  shownFolders,
  signedInLine,
  TOKEN_URL,
  type SupabaseBridge,
  type SupabaseFolder,
  type SupabaseOrg,
  type SupabaseProject,
  type SupabaseStatus,
} from "@/lib/supabase-view";
import SupabaseLinked from "./SupabaseLinked";
import SupabasePicker from "./SupabasePicker";
import { external, SMALL } from "./supabase-ui";
import { Note } from "./VaultParts";

// The Supabase drawer's body (docs/architecture/supabase.md): your Supabase access token, kept by Electron main
// in the Keychain, and each board project's link to a Supabase project, written as supabase/.temp/project-ref
// so the Supabase CLI in a thread works on the right project. The drawer shows the top bar's project, or all.
export default function SupabaseDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  cards,
  onOpenCard,
  onStart,
  onOpenUrl,
  notify,
}: {
  bridge: SupabaseBridge | null;
  status: SupabaseStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // The board's cards, to link an unapplied migration to the card that wrote it, and opening one.
  cards: Card[];
  onOpenCard: (card: Card) => void;
  // Starts a card in a folder (the Migrate card); rejects when that fails.
  onStart: (cwd: string, prompt: string, title: string) => Promise<string | undefined>;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [projects, setProjects] = useState<SupabaseProject[] | null>(null);
  const [orgs, setOrgs] = useState<SupabaseOrg[] | null>(null);

  const shell = typeof window !== "undefined" ? window.weft : undefined;
  if (needsRestart(Boolean(shell), bridge, error)) return <Restart />;
  if (!bridge) return <Note>Supabase links live in Weft&apos;s desktop app, where Electron keeps your token in the Keychain.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking Supabase…</Note>;

  const supabase = bridge;

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

  if (!status.signedIn || status.error)
    return (
      <TokenForm
        error={status.error}
        busy={busy}
        onSave={(token) =>
          change(async () => {
            const { orgs } = await supabase.setToken(token);
            setProjects(null);
            setOrgs(null);
            notify(`Signed in to Supabase${orgs.length ? ` (${orgs.join(", ")})` : ""}`);
          })
        }
        onForget={status.signedIn ? () => void change(() => supabase.forgetToken()) : undefined}
      />
    );

  async function startPicking(folder: string) {
    setPicking(folder);
    if (projects && orgs) return;
    try {
      // No orgs (a Weft started before New project, or Supabase failing) leaves Link… working and New project saying why.
      const [list, known] = await Promise.all([supabase.projects(), supabase.orgs().catch(() => [])]);
      setProjects(list);
      setOrgs(known);
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate" title={status.orgs?.join(", ")}>
          {signedInLine(status.orgs)}
        </span>
        <button onClick={() => void change(() => supabase.forgetToken())} disabled={busy} className={SMALL} title="Forget the token kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to Supabase.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <SupabasePicker
              key={f.folder}
              folder={f}
              projects={projects}
              orgs={orgs}
              busy={busy}
              onPick={(p) =>
                change(async () => {
                  const { name } = await supabase.link(f.folder, p.ref);
                  setPicking(null);
                  notify(`Linked ${folderName(f.folder)} to ${name} on Supabase`);
                })
              }
              onCreate={(p) =>
                change(async () => {
                  const { name, secret } = await supabase.create(f.folder, p);
                  setPicking(null);
                  setProjects(null);
                  notify(`Made ${name} on Supabase and linked ${folderName(f.folder)}; its database password is in the 🔐 vault as ${secret}. It takes a minute or two to start.`);
                })
              }
              onCancel={() => setPicking(null)}
            />
          ) : (
            <FolderSection
              key={f.folder}
              folder={f}
              busy={busy}
              onLink={() => void startPicking(f.folder)}
              onUnlink={() => void change(() => supabase.unlink(f.folder))}
              onRestore={(ref) =>
                void change(async () => {
                  await supabase.restore(ref);
                  notify("Supabase is waking the project; it takes a few minutes");
                })
              }
              onOpenUrl={onOpenUrl}
              cards={cards}
              onOpenCard={onOpenCard}
              onStart={(cwd, prompt, title) => void onStart(cwd, prompt, title).catch(notify)}
            />
          ),
        )}
      </div>
    </div>
  );
}

// Supabase arrived after this Weft started: one restart loads its side of main.
function Restart() {
  const [asked, setAsked] = useState(false);
  return (
    <div className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted">
      <p className="text-[12px] font-medium text-ink">Restart Weft to turn on Supabase</p>
      <p>Supabase was added after this Weft started. Restart once, then come back here to add your token. Running cards pick up where they left off.</p>
      <div>
        <button
          onClick={() => {
            window.weft?.splashAction?.("relaunch");
            setAsked(true);
          }}
          disabled={asked}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40"
        >
          {asked ? "Restarting…" : "Restart Weft"}
        </button>
      </div>
    </div>
  );
}

function TokenForm({ error, busy, onSave, onForget }: { error: string | null; busy: boolean; onSave: (token: string) => Promise<void>; onForget?: () => void }) {
  const [token, setToken] = useState("");
  return (
    <form
      className="flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) void onSave(token).then(() => setToken(""));
      }}
    >
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p>
        Link this project to Supabase with an access token from{" "}
        <a
          href={TOKEN_URL}
          onClick={(e) => {
            e.preventDefault();
            external(TOKEN_URL);
          }}
          className="text-accent underline"
        >
          supabase.com/dashboard/account/tokens
        </a>
        . Weft keeps it in your Keychain; threads never see it.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="sbp_…"
        aria-label="Supabase access token"
        autoComplete="off"
        className="rounded-md border border-line-strong bg-card px-2 py-1 text-[12px] text-ink"
      />
      <div className="flex gap-1.5">
        <button type="submit" disabled={busy || !token.trim()} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {busy ? "Checking…" : "Save token"}
        </button>
        {onForget && (
          <button type="button" onClick={onForget} disabled={busy} className={SMALL}>
            Forget it
          </button>
        )}
      </div>
    </form>
  );
}

function FolderSection({
  folder: f,
  busy,
  onLink,
  onUnlink,
  onRestore,
  onOpenUrl,
  cards,
  onOpenCard,
  onStart,
}: {
  folder: SupabaseFolder;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
  onRestore: (ref: string) => void;
  onOpenUrl: (url: string) => void;
  cards: Card[];
  onOpenCard: (card: Card) => void;
  onStart: (cwd: string, prompt: string, title: string) => void;
}) {
  const link = f.link;
  return (
    <section className="mt-2 rounded-lg border border-line bg-card px-2.5 py-2">
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={f.folder}>
          {folderName(f.folder)}
        </h3>
        {!link ? (
          <button onClick={onLink} disabled={busy} className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40">
            Link…
          </button>
        ) : link.source === "cli" ? (
          <button onClick={onUnlink} disabled={busy} className={SMALL} title="Remove supabase/.temp/project-ref from this folder">
            Unlink
          </button>
        ) : (
          <button onClick={onLink} disabled={busy} className={SMALL} title="Linked by the Supabase server in .mcp.json; link it for the Supabase CLI too">
            Link CLI…
          </button>
        )}
      </div>
      {!link && <p className="mt-0.5 text-[11px] text-faint">{f.migrations ? `${f.migrations} local migrations · not linked` : "Not linked to a Supabase project"}</p>}
      {link && f.error && (
        <p className="mt-1 text-[11px] text-danger">
          {link.name ?? link.ref}: {f.error}
        </p>
      )}
      {link && !f.error && <SupabaseLinked folder={f} link={link} busy={busy} onRestore={onRestore} onOpenUrl={onOpenUrl} cards={cards} onOpenCard={onOpenCard} onStart={onStart} />}
    </section>
  );
}
