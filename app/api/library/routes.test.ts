import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, LibraryItem } from "@/lib/types";

// The library routes over the real lib/library.ts on a temp data dir; the store is an in-memory board,
// and the pane and Haiku are stubs.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-library-routes-"));
process.env.THREADBOARD_DATA = path.join(root, "data");
process.env.HOME = path.join(root, "home");

const db = vi.hoisted(() => ({ cards: new Map<string, Card>() }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/store", () => ({
  DATA_DIR: process.env.THREADBOARD_DATA,
  getCard: vi.fn((id: string) => db.cards.get(id)),
  listCards: vi.fn(() => [...db.cards.values()]),
  getThread: vi.fn(() => [{ kind: "result", text: "The answer" }]),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(db.cards.get(id)!, patch)),
}));
vi.mock("@/lib/browser-tools", () => ({ paneUrl: vi.fn(() => Promise.resolve("")) }));
vi.mock("@/lib/haiku", () => ({ complete: vi.fn(() => Promise.resolve(JSON.stringify({ name: "pitch", title: "Pitch", prompt: "Pitch {product}" }))) }));

const lib = await import("@/lib/library");
const store = await import("@/lib/store");
const listRoute = await import("./route");
const itemRoute = await import("./[id]/route");
const fileRoute = await import("./[id]/files/[name]/route");
const pageRoute = await import("./[id]/page/route");

