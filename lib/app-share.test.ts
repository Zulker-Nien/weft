import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MiniApp } from "./mini-apps";

// lib/app-share.ts against a fake account client: every query and write is recorded so the tests can pin what goes up (only a hash, never the password; never an upsert).
interface Db {
  user: string | null;
  org: string | null;
  configured: boolean;
  apps: { id: string; name: string; url: string }[];
  share: { id: string; mode: string; has_password: boolean; name: string; kind: string; page: string; owner: "user" | "org"; slug: string | null; files: Record<string, string> | null; manifest: unknown; org_id: string } | null;
  error: { message: string } | null;
  queries: { table: string; filters: Record<string, unknown> }[];
  writes: { op: "insert" | "update" | "delete"; row: Record<string, unknown>; filters: Record<string, unknown> }[];
  profile: { username: string } | null;
  orgs: { id: string; slug: string; name: string }[];
}

const db = vi.hoisted((): Db => ({
  user: "u1", org: "o1", configured: true,
  apps: [{ id: "a1", name: "My App", url: "https://example.com/page" }],
  share: null, error: null, queries: [], writes: [],
  profile: { username: "alice" }, orgs: [{ id: "o1", slug: "personal", name: "Personal" }],
}));

const uploaded = vi.hoisted(() => ({ paths: [] as string[] }));

function query(table: string) {
  // The route hits cloud_app_shares (read/write), profiles, and org_memberships; the latter two
  // answer from db.profile and db.orgs (mocked Promise.all in app-share-owners.ts).
  const dataFor = () => {
    if (table === "cloud_app_shares") return db.share;
    if (table === "profiles") return db.profile;
    if (table === "org_memberships") return db.orgs.map((o) => ({ org_id: o.id, orgs: o }));
    return null;
  };
  const filters: Record<string, unknown> = {};
  const push = () => db.queries.push({ table, filters });
  const thenable = (done: (r: { data: unknown; error: { message: string } | null }) => unknown) =>
    Promise.resolve(db.error ? { data: null, error: db.error } : { data: dataFor(), error: null }).then(done);
  const q = {
    select: () => { push(); return q; },
    eq: (col: string, value: unknown) => { filters[col] = value; return q; },
    maybeSingle: () => {
      push();
      return Promise.resolve(db.error ? { data: null, error: db.error } : { data: dataFor(), error: null });
    },
    then: thenable,
    insert: (row: Record<string, unknown>) => write("insert", row, {}),
    update: (row: Record<string, unknown>) => {
      const where: Record<string, unknown> = {};
      const chain = {
        eq: (col: string, value: unknown) => { where[col] = value; return chain; },
        then: (done: (r: { error: { message: string } | null }) => unknown) => write("update", row, where).then(done),
      };
      return chain;
    },
    delete: () => {
      const where: Record<string, unknown> = {};
      const chain = {
        eq: (col: string, value: unknown) => { where[col] = value; return chain; },
        then: (done: (r: { error: { message: string } | null }) => unknown) => write("delete", {}, where).then(done),
      };
      return chain;
    },
  };
  return q;
}

function write(op: "insert" | "update" | "delete", row: Record<string, unknown>, filters: Record<string, unknown>) {
  db.writes.push({ op, row, filters });
  if (db.error) return Promise.resolve({ error: db.error });
  if (op === "delete") { db.share = null; return Promise.resolve({ error: null }); }
  db.share = applyRow(row);
  return Promise.resolve({ error: null });
}

// The row from a write: the columns from the write, the rest from the previous row. New columns (owner,
// slug, files, manifest, org_id) only get written when present so a row that doesn't touch them keeps them.
function applyRow(row: Record<string, unknown>): NonNullable<Db["share"]> {
  const prior = db.share;
  const fallback: NonNullable<Db["share"]> = { id: "id", mode: "private", has_password: false, name: "", kind: "site", page: "", owner: "user", slug: null, files: null, manifest: null, org_id: "o1" };
  const base = prior ?? fallback;
  return {
    id: (row.id as string | undefined) ?? base.id,
    mode: row.mode as string,
    has_password: "password_hash" in row ? row.password_hash !== null : base.has_password,
    name: (row.name as string | undefined) ?? base.name,
    kind: (row.kind as string | undefined) ?? base.kind,
    page: (row.page as string | undefined) ?? base.page,
    owner: ((row.owner as string | undefined) ?? base.owner) as "user" | "org",
    slug: (row.slug === undefined ? base.slug : row.slug) as string | null,
    files: (row.files === undefined ? base.files : row.files) as Record<string, string> | null,
    manifest: row.manifest === undefined ? base.manifest : row.manifest,
    org_id: (row.org_id as string | undefined) ?? base.org_id,
  };
}

