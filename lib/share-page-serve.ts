// One uploaded page, served for a share link's frame: a card's pane (app/api/s/[id]/page/[sha]) or a mini app
// (app/api/a/[id]/page). The route decides the visitor may see this blob; this streams weft-blobs/<orgId>/<sha> with a
// strict CSP sandbox, so the page's scripts run in an opaque origin and can't read weft.zip's cookies.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isTextType, pageContentType } from "./share-page";
import { redactText } from "./share-redact";

export const SHA_RE = /^[0-9a-f]{64}$/;

const HEADERS = {
  // `sandbox` (without `allow-same-origin`) gives the iframe an opaque origin: scripts run, but
  // they can't see weft.zip's cookies, localStorage, or the parent. `allow-popups` lets links in
  // the page open in a new tab; `allow-forms` lets the page's own forms submit. The CSP mirrors
  // the sandbox so an HTML `<meta http-equiv>` can't lift it.
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
  "X-Content-Type-Options": "nosniff",
  // 5 minutes: a stale page on the iframe side is fine; the browser fetches it again when it reloads.
  "Cache-Control": "private, max-age=300",
} as const;

export const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function serveBlobPage(service: SupabaseClient, orgId: string, sha: string): Promise<Response> {
  const { data, error } = await service.storage.from("weft-blobs").download(`${orgId}/${sha}`);
  if (error) return new Response("Not found", { status: 404, headers: NO_STORE });
  // Storage answers HTML as text/plain, so the type comes from the file (lib/share-page.ts), not the header. Anything
  // that isn't text (an image, a PDF) passes through as bytes.
  const bytes = await data.arrayBuffer();
  const type = pageContentType(data.type, new TextDecoder().decode(bytes.slice(0, 512)));
  // The page is the owner's own file, but a key typed into it shouldn't reach a stranger: mask text the way the thread is.
  const body = isTextType(type) ? redactText(new TextDecoder().decode(bytes)) : bytes;
  return new Response(body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}
