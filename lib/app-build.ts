// Builds a mini app folder under ~/.weft/apps/<slug>/ (docs/architecture/mini-app-hosting.md). When the folder
// has App.tsx (or App.jsx) and either no index.html or an index.html Weft generated (a <!-- weft:generated -->
// marker), esbuild bundles the React app against Weft's own react and react-dom into static files: index.html,
// app.js, app.css, and assets/ for any imported images and fonts. A hand-written index.html is left alone and the
// build is reported as "skipped", not "ok", so a manual app stays manual. The build runs on the Mac only; on
// weft.zip the folder is uploaded as-is by the share flow, no esbuild involved. The HTML writing lives in
// lib/app-build-html.ts; the folder walk, hashing and entry/hand-written detection live in lib/app-build-inputs.ts.
// Pure except for fs and esbuild, so the watcher (lib/app-build-watch.ts) and the API route (app/api/apps/build)
// both call it directly.
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import {
  findEntry,
  hasHandWrittenIndex,
  hashInputs,
  inputsHasCss,
} from "./app-build-inputs";
import { appTitle, writeErrorIndexHtml, writeIndexHtml } from "./app-build-html";
import { isDeployed } from "./home";
import { DATA_DIR } from "./store";

export { isBuildOutput } from "./app-build-inputs";

export const APPS_DIR = () => path.join(DATA_DIR, "apps");
export const GENERATED_MARKER = "<!-- weft:generated -->";
const BUILD_FILE = ".weft-build.json";

// The rule for an app's folder name (the slug). 1 to 64 chars, lowercase letters and digits and inner hyphens,
// case-insensitive on accept so a sloppy client normalised upstream still lands; no dots or slashes so
// path.join(APPS_DIR(), slug) can't escape the apps dir. buildApp and the /api/apps/build route both
// validate before doing any I/O.
export const APP_FOLDER_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;
export function isAppFolderSlug(slug: string): boolean {
  return APP_FOLDER_SLUG_RE.test(slug);
}

// Bare imports Weft allows in an app; anything else is a build error naming the package, so a thread adding a
// dependency learns the rules instead of bundling a missing module.
const ALLOWED_BARE = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

export type BuildResult =
  | { ok: true; at: number; inputsHash: string; hasCss: boolean }
  | { ok: false; at: number; inputsHash: string; error: string }
  | { ok: "skipped"; reason: string; at: number; inputsHash: string };

export interface AppBuildInfo {
  ok: boolean | "skipped";
  error?: string;
  reason?: string;
  at: number;
  inputsHash: string;
}

// The slug (folder name under APPS_DIR) is also the path on disk; readBuildInfo returns the last record.
export function readBuildInfo(slug: string): AppBuildInfo | undefined {
  const file = path.join(APPS_DIR(), slug, BUILD_FILE);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AppBuildInfo>;
    if (typeof parsed.at !== "number" || typeof parsed.inputsHash !== "string") return undefined;
    const ok = parsed.ok === true || parsed.ok === false ? parsed.ok : parsed.ok === "skipped" ? "skipped" : null;
    if (ok === null) return undefined;
    return { ok, at: parsed.at, inputsHash: parsed.inputsHash, ...(typeof parsed.error === "string" ? { error: parsed.error } : {}) };
  } catch {
    return undefined;
  }
}

function writeBuildInfo(slug: string, info: AppBuildInfo) {
  const file = path.join(APPS_DIR(), slug, BUILD_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(info, null, 2));
}

// A friendly error from esbuild: the first error's text, no stack.
function esbuildError(err: unknown): string {
  if (err && typeof err === "object" && "errors" in err && Array.isArray((err as { errors?: unknown[] }).errors)) {
    const first = (err as { errors: { text?: string }[] }).errors[0];
    if (first?.text) return first.text;
  }
  if (err && typeof err === "object" && "message" in err) return String(err.message);
  return String(err);
}

// Catches a bare import the *app's* source files make: any specifier that doesn't start with "." or "/"
// and isn't in the allowlist fails the build with a message naming the package. Imports inside Weft's own
// node_modules (React's internals like scheduler) are exempt: only the app's own files are checked, so React
// 19 can pull its peer deps without us listing each one. The app's folder is realpath'd so macOS's /private
// symlinks (where os.tmpdir() returns /var/...) line up with esbuild's resolved importer paths; otherwise the
// check silently lets every import through.
function bareImportPlugin(folder: string): esbuild.Plugin {
  let resolvedAppDir: string;
  try {
    resolvedAppDir = fs.realpathSync(folder) + path.sep;
  } catch {
    resolvedAppDir = path.resolve(folder) + path.sep;
  }
  return {
    name: "weft-bare-imports",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (ALLOWED_BARE.has(args.path)) return undefined; // esbuild resolves it from Weft's node_modules
        const importer = args.importer;
        if (!importer) return undefined;
        if (!path.resolve(importer).startsWith(resolvedAppDir)) return undefined;
        return { errors: [{ text: `App imports "${args.path}" but only ${[...ALLOWED_BARE].join(", ")} are allowed. Install it as an app dependency later.` }] };
      });
    },
  };
}

