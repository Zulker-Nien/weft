// The content-addressed blob store for server-side cards: file paths in a ThreadItem (a pasted
// image, a tool screenshot, a ~/.weft/show page) are swapped for `blob:sha256:<hex>` refs and
// uploaded once to the weft-blobs bucket. The outbox (lib/cloud-sync.ts) calls rewriteItem on
// each row before it goes to Supabase; the receiver calls fetchBlob to materialise a ref back
// into a file under DATA_DIR/blob-cache/.
//
// We refuse paths outside the user's home directory, the vault, anything that looks like a
// secret (account*, *-token.json, device-key.json, anything starting with .env). A file:// URL
// or an absolute path that doesn't exist on disk is left alone, so a row that mentions a missing
// image still round-trips.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BLOB_BUCKET,
  BLOB_REF_PREFIX,
  isBlobRef,
  type BlobRef,
} from "./cloud-sync-types";
import { MEDIA_REF, extensionOf } from "./media";
import { DATA_DIR } from "./store";
import type { ThreadItem } from "./types";

// The cache lives in DATA_DIR/blob-cache, but tests (and an alternate DATA_DIR) override it.
const DEFAULT_CACHE_DIR = path.join(DATA_DIR, "blob-cache");

// Per-extension mime override for the upload's content-type, since the mime table in
// lib/attachments.ts has video and audio types we don't accept on this store. The list here
// matches what the outbox might actually upload: images, the HTML pages from lib/glance.ts,
// SVGs, and PDFs.
const BLOB_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

function contentTypeFor(file: string) {
  return BLOB_MIME[extensionOf(file)] ?? "application/octet-stream";
}

// A basename that we never want to upload: secrets, account state, the device key, any token
// file, the whole vault folder. Matched case-insensitively.
const SECRET_BASENAMES = new Set(["device-key.json", "account.json", "account.sealed"]);

function basenameIsSecret(base: string) {
  const lower = base.toLowerCase();
  if (lower.startsWith(".env")) return true;
  if (SECRET_BASENAMES.has(lower)) return true;
  return lower.endsWith("-token.json") || lower.endsWith("-token");
}

// A path is safe to upload only when it lives under the home directory and doesn't point at
// secrets the vault owns. The outbox already filters by these rules; this is a defence in depth
// so a misbehaving caller can't push a token out.
export function isLocalUploadPath(p: string, home = os.homedir()): boolean {
  if (!p) return false;
  // file:// URLs get resolved to their path before the rest of the check.
  const fileUrl = /^file:\/\/(.+)$/i.exec(p);
  const target = fileUrl ? decodeURI(fileUrl[1] ?? "") : p;
  if (!target.startsWith("/")) return false;
  if (!target.startsWith(home + path.sep) && target !== home) return false;
  if (basenameIsSecret(path.basename(target))) return false;
  // Anywhere under ~/.weft/vault holds decrypted secrets; never upload from there.
  const vault = path.join(home, ".weft", "vault");
  if (target === vault || target.startsWith(vault + path.sep)) return false;
  return true;
}

// Resolves a string the item named (a markdown target, a page field) to a local file path when
// it's safe to upload; null when it should be left alone (http, localhost, missing, secret).
function resolveLocalPath(raw: string, home = os.homedir()): string | null {
  if (!raw) return null;
  // http(s) and any localhost reference stays as-is so the row's reader can still fetch it.
  if (/^https?:\/\//i.test(raw)) return null;
  if (/^[a-z]+:\/\/localhost(?::\d+)?/i.test(raw)) return null;
  if (!isLocalUploadPath(raw, home)) return null;
  // Strip file:// if it slipped through and resolve to a real path on disk.
  const fileUrl = /^file:\/\/(.+)$/i.exec(raw);
  const local = fileUrl ? decodeURI(fileUrl[1] ?? "") : raw;
  if (!fs.existsSync(local) || !fs.statSync(local).isFile()) return null;
  return local;
}

// SHA-256 of a local file, streamed so a 2 GB screenshot doesn't pin itself in memory; null when
// the file isn't there (or isn't a regular file).
export async function sha256Of(localPath: string): Promise<string | null> {
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) return null;
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(localPath), hash);
  return hash.digest("hex");
}

function blobRefFor(sha: string): BlobRef {
  return `${BLOB_REF_PREFIX}${sha}`;
}

function objectPath(orgId: string, sha: string) {
  return `${orgId}/${sha}`;
}

function isAlreadyExists(err: { name?: string; statusCode?: string; message?: string } | null | undefined) {
  if (!err) return false;
  if (err.name === "StorageApiError" && (err.statusCode === "409" || err.statusCode === "400")) return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate");
}

// Collects every local-path substring a markdown body's image / link targets point at, in
// source order. Each target is resolved (or null) up front; the caller awaits the uploads and
// splices the refs back in. Angle-bracketed and bare targets both come back as the raw string.
function findMarkdownLocalPaths(text: string, home: string): string[] {
  const locals: string[] = [];
  for (const match of text.matchAll(MEDIA_REF)) {
    // MEDIA_REF guarantees one of the two capture groups: an angled target first, else the bare one.
    const target = (match[2] ?? match[3] ?? "").trim();
    const local = resolveLocalPath(target, home);
    locals.push(local ?? "");
  }
  return locals;
}

