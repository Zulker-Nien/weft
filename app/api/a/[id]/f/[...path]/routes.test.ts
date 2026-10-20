// app/api/a/[id]/f/[...path]/route.ts: GET /api/a/<id>/<filename> — one file in a folder app.
// The gate runs on every request, the path must be a key of the share's files map (no `..`, no
// backslashes, no encoded slashes, no empty segments), and the file streams from
// weft-blobs/<org>/<sha> with the sandbox and redaction the page route uses. An HTML file has
// the bridge script injected after <head> so window.weft is defined before the app's own scripts
// run; non-HTML files come back byte-identical because injecting anything would corrupt them.
// Each test sets the share's files map to control what the route may serve.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppShareAccess } from "@/lib/app-share-access";
import type { CloudAppShareRow } from "@/lib/app-share-types";
import { GET } from "./route";

const { appShareAccess, serviceClient, serveBlobFile } = vi.hoisted(() => ({
  appShareAccess: vi.fn(),
  serviceClient: vi.fn(),
  serveBlobFile: vi.fn(),
}));

vi.mock("@/lib/app-share-access", () => ({ appShareAccess }));
vi.mock("@/lib/web-session", () => ({ serviceClient }));
vi.mock("@/lib/share-page-serve", () => ({
  serveBlobFile,
  NO_STORE: { "Cache-Control": "no-store" },
}));

const SHA = "a".repeat(64);

function folderShare(over: Partial<Pick<CloudAppShareRow, "name" | "kind" | "files">> = {}): CloudAppShareRow {
  return {
    id: "s1",
    org_id: "org-1",
    app_id: "app-1",
    name: "growth",
    mode: "public",
    kind: "folder",
    page: "index.html",
    password_hash: null,
    has_password: false,
    created_by: "u1",
    owner: "user",
    slug: "growth",
    files: { "index.html": SHA, "app.js": SHA, "assets/x.png": SHA },
    manifest: null,
    created_at: "2026-10-18T00:00:00.000Z",
    updated_at: "2026-10-18T00:00:00.000Z",
    ...over,
  };
}

function ctx(id: string, path: string[]) {
  return { params: Promise.resolve({ id, path }) };
}

const get = async (id = "s1", path: string[] = ["index.html"], url = "http://localhost") =>
  GET(new Request(`${url}/api/a/${id}/f/${path.join("/")}`), ctx(id, path));

// A fresh response per call so the route's body reads don't trip on the once-only body lock. The
// route reads the served body once when the file is HTML (to splice the bridge), and the caller
// reads it again on the route's response, so each call needs its own Response.
function mockServedBody(body: string, contentType: string, status = 200) {
  serveBlobFile.mockImplementation(() =>
    Promise.resolve(new Response(body, { status, headers: { "content-type": contentType } })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient.mockReturnValue({ storage: { from: () => ({ download: vi.fn() }) } });
  mockServedBody("<!doctype html><html><head></head><body>body</body></html>", "text/html; charset=utf-8");
});

function accessOf(share: CloudAppShareRow): AppShareAccess {
  return { kind: "ok", share };
}

describe("GET /api/a/[id]/f/[...path]", () => {
  it("returns 404 when the share row is missing", async () => {
    appShareAccess.mockResolvedValue({ kind: "missing" } satisfies AppShareAccess);
    const res = await get();
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 403 for any non-ok verdict (gated, login, denied, unconfigured)", async () => {
    const verdicts: AppShareAccess[] = [
      { kind: "denied" },
      { kind: "login" },
      { kind: "gate", mode: "email" },
      { kind: "unconfigured" },
    ];
    for (const verdict of verdicts) {
      appShareAccess.mockResolvedValue(verdict);
      const res = await get();
      expect(res.status).toBe(403);
    }
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-folder share (the share has no files to serve)", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ kind: "site", files: null })));
    const res = await get();
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the share is a folder but has no files map", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ files: null })));
    const res = await get();
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 404 for a path that isn't a key of the share's files map", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    const res = await get("s1", ["missing.html"]);
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the share's files map names a sha that isn't 64 hex chars", async () => {
    appShareAccess.mockResolvedValue(
      accessOf(folderShare({ files: { "index.html": "short", "app.js": "../../etc/passwd" } })),
    );
    const html = await get("s1", ["index.html"]);
    expect(html.status).toBe(404);
    const js = await get("s1", ["app.js"]);
    expect(js.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 503 when the service client is missing", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    serviceClient.mockReturnValue(null);
    const res = await get();
    expect(res.status).toBe(503);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("serves the file through serveBlobFile with the right sha and extension", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    const res = await get("s1", ["app.js"]);
    expect(serveBlobFile).toHaveBeenCalledWith(expect.anything(), "org-1", SHA, "js");
    expect(res.status).toBe(200);
  });

  it("serves nested files with the full path joined on /", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    await get("s1", ["assets", "x.png"]);
    expect(serveBlobFile).toHaveBeenCalledWith(expect.anything(), "org-1", SHA, "png");
  });

  it("passes through serveBlobFile's status when it returns an error", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    serveBlobFile.mockImplementation(() => Promise.resolve(new Response("Not found", { status: 404 })));
    const res = await get();
    expect(res.status).toBe(404);
  });

  it("uses no extension for a file without one", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ files: { Makefile: SHA } })));
    await get("s1", ["Makefile"]);
    expect(serveBlobFile).toHaveBeenCalledWith(expect.anything(), "org-1", SHA, "");
  });
});

