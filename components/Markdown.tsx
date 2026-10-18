"use client";

import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { resolveFileRef, type FileRef } from "@/lib/file-refs";
import { openFile, parseFileRef } from "@/lib/open-file";
import { FILE_SCHEME, parseFileHref, remarkFileLinks } from "@/lib/remark-file-links";
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useFileIndexContext, useFileLink } from "./file-link-context";
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

// A file the thread names, as a button that opens it in the editor column (lib/open-file.ts).
function FileButton({ cardId, fileRef, children, code }: { cardId: string; fileRef: FileRef; children: ReactNode; code?: boolean }) {
  return (
    <button
      type="button"
      data-testid="markdown-file-link"
      title={`${fileRef.path}${fileRef.line ? `:${fileRef.line}` : ""}`}
      onClick={() => openFile({ cardId, path: fileRef.path, ...(fileRef.line ? { line: fileRef.line } : {}) })}
      className={`cursor-pointer underline decoration-dotted underline-offset-2 hover:text-accent ${code ? "rounded bg-sunken px-1 font-mono text-ink" : ""}`}
    >
      {children}
    </button>
  );
}

// Inline code that names a file. With the card's file list (lib/file-refs.ts) it links only a file that is
// there; before the list loads it falls back to the shape test (lib/open-file.ts parseFileRef). Surfaces
// outside a thread (copilot, share viewer) have no card and render plain code.
function FileLink({ text }: { text: string }) {
  const cardId = useFileLink();
  const index = useFileIndexContext();
  const ref = index ? resolveFileRef(index, text.trim()) : parseFileRef(text);
  if (!cardId || !ref) return <code>{text}</code>;
  return (
    <FileButton cardId={cardId} fileRef={ref} code>
      {text}
    </FileButton>
  );
}

// A link: web links open in the browser pane (in the desktop app); a file the prose names (remark-file-links)
// or a markdown link to a project file, like [Board.tsx](components/Board.tsx:42), opens in the editor column
// when the file is there. Anything else shows its target on hover.
function Anchor({ href = "", children }: { href?: string; children?: ReactNode }) {
  const cardId = useFileLink();
  const index = useFileIndexContext();
  if (/^(https?:|mailto:)/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  const ref = parseFileHref(href) ?? (index && !href.startsWith("#") ? resolveFileRef(index, decodeURI(href)) : null);
  if (cardId && ref) return <FileButton cardId={cardId} fileRef={ref}>{children}</FileButton>;
  return (
    <span title={href} className="underline decoration-dotted underline-offset-2">
      {children}
    </span>
  );
}

const COMPONENTS: Components = {
  a: ({ href, children }) => <Anchor href={href}>{children}</Anchor>,
  img: ({ src, alt }) => (typeof src === "string" && src ? <MediaView src={src} alt={alt ?? ""} /> : null),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className: cls }) => {
    // react-markdown puts a block code's language class in className; inline code has none.
    if (typeof cls === "string" && cls.length > 0) return <code className={cls}>{children}</code>;
    const text = typeof children === "string" ? children : Array.isArray(children) ? children.filter((c) => typeof c === "string").join("") : "";
    return <FileLink text={text} />;
  },
};

// react-markdown drops hrefs with unknown schemes; the file links remark-file-links makes are kept.
const keepFileLinks = (url: string) => (url.startsWith(FILE_SCHEME) ? url : defaultUrlTransform(url));

// A thread message rendered as Markdown, in the same style as the composer. A single newline is a
// line break, as it was when the message was typed. streaming adds a caret after the last line.
function Markdown({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  // In a thread with the card's file list, file names in the prose become links too.
  const index = useFileIndexContext();
  const plugins = useMemo<Options["remarkPlugins"]>(() => (index ? [remarkGfm, [remarkFileLinks, index]] : [remarkGfm]), [index]);
  return (
    <div className={`md-body md-thread ${streaming ? "md-streaming" : ""} ${className}`}>
      <ReactMarkdown remarkPlugins={plugins} urlTransform={keepFileLinks} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Long threads re-render on every streamed token; unchanged messages skip the Markdown parse.
export default memo(Markdown);