export interface CreateBlobStoreOptions {
  client: SupabaseClient;
  dataDir?: string;
  cacheDir?: string;
}

export interface BlobStoreBundle {
  refFor(localPath: string): Promise<BlobRef | null>;
  upload(localPath: string, orgId: string): Promise<BlobRef | null>;
  rewriteItem(item: ThreadItem, orgId: string): Promise<ThreadItem>;
  fetchBlob(ref: BlobRef, orgId: string): Promise<string | null>;
}

function cacheDirFor(opts: CreateBlobStoreOptions) {
  if (opts.cacheDir) return opts.cacheDir;
  if (opts.dataDir) return path.join(opts.dataDir, "blob-cache");
  return DEFAULT_CACHE_DIR;
}

export function createBlobStore(opts: CreateBlobStoreOptions): BlobStoreBundle {
  const client = opts.client;
  const cacheDir = cacheDirFor(opts);
  const uploaded = new Set<string>();
  const bucket = () => client.storage.from(BLOB_BUCKET);

  async function refFor(localPath: string): Promise<BlobRef | null> {
    const sha = await sha256Of(localPath);
    return sha ? blobRefFor(sha) : null;
  }

  async function upload(localPath: string, orgId: string): Promise<BlobRef | null> {
    const sha = await sha256Of(localPath);
    if (!sha) return null;
    const ref = blobRefFor(sha);
    if (uploaded.has(ref)) return ref;
    const body = fs.readFileSync(localPath);
    const { error } = await bucket().upload(objectPath(orgId, sha), body, {
      contentType: contentTypeFor(localPath),
      upsert: false,
    });
    // 409 (and 400 with "already exists"): the sha is content-addressed, so the same bytes are
    // there. Treat it as success and remember the sha so we don't re-check.
    if (error && !isAlreadyExists(error)) throw error;
    uploaded.add(ref);
    return ref;
  }

  // A tool item's images array: each entry is rewritten to a blob ref (or left as-is).
  async function rewriteToolImages(images: string[], orgId: string, home: string): Promise<string[] | null> {
    let changed = false;
    const refs: string[] = [];
    for (const url of images) {
      const local = resolveLocalPath(url, home);
      if (local) {
        const ref = await upload(local, orgId);
        if (ref) {
          refs.push(ref);
          if (ref !== url) changed = true;
          continue;
        }
      }
      refs.push(url);
    }
    return changed ? refs : null;
  }

  // A user item's page: a file:// URL or absolute path under home becomes a blob ref.
  async function rewriteUserPage(page: string, orgId: string, home: string): Promise<BlobRef | null> {
    const local = resolveLocalPath(page, home);
    if (!local) return null;
    const ref = await upload(local, orgId);
    return ref && ref !== page ? ref : null;
  }

  // Rewrites a markdown body's local image targets, returning the new text (or null when
  // nothing changed). The replacement is exactly the input with each match's target swapped;
  // markdown text we can't resolve stays where it was.
  async function rewriteMarkdownText(text: string, orgId: string, home: string): Promise<string | null> {
    const locals = findMarkdownLocalPaths(text, home);
    if (!locals.some(Boolean)) return null;
    const refsByLocal: Array<BlobRef | null> = [];
    for (const local of locals) {
      if (!local) {
        refsByLocal.push(null);
        continue;
      }
      refsByLocal.push(await upload(local, orgId));
    }
    let i = 0;
    const next = text.replace(MEDIA_REF, (whole, alt: string) => {
      const ref = refsByLocal[i++];
      return ref ? `![${alt}](${ref})` : whole;
    });
    return next !== text ? next : null;
  }

  async function rewriteItem(item: ThreadItem, orgId: string): Promise<ThreadItem> {
    const home = os.homedir();

    if (item.kind === "tool") {
      const images = item.images?.length ? await rewriteToolImages(item.images, orgId, home) : null;
      return images ? { ...item, images } : item;
    }

    if (item.kind === "user" || item.kind === "assistant") {
      const page = item.kind === "user" && item.page ? await rewriteUserPage(item.page, orgId, home) : null;
      const text = item.text ? await rewriteMarkdownText(item.text, orgId, home) : null;
      if (!page && !text) return item;
      return { ...item, ...(page ? { page } : {}), ...(text ? { text } : {}) };
    }

    return item;
  }

  async function fetchBlob(ref: BlobRef, orgId: string): Promise<string | null> {
    if (!isBlobRef(ref)) return null;
    const sha = ref.slice(BLOB_REF_PREFIX.length);
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = path.join(cacheDir, sha);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    const { data, error } = await bucket().download(objectPath(orgId, sha));
    if (error) return null;
    // The storage client returns a Blob; write it to the cache file. A non-Blob falls back to
    // the ArrayBuffer path.
    const bytes = data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : Buffer.from(new Uint8Array(data).buffer);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, file);
    return file;
  }

  return { refFor, upload, rewriteItem, fetchBlob };
}
