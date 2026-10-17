// What /api/s/[id]/page/[sha] says a shared page is. Supabase Storage serves HTML back as text/plain (so a bucket can't
// host a live page), and the viewer's iframe then shows source, with the UTF-8 read as Latin-1. The stored type was right
// at upload (lib/blob-store.ts), so the route puts it back: HTML is recognised by how it starts, and every text type
// declares the charset the route decodes and re-encodes it with. The CSP sandbox (the route's headers) is what makes
// serving a stranger's HTML safe, not the type.

const HTML_START = /^\s*<(?:!doctype\s+html|html[\s>])/i;
const CHARSET = /;\s*charset=/i;

// declared: the Content-Type Storage answered with (may be empty). head: the first bytes of the file, decoded as text.
export function pageContentType(declared: string, head: string): string {
  const type = declared.trim().toLowerCase();
  const generic = type === "" || type.startsWith("text/plain") || type.startsWith("application/octet-stream");
  if (generic && HTML_START.test(head.replace(/^﻿/, ""))) return "text/html; charset=utf-8";
  if (type === "") return "application/octet-stream";
  if (type.startsWith("text/") && !CHARSET.test(type)) return `${declared.trim()}; charset=utf-8`;
  return declared.trim();
}

export function isTextType(type: string): boolean {
  return type.toLowerCase().startsWith("text/");
}