const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
const READ = { host: "localhost:3457" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

const card = (over: Partial<Card> = {}) => {
  const c = { id: "c1", title: "Card", prompt: "Do it", cwd: path.join(root, "proj"), backend: "claude", column: "review", createdAt: 0, updatedAt: 0, ...over } as Card;
  db.cards.set(c.id, c);
  return c;
};
const add = (over: Partial<LibraryItem> = {}, id = "n") =>
  lib.addItem({ kind: "note", scope: "mine", title: "A note", folder: "/dev/app", ...over }, id);

beforeEach(() => {
  fs.rmSync(process.env.THREADBOARD_DATA!, { recursive: true, force: true });
  fs.rmSync(process.env.HOME!, { recursive: true, force: true });
  db.cards.clear();
  vi.clearAllMocks();
});

describe("GET /api/library", () => {
  it("refuses a foreign host", () => {
    const res = listRoute.GET(req("/library", { headers: { host: "evil.com" } }));
    expect(res.status).toBe(403);
  });

  it("lists yours plus the folder's, or every project's with all=1, without the write header", async () => {
    add({}, "mine");
    add({ scope: "project", folder: "/dev/app" }, "app");
    add({ scope: "project", folder: "/dev/other" }, "other");
    const ids = async (q: string) => ((await listRoute.GET(req(`/library${q}`, { headers: READ })).json()) as { items: LibraryItem[] }).items.map((i) => i.id).sort();
    expect(await ids("")).toEqual(["mine"]);
    expect(await ids("?folder=%2Fdev%2Fapp")).toEqual(["app", "mine"]);
    expect(await ids("?all=1")).toEqual(["app", "mine", "other"]);
  });
});

describe("POST /api/library", () => {
  it("needs the write header", async () => {
    const res = await listRoute.POST(req("/library", { method: "POST", body: {}, headers: READ }));
    expect(res.status).toBe(403);
  });

  it("404s for a missing card, no card id, or the copilot", async () => {
    card({ id: "copilot", role: "copilot" });
    for (const body of [{ cardId: "ghost" }, {}, { cardId: "copilot" }]) {
      const res = await listRoute.POST(req("/library", { method: "POST", body }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "No such card." });
    }
  });

  it("stars a card as a project note by default, saving its last answer and the card's libraryId", async () => {
    const c = card();
    const res = await listRoute.POST(req("/library", { method: "POST", body: { cardId: "c1", kind: "bogus", scope: "bogus" } }));
    const { item } = (await res.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ kind: "note", scope: "project", folder: c.cwd, cardId: "c1", page: true });
    expect(c.libraryId).toBe(item.id);
    expect(fs.readFileSync(path.join(lib.itemDir(item), "index.html"), "utf8")).toContain("The answer");
  });

  it("stars a card as one of your recipes, written as a skill", async () => {
    card();
    const res = await listRoute.POST(req("/library", { method: "POST", body: { cardId: "c1", kind: "recipe", scope: "mine" } }));
    const { item } = (await res.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ kind: "recipe", scope: "mine", skill: "pitch", prompt: "Pitch {product}", blanks: [{ name: "product" }] });
    expect(fs.existsSync(path.join(process.env.HOME!, ".claude", "skills", "pitch", "SKILL.md"))).toBe(true);
  });

  it("answers 400 for a body that isn't JSON", async () => {
    const res = await listRoute.POST(req("/library", { method: "POST", body: "{nope" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/library/[id]", () => {
  it("needs the write header", async () => {
    const res = await itemRoute.PATCH(req("/library/n", { method: "PATCH", body: {}, headers: READ }), ctx({ id: "n" }));
    expect(res.status).toBe(403);
  });

  it("keeps only the fields it understands: a trimmed, capped title, a kind, a scope and numeric ticks", async () => {
    add({ kind: "todo", steps: 3 });
    const res = await itemRoute.PATCH(
      req("/library/n", { method: "PATCH", body: { title: `  ${"x".repeat(130)}  `, kind: "note", scope: "project", ticked: [2, "1", 0], folder: "/hack", steps: 99 } }),
      ctx({ id: "n" }),
    );
    const { item } = (await res.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ title: "x".repeat(120), kind: "note", scope: "project", ticked: [0, 2], folder: "/dev/app", steps: 3 });
  });

  it("ignores a blank title, an unknown kind or scope, and ticks that aren't a list", async () => {
    add();
    const res = await itemRoute.PATCH(req("/library/n", { method: "PATCH", body: { title: "  ", kind: "poem", scope: "ours", ticked: 3 } }), ctx({ id: "n" }));
    const { item } = (await res.json()) as { item: LibraryItem };
    expect(item).toMatchObject({ title: "A note", kind: "note", scope: "mine" });
    expect(item.ticked).toBeUndefined();
  });

  it("answers 400 with the reason when the change isn't allowed or the item is gone", async () => {
    add({ kind: "recipe" }, "r");
    const recipe = await itemRoute.PATCH(req("/library/r", { method: "PATCH", body: { kind: "todo" } }), ctx({ id: "r" }));
    expect(recipe.status).toBe(400);
    expect(await recipe.json()).toEqual({ error: "A recipe stays a recipe." });
    const gone = await itemRoute.PATCH(req("/library/x", { method: "PATCH", body: { title: "y" } }), ctx({ id: "x" }));
    expect(await gone.json()).toEqual({ error: "No library item x" });
  });
});

describe("DELETE /api/library/[id]", () => {
  it("needs the write header", async () => {
    const res = await itemRoute.DELETE(req("/library/n", { method: "DELETE", headers: READ }), ctx({ id: "n" }));
    expect(res.status).toBe(403);
  });

  it("takes the item out and unstars its card, and is fine with one already gone", async () => {
    const c = card({ libraryId: "n" });
    add();
    expect(await (await itemRoute.DELETE(req("/library/n", { method: "DELETE" }), ctx({ id: "n" }))).json()).toEqual({ ok: true });
    expect(lib.getItem("n")).toBeUndefined();
    expect(c.libraryId).toBeUndefined();
    expect((await itemRoute.DELETE(req("/library/n", { method: "DELETE" }), ctx({ id: "n" }))).status).toBe(200);
  });

  it("answers 400 when removing fails", async () => {
    add();
    vi.mocked(store.listCards).mockImplementationOnce(() => {
      throw new Error("board unreadable");
    });
    const res = await itemRoute.DELETE(req("/library/n", { method: "DELETE" }), ctx({ id: "n" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "board unreadable" });
  });
});

describe("GET /api/library/[id]/files/[name]", () => {
  const get = (id: string, name: string, headers = READ) => fileRoute.GET(req(`/library/${id}/files/${name}`, { headers }), ctx({ id, name }));
  const put = (name: string, data = "x") => {
    const dir = path.join(lib.itemDir(lib.getItem("n")!), "files");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  };

  it("refuses a foreign host", async () => {
    expect((await get("n", "a.png", { host: "evil.com" })).status).toBe(403);
  });

  it("404s for a missing item, a path that leaves files/, a dotfile, or a missing file", async () => {
    expect((await get("ghost", "a.png")).status).toBe(404);
    add({ scope: "project" });
    put(".secret");
    for (const name of ["../index.html", "sub/a.png", ".secret", "missing.png"]) {
      const res = await get("n", name);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });

  it("serves a saved file with the page's security headers and a type from its extension", async () => {
    add({ scope: "project" });
    put("1-s.CSS", "body{}");
    put("2-shot.png", "png");
    put("3-blob.weird", "?");
    const css = await get("n", "1-s.CSS");
    expect(await css.text()).toBe("body{}");
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(css.headers.get("content-security-policy")).toBe(lib.PAGE_HEADERS["content-security-policy"]);
    expect(css.headers.get("x-content-type-options")).toBe("nosniff");
    expect(css.headers.get("cache-control")).toBe("private, max-age=3600");
    expect((await get("n", "2-shot.png")).headers.get("content-type")).toBe("image/png");
    expect((await get("n", "3-blob.weird")).headers.get("content-type")).toBe("application/octet-stream");
  });
});

describe("GET /api/library/[id]/page", () => {
  const get = (id: string, headers = READ) => pageRoute.GET(req(`/library/${id}/page`, { headers }), ctx({ id }));

  it("refuses a foreign host", async () => {
    expect((await get("n", { host: "evil.com" })).status).toBe(403);
  });

  it("404s for an item no longer in the library", async () => {
    const res = await get("ghost");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not in the library any more.");
  });

  it("404s for a to-do or note whose page wasn't saved", async () => {
    add();
    const res = await get("n");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("This page wasn't saved.");
  });

  it("serves a saved page with its ticks wired up, as no-store HTML", async () => {
    add({ kind: "todo", ticked: [1] });
    fs.mkdirSync(lib.itemDir(lib.getItem("n")!), { recursive: true });
    fs.writeFileSync(path.join(lib.itemDir(lib.getItem("n")!), "index.html"), "<body><input type=checkbox></body>");
    const res = await get("n");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("const saved = [1];");
    expect(html).toContain("fetch('/api/library/n'");
  });

  it("builds a recipe's page from its runs on the board", async () => {
    add({ kind: "recipe", title: "Pitch" }, "r");
    card({ id: "run1", title: "Pitch Weft", recipeId: "r" });
    const html = await (await get("r")).text();
    expect(html).toContain("<h1>Pitch</h1>");
    expect(html).toContain("used 1×");
    expect(html).toContain("weft://card/run1");
  });
});