const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } }) },
  // Typed as the fake's own chain (not Supabase's overloaded from()) so a test can swap in a bespoke
  // builder that wraps the same query and still satisfies the assignment.
  from: query as (table: string) => Record<string, unknown>,
  storage: { from: () => ({ upload: vi.fn((p: string) => { uploaded.paths.push(p); return Promise.resolve({ error: null }); }) }) },
};

vi.mock("./account", () => ({ accountClient: () => { if (!db.configured) throw new Error("no key"); return client; } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve(db.org) }));
vi.mock("./mini-app-store", () => ({ listApps: () => db.apps, rememberAppShare: vi.fn() }));
vi.mock("./blob-store", () => ({
  createBlobStore: () => ({ upload: vi.fn((p: string) => { uploaded.paths.push(p); return Promise.resolve("blob:sha256:x"); }) }),
  sha256Of: vi.fn((p: string) => Promise.resolve(p === "/missing/page.html" ? null : "a".repeat(64))),
}));
vi.mock("@aimhuge/share/server", () => ({ hashSharePassword: (p: string) => `hash(${p})` }));

const { AppShareError, getAppShare, setAppShare } = await import("./app-share");
const { rememberAppShare } = await import("./mini-app-store");

// The default share fixture, so tests that only need to vary one field stay short.
const DEFAULT_SHARE: NonNullable<Db["share"]> = { id: "abcdefghijklmnopqrstuv", mode: "private", has_password: false, name: "My App", kind: "site", page: "https://example.com/page", owner: "user", slug: null, files: null, manifest: null, org_id: "o1" };
const share = (over: Partial<NonNullable<Db["share"]>> = {}): NonNullable<Db["share"]> => ({ ...DEFAULT_SHARE, ...over });
const ORG_OWNER = { owner: "user", slug: null, orgId: null, publicUrl: null, owners: { user: { username: "alice" }, orgs: [{ id: "o1", slug: "personal", name: "Personal" }] } };

// appPage's default home is os.homedir(); a file the share would actually upload has to live there.
let sandbox: string;
const homeRoot = process.env.HOME || os.homedir();
beforeEach(() => {
  Object.assign(db, {
    user: "u1", org: "o1", configured: true,
    apps: [{ id: "a1", name: "My App", url: "https://example.com/page" }],
    share: null, error: null, queries: [], writes: [],
    profile: { username: "alice" }, orgs: [{ id: "o1", slug: "personal", name: "Personal" }],
  });
  uploaded.paths.length = 0;
  fs.mkdirSync(homeRoot, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(homeRoot, ".weft-app-share-"));
});
afterEach(() => { if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); });

