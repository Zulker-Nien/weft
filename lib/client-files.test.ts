// lib/client-files.ts: the editor column's calls to /api/cards/<id>/files. fetch is faked, so every
// branch of call() runs: the JSON parse, the 409 that becomes a FileConflictError, the failed
// request that reuses the server's error, and the body-less one that falls back to a generic
// message. Each helper's URL, method and body are checked too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileConflictError, filesApi, type OpenedFile } from "./client-files";

const HEADERS = { "content-type": "application/json", "x-weft-token": "1" };

const file: OpenedFile = {
  path: "src/a.tsx",
  exists: true,
  text: "hello\n",
  hash: "abc123",
  mtime: 1_700_000_000_000,
  size: 6,
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
function fail(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}
function noBody(status: number): Response {
  // A body that isn't JSON, so res.json() rejects and call() falls back.
  return new Response("<html>nope</html>", { status, headers: { "content-type": "text/html" } });
}

let fetchMock = vi.fn();

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (i = 0) => fetchMock.mock.calls[i] as [string, RequestInit];

describe("filesApi.read", () => {
  it("GETs the file and returns it", async () => {
    fetchMock.mockResolvedValueOnce(ok({ file }));
    expect(await filesApi.read("card 1", "src/a.tsx")).toEqual(file);
    expect(call()).toEqual(["/api/cards/card%201/files?path=src%2Fa.tsx", { headers: HEADERS }]);
  });

  it("returns a file that doesn't exist", async () => {
    const missing: OpenedFile = { path: "nope.ts", exists: false, text: "", hash: null, mtime: null, size: 0 };
    fetchMock.mockResolvedValueOnce(ok({ file: missing }));
    expect(await filesApi.read("c1", "nope.ts")).toEqual(missing);
  });

  it("encodes a path with slashes and spaces", async () => {
    fetchMock.mockResolvedValueOnce(ok({ file }));
    await filesApi.read("c1", "my folder/a b.txt");
    expect(call()[0]).toBe("/api/cards/c1/files?path=my%20folder%2Fa%20b.txt");
  });
});

describe("filesApi.stat", () => {
  it("GETs with op=stat and returns the stat", async () => {
    fetchMock.mockResolvedValueOnce(ok({ stat: { exists: true, mtime: 5, size: 10 } }));
    expect(await filesApi.stat("c1", "src/a.tsx")).toEqual({ exists: true, mtime: 5, size: 10 });
    expect(call()[0]).toBe("/api/cards/c1/files?path=src%2Fa.tsx&op=stat");
  });

  it("returns the stat of a file that doesn't exist", async () => {
    fetchMock.mockResolvedValueOnce(ok({ stat: { exists: false, mtime: null, size: 0 } }));
    expect(await filesApi.stat("c1", "nope")).toEqual({ exists: false, mtime: null, size: 0 });
  });
});

describe("filesApi.head", () => {
  it("GETs with op=head and returns the HEAD text", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: "committed\n" }));
    expect(await filesApi.head("c1", "src/a.tsx")).toBe("committed\n");
    expect(call()[0]).toBe("/api/cards/c1/files?path=src%2Fa.tsx&op=head");
  });

  it("returns null for an untracked file", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: null }));
    expect(await filesApi.head("c1", "untracked.ts")).toBeNull();
  });
});

describe("filesApi.list", () => {
  it("GETs with op=list and returns the file names", async () => {
    fetchMock.mockResolvedValueOnce(ok({ files: ["src/a.tsx", "README.md"] }));
    expect(await filesApi.list("c1")).toEqual(["src/a.tsx", "README.md"]);
    expect(call()).toEqual(["/api/cards/c1/files?op=list", { headers: HEADERS }]);
  });

  it("returns an empty list", async () => {
    fetchMock.mockResolvedValueOnce(ok({ files: [] }));
    expect(await filesApi.list("c1")).toEqual([]);
  });
});

