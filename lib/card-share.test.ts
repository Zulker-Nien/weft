import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/card-share.ts against a fake account client: each table answers from `db`, and every query and write is
// recorded so the tests can pin what goes up (only a hash, never the password; never public_edit; never an upsert,
// which the database refuses because it reads password_hash).

interface Db {
  user: string | null;
  org: string | null;
  folders: string[];
  cards: Set<string>;
  share: { id: string; mode: string; has_password: boolean } | null;
  error: { message: string } | null;
  configured: boolean;
  queries: { table: string; filters: Record<string, unknown> }[];
  writes: { op: "insert" | "update"; row: Record<string, unknown>; filters: Record<string, unknown> }[];
}

const db = vi.hoisted((): Db => ({
  user: "u1",
  org: "o1",
  folders: ["/w"],
  cards: new Set<string>(["c1"]),
  share: null,
  error: null,
  configured: true,
  queries: [],
  writes: [],
}));

function query(table: string) {
  const filters: Record<string, unknown> = {};
  db.queries.push({ table, filters });
  const answer = () => {
    if (db.error) return { data: null, error: db.error };
    if (table === "cloud_cards") return { data: db.cards.has(filters.card_id as string) ? { card_id: filters.card_id } : null, error: null };
    return { data: db.share, error: null };
  };
  const q = {
    select: () => q,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return q;
    },
    maybeSingle: () => Promise.resolve(answer()),
    insert: (row: Record<string, unknown>) => write("insert", row, {}),
    update: (row: Record<string, unknown>) => {
      const where: Record<string, unknown> = {};
      const chain = {
        eq: (col: string, value: unknown) => {
          where[col] = value;
          return chain;
        },
        then: (done: (r: { error: { message: string } | null }) => unknown) => write("update", row, where).then(done),
      };
      return chain;
    },
  };
  return q;
}

// A write that asks nothing back; the next read sees it, as the database would.
function write(op: "insert" | "update", row: Record<string, unknown>, filters: Record<string, unknown>) {
  db.writes.push({ op, row, filters });
  if (db.error) return Promise.resolve({ error: db.error });
  const has = "password_hash" in row ? row.password_hash !== null : Boolean(db.share?.has_password);
  db.share = { id: (row.id as string | undefined) ?? db.share!.id, mode: row.mode as string, has_password: has };
  return Promise.resolve({ error: null });
}

const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: db.user ? { user: { id: db.user } } : null } }) },
  from: query,
};

const syncNow = vi.fn();
vi.mock("./account", () => ({
  accountClient: () => {
    if (!db.configured) throw new Error("no key");
    return client;
  },
}));
vi.mock("./cloud-sync", () => ({
  syncNow: () => {
    syncNow();
  },
  syncOrgId: () => Promise.resolve(db.org),
}));
vi.mock("./settings", () => ({ syncFolders: () => db.folders }));
vi.mock("./store", () => ({ getCard: (id: string) => (id === "c1" || id === "c2" ? { id, cwd: "/w" } : undefined) }));
vi.mock("@aimhuge/share/server", () => ({ hashSharePassword: (p: string) => `hash(${p})` }));

const { CardShareError, getCardShare, setCardShare } = await import("./card-share");

beforeEach(() => {
  Object.assign(db, { user: "u1", org: "o1", folders: ["/w"], cards: new Set(["c1"]), share: null, error: null, configured: true, queries: [], writes: [] });
  syncNow.mockClear();
});

