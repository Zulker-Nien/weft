import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types";
import { BLOB_BUCKET, BLOB_REF_PREFIX, type BlobRef } from "./cloud-sync-types";
import { createBlobStore, isLocalUploadPath, sha256Of } from "./blob-store";

// A fake Supabase client whose storage.from(bucket).upload/download returns whatever the test
// queued next, so each test pushes one entry per expected call and inspects the recorded calls.
// The union shape matches the real storage-js types so the linter's narrowing is honest.
type UploadResult = { data?: { id: string; path: string; fullPath: string } | null; error: { name?: string; statusCode?: string; message?: string } | null };
type DownloadResult = { data: Blob | Uint8Array | null; error: { message: string } | null };
function makeClient() {
  const uploadCalls: Array<{ path: string; body: Buffer; opts: { contentType?: string; upsert?: boolean } }> = [];
  const downloadCalls: string[] = [];
  const uploads: UploadResult[] = [];
  const downloads: DownloadResult[] = [];
  const from = vi.fn((bucket: string) => {
    if (bucket !== BLOB_BUCKET) throw new Error(`unexpected bucket ${bucket}`);
    return {
      upload: (p: string, body: Buffer, opts: { contentType?: string; upsert?: boolean }) => {
        uploadCalls.push({ path: p, body, opts });
        return Promise.resolve(uploads.shift() ?? { data: { id: "x", path: p, fullPath: p }, error: null });
      },
      download: (p: string) => {
        downloadCalls.push(p);
        return Promise.resolve(downloads.shift() ?? { data: null, error: { message: "no data" } });
      },
    };
  });
  return { client: { storage: { from } } as never, uploadCalls, downloadCalls, uploads, downloads, from };
}

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "weft-blob-home-"));
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "weft-blob-data-"));
let envHome = "";
let envData = "";

