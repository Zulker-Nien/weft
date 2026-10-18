"use client";

import type { ReactNode } from "react";
import { useAccount } from "@/lib/use-account";
import { openTeamPage } from "./board-palette";
import Icon, { Spinner } from "./Icon";

// What the Share dialogs (components/ShareCardDialog.tsx for a card, components/ShareAppDialog.tsx for a mini app)
// draw around @aimhuge/share's fields: the reasons a link can't be made yet and the sign-in.

export const SHARE_BUTTON = "flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-sunken disabled:opacity-60";

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ShareNote({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-1.5 text-[13px] text-ink">{children}</p>;
}

export function NoWorkspace() {
  return (
    <ShareNote>
      Your account has no workspace yet. Make one at{" "}
      <button type="button" onClick={openTeamPage} className="text-accent underline">
        weft.zip/team
      </button>
      , then share from here.
    </ShareNote>
  );
}

// The top bar's sign-in (components/AccountButton.tsx): GitHub, finished in your browser.
export function SignedOut({ account }: { account: ReturnType<typeof useAccount> }) {
  const { busy, waiting, error, signIn } = account;
  return (
    <div className="space-y-2 text-[13px] text-ink">
      <p>Sign in to Weft to share.</p>
      <button type="button" disabled={busy !== null} className={SHARE_BUTTON} onClick={() => void signIn("github")}>
        {busy === "github" || waiting ? <Spinner size={13} /> : <Icon name="github" size={14} />}
        {waiting ? "Signing in…" : "Sign in with GitHub"}
      </button>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}
