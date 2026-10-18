// Shared fakes for the lib/app-cloud.test.ts cases: a fake Supabase client that records every
// query and write, a fake blob store, a fake mini-app-store. The harness exports state and mock
// factories so each test resets the records and the fake mini-app list in beforeEach.
import fs from "node:fs";
import type { MiniApp } from "./mini-apps";

export interface Row {
  app_id: string;
  org_id: string;
  name: string;
  url: string;
  kind: "site" | "file" | "folder";
  page: string | null;
  manifest: Record<string, unknown> | null;
  position: number;
  deleted: boolean;
}

export interface Db {
  user: string | null;
  org: string | null;
  configured: boolean;
  // Existing rows by app_id; null = nothing there.
  existing: Map<string, Row>;
  // What the blob store should hand back from upload/fetchBlob.
  uploadedPaths: string[];
  fetched: { ref: string; file: string | null }[];
  // What the page sha should be (defaults to a fixed sha).
  sha: string;
  // Force the upload to return null even when sha is set, to exercise the !ref branch.
  uploadReturnsNull: boolean;
  // Last error to return from a write, for the swallowing tests.
  writeError: { message: string } | null;
  // Captured operations for assertions.
  queries: { table: string; filters: Record<string, unknown> }[];
  writes: { op: "insert" | "update" | "select" | "delete"; row: Record<string, unknown>; filters: Record<string, unknown> }[];
  // The listRows table; pullApps selects this.
  listRows: Row[];
  listError: { message: string } | null;
  // Hang the auth.getSession() promise so a test can exercise the in-flight dedupe.
  hangGetSession: boolean;
}

export const db: Db = {
  user: "u1", org: "o1", configured: true,
  existing: new Map(), uploadedPaths: [], fetched: [], sha: "a".repeat(64),
  uploadReturnsNull: false,
  writeError: null, queries: [], writes: [],
  listRows: [], listError: null, hangGetSession: false,
};

function readRow(row: Record<string, unknown>): Row {
  return {
    app_id: typeof row.app_id === "string" ? row.app_id : "",
    org_id: typeof row.org_id === "string" ? row.org_id : "o1",
    name: typeof row.name === "string" ? row.name : "",
    url: typeof row.url === "string" ? row.url : "",
    kind: row.kind === "site" || row.kind === "file" || row.kind === "folder" ? row.kind : "site",
    page: typeof row.page === "string" ? row.page : null,
    manifest: row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest) ? row.manifest as Record<string, unknown> : null,
    position: typeof row.position === "number" ? row.position : 0,
    deleted: row.deleted === true,
  };
}

function recordWrite(op: "insert" | "update" | "delete" | "select", row: Record<string, unknown>, filters: Record<string, unknown>) {
  db.writes.push({ op, row, filters: { ...filters } });
  if (op === "insert" && typeof row.app_id === "string") db.existing.set(row.app_id, readRow(row));
  if (op === "update" && typeof filters.app_id === "string") {
    const had = db.existing.get(filters.app_id);
    if (had) Object.assign(had, readRow(row));
  }
}

function writeError(): { error: { message: string } | null } {
  return { error: db.writeError };
}

