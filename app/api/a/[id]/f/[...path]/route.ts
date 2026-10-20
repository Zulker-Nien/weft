// GET /api/a/<id>/f/<...path> — one file in a folder app (docs/architecture/mini-app-hosting.md). A
// folder share's entry page is framed from the share's page route; everything else (sibling
// scripts, styles, images) resolves here as a relative URL. The gate runs on every request, the
// path must be exactly a key of the share's files map (no `..`, no backslashes, no encoded slashes,
// no empty segments), and the file streams from weft-blobs/<org>/<sha> with the same sandbox and
// text redaction as a single-page share.
//
// An HTML file gets the bridge script injected right after <head> so window.weft is defined
// before the app's own scripts run; non-HTML files (JS, CSS, images) come back byte-identical
// because injecting anything would corrupt them.
import { injectBridgeScript, parentOriginFromRequest } from "@/lib/app-bridge-inject";
import { appShareAccess } from "@/lib/app-share-access";
import { NO_STORE, serveBlobFile } from "@/lib/share-page-serve";
import { serviceClient } from "@/lib/web-session";

// One allowed character class for a path segment: letters, digits, dot, dash, underscore. This
// rejects the unsafe inputs by construction (no slashes, no backslashes, no `..`, no percent-encoding,
// no NULs) without needing to walk the string.
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

// A sha256 in hex, exactly 64 chars. The share row's files map names a path's sha; refuse anything
// outside this shape so a row that was tampered with (or written by a buggy Mac) can't ask the
// bucket for an arbitrary path.
const SHA_RE = /^[0-9a-f]{64}$/;

// A file extension the bridge is injected into. Anything else (JS, CSS, images, fonts) is
// served byte-identical: the injector's <script> tag would corrupt a JS file, the inline
// document.write would interrupt CSS parsing, and an image's bytes don't carry text.
const HTML_EXTENSIONS = new Set(["html", "htm"]);

// Decode a Next.js catch-all param. next.js already decodes %2F as `/`, which would have split the
// path; we re-encode what we got and check each segment against SEGMENT_RE so a percent-encoded
// `/` or `..` can't slip through. The whole-segment "." and ".." checks stop a segment that the
// regex allows from naming an index entry that doesn't exist in the row's files map.
function safeParts(raw: string[]): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const part of raw) {
    if (typeof part !== "string" || part.length === 0) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("\0")) return null;
    if (!SEGMENT_RE.test(decoded)) return null;
    // A "." or ".." as a whole segment tries to walk out of the folder: the files map has no such
    // key, so serveBlobFile would 404, but refusing here means the row's files map can't be probed
    // for what it doesn't contain.
    if (decoded === "." || decoded === "..") return null;
    out.push(decoded);
  }
  return out;
}

// Read the served response body as text without changing it: served non-HTML bytes round-trip
// exactly. Sharing the buffer with the route keeps the byte-identical test honest.
async function asText(res: Response): Promise<string> {
  return await res.text();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path: rawPath } = await ctx.params;
  const parts = safeParts(rawPath);
  if (!parts) return new Response("Not found", { status: 404, headers: NO_STORE });
  const relative = parts.join("/");
  const access = await appShareAccess(id);
  // The complex union from lib/app-share-access.ts doesn't always narrow access.share the way the
  // route wants; pin to the concrete share type at the boundary so the rest of the body is typed.
  if (access.kind !== "ok") {
    if (access.kind === "missing") return new Response("Not found", { status: 404, headers: NO_STORE });
    return new Response("Forbidden", { status: 403, headers: NO_STORE });
  }
  const share = access.share;
  if (share.kind !== "folder") return new Response("Not found", { status: 404, headers: NO_STORE });
  const files = share.files;
  if (!files) return new Response("Not found", { status: 404, headers: NO_STORE });
  const sha = files[relative];
  if (!sha) return new Response("Not found", { status: 404, headers: NO_STORE });
  // The row may have a non-canonical sha (a Mac that wrote before the migration). Refuse anything
  // that isn't a 64-char hex string before we hand it to the bucket; this also rejects a sha with
  // a path traversal injected through it (the storage path is `${orgId}/${sha}` and we want the
  // sha to be one segment).
  if (!SHA_RE.test(sha)) return new Response("Not found", { status: 404, headers: NO_STORE });
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const dot = relative.lastIndexOf(".");
  const ext = dot >= 0 ? relative.slice(dot + 1) : "";
  // Non-HTML files must come back byte-identical. serveBlobFile doesn't know about the bridge,
  // so anything but an HTML extension is served as-is. The HTML path splices the bridge into the
  // text body before returning.
  if (!HTML_EXTENSIONS.has(ext.toLowerCase())) {
    return serveBlobFile(service, share.org_id, sha, ext);
  }
  const served = await serveBlobFile(service, share.org_id, sha, ext);
  if (!served.ok) return served;
  const text = await asText(served);
  const origin = parentOriginFromRequest(req);
  const body = injectBridgeScript(text, origin);
  const headers = new Headers(served.headers);
  headers.set("Content-Length", String(new TextEncoder().encode(body).byteLength));
  return new Response(body, { status: served.status, headers });
}