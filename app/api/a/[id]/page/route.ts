// GET /api/a/[id]/page — a shared mini app's page, the viewer's iframe src (app/a/[id]). Gated by the same verdict as
// the viewer, on every request, and it serves only the one blob the share row names: an app link is for one page, not
// for every file the workspace has uploaded. Sandboxed by lib/share-page-serve.ts.
import { appShareAccess } from "@/lib/app-share-access";
import { appBlobSha } from "@/lib/app-share-types";
import { NO_STORE, serveBlobPage } from "@/lib/share-page-serve";
import { serviceClient } from "@/lib/web-session";

// A folder share (a data app's ~/.weft/apps/<slug>/ shared whole) names its entry file in `page` and maps each path to
// its blob in `files`. A Mac on newer code writes these rows, and a viewer that frames this route gets the entry file.
// Not exported: a route file may export only its handlers.
function folderEntrySha(row: { kind: string; page: string; files?: unknown }): string | null {
  if (row.kind !== "folder" || !row.files || typeof row.files !== "object") return null;
  const sha = (row.files as Record<string, unknown>)[row.page];
  return typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await appShareAccess(id);
  if (access.kind === "missing") return new Response("Not found", { status: 404, headers: NO_STORE });
  if (access.kind !== "ok") return new Response("Forbidden", { status: 403, headers: NO_STORE });
  const sha = appBlobSha(access.share) ?? folderEntrySha(access.share);
  const service = serviceClient();
  if (!sha) return new Response("Not found", { status: 404, headers: NO_STORE });
  if (!service) return new Response("Sharing isn't set up on this server.", { status: 503, headers: NO_STORE });
  return serveBlobPage(service, access.share.org_id, sha);
}