function makeQuery(table: string) {
  const filters: Record<string, unknown> = {};
  db.queries.push({ table, filters });
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = () => self();
  builder.eq = (c: string, v: unknown) => { filters[c] = v; return self(); };
  builder.order = () => ({
    then: (done: (r: { data: Row[]; error: { message: string } | null }) => unknown) => {
      recordWrite("select", {}, { ...filters, _order: "position" });
      return Promise.resolve({ data: db.listRows, error: db.listError }).then(done);
    },
  });
  builder.maybeSingle = () => {
    const id = typeof filters.app_id === "string" ? filters.app_id : undefined;
    const row = id !== undefined ? db.existing.get(id) ?? null : null;
    recordWrite("select", row ? { ...row } : {}, filters);
    return Promise.resolve({ data: row, error: null });
  };
  builder.insert = (row: Record<string, unknown>) => {
    recordWrite("insert", row, filters);
    return Promise.resolve(writeError());
  };
  builder.update = (row: Record<string, unknown>) => {
    // Defer the write until the chain ends: the awaited `then` on the result is what fires it.
    const queued = { row };
    const chain: { eq: (c: string, v: unknown) => typeof chain; then: <T>(done: (r: { error: { message: string } | null }) => T) => Promise<T> } = {
      eq: (c, v) => { filters[c] = v; return chain; },
      then: <T>(done: (r: { error: { message: string } | null }) => T) => {
        recordWrite("update", queued.row, filters);
        return Promise.resolve(writeError()).then(done);
      },
    };
    return chain;
  };
  builder.delete = () => {
    const chain: { eq: (c: string, v: unknown) => typeof chain; then: <T>(done: (r: { error: { message: string } | null }) => T) => Promise<T> } = {
      eq: (c, v) => { filters[c] = v; return chain; },
      then: <T>(done: (r: { error: { message: string } | null }) => T) => {
        recordWrite("delete", {}, filters);
        return Promise.resolve(writeError()).then(done);
      },
    };
    return chain;
  };
  return builder;
}

const client = {
  auth: { getSession: () => {
    if (db.hangGetSession) return new Promise<{ data: { session: { user: { id: string } } | null } }>(() => {});
    return Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } });
  } },
  from: (table: string) => makeQuery(table),
  storage: { from: () => ({
    upload: (p: string) => { db.uploadedPaths.push(p); return Promise.resolve({ error: null }); },
    download: (p: string) => {
      const want = `o1/${p.split("/").pop() ?? ""}`;
      const queued = db.fetched.find((f) => f.ref === want || f.ref === p);
      const file = queued ? queued.file : null;
      return Promise.resolve({ data: file ? fs.readFileSync(file) : null, error: file ? null : { message: "nope" } });
    },
  }) },
};

export const accountMock = () => ({ accountClient: () => { if (!db.configured) throw new Error("no key"); return client; } });
export const cloudSyncMock = () => ({ syncOrgId: () => Promise.resolve(db.org) });
export const blobStoreMock = () => ({
  createBlobStore: () => ({
    upload: (p: string) => {
      db.uploadedPaths.push(p);
      if (db.uploadReturnsNull) return Promise.resolve(null);
      return Promise.resolve(db.sha ? `blob:sha256:${db.sha}` : null);
    },
    fetchBlob: (ref: string) => {
      const sha = ref.replace(/^blob:sha256:/, "");
      const queued = db.fetched.find((f) => f.ref.endsWith(sha) || f.ref === ref);
      const file = queued?.file ?? null;
      db.fetched.push({ ref, file });
      return Promise.resolve(file);
    },
  }),
  sha256Of: () => Promise.resolve(db.sha),
});

// The fake mini-app-store: tests reset `localApps` and `inserted` between cases.
export const localApps: MiniApp[] = [];
export const inserted: { id: string; app: Omit<MiniApp, "id">; at: number }[] = [];
export const miniAppStoreMock = () => ({
  listApps: () => localApps,
  insertAppAt: (id: string, app: Omit<MiniApp, "id">, at: number) => {
    if (localApps.find((a) => a.id === id)) return undefined;
    const clamped = Math.max(0, Math.min(localApps.length, Math.trunc(at)));
    const item: MiniApp = { id, ...app };
    localApps.splice(clamped, 0, item);
    inserted.push({ id, app, at });
    return item;
  },
});

// Reset the harness state between tests.
export function resetDb() {
  Object.assign(db, {
    user: "u1", org: "o1", configured: true,
    existing: new Map(), uploadedPaths: [], fetched: [], sha: "a".repeat(64),
    uploadReturnsNull: false,
    writeError: null, queries: [], writes: [],
    listRows: [], listError: null, hangGetSession: false,
  });
  localApps.length = 0;
  inserted.length = 0;
  // Reset the pull throttle between tests.
  const g = globalThis as unknown as { __weftAppCloud?: { lastPullAt: number; inFlight: Promise<void> | null } };
  delete g.__weftAppCloud;
}
