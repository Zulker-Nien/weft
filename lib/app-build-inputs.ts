// The files that go into a build's hash and the helpers that walk them. Extracted from lib/app-build.ts
// to keep that file under the 300-line cap; pure except for fs, so the test imports them directly.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Hidden files, node_modules and the build's own outputs (index.html, app.js, app.css, assets/, .build/) are
// excluded from the input list and the hash. Weft's watcher skips build outputs so a rebuild doesn't trigger
// itself; the hash covers the same set, so a touched input invalidates and esbuild re-runs.
export function isBuildOutput(folder: string, filePath: string): boolean {
  if (path.basename(filePath) === ".weft-build.json") return true;
  const rel = path.relative(folder, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const parts = rel.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.includes("assets") || parts.includes(".build")) return true;
  const tail = parts[parts.length - 1];
  if (parts.length <= 2 && (tail === "index.html" || tail === "app.js" || tail === "app.css")) return true;
  return false;
}

// The folder's entry (App.tsx or App.jsx) and the assets and modules it pulls in. Hidden files, node_modules and
// the build's own outputs are excluded. The hash covers everything esbuild would read, so a touched file invalidates.
export function listInputs(folder: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      if (isBuildOutput(folder, full)) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  visit(folder);
  return out.sort();
}

// SHA-256 of every input file's relative path and content; truncated to 16 hex chars because the value just
// has to change when an input changes.
export function hashInputs(folder: string): string {
  const inputs = listInputs(folder);
  const hash = createHash("sha256");
  for (const file of inputs) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      // A binary the hash should still cover: read a small slice so a permission error doesn't blank the hash.
      try {
        const buf = fs.readFileSync(file);
        content = buf.subarray(0, Math.min(buf.length, 64_000)).toString("base64");
      } catch {
        content = "";
      }
    }
    hash.update(path.relative(folder, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(content);
  }
  return hash.digest("hex").slice(0, 16);
}

// A small "any CSS imports?" check: walk the folder and look for a .css file. Cheap and good enough for whether
// to add <link rel="stylesheet">; esbuild bundles the actual styles.
export function inputsHasCss(folder: string): boolean {
  const visit = (dir: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (isBuildOutput(folder, path.join(dir, entry.name))) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (visit(full)) return true;
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".css") {
        return true;
      }
    }
    return false;
  };
  return visit(folder);
}

// Finds App.tsx (or App.jsx) in the folder's root.
export function findEntry(folder: string): string | undefined {
  for (const ext of [".tsx", ".jsx"]) {
    const candidate = path.join(folder, `App${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

// True when index.html looks hand-written (no <!-- weft:generated --> marker) and should be left alone.
export function hasHandWrittenIndex(folder: string): boolean {
  const index = path.join(folder, "index.html");
  if (!fs.existsSync(index)) return false;
  const text = fs.readFileSync(index, "utf8");
  return !text.includes("<!-- weft:generated -->");
}