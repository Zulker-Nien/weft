"use client";

import { useState } from "react";
import {
  countsLine,
  expiryNote,
  needsRestart,
  platformName,
  propertyOptions,
  queueOf,
  shownFolders,
  SITE,
  untilText,
  type BlastcpBridge,
  type BlastcpFolder,
  type BlastcpPost,
  type BlastcpStatus,
  type BlastcpWorkspace,
  type PropertyOption,
} from "@/lib/blastcp-view";
import { folderName, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { BlastcpConnect, BlastcpRestart, SMALL } from "./BlastcpConnect";
import BlastcpLogo from "./BlastcpLogo";
import { Note } from "./VaultParts";

// The posts a property shows coming up.
const NEXT = 4;

// The BlastCP drawer's body (docs/architecture/blastcp.md): your BlastCP sign-in, kept by Electron main in the
// Keychain, and the property each board project posts as, with what goes out next. Clicking a post opens
// its BlastCP page in the browser pane.
export default function BlastcpDrawer({
  bridge,
  status,
  error,
  reload,
  project,
  onOpenUrl,
  notify,
}: {
  bridge: BlastcpBridge | null;
  status: BlastcpStatus | null;
  error: string | null;
  reload: () => Promise<void>;
  project: string | null;
  // Shows a page in the board's browser pane.
  onOpenUrl: (url: string) => void;
  notify: (err: unknown) => void;
}) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<BlastcpWorkspace[] | null>(null);

  if (!bridge) return <Note>BlastCP lives in Weft&apos;s desktop app, where Electron keeps your sign-in in the Keychain.</Note>;
  if (needsRestart(error)) return <BlastcpRestart />;
  if (error) return <Note>{error}</Note>;
  if (!status) return <Note>Asking BlastCP…</Note>;

  const blastcp = bridge;

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

  const connect = () =>
    void change(async () => {
      const { email } = await blastcp.connect();
      setWorkspaces(null);
      notify(`Connected to BlastCP as ${email}`);
    });

  if (!status.signedIn || status.error)
    return <BlastcpConnect error={status.error} busy={busy} onConnect={connect} onForget={status.signedIn ? () => void change(() => blastcp.forget()) : undefined} />;

  async function startPicking(folder: string) {
    setPicking(folder);
    if (workspaces) return;
    try {
      setWorkspaces(await blastcp.workspaces());
    } catch (err) {
      setPicking(null);
      notify(err);
    }
  }

  const expiry = expiryNote(status.expiresAt, now);
  const shown = shownFolders(status.folders, project);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate" title={expiry ?? undefined}>
          {status.user?.email}
          {expiry && <span className="text-warn"> · {expiry}</span>}
        </span>
        {expiry && (
          <button onClick={connect} disabled={busy} className={SMALL}>
            Reconnect
          </button>
        )}
        <button onClick={() => void change(() => blastcp.forget())} disabled={busy} className={SMALL} title="Forget the sign-in kept in the Keychain">
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <Note>Add a project to the board to link it to a BlastCP property.</Note>}
        {shown.map((f) =>
          picking === f.folder ? (
            <Picker
              key={f.folder}
              folder={f.folder}
              workspaces={workspaces}
              busy={busy}
              onPick={(o) =>
                change(async () => {
                  const { name } = await blastcp.link(f.folder, o.org, o.slug, o.name);
                  setPicking(null);
                  notify(`${folderName(f.folder)} now posts as ${name} on BlastCP`);
                })
              }
              onCancel={() => setPicking(null)}
              onOpenUrl={onOpenUrl}
            />
          ) : (
            <FolderSection key={f.folder} folder={f} busy={busy} now={now} onLink={() => void startPicking(f.folder)} onUnlink={() => void change(() => blastcp.unlink(f.folder))} onOpenUrl={onOpenUrl} />
          ),
        )}
      </div>
    </div>
  );
}