// The wrapper esbuild bundles: imports the app's entry and renders it into #root. JSX automatic makes
// App.tsx a single <div> tree; the wrapper only mounts it. Written into a real file (not a virtual
// module) so esbuild's normal resolution finds it and the app's source files are the importers of
// every bare import — which lets the bare-import check know what's an app import vs a transitive one.
const ENTRY_BASENAME = ".weft-entry.js";

function writeEntryFile(entryDir: string, entryAbs: string): string {
  fs.mkdirSync(entryDir, { recursive: true });
  const file = path.join(entryDir, ENTRY_BASENAME);
  const rel = path.relative(path.dirname(file), entryAbs).replace(/\\/g, "/");
  const contents = `import App from "./${rel}";
import { createRoot } from "react-dom/client";
const root = document.getElementById("root");
if (root) createRoot(root).render(App);
`;
  fs.writeFileSync(file, contents);
  return file;
}

// Builds one folder. Returns the result and writes the build record; never throws.
export async function buildApp(slug: string, now: () => number = Date.now): Promise<BuildResult> {
  // Reject anything that would let path.join(APPS_DIR(), slug) escape the apps dir. The build
  // record writes to <apps>/<slug>/.weft-build.json, so a bad slug never gets the chance to write
  // outside the apps folder — we return the error without recording anything.
  if (!isAppFolderSlug(slug)) {
    const at = now();
    return { ok: false, at, inputsHash: "", error: `Invalid app folder name "${slug}".` };
  }
  const folder = path.join(APPS_DIR(), slug);
  const inputsHash = hashInputs(folder);
  if (isDeployed()) {
    const info: AppBuildInfo = { ok: "skipped", at: now(), inputsHash, reason: "deployed" };
    writeBuildInfo(slug, info);
    return { ok: "skipped", reason: "deployed", at: info.at, inputsHash };
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    const error = "App folder does not exist.";
    const info: AppBuildInfo = { ok: false, at: now(), inputsHash, error };
    writeBuildInfo(slug, info);
    return { ok: false, at: info.at, inputsHash, error };
  }
  if (hasHandWrittenIndex(folder)) {
    const info: AppBuildInfo = { ok: "skipped", at: now(), inputsHash, reason: "hand-written" };
    writeBuildInfo(slug, info);
    return { ok: "skipped", reason: "hand-written", at: info.at, inputsHash };
  }
  const entry = findEntry(folder);
  if (!entry) {
    const info: AppBuildInfo = { ok: "skipped", at: now(), inputsHash, reason: "no App.tsx" };
    writeBuildInfo(slug, info);
    return { ok: "skipped", reason: "no App.tsx", at: info.at, inputsHash };
  }
  // Keep the previous app.js so a broken build still loads in the pane, with an error message.
  const oldJs = path.join(folder, "app.js");
  const oldJsContents = fs.existsSync(oldJs) ? fs.readFileSync(oldJs, "utf8") : null;
  const title = appTitle(folder, slug);
  const hasCss = inputsHasCss(folder);
  const entryFile = writeEntryFile(path.join(folder, ".build"), entry);
  try {
    const result = await esbuild.build({
      entryPoints: [{ in: entryFile, out: "app" }],
      bundle: true,
      // outdir (not outfile) so the .css and asset loaders can drop their files beside app.js.
      outdir: folder,
      format: "iife",
      platform: "browser",
      target: "es2020",
      jsx: "automatic",
      minify: true,
      sourcemap: false,
      // CSS gets its own file; images and fonts are copied to assets/ via the file loader.
      loader: { ".css": "css", ".png": "file", ".jpg": "file", ".jpeg": "file", ".gif": "file", ".webp": "file", ".svg": "file", ".avif": "file", ".ico": "file", ".woff": "file", ".woff2": "file", ".ttf": "file", ".otf": "file" },
      assetNames: "assets/[name]-[hash]",
      // Weft's own React sits beside the build, so the wrapper can import react and react-dom/client.
      nodePaths: [path.join(process.cwd(), "node_modules")],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [bareImportPlugin(folder)],
      write: true,
      logLevel: "silent",
    });
    const firstError = result.errors[0];
    if (firstError) throw new Error(firstError.text);
    writeIndexHtml(folder, title, hasCss);
    const info: AppBuildInfo = { ok: true, at: now(), inputsHash };
    writeBuildInfo(slug, info);
    return { ok: true, at: info.at, inputsHash, hasCss };
  } catch (err) {
    // Restore the previous app.js so the page stays a working React app, just with an error banner.
    if (oldJsContents !== null) fs.writeFileSync(oldJs, oldJsContents);
    const message = esbuildError(err);
    writeErrorIndexHtml(folder, title, message);
    const info: AppBuildInfo = { ok: false, at: now(), inputsHash, error: message };
    writeBuildInfo(slug, info);
    return { ok: false, at: info.at, inputsHash, error: message };
  }
}