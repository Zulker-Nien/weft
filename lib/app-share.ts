// The Mac's side of a mini app's share link (lib/app-share-types.ts, docs/architecture/mini-apps.md): the app's Share
// dialog (components/ShareAppDialog.tsx) reads and sets its cloud_app_shares row through app/api/apps/share. It writes
// as the signed-in account into the workspace cloud sync uploads to, so RLS decides who may share: only the sharer.
// A mini app lives on this Mac, so the row carries its own copy of what to show: a local page uploaded to weft-blobs
// (re-uploaded when the file changed, each time the dialog opens), or a public https site's address. A page only
// this Mac can reach can't be shared, and the dialog says why.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashSharePassword } from "@aimhuge/share/server";
import { accountClient } from "./account";
import { appShareUrl, type AppShareKind, type AppShareState, type AppShareUpdate } from "./app-share-types";
import { resolvePage } from "./blob-paths";
import { createBlobStore, sha256Of } from "./blob-store";
import { syncOrgId } from "./cloud-sync";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import { listApps, rememberAppShare } from "./mini-app-store";
import type { MiniApp } from "./mini-apps";
import { isCardShareMode, newShareId, type CardShareMode } from "./share-types";

// A refusal the route turns into its status (a missing app is a 404, a bad request a 400).
export class AppShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// What the link would show, or why it can't show anything.
export type AppPage =
  | { kind: "blob"; local: string; hash: string }
  | { kind: "site"; url: string }
  | { kind: "none"; reason: string };

const LOCAL_HOST = /^(localhost|.*\.localhost|.*\.local|127(\.\d+){3}|0\.0\.0\.0|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})$/i;

export function appPage(url: string, home?: string): AppPage {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "none", reason: "This app's address isn't a page Weft can share." };
  }
  if (u.protocol === "file:") {
    const page = resolvePage(url, home);
    if (page) return { kind: "blob", ...page };
    return { kind: "none", reason: "This app's file is gone, outside your home folder, or one Weft never uploads (a secret, the vault)." };
  }
  if (LOCAL_HOST.test(u.hostname)) {
    return { kind: "none", reason: `This app runs on your Mac (${u.host}), so a weft.zip link can't reach it. Save its deployed address as an app and share that.` };
  }
  if (u.protocol !== "https:") return { kind: "none", reason: "Only https sites can be shown under a weft.zip link." };
  return { kind: "site", url: u.href };
}

// The columns a client may read: password_hash is left out of the column grant on purpose.
type ShareRead = { id: string; mode: string; has_password: boolean | null; name: string; kind: string; page: string };

type Ready = { kind: "ready"; client: SupabaseClient; orgId: string; userId: string; app: MiniApp; page: Exclude<AppPage, { kind: "none" }> };
type Target = Ready | { kind: "blocked"; state: AppShareState };