describe("getCardShare", () => {
  it("is a 404 for a card that isn't on the board", async () => {
    const err = await getCardShare("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CardShareError);
    expect(err).toMatchObject({ status: 404, message: "No such card." });
  });

  it("says why a card can't be shared yet", async () => {
    db.configured = false;
    expect(await getCardShare("c1")).toEqual({ kind: "signed-out" });
    db.configured = true;
    db.user = null;
    expect(await getCardShare("c1")).toEqual({ kind: "signed-out" });
    db.user = "u1";
    db.org = null;
    expect(await getCardShare("c1")).toEqual({ kind: "no-workspace" });
    db.org = "o1";
    db.folders = ["/elsewhere"];
    expect(await getCardShare("c1")).toEqual({ kind: "not-synced", folder: "/w" });
  });

  it("nudges the outbox and answers pending while the card's row hasn't uploaded", async () => {
    expect(await getCardShare("c2")).toEqual({ kind: "pending" });
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it("reads an unshared card as private with no link", async () => {
    expect(await getCardShare("c1")).toEqual({ kind: "ok", id: null, url: null, mode: "private", hasPassword: false });
    expect(db.queries.at(-1)).toEqual({ table: "cloud_shares", filters: { org_id: "o1", card_id: "c1" } });
  });

  it("reads a share with its link, and an unknown mode as private", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true };
    expect(await getCardShare("c1")).toEqual({ kind: "ok", id: "abcdefghijklmnopqrstuv", url: "https://weft.zip/s/abcdefghijklmnopqrstuv", mode: "password", hasPassword: true });
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "public_edit", has_password: false };
    expect(await getCardShare("c1")).toMatchObject({ mode: "private" });
  });

  it("throws what Supabase refused", async () => {
    db.error = { message: "denied" };
    await expect(getCardShare("c1")).rejects.toThrow("denied");
  });
});

describe("setCardShare", () => {
  it("refuses public_edit and unknown modes before anything else", async () => {
    await expect(setCardShare("c1", { mode: "public_edit" as never })).rejects.toMatchObject({ status: 400 });
    await expect(setCardShare("c1", { mode: "everyone" as never })).rejects.toMatchObject({ status: 400 });
    expect(db.writes).toEqual([]);
  });

  it("answers the blocked state instead of writing", async () => {
    db.folders = [];
    expect(await setCardShare("c1", { mode: "public" })).toEqual({ kind: "not-synced", folder: "/w" });
    expect(db.writes).toEqual([]);
  });

  it("inserts a new share with a fresh id, then reads it back", async () => {
    const state = await setCardShare("c1", { mode: "email" });
    const { op, row } = db.writes[0]!;
    expect(op).toBe("insert");
    expect(row).toMatchObject({ org_id: "o1", card_id: "c1", mode: "email", password_hash: null });
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(state).toEqual({ kind: "ok", id: row.id, url: `https://weft.zip/s/${row.id as string}`, mode: "email", hasPassword: false });
  });

  it("updates an existing share in place, keeping its id", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "private", has_password: false };
    const state = await setCardShare("c1", { mode: "public" });
    expect(db.writes).toEqual([{ op: "update", row: { mode: "public", password_hash: null }, filters: { org_id: "o1", card_id: "c1" } }]);
    expect(state).toMatchObject({ id: "abcdefghijklmnopqrstuv", mode: "public" });
  });

  it("sends only a password's hash", async () => {
    const state = await setCardShare("c1", { mode: "password", password: "hunter2" });
    expect(db.writes[0]!.row).toMatchObject({ mode: "password", password_hash: "hash(hunter2)" });
    expect(JSON.stringify(db.writes)).not.toContain('"hunter2"');
    expect(state).toMatchObject({ mode: "password", hasPassword: true });
  });

  it("needs a password for the password gate unless one is stored", async () => {
    await expect(setCardShare("c1", { mode: "password" })).rejects.toMatchObject({ status: 400, message: "Set a password first." });
    await expect(setCardShare("c1", { mode: "password", password: "" })).rejects.toMatchObject({ status: 400 });
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true };
    const state = await setCardShare("c1", { mode: "password" });
    expect(db.writes[0]!.row).not.toHaveProperty("password_hash");
    expect(state).toMatchObject({ mode: "password", hasPassword: true });
  });

  it("drops the hash when leaving the password gate, and ignores a password sent with another mode", async () => {
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "password", has_password: true };
    await setCardShare("c1", { mode: "public", password: "x" });
    expect(db.writes[0]!.row.password_hash).toBeNull();
  });

  it("throws what Supabase refused on write", async () => {
    const real = query;
    db.share = { id: "abcdefghijklmnopqrstuv", mode: "private", has_password: false };
    client.from = (table: string) => {
      const q = real(table);
      const update = (row: Record<string, unknown>) => {
        db.error = { message: "rls" };
        return q.update(row);
      };
      return { ...q, update };
    };
    await expect(setCardShare("c1", { mode: "public" })).rejects.toThrow("rls");
    client.from = real;
  });
});
