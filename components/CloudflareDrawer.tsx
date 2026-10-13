"use client";

import { useState } from "react";
import { restartWeft } from "@/lib/blastcp-view";
import {
  cloudflareActions,
  deployState,
  deployWhere,
  KIND_LABEL,
  needsRestart,
  shownFolders,
  sourceLine,
  TOKEN_URL,
  unlinkedLine,
  type CloudflareBridge,
  type CloudflareDeployment,
  type CloudflareFolder,
  type CloudflareLink,
  type CloudflareProject,
  type CloudflareStatus,
} from "@/lib/cloudflare-view";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import CloudflareLogo from "./CloudflareLogo";
import CloudflarePicker from "./CloudflarePicker";
import { Note } from "./VaultParts";

const TONE = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-danger-soft text-danger", muted: "bg-sunken text-muted" } as const;
const SMALL = "rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";
const BODY = "flex flex-col gap-2 px-3 py-3 text-[11.5px] leading-snug text-muted";

// The Cloudflare drawer's body (docs/architecture/cloudflare.md): your Cloudflare API token, kept by Electron
// main in the Keychain, and each board project's link to a Worker or Pages project (kept in Weft's data folder;
// the folder's wrangler config suggests one). The drawer shows the top bar's project, or all.
export default function CloudflareDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  onOpenUrl,
  notify,
}: {
  bridge: CloudflareBridge | null;
  status: CloudflareStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [projects, setProjects] = useState<CloudflareProject[] | null>(null);

  if (needsRestart(bridge, error)) return <Restart />;
  if (!bridge) return <Note>Cloudflare links live in Weft&apos;s desktop app, where Electron keeps your token in the Keychain.</Note>;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking Cloudflare…</Note>;

  const cloudflare = bridge;

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
            const { name } = await cloudflare.setToken(token);
            setProjects(null);
            notify(`Signed in to Cloudflare: ${name}`);
          })
        }
        onForget={status.signedIn ? () => void change(() => cloudflare.forgetToken()) : undefined}
      />
    );

  async function startPicking(folder: string) {
    setPicking(folder);
    if (projects) return;
    try {
      setProjects(await cloudflare.projects());
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate">Signed in · {status.user?.name}</span>
        <button onClick={() => void change(() => cloudflare.forgetToken())} disabled={busy} className={SMALL} title="Forget the token kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to Cloudflare.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <CloudflarePicker
              key={f.folder}
              folder={f}
              projects={projects}
              busy={busy}
              onPick={(p) =>
                change(async () => {
                  const { name } = await cloudflare.link(f.folder, p.kind, p.accountId, p.name);
                  setPicking(null);
                  notify(`Linked ${folderName(f.folder)} to ${name} on Cloudflare`);
                })
              }
              onCancel={() => setPicking(null)}
            />
          ) : (
            <FolderSection key={f.folder} folder={f} busy={busy} onLink={() => void startPicking(f.folder)} onUnlink={() => void change(() => cloudflare.unlink(f.folder))} onOpenUrl={onOpenUrl} />
          ),
        )}
      </div>
    </div>
  );
}

// The board's Weft started before Cloudflare was added: its main side arrives with a restart.
function Restart() {
  const [asked, setAsked] = useState(false);
  return (
    <div className={BODY}>
      <p className="text-[12px] font-medium text-ink">Restart Weft to turn on Cloudflare</p>
      <p>Cloudflare was added after this Weft started. Restart once, then come back here and add a token. Running cards pick up where they left off.</p>
      <div>
        <button onClick={() => setAsked(restartWeft())} disabled={asked} className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-on-accent disabled:opacity-40">
          {asked ? "Restarting…" : "Restart Weft"}
        </button>
      </div>
      {asked && <p className="text-faint">If Weft closes instead of coming back, open it again.</p>}
    </div>
  );
}

