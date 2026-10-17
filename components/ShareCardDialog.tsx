"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CopyLinkButton, ShareAccessFields, ShareDialog, useShareAccess, type SaveShareAccess } from "@aimhuge/share/client";
import { api } from "@/lib/client";
import { isCardShareMode, type CardShareState } from "@/lib/share-types";
import type { Card } from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import { useEscape } from "@/lib/use-escape";
import { openTeamPage } from "./board-palette";
import Icon, { Spinner } from "./Icon";

// Share… (the card's right-click menu): one weft.zip link that shows this thread and its browser pane, live,
// behind one of @aimhuge/share's modes (never editing: that would run turns on this Mac). The link reads the
// card from cloud sync, so until the card is on Supabase the dialog says why and offers the next step
// (lib/card-share.ts answers the state). The package's dialog draws the frame and closes on Escape itself.
const POLL_MS = 2000;

const BUTTON = "flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-60";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function ShareCardDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const [state, setState] = useState<CardShareState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const account = useAccount();
  const userId = account.state.kind === "ready" ? account.state.view.user?.id : undefined;

  // The package's ShareDialog listens for Escape on its own. This layer only keeps Weft's own (the open thread,
  // the browser, a drawer under it) from also closing, so one Escape closes just the dialog.
  useEscape(true, () => {});

  const save: SaveShareAccess = async (next, password) => {
    if (!isCardShareMode(next.mode)) return { ok: false, error: "Threads can't be edited from a link." };
    try {
      const answer = await api.setShare(card.id, { mode: next.mode, password });
      setState(answer);
      return answer.kind === "ok" ? { ok: true } : { ok: false, error: "Sharing isn't available right now." };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  };
  const access = useShareAccess({ save });
  const { hydrate } = access;

  const load = useCallback(async () => {
    try {
      const answer = await api.getShare(card.id);
      setState(answer);
      setError(null);
      if (answer.kind === "ok") hydrate({ shareMode: answer.mode, editRequiresEmail: false, hasPassword: answer.hasPassword });
    } catch (err) {
      setError(message(err));
    }
  }, [card.id, hydrate]);

  // On open, and again once you sign in from here.
  useEffect(() => {
    const ask = () => void load();
    ask();
  }, [load, userId]);

  // The outbox flushes within seconds; ask again until the card's row is up.
  useEffect(() => {
    if (state?.kind !== "pending") return;
    const timer = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(timer);
  }, [state, load]);

  // Settings → Sync's switch for the card's folder (it also queues the folder's cards), then ask again.
  async function turnOnSync(folder: string) {
    try {
      await api.cloudSyncSetFolder(folder, true);
      await load();
    } catch (err) {
      setError(message(err));
    }
  }

  const url = state?.kind === "ok" ? state.url : null;
  return (
    <ShareDialog
      title={`Share “${card.title}”`}
      onClose={onClose}
      headerAction={url ? <CopyLinkButton size="sm" url={url} /> : undefined}
      footerStart={url ? <CopyLinkButton url={url} /> : undefined}
    >
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <ShareBody state={state} access={access} account={account} onSyncOn={turnOnSync} />
      )}
    </ShareDialog>
  );
}

function ShareBody({
  state,
  access,
  account,
  onSyncOn,
}: {
  state: CardShareState | null;
  access: ReturnType<typeof useShareAccess>;
  account: ReturnType<typeof useAccount>;
  onSyncOn: (folder: string) => Promise<void>;
}) {
  if (!state) return <Note>Loading…</Note>;
  switch (state.kind) {
    case "ok":
      return (
        <>
          <ShareAccessFields s={access} noun="thread" allowEdit={false} />
          <p className="mt-3 text-[12px] leading-snug text-muted">
            The link shows this thread and its browser pane, live. Key-shaped text is masked and long tool outputs stay on your Mac.
          </p>
        </>
      );
    case "not-synced":
      return <NotSynced folder={state.folder} onSyncOn={onSyncOn} />;
    case "pending":
      return (
        <Note>
          <Spinner size={13} /> Uploading this card…
        </Note>
      );
    case "signed-out":
      return <SignedOut account={account} />;
    case "no-workspace":
      return (
        <Note>
          Your account has no workspace yet. Make one at{" "}
          <button type="button" onClick={openTeamPage} className="text-accent underline">
            weft.zip/team
          </button>
          , then share from here.
        </Note>
      );
  }
}

function Note({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[13px] text-ink">{children}</p>;
}

function NotSynced({ folder, onSyncOn }: { folder: string; onSyncOn: (folder: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const name = folder.split("/").filter(Boolean).pop() ?? folder;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>A share link reads the card from cloud sync, and this folder doesn&apos;t sync yet.</p>
      <p className="text-[12px] leading-snug text-muted">
        Turning it on uploads every thread in {folder} to your workspace. Thread text is uploaded unencrypted for now: turn it on only
        for projects you&apos;re fine storing on Weft&apos;s servers.
      </p>
      <button
        type="button"
        disabled={busy}
        className={BUTTON}
        onClick={() => {
          setBusy(true);
          void onSyncOn(folder).finally(() => setBusy(false));
        }}
      >
        {busy ? <Spinner size={13} /> : <Icon name="globe" size={14} />}
        Turn on sync for {name}
      </button>
    </div>
  );
}

// The top bar's sign-in (components/AccountButton.tsx): GitHub, finished in your browser.
function SignedOut({ account }: { account: ReturnType<typeof useAccount> }) {
  const { busy, waiting, error, signIn } = account;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>Sign in to Weft to share.</p>
      <button type="button" disabled={busy !== null} className={BUTTON} onClick={() => void signIn("github")}>
        {busy === "github" || waiting ? <Spinner size={13} /> : <Icon name="github" size={14} />}
        {waiting ? "Signing in…" : "Sign in with GitHub"}
      </button>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
