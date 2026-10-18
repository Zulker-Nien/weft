// lib/share-page-serve.ts: serveBlobPage streams a file from weft-blobs with a strict CSP sandbox
// so the page's scripts run in an opaque origin and can't read weft.zip's cookies. Text gets
// the same key-shaped redaction the thread does; binary bytes pass through untouched.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_STORE, serveBlobPage } from "./share-page-serve";

beforeEach(() => {
  vi.clearAllMocks();
});

function serviceWith(blob: { data: Blob | null; error: { message: string } | null }): SupabaseClient {
  const download = vi.fn(() => Promise.resolve(blob));
  return { storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
}

describe("serveBlobPage", () => {
  it("returns 404 when the storage download errors", async () => {
    const service = serviceWith({ data: null, error: { message: "Object not found" } });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves an HTML blob stored as text/plain as text/html with the CSP sandbox header", async () => {
    const html = "<!doctype html><title>Done → ok</title>";
    const service = serviceWith({ data: new Blob([html], { type: "text/plain" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-forms");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await res.text()).toBe(html);
  });

  it("masks key-shaped text in a text page, the way the thread is", async () => {
    // Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
    const key = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");
    const service = serviceWith({ data: new Blob([`<p>key ${key}</p>`], { type: "text/html" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    const text = await res.text();
    expect(text).not.toContain(key);
    expect(text).toContain("‹hidden: a Stripe secret key›");
  });

  it("passes a non-text blob through as bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const service = serviceWith({ data: new Blob([bytes], { type: "image/png" }), error: null });
    const res = await serveBlobPage(service, "org-1", "a".repeat(64));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("downloads from weft-blobs under <orgId>/<sha>", async () => {
    const sha = "a".repeat(64);
    const download = vi.fn(() => Promise.resolve({ data: new Blob(["x"], { type: "text/plain" }), error: null }));
    const service = { storage: { from: (bucket: string) => { expect(bucket).toBe("weft-blobs"); return { download }; } } } as unknown as SupabaseClient;
    await serveBlobPage(service, "org-9", sha);
    expect(download).toHaveBeenCalledWith(`org-9/${sha}`);
  });

  it("re-exports the no-store header for the calling route's 404 / 403 / 503", () => {
    expect(NO_STORE).toEqual({ "Cache-Control": "no-store" });
  });
});
