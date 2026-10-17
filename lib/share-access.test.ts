// lib/share-access.ts: the share viewer's access gate. loadShare reads the share row + its
// cloud_cards row through the service client; shareAccess runs the verdict for one id.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serviceClient: serviceClientMock, webUser: webUserMock, cookies } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
  webUser: webUserMock,
}));

vi.mock("next/headers", () => ({ cookies }));

const fakeGate = {
  cookieName: (id: string) => `weft_share_${id.slice(0, 4)}`,
  sign: (id: string) => `signed:${id}`,
  verify: (id: string, v?: string) => Boolean(v) && v === `signed:${id}`,
  cookieOptions: () => ({ httpOnly: true, secure: false, sameSite: "lax" as const, path: "/", maxAge: 60 }),
  ttlMs: 60_000,
};

vi.mock("@/lib/share-gate", () => ({
  getShareGate: () => fakeGate,
}));

async function load() {
  vi.resetModules();
  return import("./share-access");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function shareRow(over: Partial<{ id: string; org_id: string; card_id: string; mode: string; password_hash: string | null }> = {}) {
  return {
    id: "sh1",
    org_id: "org-1",
    card_id: "c1",
    mode: "public",
    password_hash: null,
    created_by: "u1",
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    ...over,
  };
}

function cardRow(over: Partial<{ card_id: string; card: unknown; deleted: boolean; updated_at: string }> = {}) {
  return { card_id: "c1", card: { id: "c1", title: "T" }, deleted: false, updated_at: "2026-10-17T00:00:00.000Z", ...over };
}

// A query builder bound to a single table; chains like `.select().eq().maybeSingle()` resolve to
// whatever the test set on `from` for that table. Each call to `builder()` returns a fresh chain.
function fromTable(table: string, rows: { share?: unknown; card?: unknown; membership?: unknown }, errors: Record<string, { message: string }> = {}) {
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const chainMethods = ["select", "eq", "order", "limit", "lt", "gt"];
    for (const m of chainMethods) builder[m] = vi.fn(() => make());
    builder.maybeSingle = vi.fn(() => {
      if (table === "cloud_shares") return Promise.resolve({ data: rows.share ?? null, error: errors.cloud_shares ?? null });
      if (table === "cloud_cards") return Promise.resolve({ data: rows.card ?? null, error: errors.cloud_cards ?? null });
      if (table === "org_memberships") return Promise.resolve({ data: rows.membership ?? null, error: errors.org_memberships ?? null });
      return Promise.resolve({ data: null, error: null });
    });
    builder.insert = vi.fn(() => Promise.resolve(({ error: null })));
    return builder;
  };
  return make();
}

// A service-client stub: one .from() per table, each returning its own chainable.
function serviceWith(tables: Record<string, ReturnType<typeof fromTable>>) {
  return {
    from: (table: string) => tables[table] ?? fromTable(table, {}),
  };
}

