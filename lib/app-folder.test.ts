import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// lib/app-folder.ts: which files under ~/.weft/apps/<slug>/ the share may upload, and the manifest
// reduction + secret scan. The store lives in a tmp dir (WEFT_DATA), the same way lib/app-cloud.test.ts
// sets it up; the folder helper finds apps under <tmp>/apps/<slug>/.

const g = globalThis as unknown as { __weftState?: unknown };
let dir: string;
let folder: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-folder-"));
  process.env.WEFT_DATA = dir;
  g.__weftState = undefined;
  folder = path.join(dir, "apps", "growth");
  fs.mkdirSync(folder, { recursive: true });
});
afterEach(() => {
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, body: string | Buffer) {
  const file = path.join(folder, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

describe("isAppFolderUrl", () => {
  it("recognises a file directly inside ~/.weft/apps/<slug>/", async () => {
    const { isAppFolderUrl } = await import("./app-folder");
    write("index.html", "<h1>hi</h1>");
    const url = pathToFileUrl(path.join(folder, "index.html"));
    expect(isAppFolderUrl(url)).toEqual({ folder, entry: "index.html" });
  });

  it("rejects files outside ~/.weft/apps/ or one level deeper", async () => {
    const { isAppFolderUrl } = await import("./app-folder");
    write("index.html", "x");
    const deeper = path.join(folder, "nested", "page.html");
    fs.mkdirSync(path.dirname(deeper), { recursive: true });
    fs.writeFileSync(deeper, "y");
    expect(isAppFolderUrl(pathToFileUrl(deeper))).toBeNull();
    const outside = path.join(dir, "elsewhere.html");
    fs.writeFileSync(outside, "z");
    expect(isAppFolderUrl(pathToFileUrl(outside))).toBeNull();
  });

  it("rejects non-file URLs", async () => {
    const { isAppFolderUrl } = await import("./app-folder");
    expect(isAppFolderUrl("https://example.com")).toBeNull();
    expect(isAppFolderUrl("not a url")).toBeNull();
  });
});

describe("listAppFolderFiles", () => {
  it("walks the folder in sorted order, dropping dotfiles, dotfolders, sources, and the manifest", async () => {
    const { listAppFolderFiles } = await import("./app-folder");
    write("index.html", "html");
    write("app.js", "js");
    write("styles.css", "css");
    write("weft-app.json", "{}");
    write("App.tsx", "tsx");
    write("index.ts", "ts");
    write("App.jsx", "jsx");
    write("App.mts", "mts");
    write("App.cts", "cts");
    write(".hidden", "h");
    write("node_modules/x.js", "n");
    fs.mkdirSync(path.join(folder, ".git"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".git", "config"), "g");
    fs.mkdirSync(path.join(folder, "images"), { recursive: true });
    write("images/logo.png", "p");
    write("images/banner.svg", "s");
    const files = listAppFolderFiles(folder);
    const rels = files.map((f) => f.relative);
    expect(rels).toEqual(["app.js", "images/banner.svg", "images/logo.png", "index.html", "styles.css"]);
  });

  it("refuses when a single file is over 25 MB", async () => {
    const { APP_FOLDER_MAX_FILE_BYTES, listAppFolderFiles, AppFolderError } = await import("./app-folder");
    write("huge.html", Buffer.alloc(APP_FOLDER_MAX_FILE_BYTES + 1, 1));
    expect(() => listAppFolderFiles(folder)).toThrow(AppFolderError);
    expect(() => listAppFolderFiles(folder)).toThrow(/huge\.html/);
  });

  it("refuses when the folder totals more than 50 MB", async () => {
    const { APP_FOLDER_MAX_FILE_BYTES, listAppFolderFiles } = await import("./app-folder");
    for (let i = 0; i < 3; i++) write(`big${i}.bin`, Buffer.alloc(APP_FOLDER_MAX_FILE_BYTES, 1));
    expect(() => listAppFolderFiles(folder)).toThrow(/50 MB/);
  });

  it("refuses when there are more than 2,000 files", async () => {
    const { APP_FOLDER_MAX_FILES, listAppFolderFiles } = await import("./app-folder");
    // APP_FOLDER_MAX_FILES + 1; one extra to trip the cap.
    for (let i = 0; i < APP_FOLDER_MAX_FILES + 1; i++) write(`f${i}.html`, String(i));
    expect(() => listAppFolderFiles(folder)).toThrow(/2000/);
  });

  it("does not follow symlinks, so a link out of the folder is ignored", async () => {
    const { listAppFolderFiles } = await import("./app-folder");
    write("index.html", "x");
    const outside = path.join(dir, "secret.txt");
    fs.writeFileSync(outside, "secret");
    try {
      fs.symlinkSync(outside, path.join(folder, "leak.txt"));
    } catch (err) {
      // Some test filesystems disallow symlinks; skip rather than fail the run.
      if ((err as NodeJS.ErrnoException).code === "EPERM") return;
      throw err;
    }
    const rels = listAppFolderFiles(folder).map((f) => f.relative);
    expect(rels).toEqual(["index.html"]);
  });
});

describe("reducedManifest", () => {
  it("keeps only the policy keys the share uses, dropping folder and env", async () => {
    const { reducedManifest } = await import("./app-folder");
    const reduced = reducedManifest({
      name: "Growth",
      folder: "/Users/me/dev/weft",
      env: "production",
      supabaseUrl: "https://abc.supabase.co",
      secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"] } },
      public: ["SUPABASE_PUBLISHABLE_KEY"],
      reads: { signups: { supabase: "growth_signups" } },
      extra: "never",
    });
    expect(reduced).toEqual({
      secrets: { STRIPE_KEY: { hosts: ["api.stripe.com"] } },
      public: ["SUPABASE_PUBLISHABLE_KEY"],
      reads: { signups: { supabase: "growth_signups" } },
      supabaseUrl: "https://abc.supabase.co",
    });
  });

  it("returns an empty object when the source is missing, not an object, or an array", async () => {
    const { reducedManifest } = await import("./app-folder");
    expect(reducedManifest(undefined)).toEqual({});
    expect(reducedManifest(null)).toEqual({});
    expect(reducedManifest("nope")).toEqual({});
    expect(reducedManifest([])).toEqual({});
  });

  it("drops public when it isn't a string array", async () => {
    const { reducedManifest } = await import("./app-folder");
    expect(reducedManifest({ public: "nope" })).toEqual({});
    expect(reducedManifest({ public: { 0: "x" } })).toEqual({});
  });
});

describe("secretHit", () => {
  it("names a text file that holds a secret-shaped value", async () => {
    const { secretHit } = await import("./app-folder");
    write("index.html", "<h1>hi</h1>\nSTRIPE_KEY=STRIPE_LIVE\n");
    const file = { absolute: path.join(folder, "index.html"), relative: "index.html", size: 0 };
    expect(secretHit(file)).toMatch(/Stripe secret/);
  });

  it("ignores binary files and only-text files that don't trip the scan", async () => {
    const { secretHit } = await import("./app-folder");
    write("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    write("plain.html", "<h1>hi</h1>");
    const png = { absolute: path.join(folder, "logo.png"), relative: "logo.png", size: 0 };
    const html = { absolute: path.join(folder, "plain.html"), relative: "plain.html", size: 0 };
    expect(secretHit(png)).toBeNull();
    expect(secretHit(html)).toBeNull();
  });

  // A key in a file renamed to .png is the whole reason this is "scan by content, not by extension":
  // a plain-text file with no NUL bytes, in any extension, still gets scanned.
  it("scans a text file even when its extension says image/png", async () => {
    const { secretHit } = await import("./app-folder");
    write("sneaky.png", "STRIPE_KEY=STRIPE_LIVE\n");
    const file = { absolute: path.join(folder, "sneaky.png"), relative: "sneaky.png", size: 0 };
    expect(secretHit(file)).toMatch(/Stripe secret/);
  });

  // A real PNG keeps its bytes secret-free: the first 8 KB holds a NUL, so it never decodes as text.
  it("still skips a real image (a PNG with NUL bytes stays binary)", async () => {
    const { secretHit } = await import("./app-folder");
    write("real.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), Buffer.from("STRIPE_KEY=STRIPE_LIVE", "ascii")]));
    const file = { absolute: path.join(folder, "real.png"), relative: "real.png", size: 0 };
    expect(secretHit(file)).toBeNull();
  });
});

function pathToFileUrl(p: string): string {
  return "file://" + p;
}
