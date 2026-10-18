import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MiniApp } from "./mini-apps";

// lib/app-share.ts against a fake account client: each table answers from `db`, every query and write is recorded so
// the tests can pin what goes up (only a hash, never the password; never an upsert).

interface Db {
  user: string | null;
  org: string | null;
  configured: boolean;
  apps: { id: string; name: string; url: string }[];
  share: { id: string; mode: string; has_password: boolean; name: string; kind: string; page: string } | null;
  error: { message: string } | null;
  queries: { table: string; filters: Record<string, unknown> }[];
  writes: { op: "insert" | "update" | "delete"; row: Record<string, unknown>; filters: Record<string, unknown> }[];
}

const db = vi.hoisted((): Db => ({
  user: "u1", org: "o1", configured: true,
  apps: [{ id: "a1", name: "My App", url: "https://example.com/page" }],
  share: null, error: null, queries: [], writes: [],
}));

const uploaded = vi.hoisted(() => ({ paths: [] as string[] }));

function query(table: string) {
  const filters: Record<string, unknown> = {};
  db.queries.push({ table, filters });
  const answer = () => (db.error ? { data: null, error: db.error } : { data: db.share, error: null });
  const q = {
    select: () => q,
    eq: (col: string, value: unknown) => { filters[col] = value; return q; },
    maybeSingle: () => Promise.resolve(answer()),
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
  const has = "password_hash" in row ? row.password_hash !== null : Boolean(db.share?.has_password);
  db.share = {
    id: (row.id as string | undefined) ?? db.share!.id, mode: row.mode as string, has_password: has,
    name: (row.name as string | undefined) ?? db.share!.name,
    kind: (row.kind as string | undefined) ?? db.share!.kind,
    page: (row.page as string | undefined) ?? db.share!.page,
  };
  return Promise.resolve({ error: null });
}

const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } }) },
  from: query,
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

const { AppShareError, appPage, dropAppShare, getAppShare, setAppShare } = await import("./app-share");
const { rememberAppShare } = await import("./mini-app-store");

// appPage's default home is os.homedir(); a file the share would actually upload has to live there.
let sandbox: string;
const homeRoot = process.env.HOME || os.homedir();
beforeEach(() => {
  Object.assign(db, {
    user: "u1", org: "o1", configured: true,
    apps: [{ id: "a1", name: "My App", url: "https://example.com/page" }],
    share: null, error: null, queries: [], writes: [],
  });
  uploaded.paths.length = 0;
  fs.mkdirSync(homeRoot, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(homeRoot, ".weft-app-share-"));
});
afterEach(() => { if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true }); });