describe("HTML bridge injection", () => {
  it("injects the bridge script right after <head> for an html file", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    const res = await get("s1", ["index.html"], "https://weft.zip");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/^<!doctype html><html><head><script>window\.weft[\s\S]*?<\/script>/);
    // The original body content is still in the response.
    expect(text).toContain("<body>body</body>");
  });

  it("returns a non-HTML file byte-identical (no script, no rewrite, same length)", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    const js = 'const x = "<body></body>";';
    const bytes = new TextEncoder().encode(js);
    mockServedBody(js, "text/javascript; charset=utf-8");
    const res = await get("s1", ["app.js"], "https://weft.zip");
    expect(res.status).toBe(200);
    const buffer = new Uint8Array(await res.arrayBuffer());
    expect(buffer).toEqual(bytes);
    const text = new TextDecoder().decode(buffer);
    expect(text).not.toContain("window.weft");
    expect(text).not.toMatch(/<script[^a-z]/);
  });

  it("returns a stylesheet byte-identical", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ files: { "style.css": SHA } })));
    const css = 'body { color: red; } /* a comment with quotes " and backslashes \\ */';
    serveBlobFile.mockImplementation(() =>
      Promise.resolve(new Response(css, { status: 200, headers: { "content-type": "text/css" } })),
    );
    const res = await get("s1", ["style.css"], "https://weft.zip");
    const text = await res.text();
    expect(text).toBe(css);
    expect(text).not.toContain("window.weft");
    expect(text).not.toMatch(/<script[^a-z]/);
  });

  it("returns an image byte-identical", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    serveBlobFile.mockImplementation(() =>
      Promise.resolve(new Response(bytes, { status: 200, headers: { "content-type": "image/png" } })),
    );
    const res = await get("s1", ["assets", "x.png"], "https://weft.zip");
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("treats .htm the same as .html for injection", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ files: { "page.htm": SHA } })));
    const res = await get("s1", ["page.htm"], "https://weft.zip");
    const text = await res.text();
    expect(text).toContain("<script>window.weft");
  });

  it("treats an extension case-insensitively for the injection check", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare({ files: { "PAGE.HTML": SHA } })));
    const res = await get("s1", ["PAGE.HTML"], "https://weft.zip");
    const text = await res.text();
    expect(text).toContain("<script>window.weft");
  });

  it("passes through serveBlobFile's status without injecting when the served blob 404s", async () => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
    serveBlobFile.mockImplementation(() => Promise.resolve(new Response("Not found", { status: 404 })));
    const res = await get();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });
});

describe("path validation", () => {
  beforeEach(() => {
    appShareAccess.mockResolvedValue(accessOf(folderShare()));
  });

  it.each([
    ["a `..` segment that tries to walk out of the folder", ["..", "index.html"]],
    ["a `.` segment that names the directory itself", ["."]],
    ["a backslash in a segment", ["..\\index.html"]],
    ["an encoded slash that would have split the path", ["%2F", "etc", "passwd"]],
    ["an encoded `..` segment", ["%2E%2E", "index.html"]],
    ["an empty segment", ["", "index.html"]],
    ["a segment with a colon (drive letter, scheme)", ["C:", "index.html"]],
    ["a segment with a space", ["my file.html"]],
    ["a leading slash in a segment", ["/etc", "passwd"]],
    ["a NUL byte", ["index\0.html"]],
  ])("returns 404 for %s", async (_label, path) => {
    const res = await get("s1", path);
    expect(res.status).toBe(404);
    expect(serveBlobFile).not.toHaveBeenCalled();
  });

  it("returns 404 when the path array is empty", async () => {
    const res = await get("s1", []);
    expect(res.status).toBe(404);
  });
});