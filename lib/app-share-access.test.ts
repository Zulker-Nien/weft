// lib/app-share-access.ts: a mini app link's access gate. loadAppShare reads a cloud_app_shares
// row through the service client, appShareAccess runs the verdict (mode, membership, pass cookie),
// and insertAppShareVisit logs who got through an email gate. Patterned after
// lib/share-access.test.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serviceClient: serviceClientMock, webUser: webUserMock, gateVerdict: gateVerdictMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  webUser: vi.fn(),
  gateVerdict: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
  webUser: webUserMock,
}));

vi.mock("@/lib/share-access", () => ({ gateVerdict: gateVerdictMock }));

async function load() {
  vi.resetModules();
  return import("./app-share-access");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function appShareRow(over: Partial<{ id: string; org_id: string; app_id: string; mode: string; password_hash: string | null }> = {}) {
  return {
    id: "a1",
    org_id: "org-1",
    app_id: "app-1",
    mode: "public",
    page: "https://example.com/dash",
    password_hash: null,
    has_password: false,
    created_by: "u1",
    created_at: "2026-10-18T00:00:00.000Z",
    updated_at: "2026-10-18T00:00:00.000Z",
    ...over,
  };
}

// A query builder bound to a single table; chains like `.select().eq().maybeSingle()` resolve to
// whatever the test set on `from` for that table.
function fromTable(table: string, rows: { share?: unknown; membership?: unknown }, errors: Record<string, { message: string }> = {}) {
  const make = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    const chainMethods = ["select", "eq", "order", "limit"];
    for (const m of chainMethods) builder[m] = vi.fn(() => make());
    builder.maybeSingle = vi.fn(() => {
      if (table === "cloud_app_shares") return Promise.resolve({ data: rows.share ?? null, error: errors.cloud_app_shares ?? null });
      if (table === "org_memberships") return Promise.resolve({ data: rows.membership ?? null, error: errors.org_memberships ?? null });
      return Promise.resolve({ data: null, error: null });
    });
    builder.insert = vi.fn(() => Promise.resolve({ error: null }));
    return builder;
  };
  return make();
}

function serviceWith(tables: Record<string, ReturnType<typeof fromTable>>) {
  return { from: (table: string) => tables[table] ?? fromTable(table, {}) };
}

describe("loadAppShare", () => {
  it("returns null for an id that fails SHARE_ID_RE, never touching the service client", async () => {
    const { loadAppShare } = await load();
    expect(await loadAppShare({ from: vi.fn() } as unknown as SupabaseClient, "nope!")).toBeNull();
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("returns null when the service query errors", async () => {
    serviceClientMock.mockReturnValue(
      serviceWith({ cloud_app_shares: fromTable("cloud_app_shares", {}, { cloud_app_shares: { message: "down" } }) }),
    );
    const { loadAppShare } = await load();
    expect(await loadAppShare(serviceClientMock() as SupabaseClient, "a-valid-share-id")).toBeNull();
  });

  it("returns the row when the service client finds it", async () => {
    const share = appShareRow();
    serviceClientMock.mockReturnValue(serviceWith({ cloud_app_shares: fromTable("cloud_app_shares", { share }) }));
    const { loadAppShare } = await load();
    const loaded = await loadAppShare(serviceClientMock() as SupabaseClient, "a-valid-share-id");
    expect(loaded).toEqual(share);
  });
});

describe("appShareAccess", () => {
  function svcFor(share: ReturnType<typeof appShareRow> | null, membership?: unknown) {
    return serviceWith({
      cloud_app_shares: fromTable("cloud_app_shares", { share }),
      org_memberships: fromTable("org_memberships", { membership }),
    });
  }

  it("returns unconfigured when the service client is missing", async () => {
    serviceClientMock.mockReturnValue(null);
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "unconfigured" });
  });

  it("returns missing when the share row is gone", async () => {
    serviceClientMock.mockReturnValue(svcFor(null));
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "missing" });
  });

  it("returns ok for a public share", async () => {
    const share = appShareRow({ mode: "public" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    const { appShareAccess } = await load();
    const out = await appShareAccess("a-valid-share-id");
    expect(out).toEqual({ kind: "ok", share });
  });

  it("returns login for a private share when the visitor isn't signed in", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "login" });
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "login" });
  });

  it("returns denied for a private share when the visitor isn't a member", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "denied" });
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });

  it("returns ok for a private share when the gate verdict is ok", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    const { appShareAccess } = await load();
    expect((await appShareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate (email) for an email share without a pass", async () => {
    const share = appShareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "gate", mode: "email" });
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "email" });
  });

  it("returns ok for an email share with a valid pass", async () => {
    const share = appShareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    const { appShareAccess } = await load();
    expect((await appShareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate (password) for a password share without a pass", async () => {
    const share = appShareRow({ mode: "password" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "gate", mode: "password" });
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "password" });
  });

  it("returns denied for an unknown mode (fail closed)", async () => {
    const share = appShareRow({ mode: "public_edit" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "denied" });
    const { appShareAccess } = await load();
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });
});

describe("insertAppShareVisit", () => {
  it("inserts a row on the service client", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    const { insertAppShareVisit } = await load();
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(insert).toHaveBeenCalledWith({ share_id: "a1", email: "x@y" });
  });

  it("swallows a duplicate-key error", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { insertAppShareVisit } = await load();
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not throw on other errors", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "boom" } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { insertAppShareVisit } = await load();
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
