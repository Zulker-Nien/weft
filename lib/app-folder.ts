// A folder app under ~/.weft/apps/<slug>/ (docs/architecture/mini-apps.md): every file in the folder
// becomes one blob in weft-blobs, written into cloud_app_shares.files, and served by path
// (app/a/[id]/[...path]). A folder is only an app when the page lives one level under
// ~/.weft/apps/ and sits beside a weft-app.json; the rest stays a single-file app.
import fs from "node:fs";
import path from "node:path";
import { findSecret } from "./secret-detect";
import { DATA_DIR } from "./store";

// Where app folders live; tests override WEFT_DATA, so this stays a function (matches lib/app-cloud.ts).
const APPS_DIR = () => path.join(DATA_DIR, "apps");

// One entry from the folder scan: absolute path on disk, the relative path the row stores, and
// the file's size. A small set of extensions and folders are refused, so the upload can pass the
// result to the blob store without re-checking.
export interface AppFolderFile {
  // The file on disk, in this Mac's home.
  absolute: string;
  // Forward slashes, no leading /, no ..; the row's files map keys on this.
  relative: string;
  size: number;
}

// Refused extensions: the source files that would either bloat a hosted page or carry a build
// pipeline the share can't run.
const REFUSED_EXTENSIONS = new Set([".ts", ".tsx", ".jsx", ".mts", ".cts"]);
const REFUSED_NAMES = new Set(["weft-app.json", "node_modules"]);

// How much a folder app may contain before the share is refused.
export const APP_FOLDER_MAX_FILES = 2000;
export const APP_FOLDER_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const APP_FOLDER_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// A refusal the route turns into its 400 message; file names the offending path when one is at fault.
export class AppFolderError extends Error {}

// True when this app's URL is a file under ~/.weft/apps/<slug>/. The entry is always
// "index.html" today (lib/app-cloud.ts assumes the same).
export function isAppFolderUrl(url: string): { folder: string; entry: string } | null {
  if (!url.startsWith("file:")) return null;
  const local = path.resolve(decodeURI(url.replace(/^file:\/\//, "").split("#")[0] ?? ""));
  if (path.dirname(path.dirname(local)) !== APPS_DIR()) return null;
  return { folder: path.dirname(local), entry: path.basename(local) };
}

// A text file's content type: the secret scan only runs on text. The first 8 KB tells us whether
// the file decodes as utf-8 with no NUL bytes, the only signal that matters (the mime by extension
// is what an attacker would rename a key-laden file to). Capped so a 25 MB binary doesn't sit in
// memory for the scan; the scan reads the whole string from the rest of the file regardless.
const TEXT_PROBE_BYTES = 8 * 1024;

// True when the first TEXT_PROBE_BYTES decode as utf-8 with no NUL. A real PNG starts with a NUL;
// a renamed text file never does. We don't trust the mime by extension, since renaming a key-laden
// .txt to .png is the bypass: the scan never sees it. The scan itself reads the whole file.
function isProbablyText(absolute: string): boolean {
  let fd: fs.promises.FileHandle | number | undefined;
  try {
    fd = fs.openSync(absolute, "r");
    const buf = Buffer.alloc(TEXT_PROBE_BYTES);
    const read = fs.readSync(fd, buf, 0, TEXT_PROBE_BYTES, 0);
    const probe = buf.subarray(0, read);
    if (probe.includes(0)) return false;
    // Buffer.toString() with utf8 drops invalid sequences, so an invalid sequence becomes a uFFFD
    // the scan would still see. A uFFFD itself doesn't mark the file binary; instead, re-encode and
    // compare: any difference means the bytes weren't utf-8 in the first place.
    const decoded = probe.toString("utf8");
    return Buffer.from(decoded, "utf8").equals(probe);
  } catch {
    return false;
  } finally {
    if (typeof fd === "number") fs.closeSync(fd);
  }
}

// A list of the folder's files the share may upload, in stable order. Hidden entries
// (anything starting with a dot) are dropped. weft-app.json itself is dropped, because the row
// keeps a reduced version of it as the manifest. Source extensions under REFUSED_EXTENSIONS are
// dropped so a half-built React app's TypeScript doesn't end up in a hosted bundle. The total
// count, per-file size and total size are checked here, with the offending file in the error.
export function listAppFolderFiles(folder: string): AppFolderFile[] {
  const out: AppFolderFile[] = [];
  let total = 0;
  walk(folder, folder, out, (rel) => {
    if (rel === "" || rel.startsWith(".") || rel.split("/").some((p) => p.startsWith("."))) return true;
    if (REFUSED_NAMES.has(path.basename(rel))) return true;
    if (REFUSED_EXTENSIONS.has(path.extname(rel).toLowerCase())) return true;
    return false;
  }, (file) => {
    if (out.length >= APP_FOLDER_MAX_FILES) throw new AppFolderError(`Too many files (over ${APP_FOLDER_MAX_FILES}).`);
    const stat = fs.statSync(file);
    if (stat.size > APP_FOLDER_MAX_FILE_BYTES) throw new AppFolderError(`${path.relative(folder, file)} is over 25 MB.`);
    total += stat.size;
    if (total > APP_FOLDER_MAX_TOTAL_BYTES) throw new AppFolderError(`The folder is over 50 MB.`);
  });
  return out;
}

// Symlink-safe walker: recurses only when a directory is a real dir, not a symlink that could
// point outside the folder. `refuse` and `onFile` may throw to short-circuit the walk.
function walk(
  root: string,
  dir: string,
  out: AppFolderFile[],
  refuse: (relative: string) => boolean,
  onFile: (absolute: string) => void,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) continue; // never follow
    if (entry.isDirectory()) {
      if (refuse(relative + "/")) continue;
      walk(root, absolute, out, refuse, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (refuse(relative)) continue;
    onFile(absolute);
    out.push({ absolute, relative, size: fs.statSync(absolute).size });
  }
}

// The manifest for the share row, reduced from weft-app.json: only the policy bits the share
// can act on. `folder` and `env` are local pointers that must never leave the Mac.
export interface AppManifestUpload {
  secrets?: Record<string, unknown>;
  public?: string[];
  reads?: Record<string, unknown>;
  supabaseUrl?: string;
}

export function reducedManifest(raw: unknown): AppManifestUpload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  return {
    ...(isPlain(r.secrets) ? { secrets: r.secrets } : {}),
    ...(Array.isArray(r.public) ? { public: r.public } : {}),
    ...(isPlain(r.reads) ? { reads: r.reads } : {}),
    ...(typeof r.supabaseUrl === "string" ? { supabaseUrl: r.supabaseUrl } : {}),
  };
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// A file's bytes, when it might be a secret; null for binary files (we never look inside real
// images, fonts or binaries). The scan skips a file the moment its first 8 KB isn't utf-8 text,
// so a renamed key-laden text file always trips the rule and a real PNG never does.
export function secretHit(file: AppFolderFile): string | null {
  if (!isProbablyText(file.absolute)) return null;
  const text = fs.readFileSync(file.absolute, "utf8");
  const hit = findSecret(text);
  if (!hit) return null;
  return `${file.relative} looks like ${hit.kind} (${hit.preview}). Remove it before sharing.`;
}