describe("loadShare", () => {
  it("returns null for an id that fails SHARE_ID_RE", async () => {
    const { loadShare } = await load();
    expect(await loadShare("nope!")).toBeNull();
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("returns null when the service client is missing", async () => {
    serviceClientMock.mockReturnValue(null);
    const { loadShare } = await load();
    expect(await loadShare("a-valid-share-id")).toBeNull();
  });

  it("returns null when the share row is missing", async () => {
    serviceClientMock.mockReturnValue(serviceWith({ cloud_shares: fromTable("cloud_shares", {}), cloud_cards: fromTable("cloud_cards", {}) }));
    const { loadShare } = await load();
    expect(await loadShare("a-valid-share-id")).toBeNull();
  });

  it("returns a LoadedShare with the share and card when both rows exist", async () => {
    const share = shareRow();
    const card = cardRow();
    serviceClientMock.mockReturnValue(
      serviceWith({
        cloud_shares: fromTable("cloud_shares", { share }),
        cloud_cards: fromTable("cloud_cards", { card }),
      }),
    );
    const { loadShare } = await load();
    const loaded = await loadShare("a-valid-share-id");
    expect(loaded).not.toBeNull();
    expect(loaded?.share).toEqual(share);
    expect(loaded?.card).toEqual(card);
  });

  it("returns a LoadedShare with card: null when the card is deleted or missing", async () => {
    const share = shareRow();
    const deletedCard = { ...cardRow(), deleted: true };
    serviceClientMock.mockReturnValue(
      serviceWith({
        cloud_shares: fromTable("cloud_shares", { share }),
        cloud_cards: fromTable("cloud_cards", { card: deletedCard }),
      }),
    );
    const { loadShare } = await load();
    const loaded = await loadShare("a-valid-share-id");
    expect(loaded?.share).toEqual(share);
    expect(loaded?.card).toBeNull();
  });
});

describe("shareAccess", () => {
  // A shared builder so most tests don't have to repeat the shape.
  function svcFor(share: ReturnType<typeof shareRow>, card: ReturnType<typeof cardRow> | null = cardRow(), membership?: unknown) {
    return serviceWith({
      cloud_shares: fromTable("cloud_shares", { share }),
      cloud_cards: fromTable("cloud_cards", { card }),
      org_memberships: fromTable("org_memberships", { membership }),
    });
  }

  it("returns unconfigured when the service client is missing", async () => {
    serviceClientMock.mockReturnValue(null);
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "unconfigured" });
  });

  it("returns missing when the card row is gone", async () => {
    const share = shareRow();
    serviceClientMock.mockReturnValue(svcFor(share, null));
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "missing" });
  });

  it("returns denied for an unknown mode (fail closed)", async () => {
    const share = shareRow({ mode: "public_edit" });
    serviceClientMock.mockReturnValue(svcFor(share));
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });

  it("returns ok for a public share", async () => {
    const share = shareRow({ mode: "public" });
    serviceClientMock.mockReturnValue(svcFor(share));
    const { shareAccess } = await load();
    const out = await shareAccess("a-valid-share-id");
    expect(out.kind).toBe("ok");
  });

  it("returns login for a private share when the visitor isn't signed in", async () => {
    const share = shareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    webUserMock.mockResolvedValue(null);
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "login" });
  });

  it("returns denied for a private share when the visitor isn't a member", async () => {
    const share = shareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    webUserMock.mockResolvedValue({ id: "u1", email: "x@x", name: null, avatar: null });
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });

  it("returns ok for a private share when the visitor is a member", async () => {
    const share = shareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share, cardRow(), { role: "member" }));
    webUserMock.mockResolvedValue({ id: "u1", email: "x@x", name: null, avatar: null });
    const { shareAccess } = await load();
    expect((await shareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate for an email share without a pass", async () => {
    const share = shareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    cookies.mockResolvedValue({ get: () => undefined });
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "email" });
  });

  it("returns ok for an email share with a valid pass", async () => {
    const share = shareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    cookies.mockResolvedValue({ get: () => ({ value: "signed:a-valid-share-id" }) });
    const { shareAccess } = await load();
    expect((await shareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate for a password share without a pass", async () => {
    const share = shareRow({ mode: "password" });
    serviceClientMock.mockReturnValue(svcFor(share));
    cookies.mockResolvedValue({ get: () => undefined });
    const { shareAccess } = await load();
    expect(await shareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "password" });
  });
});

describe("insertShareVisit", () => {
  it("inserts a row on the service client", async () => {
    const insert = vi.fn(() => Promise.resolve(({ error: null })));
    serviceClientMock.mockReturnValue({ from: () => ({ insert }) });
    const { insertShareVisit } = await load();
    await insertShareVisit(serviceClientMock() as SupabaseClient, { shareId: "sh1", email: "x@y" });
    expect(insert).toHaveBeenCalledWith({ share_id: "sh1", email: "x@y" });
  });

  it("swallows a duplicate-key error", async () => {
    const insert = vi.fn(() => Promise.resolve(({ error: { message: "duplicate key value violates unique constraint" } })));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceClientMock.mockReturnValue({ from: () => ({ insert }) });
    const { insertShareVisit } = await load();
    await insertShareVisit(serviceClientMock() as SupabaseClient, { shareId: "sh1", email: "x@y" });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not throw on other errors", async () => {
    const insert = vi.fn(() => Promise.resolve(({ error: { message: "boom" } })));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceClientMock.mockReturnValue({ from: () => ({ insert }) });
    const { insertShareVisit } = await load();
    await insertShareVisit(serviceClientMock() as SupabaseClient, { shareId: "sh1", email: "x@y" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
