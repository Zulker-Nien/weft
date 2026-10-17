// GET /api/s/[id]/page/[sha] — the iframe src for a shared page. Streams the file from
// weft-blobs/<orgId>/<sha> with a strict CSP sandbox so the page's scripts run in an opaque origin
// and can't read weft.zip's cookies. The viewer can frame the page; a provider that refuses
// framing (X-Frame-Options) is the iframe's loss, and the page also offers an "Open ↗" link.
//
// Access is gated by the same shareAccess verdict the live route uses; the same id resolves to
// the same share, so a private visitor gets 403, a gated visitor gets 403, and a deleted card
// gets 404. The sha is validated as 64 hex chars so an attacker can't probe storage paths, and it must be the blob of
// THIS card's current pane: a share link is for one card, not for every file the workspace has uploaded.
import { shareAccess } from "@/lib/share-access";
import { loadPaneAcrossThread } from "@/lib/share-live";
import { isTextType, pageContentType } from "@/lib/share-page";
import { redactText } from "@/lib/share-redact";
import { serviceClient } from "@/lib/web-session";

const SHA_RE = /^[0-9a-f]{64}$/;

const HEADERS = {
  // `sandbox` (without `allow-same-origin`) gives the iframe an opaque origin: scripts run, but
  // they can't see weft.zip's cookies, localStorage, or the parent. `allow-popups` lets links in
  // the page open in a new tab; `allow-forms` lets the page's own forms submit. The CSP mirrors
  // the sandbox so an HTML `<meta http-equiv>` can't lift it.
  "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms",
  "X-Content-Type-Options": "nosniff",
  // 5 minutes: the blob URL on the share live response is good for an hour, so a stale page on
  // the iframe side is fine; the browser will fetch the page again when it reloads.
  "Cache-Control": "private, max-age=300",
} as const;

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await ctx.params;
  if (!SHA_RE.test(sha)) return new Response("Bad request", { status: 400 });
  const access = await shareAccess(id);
  if (access.kind !== "ok") return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const service = serviceClient();
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  const { org_id: orgId, card_id: cardId } = access.share.share;
  const pane = await loadPaneAcrossThread(service, orgId, cardId);
  if (pane?.kind !== "blob" || pane.ref !== `blob:sha256:${sha}`) return new Response("Not found", { status: 404, headers: NO_STORE });
  const path = `${orgId}/${sha}`;
  const { data, error } = await service.storage.from("weft-blobs").download(path);
  if (error) return new Response("Not found", { status: 404, headers: NO_STORE });
  // Storage answers HTML as text/plain, so the type comes from the file (lib/share-page.ts), not the header. Anything
  // that isn't text (an image, a PDF) passes through as bytes.
  const bytes = await data.arrayBuffer();
  const type = pageContentType(data.type, new TextDecoder().decode(bytes.slice(0, 512)));
  // The page is the owner's own file, but a key typed into it shouldn't reach a stranger: mask text the way the thread is.
  const body = isTextType(type) ? redactText(new TextDecoder().decode(bytes)) : bytes;
  return new Response(body, { status: 200, headers: { ...HEADERS, "Content-Type": type } });
}