describe("filesApi.write", () => {
  it("PUTs the text with its baseHash and returns the saved hash and mtime", async () => {
    fetchMock.mockResolvedValueOnce(ok({ hash: "def456", mtime: 1_700_000_100_000 }));
    expect(await filesApi.write("c1", "src/a.tsx", "hello\n", "abc123")).toEqual({
      hash: "def456",
      mtime: 1_700_000_100_000,
    });
    expect(call()).toEqual([
      "/api/cards/c1/files",
      {
        method: "PUT",
        headers: HEADERS,
        body: JSON.stringify({ path: "src/a.tsx", text: "hello\n", baseHash: "abc123" }),
      },
    ]);
  });

  it("sends a null baseHash for a file that didn't exist", async () => {
    fetchMock.mockResolvedValueOnce(ok({ hash: "h", mtime: 1 }));
    await filesApi.write("c1", "new.ts", "hi", null);
    expect(JSON.parse(call()[1].body as string)).toEqual({ path: "new.ts", text: "hi", baseHash: null });
  });

  it("leaves baseHash out of the request when it's undefined (overwrite blindly)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ hash: "h", mtime: 1 }));
    await filesApi.write("c1", "src/a.tsx", "hello\n");
    // JSON.stringify drops the undefined key, so the server sees no baseHash at all.
    expect(JSON.parse(call()[1].body as string)).toEqual({ path: "src/a.tsx", text: "hello\n" });
  });

  it("throws a FileConflictError carrying what's on disk now when the file changed", async () => {
    const current: OpenedFile = { path: "src/a.tsx", exists: true, text: "changed elsewhere\n", hash: "zzz", mtime: 2, size: 17 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ conflict: true, current }), { status: 409 }));
    const error = await filesApi.write("c1", "src/a.tsx", "mine\n", "abc123").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileConflictError);
    expect(error).toMatchObject({ name: "FileConflictError" });
  });

  it("names the file and says why in the conflict's message", async () => {
    const current: OpenedFile = { path: "src/a.tsx", exists: true, text: "x", hash: "z", mtime: 2, size: 1 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ current }), { status: 409 }));
    const error = await filesApi.write("c1", "src/a.tsx", "mine\n", "abc123").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileConflictError);
    expect((error as FileConflictError).message).toBe("src/a.tsx changed on disk since you opened it.");
    expect((error as FileConflictError).current).toEqual(current);
  });

  it("reports a conflict for a file that was deleted between read and write", async () => {
    const gone: OpenedFile = { path: "src/a.tsx", exists: false, text: "", hash: null, mtime: null, size: 0 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ current: gone }), { status: 409 }));
    const error = await filesApi.write("c1", "src/a.tsx", "mine\n", "abc123").catch((e: unknown) => e);
    expect((error as FileConflictError).current).toEqual(gone);
  });

  it("rejects with the server's error message", async () => {
    fetchMock.mockResolvedValueOnce(fail(400, "secret file"));
    await expect(filesApi.read("c1", ".env")).rejects.toThrow("secret file");
  });

  it("rejects with the server's error on a 500", async () => {
    fetchMock.mockResolvedValueOnce(fail(500, "boom"));
    await expect(filesApi.stat("c1", "a.ts")).rejects.toThrow("boom");
  });
});

describe("call() error handling", () => {
  it("falls back to a generic message when the failure has no JSON body", async () => {
    fetchMock.mockResolvedValueOnce(noBody(500));
    await expect(filesApi.read("c1", "a.ts")).rejects.toThrow("Request failed (500).");
  });

  it("falls back to a generic message when the body is empty", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(filesApi.list("c1")).rejects.toThrow("Request failed (503).");
  });

  it("falls back to a generic message when a failed response parses to nothing usable", async () => {
    // Valid JSON, but no error field, and not ok.
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    await expect(filesApi.head("c1", "a.ts")).rejects.toThrow("Request failed (400).");
  });

  it("treats an ok response with an unparseable body as a failure", async () => {
    fetchMock.mockResolvedValueOnce(noBody(200));
    await expect(filesApi.list("c1")).rejects.toThrow("Request failed (200).");
  });

  it("falls back for a 409 that carries no current file", async () => {
    // A conflict without `current` isn't a conflict call() can build an error from.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }));
    await expect(filesApi.write("c1", "a.ts", "x", "h")).rejects.toThrow("conflict");
  });

  it("uses the server's error on a 409 with an error but no current", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "conflict, no current" }), { status: 409 }));
    await expect(filesApi.write("c1", "a.ts", "x", "h")).rejects.toThrow("conflict, no current");
  });

  it("lets a network failure through as-is", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(filesApi.read("c1", "a.ts")).rejects.toThrow("Failed to fetch");
  });
});