import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitBody, createPageLinks, notify, ownPage } from "./page-links.cjs";

// A real folder standing in for ~/.weft: ownPage only trusts files that exist under it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "weft-own-"));
const WEFT = path.join(ROOT, ".weft");
fs.mkdirSync(path.join(WEFT, "show"), { recursive: true });
fs.mkdirSync(path.join(ROOT, "Downloads"));
fs.writeFileSync(path.join(WEFT, "show", "index.html"), "");
fs.writeFileSync(path.join(ROOT, "Downloads", "b.html"), "");
fs.symlinkSync(path.join(ROOT, "Downloads", "b.html"), path.join(WEFT, "show", "link.html"));
const PAGE = pathToFileURL(path.join(WEFT, "show", "index.html")).href;
const from = { card: "pile", page: PAGE };

function page(url = PAGE) {
  return { isDestroyed: () => false, getURL: () => url, executeJavaScript: vi.fn(() => Promise.resolve()) };
}

function links(wc = page()) {
  const warn = vi.fn();
  const api = createPageLinks({ getServer: () => ({ url: "http://127.0.0.1:3457" }), contentsFor: () => wc, warn, weftDir: WEFT });
  return { api, warn, wc };
}

function respond(status: number, body: unknown) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("ownPage / commitBody", () => {
  it("is only a card's local file page", () => {
    expect(ownPage(from, WEFT)).toBe(true);
    expect(ownPage({ card: "pile", page: "https://evil.example" })).toBe(false);
    expect(ownPage({ card: null, page: PAGE })).toBe(false);
    expect(ownPage(undefined)).toBe(false);
  });

  it("refuses a file outside the weft folder, a symlink out of it and a missing file", () => {
    const at = (...p: string[]) => ({ card: "pile", page: pathToFileURL(path.join(ROOT, ...p)).href });
    expect(ownPage(at("Downloads", "b.html"), WEFT)).toBe(false);
    expect(ownPage(at(".weft", "show", "link.html"), WEFT)).toBe(false);
    expect(ownPage(at(".weft", "show", "gone.html"), WEFT)).toBe(false);
  });

  it("reads every path and the flags from the link", () => {
    expect(commitBody("weft://commit?message=feat%3A%20a&path=a.ts&path=dir%20x%2Fb.ts&push=1&done=c1&change=3&label=Tips")).toEqual({
      message: "feat: a",
      paths: ["a.ts", "dir x/b.ts"],
      push: "1",
      done: "c1",
      change: "3",
      label: "Tips",
    });
  });
});

describe("notify", () => {
  it("dispatches the event on the page that's still showing", () => {
    const wc = page();
    notify(wc, PAGE, "weft-commit", { ok: true, hash: "abc" });
    expect(wc.executeJavaScript).toHaveBeenCalledWith('window.dispatchEvent(new CustomEvent("weft-commit", { detail: {"ok":true,"hash":"abc"} }))');
  });

  it("does nothing once the card shows another page, or has none", () => {
    const wc = page("file:///other.html");
    notify(wc, PAGE, "weft-commit", {});
    expect(wc.executeJavaScript).not.toHaveBeenCalled();
    expect(() => notify(undefined, PAGE, "x", {})).not.toThrow();
  });
});

describe("handle", () => {
  it("posts a commit link to the card's commit route and tells the page", async () => {
    const fetch = respond(200, { result: { ok: true, change: "3", hash: "abc" } });
    const { api, wc } = links();
    await api.commit("weft://commit?message=m&path=a.ts&change=3", from);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3457/api/cards/pile/commit", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ message: "m", paths: ["a.ts"], change: "3" });
    expect(wc.executeJavaScript.mock.calls[0]).toEqual([expect.stringContaining('"hash":"abc"')]);
  });

  it("tells the page when the board refuses or can't be reached", async () => {
    respond(400, { error: "A commit needs a message." });
    const { api, wc } = links();
    await api.commit("weft://commit?path=a.ts&change=2", from);
    expect(wc.executeJavaScript.mock.calls[0]).toEqual([expect.stringContaining('"ok":false,"change":"2","error":"A commit needs a message."')]);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await api.commit("weft://commit?path=a.ts", from);
    expect(wc.executeJavaScript.mock.calls[1]).toEqual([expect.stringContaining('"error":"offline"')]);
  });

  it("sends a reply link as a message, warning when it doesn't go through", async () => {
    const fetch = respond(200, {});
    const { api, warn } = links();
    await api.reply("weft://reply?text=%20skip%20it%20", from);
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:3457/api/cards/pile/messages", expect.objectContaining({ body: '{"text":"skip it"}' }));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>", { status: 500, statusText: "Internal Server Error" }))));
    await api.reply("weft://reply?text=x", from);
    expect(warn).toHaveBeenCalledWith("Couldn't send that to the thread", "Internal Server Error");
  });

  it("ignores links from other pages, and leaves other weft:// links to the app", async () => {
    const fetch = respond(200, {});
    const { api } = links();
    await api.reply("weft://reply?text=x", { card: "pile", page: "https://x.example" });
    await api.commit("weft://commit?message=m&path=a", { card: "pile", page: "https://x.example" });
    await api.reply("weft://reply", from);
    expect(fetch).not.toHaveBeenCalled();
    expect(api.handle("weft://reply?text=x", from)).toBe(true);
    expect(api.handle("weft://commit?message=m&path=a", from)).toBe(true);
    expect(api.handle("weft://card/abc", from)).toBe(false);
  });
});