const file = (name: string, bytes: Buffer | string = "hello") => {
  const p = path.join(HOME, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
};
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const cacheDir = () => path.join(DATA, "blob-cache");
const store = (m: ReturnType<typeof makeClient>) => createBlobStore({ client: m.client, cacheDir: cacheDir() });

beforeEach(() => {
  envHome = process.env.HOME ?? "";
  envData = process.env.THREADBOARD_DATA ?? "";
  process.env.HOME = HOME;
  process.env.THREADBOARD_DATA = DATA;
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(DATA, { recursive: true });
});
afterEach(() => {
  process.env.HOME = envHome;
  process.env.THREADBOARD_DATA = envData;
});

describe("isLocalUploadPath", () => {
  it("refuses empty, relative, and outside-home paths", () => {
    expect(isLocalUploadPath("", HOME)).toBe(false);
    expect(isLocalUploadPath("relative/x.png", HOME)).toBe(false);
    expect(isLocalUploadPath("/etc/passwd", HOME)).toBe(false);
  });
  it("accepts a file under the home directory", () => {
    expect(isLocalUploadPath(path.join(HOME, "a.png"), HOME)).toBe(true);
  });
  it("decodes file:// URLs before the check", () => {
    const p = path.join(HOME, "x.png");
    expect(isLocalUploadPath(`file://${p}`, HOME)).toBe(true);
    expect(isLocalUploadPath("file:///etc/passwd", HOME)).toBe(false);
  });
  it("refuses .env files, the device key, account files, token files, and the vault", () => {
    for (const n of [".env", ".env.local", "device-key.json", "account.json", "account.sealed", "puku-trial-token", "shell-token", "github-token.json"]) {
      expect(isLocalUploadPath(path.join(HOME, n), HOME)).toBe(false);
    }
    expect(isLocalUploadPath(path.join(HOME, ".weft", "vault", "x.json"), HOME)).toBe(false);
    expect(isLocalUploadPath(path.join(HOME, ".weft", "vault"), HOME)).toBe(false);
  });
});

describe("sha256Of", () => {
  it("returns null for a missing file or a directory, hashes a real file", async () => {
    expect(await sha256Of(path.join(HOME, "nope.png"))).toBeNull();
    fs.mkdirSync(path.join(HOME, "dir.png"), { recursive: true });
    expect(await sha256Of(path.join(HOME, "dir.png"))).toBeNull();
    const bytes = Buffer.from("abcdef");
    expect(await sha256Of(file("a.bin", bytes))).toBe(sha(bytes));
  });
});

describe("createBlobStore", () => {
  describe("refFor", () => {
    it("returns null for a missing file, blob:sha256:<hex> for a real one", async () => {
      const m = makeClient();
      expect(await store(m).refFor(path.join(HOME, "nope.png"))).toBeNull();
      const bytes = Buffer.from("the quick brown fox");
      expect(await store(m).refFor(file("a.bin", bytes))).toBe(`${BLOB_REF_PREFIX}${sha(bytes)}`);
    });
  });

  describe("upload", () => {
    it("returns null when the file is missing", async () => {
      const m = makeClient();
      expect(await store(m).upload(path.join(HOME, "nope.png"), "org1")).toBeNull();
    });

    it("uploads to <bucket>/<orgId>/<sha> with the right content type, upsert false", async () => {
      const bytes = Buffer.from("PNGbytes");
      const p = file("shot.png", bytes);
      const m = makeClient();
      m.uploads.push({ error: null });
      expect(await store(m).upload(p, "orgA")).toBe(`${BLOB_REF_PREFIX}${sha(bytes)}`);
      expect(m.from).toHaveBeenCalledWith(BLOB_BUCKET);
      expect(m.uploadCalls[0]).toEqual({ path: `orgA/${sha(bytes)}`, body: bytes, opts: { contentType: "image/png", upsert: false } });
    });

    it("uses the right content type for every supported extension", async () => {
      const m = makeClient();
      const types: Array<[string, string]> = [
        ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"], ["gif", "image/gif"],
        ["html", "text/html; charset=utf-8"], ["svg", "image/svg+xml"], ["pdf", "application/pdf"],
        ["bin", "application/octet-stream"],
      ];
      let n = 0;
      for (const [ext, type] of types) {
        const p = file(`x${n++}.${ext}`, `bytes-${n}`); // distinct bytes: avoid per-store cache
        m.uploads.push({ error: null });
        await store(m).upload(p, "orgA");
        expect(m.uploadCalls.at(-1)?.opts.contentType).toBe(type);
      }
    });

    it("treats 409 and 400 'already exists' as success and remembers the ref", async () => {
      const p = file("a.png", "x");
      for (const err of [
        { name: "StorageApiError", statusCode: "409", message: "duplicate" },
        { name: "StorageApiError", statusCode: "400", message: "The resource already exists" },
      ]) {
        const m = makeClient();
        m.uploads.push({ error: err });
        const s = store(m);
        const ref = await s.upload(p, "orgA");
        expect(ref).toMatch(/^blob:sha256:[0-9a-f]{64}$/);
        const before = m.uploadCalls.length;
        expect(await s.upload(p, "orgA")).toBe(ref);
        expect(m.uploadCalls.length).toBe(before);
      }
    });

    it("throws on a non-already-exists error (500, generic, or message-less 500)", async () => {
      const p = file("a.png", "x");
      for (const err of [
        { name: "StorageApiError", statusCode: "500", message: "boom" },
        { name: "OtherError", message: "no internet" },
        { name: "StorageApiError", statusCode: "500" },
      ]) {
        const m = makeClient();
        m.uploads.push({ error: err });
        await expect(store(m).upload(p, "orgA")).rejects.toBeTruthy();
      }
    });

    it("uses dataDir/blob-cache when cacheDir is omitted, and the module default otherwise", async () => {
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null });
      expect(await createBlobStore({ client: m.client, dataDir: DATA }).upload(file("a.png", "1"), "orgA")).toMatch(/^blob:sha256:/);
      expect(await createBlobStore({ client: m.client }).upload(file("b.png", "2"), "orgA")).toMatch(/^blob:sha256:/);
    });
  });

  describe("rewriteItem", () => {
    it("returns the item unchanged when nothing in it points at a local file", async () => {
      const m = makeClient();
      const item = { kind: "user", text: "Hello world, no images here.", at: 1 } as const;
      expect(await store(m).rewriteItem(item, "orgA")).toBe(item);
    });

    it("uploads and rewrites tool.images entries that are local files", async () => {
      const p1 = file("shot1.png", "1");
      const p2 = file("shot2.jpg", "22");
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null });
      const item: ThreadItem = { kind: "tool", id: "t1", name: "Bash", summary: "", at: 1, images: [p1, "/api/attachments/keep.png", `file://${p2}`] };
      const out = await store(m).rewriteItem(item, "orgA");
      expect(out).not.toBe(item);
      if (out.kind === "tool") {
        expect(out.images?.[0]).toMatch(/^blob:sha256:/);
        expect(out.images?.[1]).toBe("/api/attachments/keep.png");
        expect(out.images?.[2]).toMatch(/^blob:sha256:/);
      } else throw new Error("kind changed");
    });

    it("rewrites a user.page that is a local file or a file:// URL", async () => {
      const p = file("page.html", "<html></html>");
      const m = makeClient();
      m.uploads.push({ error: null });
      const out = await store(m).rewriteItem({ kind: "user", text: "", at: 1, page: `file://${p}` } as const, "orgA");
      if (out.kind === "user") expect(out.page).toMatch(/^blob:sha256:/);
      else throw new Error("kind changed");
    });

    it("leaves a user.page that is http or a missing file alone", async () => {
      const m = makeClient();
      const s = store(m);
      expect(await s.rewriteItem({ kind: "user", text: "", at: 1, page: "https://example.com" } as const, "orgA")).toEqual({ kind: "user", text: "", at: 1, page: "https://example.com" });
      expect(await s.rewriteItem({ kind: "user", text: "", at: 1, page: path.join(HOME, "nope.html") } as const, "orgA")).toEqual({ kind: "user", text: "", at: 1, page: path.join(HOME, "nope.html") });
    });

    it("rewrites markdown image targets (bare and angle-bracketed) and leaves http/localhost alone", async () => {
      const p1 = file("pic.png", "P1");
      const p2 = file("p2.png", "P2");
      const m = makeClient();
      m.uploads.push({ error: null }, { error: null }, { error: null });
      const s = store(m);
      const user = { kind: "user", text: `look ![a](${p1}) and ![b](https://x.test/y)`, at: 1 } as const;
      const out = await s.rewriteItem(user, "orgA");
      if (out.kind === "user") {
        expect(out.text).toMatch(/!\[a\]\(blob:sha256:[0-9a-f]{64}\)/);
        expect(out.text).toContain("https://x.test/y");
      } else throw new Error("kind changed");
      const assistant = { kind: "assistant", text: `![p](<${p2}>)`, at: 1 } as const;
      const out2 = await s.rewriteItem(assistant, "orgA");
      if (out2.kind === "assistant") expect(out2.text).toMatch(/!\[p\]\(blob:sha256:[0-9a-f]{64}\)/);
      else throw new Error("kind changed");
      const skip = { kind: "assistant", text: "![r](https://x.test/y) ![l](http://localhost:3000/a)", at: 1 } as const;
      expect(await s.rewriteItem(skip, "orgA")).toBe(skip);
    });

    it("leaves non-tool, non-user, non-assistant items, tools without images, and unsafe paths alone", async () => {
      const m = makeClient();
      const s = store(m);
      expect(await s.rewriteItem({ kind: "result", text: "ok", isError: false, at: 1 } as const, "orgA")).toEqual({ kind: "result", text: "ok", isError: false, at: 1 });
      expect(await s.rewriteItem({ kind: "tool", id: "t1", name: "Bash", summary: "x", at: 1 } as const, "orgA")).toEqual({ kind: "tool", id: "t1", name: "Bash", summary: "x", at: 1 });
      const outside = { kind: "assistant", text: "![o](/etc/passwd)", at: 1 } as const;
      expect(await s.rewriteItem(outside, "orgA")).toBe(outside);
      const missing = { kind: "assistant", text: `![m](${path.join(HOME, "missing.png")})`, at: 1 } as const;
      expect(await s.rewriteItem(missing, "orgA")).toBe(missing);
      fs.mkdirSync(path.join(HOME, ".weft", "vault"), { recursive: true });
      const secret = path.join(HOME, ".weft", "vault", "k.json");
      fs.writeFileSync(secret, "{}");
      const token = path.join(HOME, "puku-trial-token");
      fs.writeFileSync(token, "x");
      const a = { kind: "assistant", text: `![v](${secret}) ![t](${token})`, at: 1 } as const;
      expect(await s.rewriteItem(a, "orgA")).toBe(a);
    });
  });

  describe("fetchBlob", () => {
    // Each test uses a unique ref so a write to the cache in one test doesn't short-circuit the
    // next test's download or error case.
    const refA: BlobRef = `blob:sha256:${"a".repeat(64)}`;
    const refB: BlobRef = `blob:sha256:${"b".repeat(64)}`;
    const refC: BlobRef = `blob:sha256:${"c".repeat(64)}`;
    const refD: BlobRef = `blob:sha256:${"d".repeat(64)}`;

    it("returns null for a malformed ref, returns the cached file when present, downloads a Blob on miss", async () => {
      const bad = "blob:sha256:nothex";
      expect(await store(makeClient()).fetchBlob(bad as never, "orgA")).toBeNull();
      fs.mkdirSync(cacheDir(), { recursive: true });
      const cached = path.join(cacheDir(), "a".repeat(64));
      fs.writeFileSync(cached, "cached!");
      const m1 = makeClient();
      expect(await store(m1).fetchBlob(refA, "orgA")).toBe(cached);
      expect(m1.downloadCalls).toHaveLength(0);
      const m2 = makeClient();
      m2.downloads.push({ data: new Blob(["hello"]), error: null });
      const out = await store(m2).fetchBlob(refB, "orgA");
      expect(m2.downloadCalls).toEqual([`orgA/${"b".repeat(64)}`]);
      expect(out && fs.readFileSync(out, "utf8")).toBe("hello");
    });

    it("downloads a non-Blob body and returns null on error or empty body", async () => {
      const m1 = makeClient();
      m1.downloads.push({ data: new Uint8Array([104, 105]), error: null });
      const out = await store(m1).fetchBlob(refC, "orgA");
      expect(out && fs.readFileSync(out, "utf8")).toBe("hi");
      const m2 = makeClient();
      m2.downloads.push({ data: null, error: { message: "nope" } });
      expect(await store(m2).fetchBlob(refD, "orgA")).toBeNull();
    });
  });
});
