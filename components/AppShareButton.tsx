"use client";

import { useState } from "react";
import type { MiniApp } from "@/lib/mini-apps";
import { guarded } from "./guarded";
import Icon from "./Icon";

// The browser pane's Share button for a saved app (components/BrowserPane.tsx): opens the app's Share…
// dialog beside SaveAppButton in the toolbar. Accent when the app already has a link (app.share?.id),
// muted otherwise. Hidden when no app is open (the host decides; this is a no-op render then). A card's
// own pane shows the card's share through the actions slot, so this only renders on the board's pane.
const ShareAppDialog = guarded(() => import("./ShareAppDialog"), { what: "share dialog", className: "fixed left-4 top-16 z-50" });

export default function AppShareButton({ app }: { app: MiniApp | undefined }) {
  const [open, setOpen] = useState(false);
  if (!app) return null;
  const linked = Boolean(app.share?.id);
  return (
    <>
      <button
        type="button"
        title={linked ? "This app has a weft.zip link" : "Share this app"}
        aria-label="Share app"
        onClick={() => setOpen(true)}
        className={`rounded-md p-1.5 ${linked ? "text-accent hover:bg-accent-soft" : "text-muted hover:bg-sunken hover:text-ink"}`}
      >
        <Icon name="share" size={15} />
      </button>
      {open && <ShareAppDialog app={app} onClose={() => setOpen(false)} />}
    </>
  );
}
