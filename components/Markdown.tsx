"use client";

import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import MediaView from "./MediaView";

// A fenced code block, with a button that copies its text.
function CodeBlock({ children }: { children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.innerText ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }

  return (
    <div className="group relative">
      <pre ref={pre}>{children}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-1.5 top-1.5 rounded border border-line bg-panel px-1.5 py-0.5 text-[11px] text-muted opacity-0 hover:text-ink group-hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const COMPONENTS: Components = {
  // Web links open in the browser pane (in the desktop app). Links to files in the project, like
  // [Board.tsx](components/Board.tsx:42), have nowhere to open, so they show the path on hover.
  a: ({ href = "", children }) =>
    /^(https?:|mailto:)/i.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span title={href} className="underline decoration-dotted underline-offset-2">
        {children}
      </span>
    ),
  img: ({ src, alt }) => (typeof src === "string" && src ? <MediaView src={src} alt={alt ?? ""} /> : null),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

// A thread message rendered as Markdown, in the same style as the composer. A single newline is a
// line break, as it was when the message was typed. streaming adds a caret after the last line.
function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={`md-body md-thread ${streaming ? "md-streaming" : ""} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Long threads re-render on every streamed token; unchanged messages skip the Markdown parse.
export default memo(Markdown);