describe("getAppShare", () => {
  it("is a 404 for an unknown app, or when the app's file is gone by the time it's read", async () => {
    const err = await getAppShare("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppShareError);
    expect(err).toMatchObject({ status: 404, message: "No such app." });
    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>hi</h1>");
    db.apps = [{ id: "a1", name: "My App", url: `file://${file}` }];
    db.share = share({ mode: "public", kind: "blob", page: "blob:sha256:x" });
    const { sha256Of } = await import("./blob-store");
    vi.mocked(sha256Of).mockResolvedValueOnce(null);
    await expect(getAppShare("a1")).rejects.toMatchObject({ status: 404 });
  });

  it("says why it can't be shared yet", async () => {
    db.configured = false;
    expect(await getAppShare("a1")).toEqual({ kind: "signed-out" });
    db.configured = true; db.user = null;
    expect(await getAppShare("a1")).toEqual({ kind: "signed-out" });
    db.user = "u1"; db.org = null;
    expect(await getAppShare("a1")).toEqual({ kind: "no-workspace" });
  });

  it("tells you why a page this Mac can't expose can't be shared", async () => {
    db.apps = [{ id: "a1", name: "Local", url: "http://localhost:3000" }];
    expect(await getAppShare("a1")).toMatchObject({ kind: "unshareable" });
  });

  it("reads an unshared app as private with no link, calling the right table and filters", async () => {
    expect(await getAppShare("a1")).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "site", manifest: null, ...ORG_OWNER, owner: null });
    expect(db.queries.find((q) => q.table === "cloud_app_shares" && "app_id" in q.filters)).toEqual({ table: "cloud_app_shares", filters: { created_by: "u1", app_id: "a1" } });
  });

  it("clears a remembered link whose row is gone, and leaves an unshared app's memo alone", async () => {
    db.apps = [{ ...db.apps[0], share: { id: "gone-gone-gone-gone", mode: "public", hasPassword: false } } as MiniApp];
    await getAppShare("a1");
    expect(rememberAppShare).toHaveBeenLastCalledWith("a1", { id: null, mode: "private", hasPassword: false, url: null, owner: null, slug: null, orgId: null });
    vi.mocked(rememberAppShare).mockClear();
    db.apps = [{ id: "a1", name: "My App", url: "https://example.com/page" }];
    await getAppShare("a1");
    expect(rememberAppShare).not.toHaveBeenCalled();
  });

  it("reads a share with its link, and an unknown mode as private", async () => {
    db.share = share({ mode: "password", has_password: true });
    expect(await getAppShare("a1")).toEqual({ kind: "ok", id: "abcdefghijklmnopqrstuv", url: "https://weft.zip/a/abcdefghijklmnopqrstuv", mode: "password", hasPassword: true, shows: "site", manifest: null, ...ORG_OWNER });
    db.share = share({ mode: "public_edit" });
    expect(await getAppShare("a1")).toMatchObject({ mode: "private" });
  });

  it("updates the row when the app was renamed or its page changed, uploading then", async () => {
    db.share = share({ mode: "public", name: "Old" });
    // Renamed only: no upload, name updates.
    await getAppShare("a1");
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ op: "update", row: { name: "My App", kind: "site", page: "https://example.com/page", files: null, manifest: null, owner: "user", slug: null }, filters: { id: "abcdefghijklmnopqrstuv" } });
    expect(uploaded.paths).toEqual([]);
    // Page changed to a local file: upload + update.
    db.share = share({ mode: "public", kind: "blob", page: "blob:sha256:" + "0".repeat(64) });
    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>hi</h1>");
    db.apps = [{ id: "a1", name: "My App", url: `file://${file}` }];
    await getAppShare("a1");
    expect(uploaded.paths).toContain(file);
    expect(db.writes.at(-1)).toMatchObject({ op: "update", filters: { id: "abcdefghijklmnopqrstuv" } });
  });

  // The automatic re-upload path (when the folder's files changed since the row) runs the secret
  // scan, so a key-laden file never gets re-uploaded by accident. Without the scan, the row would
  // be silently updated with the new file and the file would land in weft-blobs.
  it("refuses to re-upload a folder whose files hold a secret", async () => {
    // The folder helper matches against DATA_DIR/apps (lib/app-folder.ts APPS_DIR()), not HOME; tests
    // override WEFT_DATA via vitest.config.ts, so the app has to live under that path. The folder is
    // created and torn down in finallys so a failed assertion still cleans up.
    const folderAppDir = path.join(process.env.WEFT_DATA ?? homeRoot, "apps", "weft-app-share-secret");
    try {
      fs.mkdirSync(folderAppDir, { recursive: true });
      fs.writeFileSync(path.join(folderAppDir, "index.html"), "<h1>hi</h1>\nSTRIPE_KEY=STRIPE_LIVE\n");
      const app = { id: "a1", name: "Growth", url: `file://${folderAppDir}/index.html`, addedAt: 1 } as MiniApp;
      const appBefore = db.apps;
      db.apps = [app];
      try {
        // Sanity check: appPage for this URL must classify as a folder so the scan runs.
        const { appPage } = await import("./app-share");
        expect(appPage(app.url).kind).toBe("folder");
        // Stale row: the file's hash differs from what appShare would compute now, so the upload path runs.
        db.share = share({ mode: "public", kind: "folder", page: "index.html", files: { "index.html": "0".repeat(64) }, slug: null, org_id: "o1" });
        const err = await getAppShare("a1").catch((e: unknown) => e);
        expect(err).toBeInstanceOf(AppShareError);
        expect(err).toMatchObject({ status: 400 });
        expect((err as { message: string }).message).toMatch(/Stripe secret/);
        expect(uploaded.paths).toEqual([]);
        expect(db.writes).toEqual([]);
      } finally {
        db.apps = appBefore;
      }
    } finally {
      fs.rmSync(folderAppDir, { recursive: true, force: true });
    }
  });

  it("throws what Supabase refused", async () => {
    db.error = { message: "denied" };
    await expect(getAppShare("a1")).rejects.toThrow("denied");
    db.error = null;
  });
});

