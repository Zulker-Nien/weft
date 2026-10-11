"use client";

import { useEffect, useRef, useState } from "react";
import type { BrowserState } from "@/lib/client";
import { setPaneBox } from "@/lib/float-place";
import { useAnyOverlay } from "@/lib/overlay";
import Icon, { Spinner } from "./Icon";
import ZoomMenu from "./ZoomMenu";

const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };
// The page itself is a native Electron view laid over the placeholder below;
// this component draws the toolbar and tells the shell where to put the view.
export default function BrowserPane({
  desktop,
  state,
  obscured,
  expanded,
  width,
  onWidth,
  onClose,
}: {
  desktop: boolean;
  state: BrowserState;
  obscured: boolean;
  expanded: boolean;
  width: number;
  onWidth: (width: number) => void;
  // Beside an open card this closes the card too: the card and its browser are one window.
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const overlay = useAnyOverlay();
  const hide = obscured || overlay || resizing;
  // A shell from before zoom reporting sends no zoom.
  const zoom = state.zoom ?? 100;

  useEffect(() => {
    const bridge = window.threadboard;
    const el = holder.current;
    if (!bridge || !el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      const box = hide ? HIDDEN : { x: r.left, y: r.top, width: r.width, height: r.height };
      bridge.browser.setBounds(box);
      // Hover bubbles keep clear of the native view; they read this rather than asking the shell.
      setPaneBox(box);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      bridge.browser.setBounds(HIDDEN);
      setPaneBox(null);
    };
  }, [hide, expanded]);

  function go(raw: string) {
    const url = raw.trim();
    if (url) void window.threadboard?.browser.open(url);
  }

  // The native view swallows pointer events, so it's hidden while dragging the divider.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setResizing(true);
    const move = (ev: PointerEvent) => {
      const max = window.innerWidth - 420;
      onWidth(Math.min(max, Math.max(320, window.innerWidth - ev.clientX)));
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const nav = "rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <section
      className={`relative flex flex-col border-l border-line bg-panel ${expanded ? "min-w-0 flex-1" : "shrink-0"}`}
      style={expanded ? undefined : { width }}
    >
      {!expanded && (
        <div
          onPointerDown={startResize}
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-accent/30"
          aria-hidden="true"
        />
      )}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button className={nav} disabled={!state.canGoBack} onClick={() => window.threadboard?.browser.back()} aria-label="Back">
          <Icon name="back" size={15} />
        </button>
        <button className={nav} disabled={!state.canGoForward} onClick={() => window.threadboard?.browser.forward()} aria-label="Forward">
          <Icon name="forward" size={15} />
        </button>
        <button className={nav} disabled={!state.url} onClick={() => window.threadboard?.browser.reload()} aria-label="Reload">
          {state.loading ? <Spinner size={13} /> : <Icon name="reload" size={15} />}
        </button>
        <input
          value={draft ?? state.url}
          onFocus={(e) => {
            setDraft(state.url);
            e.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              go(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          disabled={!desktop}
          placeholder="Type a URL, or ask an agent to open one"
          className="mx-1 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 py-1 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-accent"
        />
        {/* Only the page's zoom; ⌘+/−/0, ⌘+scroll and pinch work too. Accent when not 100%. */}
        <ZoomMenu zoom={zoom} disabled={!state.url} />
        <button className={nav} onClick={onClose} aria-label={expanded ? "Close thread" : "Close browser"}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div ref={holder} className="relative min-h-0 flex-1 bg-canvas">
        {!desktop ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="globe" size={28} className="text-faint" />
            <p className="text-[13px] text-muted">The browser pane runs in the desktop app.</p>
            <code className="rounded bg-sunken px-2 py-1 font-mono text-[12px] text-ink">npm run desktop</code>
          </div>
        ) : (
          !state.url && (
            <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-faint">
              Nothing open yet
            </div>
          )
        )}
      </div>
    </section>
  );
}
