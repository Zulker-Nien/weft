// app/api/a/[id]/page/route.ts: GET /api/a/<id>/page — the iframe src for a shared mini app.
// Gated by appShareAccess, serves only the one blob the share row names (an app link is for one
// page, not for every file the workspace has uploaded), and the response is sandboxed. The page
// route injects the bridge script after <head> so the served HTML can call window.weft; the
// folder file route injects only on HTML extensions.
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
  return { id: "s1", org_id: "org-1", app_id: "app-1", mode: "public", kind: "blob", page: `blob:sha256:${SHA}`, password_hash: null, has_password: false, created_by: "u1", owner: "user", slug: "growth", files: null, manifest: null, created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z", ...over };
}

const get = async (id = "s1", url = "http://localhost") => (await load()).GET(new Request(`${url}/api/a/${id}/page`), ctx(id));

// A fresh response per call so the route's body read (and the test's read) don't trip on the
// once-only body lock.
function mockServedPage(html: string) {
  serveBlobPage.mockImplementation(() =>
    Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient.mockReturnValue({ from: () => ({}) });
  mockServedPage("<!doctype html><html><head></head><body>page body</body></html>");
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
    // The bridge is injected: the body now starts with <!doctype html><html><head><script>.
    const body = await res.text();
    expect(body).toMatch(/^<!doctype html><html><head><script>window\.weft/);
  });

  it("serves a folder share's entry file from its files map and injects the bridge", async () => {
    const entry = "b".repeat(64);
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ kind: "folder", page: "index.html", files: { "index.html": entry, "app.js": SHA } }) });
    const r = await get();
    expect(r.status).toBe(200);
    expect(serveBlobPage).toHaveBeenCalledWith(expect.anything(), "org-1", entry);
    expect(await r.text()).toMatch(/^<!doctype html><html><head><script>window\.weft/);
  });

  it("returns 404 for a folder share whose entry isn't a well-formed file in its map", async () => {
    for (const files of [null, { "app.js": SHA }, { "index.html": "short" }, { "index.html": 7 }]) {
      appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare({ kind: "folder", page: "index.html", files }) });
      expect((await get()).status).toBe(404);
    }
    expect(serveBlobPage).not.toHaveBeenCalled();
  });

  it("passes through serveBlobPage's status when it returns an error (no bridge injection)", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare() });
    serveBlobPage.mockImplementation(() => Promise.resolve(new Response("Not found", { status: 404 })));
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("uses the request URL's origin as the bridge's parent origin", async () => {
    const share = blobShare();
    appShareAccess.mockResolvedValue({ kind: "ok", share });
    const res = await get("s1", "https://weft.zip");
    expect(await res.text()).toContain('"https://weft.zip"');
  });

  it("leaves the HTML unchanged when the request has no usable origin", async () => {
    appShareAccess.mockResolvedValue({ kind: "ok", share: blobShare() });
    const res = await get("s1", "about:blank");
    const body = await res.text();
    expect(body).not.toContain("<script>window.weft");
    expect(body).toBe("<!doctype html><html><head></head><body>page body</body></html>");
  });
});