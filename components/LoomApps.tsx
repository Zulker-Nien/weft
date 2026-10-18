"use client";

import { useState } from "react";
import { appGlyph, type MiniApp } from "@/lib/mini-apps";
import type { CardShareMode } from "@/lib/share-types";
import { useMiniApps } from "@/lib/use-mini-apps";
import { guarded } from "./guarded";
import Icon from "./Icon";

const ShareAppDialog = guarded(() => import("./ShareAppDialog"), { what: "share dialog", className: "fixed left-4 top-16 z-50" });

const SHARED: Record<CardShareMode, string> = { private: "Workspace", public: "Public", email: "Email gate", password: "Password" };

// Where an app lives, in a few words: a site's host, a local page's file name.
export function appWhere(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== "file:") return u.host + u.pathname.replace(/\/$/, "");
    const parts = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    return parts.slice(parts.at(-1) === "index.html" ? -2 : -1).join("/");
  } catch {
    return url;
  }
}

// "My mini apps" on the Loom's You tab, under your wefter card: the pages you saved from the browser pane
// (components/SaveAppButton.tsx), each one click from the pane and one from its Share dialog. A shared app says how.
export default function LoomApps({ onOpen }: { onOpen: (url: string) => void }) {
  const apps = useMiniApps();
  const [sharing, setSharing] = useState<MiniApp | null>(null);
  const shared = apps.filter((a) => a.share?.id).length;
  return (
    <section aria-label="My mini apps" className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
        My mini apps
        <span className="text-[11.5px] font-normal text-muted tabular-nums">
          {apps.length}
          {shared > 0 && ` · ${shared} shared`}
        </span>
      </h3>
      {apps.length === 0 ? (
        <p className="text-[12px] text-muted">
          None yet. Open a page in the browser pane and press its grid button (Save as app): it lands on the left rail and here.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {apps.map((app) => (
            <AppRow key={app.id} app={app} onOpen={() => onOpen(app.url)} onShare={() => setSharing(app)} />
          ))}
        </div>
      )}
      {sharing && <ShareAppDialog app={sharing} onClose={() => setSharing(null)} />}
    </section>
  );
}

function AppRow({ app, onOpen, onShare }: { app: MiniApp; onOpen: () => void; onShare: () => void }) {
  const glyph = appGlyph(app.name);
  const mode = app.share?.id ? app.share.mode : null;
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg border border-line px-2 py-1.5 hover:border-line-strong">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={`Open ${app.name} in the browser pane`}>
        <span
          aria-hidden
          style={glyph.emoji ? undefined : { background: `hsl(${glyph.hue} 55% 48%)` }}
          className={`grid size-7 shrink-0 place-items-center rounded-lg font-semibold ${glyph.emoji ? "bg-sunken text-[15px]" : "text-[12px] text-white"}`}
        >
          {glyph.text}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] text-ink">{app.name}</span>
          <span className="truncate text-[11px] text-muted">{mode ? `🔗 ${SHARED[mode]}` : appWhere(app.url)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onShare}
        aria-label={`Share ${app.name}`}
        title="Share…"
        className={`grid size-6 shrink-0 place-items-center rounded-md hover:bg-sunken hover:text-ink ${mode ? "text-accent" : "text-muted"}`}
      >
        <Icon name="share" size={13} />
      </button>
    </div>
  );
}