function TokenForm({ error, busy, onSave, onForget }: { error: string | null; busy: boolean; onSave: (token: string) => Promise<void>; onForget?: () => void }) {
  const [token, setToken] = useState("");
  return (
    <form
      className={BODY}
      onSubmit={(e) => {
        e.preventDefault();
        if (token.trim()) void onSave(token).then(() => setToken(""));
      }}
    >
      {error && <p className="rounded-md bg-danger-soft px-2 py-1.5 text-danger">{error}</p>}
      <p>
        Link this project to a Cloudflare Worker or Pages project with an API token from{" "}
        <a
          href={TOKEN_URL}
          onClick={(e) => {
            e.preventDefault();
            window.threadboard?.openExternal(TOKEN_URL);
          }}
          className="text-accent underline"
        >
          dash.cloudflare.com/profile/api-tokens
        </a>
        . The &ldquo;Edit Cloudflare Workers&rdquo; template covers it. Weft keeps it in your Keychain; threads never see it.
      </p>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Cloudflare API token"
        aria-label="Cloudflare API token"
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

function FolderSection({ folder: f, busy, onLink, onUnlink, onOpenUrl }: { folder: CloudflareFolder; busy: boolean; onLink: () => void; onUnlink: () => void; onOpenUrl: (url: string) => void }) {
  const link = f.link;
  return (
    <section className="mt-2 rounded-lg border border-line bg-card px-2.5 py-2">
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={f.folder}>
          {folderName(f.folder)}
        </h3>
        {link ? (
          <button onClick={onUnlink} disabled={busy} className={SMALL} title="Forget this link; the Cloudflare project stays">
            Unlink
          </button>
        ) : (
          <button onClick={onLink} disabled={busy} className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40">
            Link…
          </button>
        )}
      </div>
      {!link && <p className="mt-0.5 text-[11px] text-faint">{unlinkedLine(f)}</p>}
      {link && f.error && (
        <p className="mt-1 text-[11px] text-danger">
          {link.name}: {f.error}
        </p>
      )}
      {link && !f.error && <Linked link={link} folder={f} onOpenUrl={onOpenUrl} />}
    </section>
  );
}

function Linked({ link, folder, onOpenUrl }: { link: CloudflareLink; folder: CloudflareFolder; onOpenUrl: (url: string) => void }) {
  const source = sourceLine(link, folder);
  const { url } = link;
  const actions = cloudflareActions(link);
  return (
    <div className="mt-1 space-y-1 text-[11px] text-muted">
      <div className="flex items-center gap-1.5">
        <CloudflareLogo size={13} />
        <span className="text-[12px] text-ink">{link.name}</span>
        <span className="truncate text-faint">
          {KIND_LABEL[link.kind]}
          {link.account ? ` · ${link.account}` : ""}
        </span>
      </div>
      {url && (
        <button onClick={() => onOpenUrl(url)} className="block max-w-full truncate text-left text-accent hover:underline" title="Open in the browser pane">
          {url.replace(/^https:\/\//, "")}
        </button>
      )}
      {link.latest ? <Deploy deploy={link.latest} onOpenUrl={onOpenUrl} /> : <p className="text-faint">No deploys yet</p>}
      {source && <p className={source.warn ? "text-warn" : ""}>{source.text}</p>}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
          {actions.map((a) => (
            <button key={a.label} onClick={() => window.threadboard?.openExternal(a.url)} className="text-faint hover:text-ink" title={a.url}>
              {a.label} ↗
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The latest deploy: its state, where it went (or what made it), how long ago, and a way to open it.
function Deploy({ deploy, onOpenUrl }: { deploy: CloudflareDeployment; onOpenUrl: (url: string) => void }) {
  const now = useNow();
  const state = deployState(deploy.state);
  const { url } = deploy;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`rounded px-1 text-[10px] leading-[15px] ${TONE[state.tone]}`} title={deploy.stage ?? undefined}>
        {state.label}
      </span>
      <span className="text-faint">
        {deployWhere(deploy)} · {timeAgo(deploy.createdAt, now)}
      </span>
      {url && (
        <button onClick={() => onOpenUrl(url)} className="ml-auto text-faint hover:text-ink" title="Open this deploy in the browser pane">
          open
        </button>
      )}
    </div>
  );
}