function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function signedIn(): Promise<{ client: SupabaseClient; userId: string } | null> {
  let client: SupabaseClient;
  try {
    client = accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  return userId ? { client, userId } : null;
}

async function target(appId: string): Promise<Target> {
  const app = listApps().find((a) => a.id === appId);
  if (!app) throw new AppShareError("No such app.", 404);
  const account = await signedIn();
  if (!account) return { kind: "blocked", state: { kind: "signed-out" } };
  const orgId = await syncOrgId(account.client, account.userId);
  if (!orgId) return { kind: "blocked", state: { kind: "no-workspace" } };
  const page = appPage(app.url);
  if (page.kind === "none") return { kind: "blocked", state: { kind: "unshareable", reason: page.reason } };
  return { kind: "ready", ...account, orgId, app, page };
}

async function readShare(t: Ready): Promise<ShareRead | null> {
  const { data, error } = await t.client
    .from("cloud_app_shares")
    .select("id, mode, has_password, name, kind, page")
    .eq("org_id", t.orgId)
    .eq("created_by", t.userId)
    .eq("app_id", t.app.id)
    .maybeSingle<ShareRead>();
  check(error);
  return data;
}

// The row's kind and page for what the app is now; `upload` sends a local page's bytes up first.
async function currentPage(t: Ready, upload: boolean): Promise<{ kind: AppShareKind; page: string }> {
  if (t.page.kind === "site") return { kind: "site", page: t.page.url };
  const sha = await sha256Of(t.page.local);
  if (!sha) throw new AppShareError("This app's page is gone.", 404);
  if (upload) await createBlobStore({ client: t.client }).upload(t.page.local, t.orgId);
  return { kind: "blob", page: `${BLOB_REF_PREFIX}${sha}${t.page.hash}` };
}

// A row with a mode this build doesn't know reads as private: fail closed. The memo goes on the app in apps.json.
function stateOf(t: Ready, row: ShareRead | null): AppShareState {
  const shows = t.page.kind;
  const mode: CardShareMode = row && isCardShareMode(row.mode) ? row.mode : "private";
  const state: AppShareState = row
    ? { kind: "ok", id: row.id, url: appShareUrl(row.id), mode, hasPassword: Boolean(row.has_password), shows }
    : { kind: "ok", id: null, url: null, mode, hasPassword: false, shows };
  // No row (never shared, or taken down elsewhere) clears a stale memo too; an unchanged one isn't written again.
  if (row || t.app.share?.id) rememberAppShare(t.app.id, { id: state.id, mode, hasPassword: state.hasPassword });
  return state;
}

export async function getAppShare(appId: string): Promise<AppShareState> {
  const t = await target(appId);
  if (t.kind === "blocked") return t.state;
  const row = await readShare(t);
  if (!row) return stateOf(t, null);
  // Keep the link showing the app as it is: a renamed app, an edited page, a new address.
  const now = await currentPage(t, false);
  if (row.name === t.app.name && row.kind === now.kind && row.page === now.page) return stateOf(t, row);
  if (row.page !== now.page) await currentPage(t, true);
  const { error } = await t.client.from("cloud_app_shares").update({ name: t.app.name, ...now }).eq("id", row.id);
  check(error);
  return stateOf(t, await readShare(t));
}

export async function setAppShare(appId: string, update: AppShareUpdate): Promise<AppShareState> {
  // Never public_edit: a mini app is the sharer's page, not something a visitor changes.
  if (!isCardShareMode(update.mode)) throw new AppShareError("Unknown share mode.", 400);
  const password = typeof update.password === "string" && update.password !== "" ? update.password : undefined;
  const t = await target(appId);
  if (t.kind === "blocked") return t.state;
  const existing = await readShare(t);
  if (update.mode === "password" && !password && !existing?.has_password) throw new AppShareError("Set a password first.", 400);
  const change: Record<string, unknown> = { mode: update.mode, name: t.app.name, ...(await currentPage(t, true)) };
  // Only the hash goes up. Leaving the password gate drops the old one, so it can't come back unseen.
  if (update.mode !== "password") change.password_hash = null;
  else if (password) change.password_hash = hashSharePassword(password);
  // An update or an insert that asks nothing back, never an upsert (see lib/card-share.ts: the hash isn't selectable).
  const shares = t.client.from("cloud_app_shares");
  const { error } = existing
    ? await shares.update(change).eq("id", existing.id)
    : await shares.insert({ ...change, id: newShareId(), org_id: t.orgId, app_id: t.app.id });
  check(error);
  return stateOf(t, await readShare(t));
}

// Removing an app takes its link down too, in every workspace. Best effort: signed out, the row stays until you share again.
export async function dropAppShare(app: MiniApp | undefined): Promise<void> {
  if (!app?.share?.id) return;
  const account = await signedIn();
  if (!account) return;
  const { error } = await account.client.from("cloud_app_shares").delete().eq("created_by", account.userId).eq("app_id", app.id);
  check(error);
}
