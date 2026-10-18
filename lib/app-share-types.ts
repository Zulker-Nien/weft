// Share links for a mini app (lib/mini-apps.ts): one URL, weft.zip/a/<id>, that shows the app's page to whoever the
// link is for, behind the same @aimhuge/share modes as a card's link (lib/share-types.ts). The contract between the parts:
// - the desktop writes a cloud_app_shares row through the signed-in account (app/api/apps/share, lib/app-share.ts),
//   with a copy of what to show: a local page uploaded as a blob, or a public https site's address,
// - the deployed Weft reads it with the service client, checks the gate (lib/app-share-access.ts) and serves the
//   viewer (app/a/[id]) and the page itself (app/api/a/[id]/page).
// Pure, so the dialog and the viewer import it too.
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import type { MiniApp } from "./mini-apps";
import type { CardShareMode } from "./share-types";
import { SITE } from "./site";

// blob: a page from this Mac, uploaded to weft-blobs and served sandboxed. site: a public https site, framed as is.
export type AppShareKind = "blob" | "site";

// public.cloud_app_shares (supabase/migrations/20261018150000_app_shares.sql).
export interface CloudAppShareRow {
  id: string;
  org_id: string;
  app_id: string;
  name: string;
  kind: AppShareKind;
  // `blob:sha256:<hex>#hash` for a blob, the https address for a site.
  page: string;
  mode: CardShareMode;
  // Clients can't select it (column grants); they read has_password.
  password_hash?: string | null;
  has_password?: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export function appShareUrl(id: string, origin = SITE): string {
  return `${origin}/a/${id}`;
}

// What GET/PUT /api/apps/share answer on the desktop, for the app's Share dialog.
export type AppShareState =
  | { kind: "signed-out" }
  | { kind: "no-workspace" }
  // A page only this Mac can reach (a dev server on localhost, a file Weft won't upload): `reason` says which.
  | { kind: "unshareable"; reason: string }
  | { kind: "ok"; id: string | null; url: string | null; mode: CardShareMode; hasPassword: boolean; shows: AppShareKind };

// PUT /api/apps/share. A password is hashed on the Mac and only its hash goes up; omitted keeps the old one.
export interface AppShareUpdate {
  mode: CardShareMode;
  password?: string;
}

// The dialog's first paint, before the server answers: the share the app remembers (app.share), else a private one.
export function seedAppShareState(app: Pick<MiniApp, "url" | "share">, signedOut: boolean): AppShareState {
  if (signedOut) return { kind: "signed-out" };
  const memo = app.share;
  const shows: AppShareKind = app.url.startsWith("file:") ? "blob" : "site";
  if (!memo) return { kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows };
  return { kind: "ok", id: memo.id, url: memo.id ? appShareUrl(memo.id) : null, mode: memo.mode, hasPassword: memo.hasPassword, shows };
}

// What the viewer frames: a blob through the share's own page route (the #hash kept), a site at its address.
export function appFrameSrc(id: string, row: Pick<CloudAppShareRow, "kind" | "page">): string {
  if (row.kind === "site") return row.page;
  const at = row.page.indexOf("#");
  return `/api/a/${id}/page${at < 0 ? "" : row.page.slice(at)}`;
}

// The sha a blob share serves, or null when the row isn't a well-formed blob.
export function appBlobSha(row: Pick<CloudAppShareRow, "kind" | "page">): string | null {
  if (row.kind !== "blob" || !row.page.startsWith(BLOB_REF_PREFIX)) return null;
  const sha = row.page.slice(BLOB_REF_PREFIX.length).replace(/#.*$/, "");
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null;
}
