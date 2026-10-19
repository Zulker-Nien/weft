// app/api/a/[id]/page/route.ts: GET /api/a/<id>/page — the iframe src for a shared mini app.
// Gated by appShareAccess, serves only the one blob the share row names (an app link is for one
// page, not for every file the workspace has uploaded), and the response is sandboxed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { appShareAccess, serviceClient, serveBlobPage } = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  serveBlobPage: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/share-page-serve", () => ({ serveBlobPage, NO_STORE: { "Cache-Control": "no-store" } }));

async function load() {
  vi.resetModules();
  return import("./route");
}

const SHA = "a".repeat(64);

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function blobShare(over: Partial<{ org_id: string; kind: string; page: string; files: unknown }> = {}) {
  return { id: "s1", org_id: "org-1", app_id: "app-1", mode: "public", kind: "blob", page: `blob:sha256:${SHA}`, password_hash: null, has_password: false, created_by: "u1", created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z", ...over };
}

const get = async (id = "s1") => (await load()).GET(new Request(`http://localhost/api/a/${id}/page`), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient.mockReturnValue({ from: () => ({}) });
  serveBlobPage.mockResolvedValue(new Response("page body", { status: 200, headers: { "content-type": "text/html" } }));
});

describe("GET /api/a/[id]/page", () => {
  it("returns 404 when the share row is missing", async () => {
    appShareAccess.mockResolvedValue({ kind: "missing" });
    expect((await get()).status).toBe(404);
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("returns 403 for any non-ok verdict (gated, login, denied, unconfigured)", async () => {
    appShareAccess.mockResolvedValue({ kind: "denied" });
    expect((await get()).status).toBe(403);
    appShareAccess.mockResolvedValue({ kind: "login" });
    expect((await get()).status).toBe(403);
    appShareAccess.mockResolvedValue({ kind: "gate", mode: "email" });
    expect((await get()).status).toBe(403);
    appShareAccess.mockResolvedValue({ kind: "unconfigured" });
    expect((await get()).status).toBe(403);
  });

  it("returns 404 for a site share (no blob to serve)", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ kind: "site", page: "https://example.com/dash" }) });
    expect((await get()).status).toBe(404);
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed blob page (sha fails the regex)", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ page: "blob:sha256:short" }) });
    expect((await get()).status).toBe(404);
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("returns 503 when the service client is missing", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare() });
    serviceClient.mockReturnValue(null);
    expect((await get()).status).toBe(503);
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("serves the blob through serveBlobPage with the share's org and the parsed sha", async () => {
    const share = blobShare();
    appShareAccess.mockResolvedValue({ kind: "ok", share });
    const res = await get();
    expect(serveBlobPage).toHaveBeenCalledWith(expect.anything(), "org-1", SHA);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("page body");
  });

  it("serves a folder share's entry file from its files map", async () => {
    const entry = "b".repeat(64);
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ kind: "folder", page: "index.html", files: { "index.html": entry, "app.js": SHA } }) });
    expect((await get()).status).toBe(200);
    expect(serveBlobPage).toHaveBeenCalledWith(expect.anything(), "org-1", entry);
  });

  it("returns 404 for a folder share whose entry isn't a well-formed file in its map", async () => {
    for (const files of [null, { "app.js": SHA }, { "index.html": "short" }, { "index.html": 7 }]) {
      appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ kind: "folder", page: "index.html", files }) });
      expect((await get()).status).toBe(404);
    }
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("passes through serveBlobPage's status when it returns an error", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare() });
    serveBlobPage.mockResolvedValue(new Response("Not found", { status: 404 }));
    expect((await get()).status).toBe(404);
  });
});
