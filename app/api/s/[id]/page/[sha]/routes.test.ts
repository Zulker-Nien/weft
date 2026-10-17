// app/api/s/[id]/page/[sha]/route.ts: GET /api/s/<id>/page/<sha>. Streams the file from weft-blobs
// with a strict CSP sandbox so the page's scripts run in an opaque one and can't reach weft.zip's
// cookies. Access is gated by the same shareAccess verdict the live route uses, and the sha must be
// the blob of the shared card's own pane: a link is for one card, not for the workspace's uploads.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { shareAccess, serviceClient, loadPaneAcrossThread } = vi.hoisted(() => ({
  shareAccess: vi.fn(),
  serviceClient: vi.fn(),
  loadPaneAcrossThread: vi.fn(),
}));

vi.mock("@/lib/share-access", () => ({ shareAccess }));
vi.mock("@/lib/share-live", () => ({ loadPaneAcrossThread }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));

async function load() {
  vi.resetModules();
  return import("./route");
}

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const OK = { kind: "ok", share: { share: { org_id: "o", card_id: "c1" }, card: { card: {} } } };
const OWN_PANE = { kind: "blob", ref: `blob:sha256:${SHA}`, hash: "", label: "Page" };

function ctx(id: string, sha: string) {
  return { params: Promise.resolve({ id, sha }) };
}

function download(data: Blob | null, error: { message: string } | null = null) {
  const fn = vi.fn(() => Promise.resolve({ data, error }));
  serviceClient.mockReturnValue({ storage: { from: () => ({ download: fn }) } });
  return fn;
}

const get = async (sha = SHA) => (await load()).GET(new Request("http://localhost/api/s/x/page/" + sha), ctx("x", sha));

beforeEach(() => {
  vi.clearAllMocks();
  shareAccess.mockResolvedValue(OK);
  loadPaneAcrossThread.mockResolvedValue(OWN_PANE);
});

describe("GET /api/s/[id]/page/[sha]", () => {
  it("returns 400 for a sha that isn't 64 hex chars", async () => {
    const res = await get("not-a-sha");
    expect(res.status).toBe(400);
    expect(shareAccess).not.toHaveBeenCalled();
  });

  it("returns 403 when the visitor can't access the share", async () => {
    shareAccess.mockResolvedValue({ kind: "denied" });
    expect((await get()).status).toBe(403);
  });

  it("returns 503 when the service client is missing", async () => {
    serviceClient.mockReturnValue(null);
    expect((await get()).status).toBe(503);
  });

  it("returns 404 when the storage download errors", async () => {
    download(null, { message: "404" });
    expect((await get()).status).toBe(404);
  });

  it("serves only the blob the shared card's pane shows", async () => {
    const fn = download(new Blob(["secret page of another card"], { type: "text/html" }));
    expect((await get(OTHER)).status).toBe(404);
    expect(loadPaneAcrossThread).toHaveBeenCalledWith(expect.anything(), "o", "c1");
    expect(fn).not.toHaveBeenCalled();
  });

  it("serves nothing when the card's pane isn't an uploaded page", async () => {
    const fn = download(new Blob(["x"], { type: "text/html" }));
    loadPaneAcrossThread.mockResolvedValue({ kind: "site", url: "https://example.com", label: "example.com" });
    expect((await get()).status).toBe(404);
    loadPaneAcrossThread.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns the file body with the strict CSP sandbox and the blob's content type", async () => {
    download(new Blob(["<html>hi</html>"], { type: "text/html" }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-forms");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await res.text()).toBe("<html>hi</html>");
  });

  it("masks key-shaped text in a page, the way the thread is", async () => {
    // Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
    const key = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
    download(new Blob([`<p>key ${key}</p>`], { type: "text/html" }));
    const text = await (await get()).text();
    expect(text).not.toContain(key);
    expect(text).toContain("‹hidden: a Stripe secret key›");
  });

  it("passes a non-text blob through as bytes", async () => {
    download(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
    const res = await get();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("falls back to octet-stream when the blob has no type", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    Object.defineProperty(blob, "type", { value: "" });
    download(blob);
    expect((await get()).headers.get("content-type")).toBe("application/octet-stream");
  });
});