function FolderSection({
  folder: f,
  busy,
  now,
  onLink,
  onUnlink,
  onOpenUrl,
}: {
  folder: BlastcpFolder;
  busy: boolean;
  now: number;
  onLink: () => void;
  onUnlink: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const link = f.link;
  return (
    <section className="mt-2 rounded-lg border border-line bg-card px-2.5 py-2">
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={f.folder}>
          {folderName(f.folder)}
        </h3>
        {link ? (
          <button onClick={onUnlink} disabled={busy} className={SMALL} title="Stop showing this property here (nothing changes on BlastCP)">
            Unlink
          </button>
        ) : (
          <button onClick={onLink} disabled={busy} className="rounded-md bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent disabled:opacity-40">
            Link…
          </button>
        )}
      </div>
      {!link && <p className="mt-0.5 text-[11px] text-faint">Not linked to a BlastCP property</p>}
      {link && (
        <div className="mt-1 space-y-1 text-[11px] text-muted">
          <button onClick={() => onOpenUrl(`${link.url}/queue`)} className="block max-w-full truncate text-left text-[12px] text-ink hover:underline" title="Open its queue in the browser pane">
            <BlastcpLogo size={12} /> {link.name} <span className="text-faint">· {link.org}</span>
          </button>
          {f.error ? <p className="text-danger">{f.error}</p> : f.posts ? <Queue posts={f.posts} now={now} draftsUrl={`${link.url}/drafts`} onOpenUrl={onOpenUrl} /> : <p className="text-faint">Loading posts…</p>}
        </div>
      )}
    </section>
  );
}

function Queue({ posts, now, draftsUrl, onOpenUrl }: { posts: BlastcpPost[]; now: number; draftsUrl: string; onOpenUrl: (url: string) => void }) {
  const q = queueOf(posts, now);
  const counts = countsLine(q);
  return (
    <>
      {q.next.length === 0 ? (
        <p className="text-faint">Nothing scheduled</p>
      ) : (
        <ul className="space-y-0.5">
          {q.next.slice(0, NEXT).map((p) => (
            <li key={p.id}>
              <PostRow post={p} when={untilText(p.scheduledFor, now)} onOpenUrl={onOpenUrl} />
            </li>
          ))}
          {q.next.length > NEXT && <li className="text-faint">+{q.next.length - NEXT} more scheduled</li>}
        </ul>
      )}
      {counts && (
        <button onClick={() => onOpenUrl(draftsUrl)} className={q.failed ? "text-danger hover:underline" : "text-warn hover:underline"} title="Open drafts in the browser pane">
          {counts}
        </button>
      )}
      {q.last && <p className="truncate text-faint">Last out {timeAgo(q.last.publishedAt, now)}: {platformName(q.last.platform)}</p>}
    </>
  );
}

function PostRow({ post, when, onOpenUrl }: { post: BlastcpPost; when: string; onOpenUrl: (url: string) => void }) {
  const url = post.reviewUrl;
  return (
    <button onClick={() => url && onOpenUrl(url)} disabled={!url} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-sunken" title={post.title ?? undefined}>
      <span className="w-[52px] shrink-0 text-faint">{when}</span>
      <span className="shrink-0 rounded bg-sunken px-1 text-[10px] leading-[15px]">{platformName(post.platform)}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{post.title ?? "Untitled"}</span>
    </button>
  );
}

// Links a folder to one property in one of your workspaces.
function Picker({
  folder,
  workspaces,
  busy,
  onPick,
  onCancel,
  onOpenUrl,
}: {
  folder: string;
  workspaces: BlastcpWorkspace[] | null;
  busy: boolean;
  onPick: (o: PropertyOption) => Promise<void>;
  onCancel: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [search, setSearch] = useState("");
  const rows = workspaces ? propertyOptions(workspaces, folder, search) : [];
  const many = new Set(rows.map((r) => r.org)).size > 1;
  return (
    <section className="mt-2 rounded-lg border border-accent/40 bg-card px-2 py-2" aria-label={`Link ${folderName(folder)}`}>
      <div className="flex items-center gap-1 px-0.5">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">Link {folderName(folder)} to…</h3>
        <button onClick={onCancel} className={SMALL}>
          Cancel
        </button>
      </div>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Search properties"
        aria-label="Search BlastCP properties"
        className="mt-1.5 w-full rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-ink"
      />
      {!workspaces && <Note>Loading your BlastCP properties…</Note>}
      {workspaces && rows.length === 0 && (
        <Note>
          {search ? (
            "No property matches."
          ) : (
            <>
              No properties yet.{" "}
              <button onClick={() => onOpenUrl(SITE)} className="text-accent underline">
                Make one on BlastCP
              </button>
            </>
          )}
        </Note>
      )}
      <ul className="mt-1 max-h-[320px] overflow-y-auto">
        {rows.map((o) => (
          <li key={`${o.org}/${o.slug}`}>
            <button onClick={() => void onPick(o)} disabled={busy} className="w-full rounded px-1.5 py-1 text-left hover:bg-sunken disabled:opacity-40">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{o.name}</span>
                {o.score >= 2 && <span className="shrink-0 rounded bg-accent-soft px-1 text-[10px] leading-[15px] text-accent">best fit</span>}
              </span>
              <span className="block truncate text-[10.5px] text-faint">
                {o.slug}
                {many ? ` · ${o.orgName}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
