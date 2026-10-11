import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
interface PanePage {
  cardId: string;
  url: string;
  kind: "file" | "app" | "web";
  title: string;
  updatedAt: string;
  savedUrl?: string;
}

interface PanePagesModule {
  createPanePages: (dataDir: string) => {
    record(cardId: string, url: string, title?: string): void;
    restoreUrl(cardId: string): string | undefined;
    fallbackUrl(cardId: string): string | undefined;
    get(cardId: string): PanePage | undefined;
  };
  kindOf: (url: string) => PanePage["kind"];
  isTemp: (file: string) => boolean;
}

const { createPanePages, kindOf, isTemp } = createRequire(import.meta.url)("../electron/pane-pages.cjs") as PanePagesModule;

let dataDir: string;
let tmpPage: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-pages-test-"));
  tmpPage = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "weft-show-")), "plan.html");
  fs.writeFileSync(tmpPage, "<h1>plan</h1>");
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(tmpPage), { recursive: true, force: true });
});

describe("kindOf / isTemp", () => {
  it("tells files, local apps and the web apart", () => {
    expect(kindOf("file:///x.html")).toBe("file");
    expect(kindOf("http://localhost:3000/")).toBe("app");
    expect(kindOf("http://127.0.0.1:5173")).toBe("app");
    expect(kindOf("https://example.com")).toBe("web");
  });

  it("knows the temp folders macOS clears", () => {
    expect(isTemp("/tmp/weft-show/a.html")).toBe(true);
    expect(isTemp("/private/tmp/a.html")).toBe(true);
    expect(isTemp("/tmpfoo/a.html")).toBe(false);
    expect(isTemp("/Users/me/.weft/glance/a.html")).toBe(false);
  });
});

describe("createPanePages", () => {
  it("copies a temp page so it survives a reboot, and restores the copy", () => {
    const pages = createPanePages(dataDir);
    pages.record("card1", pathToFileURL(tmpPage).href, "Plan");
    const restored = pages.restoreUrl("card1");
    expect(restored).toBe(pathToFileURL(path.join(dataDir, "pages", "card1", "plan.html")).href);
    fs.rmSync(tmpPage);
    expect(fs.readFileSync(new URL(restored!), "utf8")).toBe("<h1>plan</h1>");
  });

  it("keeps the url itself for apps and files outside temp folders", () => {
    const pages = createPanePages(dataDir);
    pages.record("card1", "http://localhost:3000/board", "Board");
    expect(pages.restoreUrl("card1")).toBe("http://localhost:3000/board");
    expect(pages.get("card1")).toMatchObject({ cardId: "card1", kind: "app", title: "Board" });
  });

  it("persists across a restart", () => {
    createPanePages(dataDir).record("card1", "https://example.com/", "Example");
    expect(createPanePages(dataDir).restoreUrl("card1")).toBe("https://example.com/");
  });

  it("ignores blank and error pages", () => {
    const pages = createPanePages(dataDir);
    pages.record("card1", "about:blank");
    pages.record("card1", "chrome-error://chromewebdata/");
    expect(pages.restoreUrl("card1")).toBeUndefined();
  });

  it("falls back to the card's last update page", () => {
    const pages = createPanePages(dataDir);
    expect(pages.fallbackUrl("card1")).toBeUndefined();
    fs.mkdirSync(path.join(dataDir, "glance"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "glance", "card1.html"), "<p>update</p>");
    expect(pages.fallbackUrl("card1")).toBe(pathToFileURL(path.join(dataDir, "glance", "card1.html")).href);
  });

  it("never recorded: restores the last page the card's thread opened, and records it", () => {
    fs.mkdirSync(path.join(dataDir, "threads"), { recursive: true });
    const url = pathToFileURL(tmpPage).href;
    const items = [
      { kind: "tool", name: "mcp__browser__open_url", summary: "http://localhost:3000", result: "Opened http://localhost:3000 — App", isError: false },
      { kind: "tool", name: "mcp__browser__open_url", summary: url, result: `Opened ${url} — Plan`, isError: false },
      { kind: "tool", name: "mcp__browser__open_url", summary: "http://localhost:9", result: "Error", isError: true },
    ];
    fs.writeFileSync(path.join(dataDir, "threads", "card1.json"), JSON.stringify(items));
    const pages = createPanePages(dataDir);
    expect(pages.get("card1")).toBeUndefined();
    const restored = pages.restoreUrl("card1");
    expect(pages.get("card1")!.url).toBe(url);
    expect(restored).toBe(pages.get("card1")!.savedUrl ?? url);
    expect(pages.restoreUrl("card2")).toBeUndefined();
  });
});
