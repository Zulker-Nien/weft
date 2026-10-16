"use client";

// The right-hand side panel for an open card: title, folder, the thread items newest first,
// and "Load older" once the panel has more to page through. Tool rows collapse to a one-liner
// and expand to show the full output; result items render as a "Turn finished" divider.
import { useEffect, useState } from "react";
import type { ThreadItem } from "@/lib/types";
import { webBoardToolSummary } from "./WebBoard";

export interface SidePanelMeta {
  id: string;
  title: string;
  folder: string;
  ownerDevice: string;
  card: { stage?: string; lastLine?: string };
  updatedAt: string;
}

export interface SidePanelWindow {
  cardId: string;
  items: ThreadItem[];
  hasOlder: boolean;
  blobRefs: string[];
}

export function WebBoardSidePanel({ meta, window, blobUrls, onClose, onLoadOlder }: { meta: SidePanelMeta; window: SidePanelWindow; blobUrls: Record<string, string>; onClose: () => void; onLoadOlder: () => void }) {
  // Escape closes the panel; matches the modal's behavior across the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wz-boardSidePanel" role="dialog" aria-label={`Card: ${meta.title}`} onClick={onClose}>
      <div className="wz-boardSidePanelBody" onClick={(e) => e.stopPropagation()}>
        <div className="wz-boardSidePanelHeader">
          <h2 className="wz-boardSidePanelTitle">{meta.title}</h2>
          <button type="button" className="wz-boardSidePanelClose" onClick={onClose} aria-label="Close panel">
            Close
          </button>
        </div>
        <div className="wz-boardCardMeta" style={{ marginBottom: 14 }}>
          {meta.folder ? <span>{meta.folder.split("/").filter(Boolean).pop() || meta.folder}</span> : null}
          {meta.folder ? <span className="wz-boardCardMetaSep">·</span> : null}
          <span>{meta.ownerDevice}</span>
        </div>
        <div className="wz-boardThread">
          {window.hasOlder ? (
            <button type="button" className="wz-boardLoadMore" onClick={onLoadOlder}>
              Load older
            </button>
          ) : null}
          {window.items.map((item, i) => (
            <ThreadItemView key={i} item={item} blobUrls={blobUrls} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreadItemView({ item, blobUrls }: { item: ThreadItem; blobUrls: Record<string, string> }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="wz-boardThreadItem wz-boardThreadItem-user">
          <MarkdownLite text={item.text} blobUrls={blobUrls} />
        </div>
      );
    case "assistant":
      return (
        <div className="wz-boardThreadItem wz-boardThreadItem-assistant">
          <MarkdownLite text={item.text} blobUrls={blobUrls} />
        </div>
      );
    case "tool":
      return <ToolRow item={item} blobUrls={blobUrls} />;
    case "result":
      return <div className="wz-boardThreadItem-result">Turn finished{item.costUsd ? ` · $${item.costUsd.toFixed(2)}` : ""}</div>;
    case "permission":
      return <div className="wz-boardThreadItem-tool">{item.toolName}: {item.title}</div>;
    case "edited":
      return <div className="wz-boardThreadItem-tool">Edit (↑) sent</div>;
    case "shell": {
      const exit = item.exitCode === 0 || item.exitCode === null ? "" : ` · exit ${item.exitCode}`;
      return <div className="wz-boardThreadItem-tool">! {item.command}{exit}</div>;
    }
  }
}

function ToolRow({ item, blobUrls }: { item: Extract<ThreadItem, { kind: "tool" }>; blobUrls: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  // A long result (over TOOL_RESULT_INLINE_MAX) is left out of the row; the cloud side keeps
  // it in cloud_tool_outputs. The fetch is opt-in: the user clicks to expand. For now we just
  // surface the inline result (when present) and a "fetch pending" hint for the long ones —
  // a follow-up reads the cloud table directly.
  const output = item.result ?? null;
  // An image-bearing tool (a screenshot) shows the image inline; the summary row is the
  // label and toggle.
  const images = (item.images ?? []).map((ref) => blobUrls[ref] ?? ref);

  return (
    <div className="wz-boardThreadItem wz-boardThreadItem-tool">
      <button type="button" className={`wz-boardThreadItem-toolSummary${open ? " wz-boardThreadItem-toolSummaryOpen" : ""}`} onClick={() => setOpen((v) => !v)}>
        <span className="wz-boardThreadItem-toolSummaryMark">{open ? "▾" : "▸"}</span>
        <span>{webBoardToolSummary(item.name, item.summary, item.resultBytes, item.isError)}</span>
        {item.resultBytes ? <span style={{ marginLeft: "auto", opacity: 0.6 }}>{(item.resultBytes / 1024).toFixed(1)} KB</span> : null}
      </button>
      {open && output ? <pre className="wz-boardThreadItem-toolOutput">{output}</pre> : null}
      {open && !output && item.resultBytes ? <div className="wz-boardThreadItem-tool">Loading output…</div> : null}
      {images.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {images.map((src, i) => (
            <img key={i} className="wz-boardThreadItem-image" src={src} alt={item.summary || item.name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// A minimal safe markdown renderer: bold, italic, code spans, code fences, and links. Avoids
// pulling components/Markdown.tsx (it imports MediaView and a long toolbar) and react-markdown
// itself (heavy for a list of messages). A reader-side script injection is the only realistic
// threat, and we strip angle brackets and javascript: links before they hit the DOM.
function MarkdownLite({ text, blobUrls }: { text: string; blobUrls: Record<string, string> }) {
  const lines = text.split(/\n/);
  return (
    <div>
      {lines.map((line, i) => (
        <div key={i}>{renderInline(line, blobUrls)}</div>
      ))}
    </div>
  );
}

function renderInline(text: string, blobUrls: Record<string, string>): React.ReactNode {
  // A list of tokens: code spans, bold, italic, links, and image targets that resolve through
  // the blob url map. Everything else is plain text.
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|!\[[^\]\n]*\]\([^)\s]+\)|\[([^\]\n]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("!")) {
      // Image: ![alt](url) — resolve a blob ref to its signed url.
      const m2 = /^!\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(tok);
      if (m2) {
        const alt = sanitizeText(m2[1] ?? "");
        const target = m2[2] ?? "";
        const resolved = blobUrls[target] ?? target;
        if (isSafeUrl(resolved)) {
          out.push(<img key={i++} className="wz-boardThreadItem-image" src={resolved} alt={alt} />);
        }
      }
    } else if (tok.startsWith("[")) {
      const m2 = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(tok);
      if (m2) {
        const text2 = sanitizeText(m2[1] ?? "");
        const target = m2[2] ?? "";
        if (isSafeUrl(target)) {
          out.push(
            <a key={i++} href={target} target="_blank" rel="noreferrer">
              {text2}
            </a>,
          );
        }
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function sanitizeText(text: string): string {
  // Strip any angle brackets and control chars from a markdown label so it can't carry HTML.
  return text.replace(/[<>]/g, "").replace(/[\x00-\x1f]/g, "");
}

function isSafeUrl(url: string): boolean {
  // We allow http(s), mailto, and bare blob refs that were already resolved to https by the
  // signed-URL pass. Anything that looks like javascript: or data: (other than images) is dropped.
  return /^(https?:|mailto:|#|\/)/i.test(url);
}