describe("setAppShare", () => {
  it("refuses public_edit and unknown modes before anything else", async () => {
    await expect(setAppShare("a1", { mode: "public_edit" as never })).rejects.toMatchObject({ status: 400 });
    await expect(setAppShare("a1", { mode: "everyone" as never })).rejects.toMatchObject({ status: 400 });
    expect(db.writes).toEqual([]);
  });

  it("answers the blocked state instead of writing", async () => {
    db.user = null;
    expect(await setAppShare("a1", { mode: "public" })).toEqual({ kind: "signed-out" });
    expect(db.writes).toEqual([]);
  });

  it("inserts a new share with a fresh id and uploads a local page, then reads it back", async () => {
    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>hi</h1>");
    db.apps = [{ id: "a1", name: "My App", url: `file://${file}` }];
    const state = await setAppShare("a1", { mode: "email" });
    expect(db.writes).toHaveLength(1);
    const { op, row } = db.writes[0]!;
    expect(op).toBe("insert");
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(row).toMatchObject({ org_id: "o1", app_id: "a1", mode: "email", name: "My App", kind: "blob", password_hash: null, owner: "user", slug: null, files: null, manifest: null });
    expect((row.page as string).startsWith("blob:sha256:")).toBe(true);
    expect(state).toEqual({ kind: "ok", id: row.id, url: `https://weft.zip/a/${row.id as string}`, mode: "email", hasPassword: false, shows: "blob", manifest: null, ...ORG_OWNER });
    expect(uploaded.paths).toContain(file);
  });

  it("updates an existing share in place, keeping its id", async () => {
    db.share = share();
    const state = await setAppShare("a1", { mode: "public" });
    const expected = { op: "update", row: { mode: "public", name: "My App", kind: "site", page: "https://example.com/page", password_hash: null, owner: "user", slug: null, files: null, manifest: null, org_id: "o1" }, filters: { id: "abcdefghijklmnopqrstuv" } };
    expect(db.writes).toEqual([expected]);
    expect(state).toMatchObject({ id: "abcdefghijklmnopqrstuv", mode: "public" });
  });

  it("sends only a password's hash, never the cleartext", async () => {
    const state = await setAppShare("a1", { mode: "password", password: "hunter2" });
    expect(db.writes[0]!.row).toMatchObject({ mode: "password", password_hash: "hash(hunter2)" });
    expect(JSON.stringify(db.writes)).not.toContain('"hunter2"');
    expect(state).toMatchObject({ mode: "password", hasPassword: true });
  });

  it("needs a password for the password gate unless one is stored", async () => {
    await expect(setAppShare("a1", { mode: "password" })).rejects.toMatchObject({ status: 400, message: "Set a password first." });
    await expect(setAppShare("a1", { mode: "password", password: "" })).rejects.toMatchObject({ status: 400 });
    db.share = share({ mode: "password", has_password: true });
    const state = await setAppShare("a1", { mode: "password" });
    expect(db.writes[0]!.row).not.toHaveProperty("password_hash");
    expect(state).toMatchObject({ mode: "password", hasPassword: true });
  });

  it("drops the hash when leaving the password gate, and ignores a password sent with another mode", async () => {
    db.share = share({ mode: "password", has_password: true });
    await setAppShare("a1", { mode: "public", password: "x" });
    expect(db.writes[0]!.row.password_hash).toBeNull();
  });

  it("moves the link to a workspace the user belongs to, with org_id set", async () => {
    db.orgs = [
      { id: "o1", slug: "personal", name: "Personal" },
      { id: "o2", slug: "team", name: "Team" },
    ];
    await setAppShare("a1", { mode: "public", owner: "org", orgId: "o2", slug: "growth" });
    const { op, row } = db.writes[0]!;
    expect(op).toBe("insert");
    expect(row).toMatchObject({ org_id: "o2", owner: "org", slug: "growth", mode: "public", name: "My App" });
  });

  it("rejects a slug that doesn't match the rule", async () => {
    await expect(setAppShare("a1", { mode: "public", slug: "Bad Slug" })).rejects.toMatchObject({ status: 400 });
    await expect(setAppShare("a1", { mode: "public", slug: "" })).rejects.toMatchObject({ status: 400 });
    expect(db.writes).toEqual([]);
  });

  it("rejects an owner=org without a workspace, or one the user doesn't belong to", async () => {
    await expect(setAppShare("a1", { mode: "public", owner: "org" })).rejects.toMatchObject({ status: 400, message: "Pick a workspace." });
    await expect(setAppShare("a1", { mode: "public", owner: "org", orgId: "nope" })).rejects.toThrow("that workspace");
    expect(db.writes).toEqual([]);
  });

  it("turns a unique-slug violation into 'That address is taken.', and rethrows Supabase errors", async () => {
    const real = query;
    client.from = (table: string) => {
      const q = real(table);
      const insert = (): Promise<{ error: { message: string } }> => Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "cloud_app_shares_user_slug"' } });
      const update = (row: Record<string, unknown>) => { db.error = { message: "rls" }; return q.update(row); };
      // Copy `q`'s keys into a plain object so the thenable chain isn't seen as a Promise by
      // no-misused-promises (spreading it directly would pull its `then` in as a promise method).
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(q)) copy[key] = q[key as keyof typeof q];
      return { ...copy, insert, update };
    };
    await expect(setAppShare("a1", { mode: "public", slug: "growth" })).rejects.toMatchObject({ status: 400, message: "That address is taken." });
    db.share = share();
    db.error = { message: "rls" };
    await expect(setAppShare("a1", { mode: "public" })).rejects.toThrow("rls");
    client.from = real;
  });
});