// lib/app-share-access.ts: a mini app link's access gate. loadAppShare reads a cloud_app_shares
// row through the service client, appShareAccess runs the verdict (mode, membership, pass cookie),
// and insertAppShareVisit logs who got through an email gate. The by-slug lookups and access
// function live in lib/app-share-access-by-slug.test.ts, which uses the same helpers.
// Patterned after lib/share-access.test.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appShareAccess, insertAppShareVisit, loadAppShare } from "./app-share-access";
import { appShareRow, fromTable, serviceWith } from "./app-share-access.test-helpers";

const { serviceClient: serviceClientMock, gateVerdict: gateVerdictMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  gateVerdict: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: serviceClientMock,
  webUser: vi.fn(),
}));

vi.mock("@/lib/share-access", () => ({ gateVerdict: gateVerdictMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadAppShare", () => {
  it("returns null for an id that fails SHARE_ID_RE, never touching the service client", async () => {
    expect(await loadAppShare({ from: vi.fn() } as unknown as SupabaseClient, "nope!")).toBeNull();
    expect(serviceClientMock).not.toHaveBeenCalled();
  });

  it("returns null when the service query errors", async () => {
    serviceClientMock.mockReturnValue(
      serviceWith({ cloud_app_shares: fromTable("cloud_app_shares", {}, { cloud_app_shares: { message: "down" } }) }),
    );
    expect(await loadAppShare(serviceClientMock() as SupabaseClient, "a-valid-share-id")).toBeNull();
  });

  it("returns the row when the service client finds it", async () => {
    const share = appShareRow();
    serviceClientMock.mockReturnValue(serviceWith({ cloud_app_shares: fromTable("cloud_app_shares", { share }) }));
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
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "unconfigured" });
  });

  it("returns missing when the share row is gone", async () => {
    serviceClientMock.mockReturnValue(svcFor(null));
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "missing" });
  });

  it("returns ok for a public share", async () => {
    const share = appShareRow({ mode: "public" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    const out = await appShareAccess("a-valid-share-id");
    expect(out).toEqual({ kind: "ok", share });
  });

  it("returns login for a private share when the visitor isn't signed in", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "login" });
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "login" });
  });

  it("returns denied for a private share when the visitor isn't a member", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "denied" });
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });

  it("returns ok for a private share when the gate verdict is ok", async () => {
    const share = appShareRow({ mode: "private" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    expect((await appShareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate (email) for an email share without a pass", async () => {
    const share = appShareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "gate", mode: "email" });
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "email" });
  });

  it("returns ok for an email share with a valid pass", async () => {
    const share = appShareRow({ mode: "email" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "ok" });
    expect((await appShareAccess("a-valid-share-id")).kind).toBe("ok");
  });

  it("returns gate (password) for a password share without a pass", async () => {
    const share = appShareRow({ mode: "password" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "gate", mode: "password" });
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "gate", mode: "password" });
  });

  it("returns denied for an unknown mode (fail closed)", async () => {
    const share = appShareRow({ mode: "public_edit" });
    serviceClientMock.mockReturnValue(svcFor(share));
    gateVerdictMock.mockResolvedValue({ kind: "denied" });
    expect(await appShareAccess("a-valid-share-id")).toEqual({ kind: "denied" });
  });
});

describe("insertAppShareVisit", () => {
  it("inserts a row on the service client", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }));
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(insert).toHaveBeenCalledWith({ share_id: "a1", email: "x@y" });
  });

  it("swallows a duplicate-key error", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("logs but does not throw on other errors", async () => {
    const insert = vi.fn(() => Promise.resolve({ error: { message: "boom" } }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await insertAppShareVisit({ from: () => ({ insert }) } as unknown as SupabaseClient, { shareId: "a1", email: "x@y" });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
