"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CopyLinkButton, ShareDialog } from "@aimhuge/share/client";
import { useOverlay } from "@/lib/overlay";
import { useAccount } from "@/lib/use-account";
import { useEscape } from "@/lib/use-escape";
import { useTeam } from "@/lib/use-team";
import { openTeamPage, openWeftPage } from "./board-palette";
import { BoardShareBody, boardUrl } from "./BoardSharePanel";
import Icon from "./Icon";
import { SHARE_BUTTON, SignedOut } from "./ShareParts";

// Share the board on the desktop (the share icon by your avatar, its menu, the palette): the workspace's web board at
// weft.zip/<slug>/board with Copy and Open, and the shared panel (components/BoardSharePanel.tsx) for who can open it and
// invites. The team comes from lib/use-team.ts (prefetched by the top bar, so it usually opens loaded). Signed out, it
// asks you to sign in first, like Share…. Same frame and overlay rules as Share….
export { boardUrl };

export default function ShareBoardDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [org, setOrg] = useState<string | undefined>(undefined);
  const { state, refresh, actions } = useTeam(org);
  const signedOut = account.state.kind === "ready" && !account.state.view.user;

  // The package's ShareDialog closes on Escape itself; this keeps Weft's own layers from closing too.
  useEscape(true, () => {});
  useOverlay(true);

  const url = state.kind === "ok" && !signedOut ? boardUrl(state.team.org.slug) : null;
  return createPortal(
    <ShareDialog
      title="Share the board"
      onClose={onClose}
      headerAction={url ? <CopyLinkButton size="sm" url={url} /> : undefined}
      footerStart={
        url ? (
          <span className="flex items-center gap-2">
            <CopyLinkButton url={url} />
            <button type="button" className={SHARE_BUTTON} onClick={() => openWeftPage(url)}>
              <Icon name="globe" size={14} /> Open
            </button>
          </span>
        ) : undefined
      }
    >
      {signedOut || state.kind === "signed-out" ? (
        <SignedOut account={account} />
      ) : (
        <BoardShareBody state={state} refresh={refresh} actions={actions} onSwitch={setOrg} onManageTeam={openTeamPage} />
      )}
    </ShareDialog>,
    document.body,
  );
}

