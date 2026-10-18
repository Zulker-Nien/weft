"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CopyLinkButton, ShareAccessFields, ShareDialog, useShareAccess, type SaveShareAccess } from "@aimhuge/share/client";
import { seedAppShareState, type AppShareState } from "@/lib/app-share-types";
import type { MiniApp } from "@/lib/mini-apps";
import { useOverlay } from "@/lib/overlay";
import { isCardShareMode } from "@/lib/share-types";
import { useAccount } from "@/lib/use-account";
import { useEscape } from "@/lib/use-escape";
import { appsApi, reloadApps } from "@/lib/use-mini-apps";
import { errorText, NoWorkspace, ShareNote, SignedOut } from "./ShareParts";

// Share… on a mini app (its right-click menu on the rail, its share button in My mini apps): one weft.zip/a/<id> link
// that shows the app's page, behind the same @aimhuge/share modes as a card (never editing). lib/app-share.ts answers the
// state: a local page goes up as a copy, a public https site is framed as is, and a page only this Mac reaches says why
// it can't be shared. Like the card's dialog it never waits: it draws from the share the app remembers (app.share) and
// the answer replaces it, goes to document.body over the whole window, and steps the native browser pane aside.

function hydrateFrom(state: AppShareState, hydrate: ReturnType<typeof useShareAccess>["hydrate"]) {
  if (state.kind === "ok") hydrate({ shareMode: state.mode, editRequiresEmail: false, hasPassword: state.hasPassword });
}

export default function ShareAppDialog({ app, onClose }: { app: MiniApp; onClose: () => void }) {
  const account = useAccount();
  const userId = account.state.kind === "ready" ? account.state.view.user?.id : undefined;
  const signedOut = account.state.kind === "ready" && !userId;
  const [state, setState] = useState<AppShareState>(() => seedAppShareState(app, signedOut));
  const [error, setError] = useState<string | null>(null);

  // The package's ShareDialog closes on Escape itself; this only keeps Weft's own layers from closing too.
  useEscape(true, () => {});
  useOverlay(true);

  const save: SaveShareAccess = async (next, password) => {
    if (!isCardShareMode(next.mode)) return { ok: false, error: "Mini apps can't be edited from a link." };
    try {
      const answer = await appsApi.setShare(app.id, { mode: next.mode, password });
      setState(answer);
      void reloadApps().catch(() => {}); // My mini apps marks the shared ones
      return answer.kind === "ok" ? { ok: true } : { ok: false, error: "Sharing isn't available right now." };
    } catch (err) {
      return { ok: false, error: errorText(err) };
    }
  };
  const access = useShareAccess({ save });
  const { hydrate } = access;

  useLayoutEffect(() => hydrateFrom(state, hydrate), []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const answer = await appsApi.getShare(app.id);
      setState(answer);
      setError(null);
      hydrateFrom(answer, hydrate);
    } catch (err) {
      setError(errorText(err));
    }
  }, [app.id, hydrate]);

  // On open, and again once you sign in from here.
  useEffect(() => {
    const ask = () => void load();
    ask();
  }, [load, userId]);

  const url = state.kind === "ok" ? state.url : null;
  return createPortal(
    <ShareDialog
      title={`Share “${app.name}”`}
      onClose={onClose}
      headerAction={url ? <CopyLinkButton size="sm" url={url} /> : undefined}
      footerStart={url ? <CopyLinkButton url={url} /> : undefined}
    >
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        <AppShareBody state={state} access={access} account={account} />
      )}
    </ShareDialog>,
    document.body,
  );
}

function AppShareBody({
  state,
  access,
  account,
}: {
  state: AppShareState;
  access: ReturnType<typeof useShareAccess>;
  account: ReturnType<typeof useAccount>;
}) {
  switch (state.kind) {
    case "ok":
      return (
        <>
          <ShareAccessFields s={access} noun="app" allowEdit={false} />
          <p className="mt-3 text-[12px] leading-snug text-muted">
            {state.shows === "blob"
              ? "The link shows a copy of this page, sandboxed, with key-shaped text masked. Opening Share… again sends your latest edits."
              : "The link frames this site under weft.zip, with an Open link for sites that refuse to be framed."}
          </p>
        </>
      );
    case "unshareable":
      return <ShareNote>{state.reason}</ShareNote>;
    case "signed-out":
      return <SignedOut account={account} />;
    case "no-workspace":
      return <NoWorkspace />;
  }
}
