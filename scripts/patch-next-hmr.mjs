// Patches a race in Next 16.4's Turbopack dev server that reloads the board in a loop on open
// (docs/bug-fixes/009-hmr-hash-mismatch-reload-loop.md).
//
// The server bumps its HMR version on every compile event, including the answer to a page's first
// chunk subscribe. A page that subscribes a second chunk (a lazy guarded() import) before that answer
// reaches it sends the old version, the server says "HMR hash mismatch" and reloads it, and the fresh
// page runs the same race again. Only a version newer than the server's proves the page came from an
// earlier server; an older one means updates are still on their way to a page that is already subscribed.
//
// Runs from postinstall; idempotent. Remove it once Next stops reloading on an older version.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STRICT = "parsedData.hmrVersion !== undefined && parsedData.hmrVersion !== String(clientHmrVersion)";
const RELAXED = "parsedData.hmrVersion !== undefined && Number(parsedData.hmrVersion) > clientHmrVersion";

export const TARGETS = [
  "node_modules/next/dist/server/dev/hot-reloader-turbopack.js",
  "node_modules/next/dist/esm/server/dev/hot-reloader-turbopack.js",
];

/** @typedef {"patched" | "already" | "missing"} PatchStatus "already": patched before; "missing": Next changed and the check isn't there. */

/**
 * @param {string} source
 * @returns {{ status: PatchStatus, source: string }}
 */
export function patchSource(source) {
  if (source.includes(RELAXED)) return { status: "already", source };
  if (!source.includes(STRICT)) return { status: "missing", source };
  return { status: "patched", source: source.replace(STRICT, RELAXED) };
}

/**
 * @param {string} root the project folder
 * @returns {{ file: string, status: PatchStatus }[]}
 */
export function patchNext(root) {
  return TARGETS.map((rel) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) return { file: rel, status: "missing" };
    const { status, source } = patchSource(fs.readFileSync(file, "utf8"));
    if (status === "patched") fs.writeFileSync(file, source);
    return { file: rel, status };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const { file, status } of patchNext(root)) {
    if (status === "missing") console.warn(`[patch-next-hmr] ${file}: the HMR version check changed; check whether the reload loop is fixed upstream.`);
  }
}
