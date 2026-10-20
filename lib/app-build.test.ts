import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/app-build.ts: real esbuild against a temp APPS_DIR. The build is small (an App.tsx that imports React
// and a CSS file, a hand-written index.html that should be left alone, a bad bare import) and esbuild itself
// is fast, so we don't bother mocking it: a real test catches plugin bugs a mock would miss.

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weft-app-build-"));
const slug = "demo";
// APPS_DIR is path.join(DATA_DIR, "apps") (lib/store.ts), so redirect DATA_DIR to the temp root
// via WEFT_DATA so the test's files stay in tmpRoot and never touch ~/.weft.
process.env.WEFT_DATA = tmpRoot;
const folder = path.join(tmpRoot, "apps", slug);

function writeFile(rel: string, content: string) {
  const full = path.join(folder, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  fs.rmSync(path.join(tmpRoot, "apps"), { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "weft-app.json"), JSON.stringify({ name: "Demo" }));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("buildApp", () => {
  it("bundles App.tsx with esbuild and writes a generated index.html", async () => {
    writeFile("App.tsx", `import "./styles.css";\nexport default function App() { return <div className="root">Hello</div>; }`);
    writeFile("styles.css", `.root { color: tomato; }`);
    const { buildApp, readBuildInfo } = await import("./app-build");
    const result = await buildApp(slug, () => 1234);
    expect(result.ok).toBe(true);
    if (result.ok !== true) throw new Error("expected ok");
    expect(result.hasCss).toBe(true);
    expect(result.at).toBe(1234);
    const appJs = fs.readFileSync(path.join(folder, "app.js"), "utf8");
    expect(appJs).toMatch(/createRoot/);
    expect(appJs).toMatch(/Hello/);
    const indexHtml = fs.readFileSync(path.join(folder, "index.html"), "utf8");
    expect(indexHtml).toContain("<!-- weft:generated -->");
    expect(indexHtml).toContain('<link rel="stylesheet" href="./app.css">');
    expect(indexHtml).toContain('script src="./app.js" defer');
    expect(fs.existsSync(path.join(folder, "app.css"))).toBe(true);
    const info = readBuildInfo(slug);
    expect(info?.ok).toBe(true);
    expect(info?.inputsHash).toBe(result.inputsHash);
  });

  it("skips a hand-written index.html and leaves it alone", async () => {
    fs.writeFileSync(path.join(folder, "index.html"), "<!doctype html><html><body>manual</body></html>");
    writeFile("App.tsx", `export default () => null;`);
    const { buildApp } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe("skipped");
    if (result.ok !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("hand-written");
    const html = fs.readFileSync(path.join(folder, "index.html"), "utf8");
    expect(html).toBe("<!doctype html><html><body>manual</body></html>");
  });

  it("skips a folder with no App.tsx", async () => {
    writeFile("styles.css", "p{}");
    const { buildApp } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe("skipped");
    if (result.ok !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("no App.tsx");
  });

  it("rejects a bare import that isn't in the allowlist and writes an error page", async () => {
    // Reference the import so esbuild's tree-shaking doesn't drop it before the bare-import plugin sees it.
    writeFile("App.tsx", `import axios from "axios";\nconst _x = axios;\nexport default () => <div>{typeof _x}</div>;`);
    const { buildApp, readBuildInfo } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("expected failure");
    expect(result.error).toContain("axios");
    const html = fs.readFileSync(path.join(folder, "index.html"), "utf8");
    expect(html).toContain("<!-- weft:generated -->");
    expect(html).toContain("axios");
    const info = readBuildInfo(slug);
    expect(info?.ok).toBe(false);
    if (info?.ok === false) expect(info.error).toContain("axios");
  });

  it("rejects a bare import made inside a sibling file the entry imports", async () => {
    // charts.tsx imports zod (a package Weft DOES have in node_modules), so esbuild would resolve it
    // and the build would succeed unless the bare-import plugin catches it. The plugin must check the
    // whole app folder — not just the wrapper's imports — so even files the entry pulls in are checked.
    writeFile("App.tsx", `import { Z } from "./charts";\nexport default () => <div>{typeof Z}</div>;`);
    writeFile("charts.ts", `import { z } from "zod";\nexport const Z = z.string();`);
    const { buildApp } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("expected failure");
    expect(result.error).toContain("zod");
  });

  it("rejects a bare import made inside a nested helper under the app folder", async () => {
    // Same as above, but the offender is several directories deep. The plugin covers the whole folder,
    // not just the entry's parent, so a deep file is caught too.
    writeFile("App.tsx", `import { Z } from "./helpers/charts";\nexport default () => <div>{typeof Z}</div>;`);
    writeFile("helpers/charts.ts", `import { z } from "zod";\nexport const Z = z.string();`);
    const { buildApp } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("expected failure");
    expect(result.error).toContain("zod");
  });

  it("skips when isDeployed() is true", async () => {
    process.env.WEFT_HOME = "1";
    try {
      writeFile("App.tsx", `export default () => null;`);
      const { buildApp } = await import("./app-build");
      const result = await buildApp(slug, () => 1);
      expect(result.ok).toBe("skipped");
      if (result.ok !== "skipped") throw new Error("expected skipped");
      expect(result.reason).toBe("deployed");
      expect(fs.existsSync(path.join(folder, "app.js"))).toBe(false);
    } finally {
      delete process.env.WEFT_HOME;
    }
  });

  it("keeps the previous app.js when a rebuild fails", async () => {
    writeFile("App.tsx", `export default () => <div>good</div>;`);
    const { buildApp } = await import("./app-build");
    const first = await buildApp(slug, () => 1);
    expect(first.ok).toBe(true);
    const beforeJs = fs.readFileSync(path.join(folder, "app.js"), "utf8");
    // Now introduce a syntax error and rebuild: the file on disk stays the working build.
    writeFile("App.tsx", `export default () => <div`);
    const second = await buildApp(slug, () => 2);
    expect(second.ok).toBe(false);
    const afterJs = fs.readFileSync(path.join(folder, "app.js"), "utf8");
    expect(afterJs).toBe(beforeJs);
  });

  it("appends an image import to the assets folder", async () => {
    // A 1x1 PNG (the smallest valid PNG).
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=", "base64");
    fs.writeFileSync(path.join(folder, "logo.png"), png);
    writeFile("App.tsx", `import logo from "./logo.png";\nexport default () => <img src={logo} />;`);
    const { buildApp } = await import("./app-build");
    const result = await buildApp(slug, () => 1);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(folder, "assets"))).toBe(true);
    const assets = fs.readdirSync(path.join(folder, "assets"));
    expect(assets.length).toBeGreaterThan(0);
  });

  it("refuses a slug that escapes the apps dir (../etc)", async () => {
    // buildApp is called directly, bypassing the route — the lib still has to refuse it.
    writeFile("App.tsx", `export default () => null;`);
    const { buildApp } = await import("./app-build");
    const result = await buildApp("../etc", () => 1);
    expect(result.ok).toBe(false);
    if (result.ok !== false) throw new Error("expected failure");
    expect(result.error).toContain("Invalid app folder name");
    // The build record must not have been written outside the apps dir. "../etc" would resolve
    // to tmpRoot/etc/.weft-build.json — assert it doesn't exist.
    expect(fs.existsSync(path.join(tmpRoot, "etc", ".weft-build.json"))).toBe(false);
  });

  it("also refuses a slug with a dot, a slash, or a leading hyphen", async () => {
    for (const bad of ["foo.bar", "foo/bar", "-foo", "foo-", "", "a".repeat(65)]) {
      const { buildApp } = await import("./app-build");
      const r = await buildApp(bad, () => 1);
      expect(r.ok).toBe(false);
    }
  });
});

describe("isBuildOutput", () => {
  it("recognises the generated files and the build record", async () => {
    const { isBuildOutput } = await import("./app-build");
    expect(isBuildOutput(folder, path.join(folder, "index.html"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, "app.js"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, "app.css"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, ".weft-build.json"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, "assets", "logo.png"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, ".build", "entry.jsx"))).toBe(true);
    expect(isBuildOutput(folder, path.join(folder, "App.tsx"))).toBe(false);
    expect(isBuildOutput(folder, path.join(folder, "src", "App.tsx"))).toBe(false);
  });
});

describe("readBuildInfo", () => {
  it("returns undefined when the file is missing or malformed", async () => {
    const { readBuildInfo } = await import("./app-build");
    expect(readBuildInfo(slug)).toBeUndefined();
    fs.writeFileSync(path.join(folder, ".weft-build.json"), "{ not json");
    expect(readBuildInfo(slug)).toBeUndefined();
  });
});