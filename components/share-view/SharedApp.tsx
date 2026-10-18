// The /a/[id] viewer: one shared mini app, its page full-window under a thin header. A page the Mac uploaded is framed
// from /api/a/[id]/page, sandboxed by the route's CSP; a public site is framed at its address, with Open for the sites
// that refuse to be framed. Same dark tokens as a shared card (share-view.css).
import { appGlyph } from "@/lib/mini-apps";
import "./share-view.css";

export function SharedApp({ name, src, site }: { name: string; src: string; site: boolean }) {
  const glyph = appGlyph(name);
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
        <iframe title={name} src={src} sandbox="allow-scripts allow-popups allow-forms" className="wz-sharePaneFrame" />
      </div>
    </div>
  );
}
