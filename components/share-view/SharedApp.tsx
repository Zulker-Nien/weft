// The /@<user>/apps/<slug> and /<org>/apps/<slug> viewer: one shared mini app, its page
// full-window under a thin header. A page the Mac uploaded is framed from /api/a/<id>/page,
// sandboxed by the route's CSP; a public site is framed at its address, with Open for the sites
// that refuse to be framed; a folder's entry is framed from /api/a/<id>/f/<entry>.
//
// The host page also runs the parent side of the bridge (lib/app-bridge.ts): the inline script
// Weft inserts into the app's HTML posts a BridgeRequest to window.parent, the page calls one of
// Weft's /api/a/<id>/{fetch,read,env} routes (or pops AppSecretForm for requestSecret) and posts
// a BridgeResponse back. See use-app-bridge.ts and lib/app-bridge-inject.ts.
"use client";

import { useRef } from "react";
import { appGlyph } from "@/lib/mini-apps";
import type { AppPolicy } from "@/lib/app-share-types";
import { useAppBridge, type AppSecretSpec } from "./use-app-bridge";
import "./share-view.css";

// The portal the secrets route builds. The secrets route is built by another agent; we declare
// the prop here so this file compiles without a hard import.
type SecretFormProps = {
  shareId: string;
  name: string;
  hosts: string[];
  onDone: (set: boolean) => void;
};

export function SharedApp({
  name,
  src,
  site,
  shareId,
  manifest,
  renderSecretForm,
}: {
  name: string;
  src: string;
  // A public site is framed as is (the user gets Open to bypass sites that refuse to be framed).
  site: boolean;
  // The app's share id, used to build the route paths the bridge posts to. The legacy /a/<id>
  // viewer still passes it; only the canonical /@<user>/apps/<slug> viewer wires the bridge.
  shareId?: string;
  // The folder app's policy, with the secret declarations. Empty for a site or single-page app.
  manifest?: AppPolicy | null;
  // Render the secret form as a portal. The page passes the real AppSecretForm once it exists;
  // the legacy viewer omits it (or passes a noop) because requestSecret isn't called there.
  renderSecretForm?: (input: SecretFormProps) => void;
}) {
  const glyph = appGlyph(name);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const secrets: AppSecretSpec[] = manifest?.secrets
    ? Object.entries(manifest.secrets).map(([n, rule]) => ({ name: n, hosts: rule.hosts }))
    : [];
  // The hook is called unconditionally; it no-ops when shareId is empty (the legacy /a/<id>
  // viewer), so the call order is stable across renders.
  useAppBridge(iframeRef, {
    shareId: shareId ?? "",
    secrets,
    renderSecretForm: renderSecretForm ?? noopSecretForm,
  });
  return (
    <div className="wz-desk" data-theme="dark">
      <div className="wz-share">
        <header className="wz-shareHeader">
          <h1 className="wz-shareTitle">
            <span
              aria-hidden
              className="wz-shareAppGlyph"
              data-emoji={glyph.emoji ? "true" : "false"}
              style={glyph.emoji ? undefined : { background: `hsl(${glyph.hue} 55% 48%)` }}
            >
              {glyph.text}
            </span>
            <span>{name}</span>
          </h1>
          <span className="wz-shareColumn">Mini app</span>
          <div className="flex-1" />
          {site && (
            <a href={src} target="_blank" rel="noopener noreferrer" className="wz-shareBrand" style={{ marginLeft: 0 }}>
              Open ↗
            </a>
          )}
          <a className="wz-shareBrand" href="https://weft.zip" target="_blank" rel="noopener noreferrer">
            Shared from Weft
          </a>
        </header>
        <iframe
          ref={iframeRef}
          title={name}
          src={src}
          sandbox="allow-scripts allow-popups allow-forms"
          className="wz-sharePaneFrame"
        />
      </div>
    </div>
  );
}

// The hook requires a renderer; the legacy /a/<id> viewer doesn't run a bridge, so the
// promise never resolves and requestSecret (also unused there) is never called.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function noopSecretForm(_input: { shareId: string; name: string; hosts: string[]; onDone: (set: boolean) => void }): void {
  // no-op
}
