// The shell every provider drawer draws one linked folder in: the bordered card, the folder's name
// and its Link/Unlink buttons on one line, the "not linked yet" line, and the red line for a link
// that failed to read. Four drawers wrote this shape out (Vercel, Supabase, Cloudflare, BlastCP);
// only the middle differs — the linked project's details — so that part arrives as children.
// Github's drawer keeps its own: it has no Link/Unlink pair and no link object, just a sync switch.
import { folderName } from "@/lib/format";
import { LINK, SMALL } from "./tone";

// What a row's own action button offers. `linked` picks between Unlink and Link…; Supabase has a
// third state, a link the server made that the CLI can't use yet, so it passes its own button.
export interface FolderAction {
  linked: boolean;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
  // The tooltip on Unlink, saying what removing the link leaves alone.
  unlinkTitle: string;
  // Shown instead of the Unlink/Link pair when set, for Supabase's "Link CLI…" state.
  extra?: React.ReactNode;
}

export interface FolderRowProps extends FolderAction {
  // The folder's full path; the row shows its last segment and keeps the rest in the title.
  folder: string;
  // The line under the title while there's no link yet ("Not linked to a Vercel project").
  unlinked: string;
  // A link that exists but couldn't be read: its name and the reason, in red. The link is still
  // unlinked by the Unlink button, so a broken link can be cleared.
  error?: { name: string; message: string } | null;
}

export function FolderRow({ folder, linked, busy, onLink, onUnlink, unlinkTitle, extra, unlinked, error, children }: FolderRowProps & { children?: React.ReactNode }) {
  return (
    <section className="mt-2 rounded-lg border border-line bg-card px-2.5 py-2">
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink" title={folder}>
          {folderName(folder)}
        </h3>
        {extra ??
          (linked ? (
            <button onClick={onUnlink} disabled={busy} className={SMALL} title={unlinkTitle}>
              Unlink
            </button>
          ) : (
            <button onClick={onLink} disabled={busy} className={LINK}>
              Link…
            </button>
          ))}
      </div>
      {!linked && <p className="mt-0.5 text-[11px] text-faint">{unlinked}</p>}
      {linked && error && (
        <p className="mt-1 text-[11px] text-danger">
          {error.name}: {error.message}
        </p>
      )}
      {linked && !error && children}
    </section>
  );
}