describe("appPage", () => {
  // Pure unit (takes a `home` arg), so the test can use a tmp dir and skip the real home.
  const withTmpHome = (fn: (home: string) => void) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-share-unit-"));
    try { fn(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  };

  it("maps a file:// page inside home to a blob with its hash kept", () => {
    withTmpHome((home) => {
      const file = path.join(home, "page.html");
      fs.writeFileSync(file, "<h1>hi</h1>");
      expect(appPage(`file://${file}#step-2`, home)).toEqual({ kind: "blob", local: file, hash: "#step-2" });
      expect(appPage(`file://${file}`, home)).toEqual({ kind: "blob", local: file, hash: "" });
    });
  });

  it("refuses a file:// page outside home or one that is gone", () => {
    withTmpHome((home) => {
      const outside = path.join(os.tmpdir(), "page.html");
      fs.writeFileSync(outside, "x");
      expect(appPage(`file://${outside}#hash`, home)).toEqual({ kind: "none", reason: "This app's file is gone, outside your home folder, or one Weft never uploads (a secret, the vault)." });
      fs.rmSync(outside);
      expect(appPage(`file://${path.join(home, "gone.html")}#hash`, home).kind).toBe("none");
    });
  });

  it("refuses localhost, .local, and LAN hosts", () => {
    for (const url of [
      "http://localhost:3000", "http://my-app.localhost:5173", "http://printer.local",
      "http://127.0.0.1:8080", "http://0.0.0.0", "http://[::1]",
      "http://10.0.0.5", "http://192.168.1.1", "http://172.16.0.1",
    ]) expect(appPage(url).kind).toBe("none");
  });

  it("passes https sites through unchanged", () => {
    expect(appPage("https://example.com/x?y=1#z")).toEqual({ kind: "site", url: "https://example.com/x?y=1#z" });
  });

  it("refuses http (non-local) and any non-URL string", () => {
    expect(appPage("http://example.com")).toMatchObject({ kind: "none" });
    expect(appPage("not a url")).toMatchObject({ kind: "none" });
  });
});

describe("getAppShare", () => {
  it("is a 404 for an unknown app", async () => {
    const err = await getAppShare("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppShareError);
    expect(err).toMatchObject({ status: 404, message: "No such app." });
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
    expect(await getAppShare("a1")).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows: "site" });
    expect(db.queries.at(-1)).toEqual({ table: "cloud_app_shares", filters: { org_id: "o1", created_by: "u1", app_id: "a1" } });
  });

  it("clears a remembered link whose row is gone, and leaves an unshared app's memo alone", async () => {
    db.apps = [{ ...db.apps[0], share: { id: "gone-gone-gone-gone", mode: "public", hasPassword: false } } as MiniApp];
    await getAppShare("a1");
    expect(rememberAppShare).toHaveBeenLastCalledWith("a1", { id: null, mode: "private", hasPassword: false });
    vi.mocked(rememberAppShare).mockClear();
    db.apps = [{ id: "a1", name: "My App", url: "https://example.com/page" }];
    await getAppShare("a1");
    expect(rememberAppShare).not.toHaveBeenCalled();
  });

  it("reads a share with its link, and an unknown mode as private", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true, name: "My App", kind: "site", page: "https://example.com/page" };
    expect(await getAppShare("a1")).toEqual({ kind: "ok", id: "abcdefghijklmnopqrstuv", url: "https://weft.zip/a/abcdefghijklmnopqrstuv", mode: "password", hasPassword: true, shows: "site" });
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "public_edit", has_password: false, name: "My App", kind: "site", page: "https://example.com/page" };
    expect(await getAppShare("a1")).toMatchObject({ mode: "private" });
  });

  it("updates the row when the app was renamed or its page changed, uploading then", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "public", has_password: false, name: "Old", kind: "site", page: "https://example.com/page" };
    // Renamed only: no upload, name updates.
    await getAppShare("a1");
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ op: "update", row: { name: "My App", kind: "site", page: "https://example.com/page" }, filters: { id: "abcdefghijklmnopqrstuv" } });
    expect(uploaded.paths).toEqual([]);
    // Page changed to a local file: upload + update.
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "public", has_password: false, name: "My App", kind: "blob", page: "blob:sha256:" + "0".repeat(64) };
    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>hi</h1>");
    db.apps = [{ id: "a1", name: "My App", url: `file://${file}` }];
    await getAppShare("a1");
    expect(uploaded.paths).toContain(file);
    expect(db.writes.at(-1)).toMatchObject({ op: "update", filters: { id: "abcdefghijklmnopqrstuv" } });
  });

  it("is a 404 when the app's file is gone by the time it's read", async () => {
    const file = path.join(sandbox, "page.html");
    fs.writeFileSync(file, "<h1>hi</h1>");
    db.apps = [{ id: "a1", name: "My App", url: `file://${file}` }];
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "public", has_password: false, name: "My App", kind: "blob", page: "blob:sha256:x" };
    const { sha256Of } = await import("./blob-store");
    vi.mocked(sha256Of).mockResolvedValueOnce(null);
    await expect(getAppShare("a1")).rejects.toMatchObject({ status: 404 });
  });

  it("throws what Supabase refused", async () => {
    db.error = { message: "denied" };
    await expect(getAppShare("a1")).rejects.toThrow("denied");
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
    expect(row).toMatchObject({ org_id: "o1", app_id: "a1", mode: "email", name: "My App", kind: "blob", password_hash: null });
    expect((row.page as string).startsWith("blob:sha256:")).toBe(true);
    expect(state).toEqual({ kind: "ok", id: row.id, url: `https://weft.zip/a/${row.id as string}`, mode: "email", hasPassword: false, shows: "blob" });
    expect(uploaded.paths).toContain(file);
  });

  it("updates an existing share in place, keeping its id", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "private", has_password: false, name: "My App", kind: "site", page: "https://example.com/page" };
    const state = await setAppShare("a1", { mode: "public" });
    const expected = { op: "update", row: { mode: "public", name: "My App", kind: "site", page: "https://example.com/page", password_hash: null }, filters: { id: "abcdefghijklmnopqrstuv" } };
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
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true, name: "My App", kind: "site", page: "https://example.com/page" };
    const state = await setAppShare("a1", { mode: "password" });
    expect(db.writes[0]!.row).not.toHaveProperty("password_hash");
    expect(state).toMatchObject({ mode: "password", hasPassword: true });
  });

  it("drops the hash when leaving the password gate, and ignores a password sent with another mode", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true, name: "My App", kind: "site", page: "https://example.com/page" };
    await setAppShare("a1", { mode: "public", password: "x" });
    expect(db.writes[0]!.row.password_hash).toBeNull();
  });

  it("throws what Supabase refused on write", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "private", has_password: false, name: "My App", kind: "site", page: "https://example.com/page" };
    const real = query;
    client.from = (table: string) => {
      const q = real(table);
      const update = (row: Record<string, unknown>) => { db.error = { message: "rls" }; return q.update(row); };
      return { ...q, update };
    };
    await expect(setAppShare("a1", { mode: "public" })).rejects.toThrow("rls");
    client.from = real;
  });
});

describe("dropAppShare", () => {
  const withShare = (): MiniApp => ({ id: "a1", name: "x", url: "x", addedAt: 0, share: { id: "s1", mode: "public", hasPassword: false } });

  it("is a no-op when the app has no memo", async () => {
    await dropAppShare(undefined);
    await dropAppShare({ id: "a1", name: "x", url: "x", addedAt: 0 });
    expect(db.writes).toEqual([]);
  });

  it("is a no-op when signed out", async () => {
    db.user = null;
    await dropAppShare(withShare());
    expect(db.writes).toEqual([]);
  });

  it("deletes the row scoped to created_by and app_id when signed in", async () => {
    await dropAppShare(withShare());
    expect(db.writes).toEqual([{ op: "delete", row: {}, filters: { created_by: "u1", app_id: "a1" } }]);
  });

  it("throws what Supabase refused on delete", async () => {
    db.error = { message: "nope" };
    await expect(dropAppShare(withShare())).rejects.toThrow("nope");
  });
});