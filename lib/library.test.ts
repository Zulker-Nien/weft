import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, LibraryItem, ThreadItem } from "./types";

// library.ts reads DATA_DIR (from the store) at import, so the store is mocked onto a temp dir, and HOME
// points at another so "mine" recipes land in a temp ~/.claude/skills.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "weft-library-"));
process.env.THREADBOARD_DATA = path.join(root, "data");
process.env.HOME = path.join(root, "home");

const db = vi.hoisted(() => ({ cards: [] as Card[], threads: new Map<string, ThreadItem[]>() }));

vi.mock("./store", () => ({
  DATA_DIR: process.env.THREADBOARD_DATA,
  listCards: vi.fn(() => db.cards),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => Object.assign(db.cards.find((c) => c.id === id) ?? {}, patch)),
}));
vi.mock("./bus", () => ({ publish: vi.fn() }));

const lib = await import("./library");
const store = await import("./store");
const bus = await import("./bus");

const LIB = path.join(process.env.THREADBOARD_DATA, "library");
const HOME_SKILLS = path.join(process.env.HOME, ".claude", "skills");

const card = (over: Partial<Card> = {}) =>
  ({ id: "c1", title: "Card", prompt: "Do the thing", cwd: path.join(root, "proj"), backend: "claude", column: "review", createdAt: 0, updatedAt: 0, ...over }) as Card;

const note = (over: Partial<Omit<LibraryItem, "id" | "createdAt" | "updatedAt">> = {}) =>
  ({ kind: "note", scope: "mine", title: "A note", folder: "/p/one", ...over }) as Omit<LibraryItem, "id" | "createdAt" | "updatedAt">;

const index = (dir: string) => (JSON.parse(fs.readFileSync(path.join(dir, "items.json"), "utf8")) as { items: LibraryItem[] }).items;

beforeEach(() => {
  fs.rmSync(process.env.THREADBOARD_DATA!, { recursive: true, force: true });
  fs.rmSync(process.env.HOME!, { recursive: true, force: true });
  db.cards = [];
  db.threads.clear();
  vi.clearAllMocks();
});

describe("projectSlug", () => {
  it("turns everything but letters and digits into dashes, like ~/.claude/projects", () => {
    expect(lib.projectSlug("/Users/me/dev/my_app.v2")).toBe("-Users-me-dev-my-app-v2");
  });
});

describe("addItem, getItem, listLibrary", () => {
  it("writes mine to library/items.json and a project's to library/projects/<slug>, and announces the change", () => {
    const mine = lib.addItem(note(), "m1");
    const proj = lib.addItem(note({ scope: "project", folder: "/p/one" }), "p1");
    expect(mine).toMatchObject({ id: "m1", kind: "note", createdAt: expect.any(Number) as unknown });
    expect(mine.updatedAt).toBe(mine.createdAt);
    expect(index(LIB).map((i) => i.id)).toEqual(["m1"]);
    expect(index(path.join(LIB, "projects", "-p-one")).map((i) => i.id)).toEqual(["p1"]);
    expect(lib.getItem("p1")?.scope).toBe("project");
    expect(bus.publish).toHaveBeenCalledWith({ type: "library" });
    expect(proj.folder).toBe("/p/one");
  });

  it("gives a random id by default and replaces an item saved again under the same id", () => {
    const a = lib.addItem(note());
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    lib.addItem(note({ title: "again" }), a.id);
    expect(index(LIB)).toHaveLength(1);
    expect(lib.getItem(a.id)?.title).toBe("again");
  });

  it("lists yours alone by default, yours plus one project's with a folder, every project's with all, newest first", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3);
    lib.addItem(note(), "m");
    lib.addItem(note({ scope: "project", folder: "/p/one" }), "one");
    lib.addItem(note({ scope: "project", folder: "/p/two" }), "two");
    vi.restoreAllMocks();
    expect(lib.listLibrary().map((i) => i.id)).toEqual(["m"]);
    expect(lib.listLibrary({ folder: "/p/one" }).map((i) => i.id)).toEqual(["one", "m"]);
    expect(lib.listLibrary({ folder: null }).map((i) => i.id)).toEqual(["m"]);
    expect(lib.listLibrary({ all: true }).map((i) => i.id)).toEqual(["two", "one", "m"]);
  });

  it("reads an empty library when nothing was saved, the index is corrupt, or it has no items key", () => {
    expect(lib.listLibrary({ all: true })).toEqual([]);
    expect(lib.getItem("nope")).toBeUndefined();
    fs.mkdirSync(LIB, { recursive: true });
    fs.writeFileSync(path.join(LIB, "items.json"), "{not json");
    expect(lib.listLibrary()).toEqual([]);
    fs.writeFileSync(path.join(LIB, "items.json"), "{}");
    expect(lib.listLibrary()).toEqual([]);
  });

  it("puts an item's own folder under its scope", () => {
    expect(lib.itemDir({ id: "x", scope: "mine", folder: "/p/one" } as LibraryItem)).toBe(path.join(LIB, "x"));
    expect(lib.itemDir({ id: "x", scope: "project", folder: "/p/one" } as LibraryItem)).toBe(path.join(LIB, "projects", "-p-one", "x"));
  });
});

describe("updateItem", () => {
  it("throws for an item that isn't there", () => {
    expect(() => lib.updateItem("ghost", { title: "x" })).toThrow("No library item ghost");
  });

  it("keeps a recipe a recipe, and won't turn a note into one", () => {
    lib.addItem(note({ kind: "recipe" }), "r");
    lib.addItem(note(), "n");
    expect(() => lib.updateItem("r", { kind: "note" })).toThrow("A recipe stays a recipe.");
    expect(() => lib.updateItem("n", { kind: "recipe" })).toThrow("Save the card as a recipe instead.");
    expect(lib.updateItem("r", { kind: "recipe", title: "still" }).title).toBe("still");
  });

  it("swaps a note and a to-do in place, ignoring undefined fields and bumping updatedAt", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(10).mockReturnValueOnce(20);
    lib.addItem(note({ title: "keep" }), "n");
    const next = lib.updateItem("n", { kind: "todo", title: undefined });
    vi.restoreAllMocks();
    expect(next).toMatchObject({ kind: "todo", title: "keep", createdAt: 10, updatedAt: 20 });
    expect(index(LIB)).toEqual([next]);
  });

  it("saves ticks as sorted, unique, non-negative whole numbers", () => {
    lib.addItem(note({ kind: "todo", steps: 5 }), "t");
    expect(lib.updateItem("t", { ticked: [3, 1, 3, -1, 2.5, 0] }).ticked).toEqual([0, 1, 3]);
  });

  it("moves an item and its folder between mine and a project", () => {
    lib.addItem(note(), "n");
    fs.mkdirSync(path.join(LIB, "n"), { recursive: true });
    fs.writeFileSync(path.join(LIB, "n", "index.html"), "page");
    const moved = lib.updateItem("n", { scope: "project" });
    const projDir = path.join(LIB, "projects", "-p-one");
    expect(fs.readFileSync(path.join(projDir, "n", "index.html"), "utf8")).toBe("page");
    expect(fs.existsSync(path.join(LIB, "n"))).toBe(false);
    expect(index(LIB)).toEqual([]);
    expect(index(projDir)).toEqual([moved]);
  });

  it("moves an item with no folder of its own just in the index", () => {
    lib.addItem(note({ scope: "project" }), "n");
    lib.updateItem("n", { scope: "mine" });
    expect(index(LIB).map((i) => i.id)).toEqual(["n"]);
    expect(fs.existsSync(path.join(LIB, "n"))).toBe(false);
  });

  it("moves a recipe's skill to the new scope's skills folder", () => {
    const folder = path.join(root, "proj-move");
    const skillPath = path.join(HOME_SKILLS, "ship-it");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), "skill");
    lib.addItem(note({ kind: "recipe", folder, skill: "ship-it", skillPath }), "r");
    const moved = lib.updateItem("r", { scope: "project" });
    const skillTo = path.join(folder, ".claude", "skills", "ship-it");
    expect(moved.skillPath).toBe(skillTo);
    expect(fs.readFileSync(path.join(skillTo, "SKILL.md"), "utf8")).toBe("skill");
    expect(fs.existsSync(skillPath)).toBe(false);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("leaves a recipe's skill where it is when the new place already has one by that name", () => {
    const folder = path.join(root, "proj-taken");
    const skillPath = path.join(HOME_SKILLS, "ship-it");
    fs.mkdirSync(skillPath, { recursive: true });
    fs.mkdirSync(path.join(folder, ".claude", "skills", "ship-it"), { recursive: true });
    lib.addItem(note({ kind: "recipe", folder, skill: "ship-it", skillPath }), "r");
    expect(lib.updateItem("r", { scope: "project" }).skillPath).toBe(skillPath);
    expect(fs.existsSync(skillPath)).toBe(true);
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("doesn't touch skills for a recipe without one", () => {
    lib.addItem(note({ kind: "recipe", skill: "gone", skillPath: path.join(root, "missing-skill") }), "r");
    expect(lib.updateItem("r", { scope: "project" }).skillPath).toBe(path.join(root, "missing-skill"));
    lib.addItem(note({ kind: "recipe" }), "r2");
    expect(lib.updateItem("r2", { scope: "project" }).skillPath).toBeUndefined();
  });
});

describe("removeItem", () => {
  it("does nothing for an item that isn't there", () => {
    lib.removeItem("ghost");
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("drops it from the index, deletes its folder and unstars its cards", () => {
    db.cards = [card({ id: "a", libraryId: "n" }), card({ id: "b", libraryId: "other" })];
    lib.addItem(note(), "n");
    fs.mkdirSync(path.join(LIB, "n"), { recursive: true });
    lib.removeItem("n");
    expect(index(LIB)).toEqual([]);
    expect(fs.existsSync(path.join(LIB, "n"))).toBe(false);
    expect(store.updateCard).toHaveBeenCalledTimes(1);
    expect(store.updateCard).toHaveBeenCalledWith("a", { libraryId: undefined });
    expect(bus.publish).toHaveBeenLastCalledWith({ type: "library" });
  });

  it("deletes a skill Weft wrote, and keeps one that lost the mark or has no SKILL.md", () => {
    const mk = (name: string, text?: string) => {
      const dir = path.join(HOME_SKILLS, name);
      fs.mkdirSync(dir, { recursive: true });
      if (text !== undefined) fs.writeFileSync(path.join(dir, "SKILL.md"), text);
      return dir;
    };
    const ours = mk("ours", `---\n---\n${lib.SKILL_MARK}\nbody`);
    const edited = mk("edited", "hand made");
    const bare = mk("bare");
    lib.addItem(note({ kind: "recipe", skillPath: ours }), "a");
    lib.addItem(note({ kind: "recipe", skillPath: edited }), "b");
    lib.addItem(note({ kind: "recipe", skillPath: bare }), "c");
    ["a", "b", "c"].forEach(lib.removeItem);
    expect(fs.existsSync(ours)).toBe(false);
    expect(fs.existsSync(edited)).toBe(true);
    expect(fs.existsSync(bare)).toBe(true);
  });
});

describe("localAsset", () => {
  const base = path.join(root, "assets");
  fs.mkdirSync(path.join(base, "sub"), { recursive: true });
  fs.writeFileSync(path.join(base, "a b.png"), "png");

  it("skips anchors, protocol-relative links, other schemes and blanks", () => {
    for (const ref of ["", "  ", "#top", "//cdn.example/x.png", "https://x.dev/a.png", "data:image/png;base64,AA", "mailto:a@b.c", "weft://card/1"]) {
      expect(lib.localAsset(ref, base)).toBeUndefined();
    }
  });

  it("finds relative paths (URL-decoded, query and hash dropped), absolute paths and file:// URLs", () => {
    const file = path.join(base, "a b.png");
    expect(lib.localAsset("a%20b.png?v=2#x", base)).toBe(file);
    expect(lib.localAsset(" sub/../a b.png ", base)).toBe(file);
    expect(lib.localAsset(file, "/elsewhere")).toBe(file);
    expect(lib.localAsset(`${pathToFileURL(file).href}?x`, "/elsewhere")).toBe(file);
  });

  it("refuses missing files, folders, malformed paths, bad file URLs and files over 25 MB", () => {
    expect(lib.localAsset("nope.png", base)).toBeUndefined();
    expect(lib.localAsset("sub", base)).toBeUndefined();
    expect(lib.localAsset("%E0%A4%A", base)).toBeUndefined();
    expect(lib.localAsset("file://remote-host/x.png", base)).toBeUndefined();
    const big = path.join(base, "big.bin");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 25 * 1024 * 1024 + 1);
    expect(lib.localAsset("big.bin", base)).toBeUndefined();
  });
});

describe("bundlePage", () => {
  it("copies local src, href, poster and url() files into files/ once each and rewrites the links", () => {
    const base = fs.mkdtempSync(path.join(root, "page-"));
    const out = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(base, "shot 1.png"), "img");
    fs.writeFileSync(path.join(base, "s.css"), "css");
    const html = `<img src="shot%201.png"><link href='s.css'><video poster="shot%201.png"></video>
<a href="https://x.dev">x</a><div style="background:url('shot%201.png')"></div><div style="background:url(missing.png)"></div>`;
    const res = lib.bundlePage(html, base, out);
    expect(res).toContain(`<img src="files/1-shot_1.png">`);
    expect(res).toContain(`<link href='files/2-s.css'>`);
    expect(res).toContain(`poster="files/1-shot_1.png"`);
    expect(res).toContain(`url('files/1-shot_1.png')`);
    expect(res).toContain(`href="https://x.dev"`);
    expect(res).toContain("url(missing.png)");
    expect(fs.readdirSync(path.join(out, "files")).sort()).toEqual(["1-shot_1.png", "2-s.css"]);
    expect(fs.readFileSync(path.join(out, "files", "2-s.css"), "utf8")).toBe("css");
  });

  it("leaves a page with nothing local alone and makes no files folder", () => {
    const out = fs.mkdtempSync(path.join(root, "out-"));
    expect(lib.bundlePage(`<a href="#x">x</a>`, root, out)).toBe(`<a href="#x">x</a>`);
    expect(fs.existsSync(path.join(out, "files"))).toBe(false);
  });
});

describe("countCheckboxes", () => {
  it("counts checkbox inputs in any quoting and case, and nothing else", () => {
    expect(lib.countCheckboxes(`<input type="checkbox"><INPUT disabled type='checkbox'><input type=checkbox><input type="text">`)).toBe(3);
    expect(lib.countCheckboxes("<p>none</p>")).toBe(0);
  });
});

describe("lastReply", () => {
  it("takes the last non-blank result or assistant text", () => {
    const items = [
      { kind: "assistant", text: "first" },
      { kind: "result", text: "answer" },
      { kind: "assistant", text: "  " },
      { kind: "user", text: "later" },
    ] as ThreadItem[];
    expect(lib.lastReply(items)).toBe("answer");
    expect(lib.lastReply([{ kind: "user", text: "hi" }] as ThreadItem[])).toBe("");
    expect(lib.lastReply([])).toBe("");
  });
});

describe("replyPage", () => {
  it("renders the reply as escaped Markdown under the title, without Weft's own status lines", () => {
    const reply = "## Plan\n\n- [ ] one\n- [x] two\n\n<script>bad()</script>\n\n```weft-review\n{}\n```\nBOARD STATUS: done\n`=-=[ SESSION STATUS: x ]=-=`";
    const html = lib.replyPage(`Q&A <"x">`, reply);
    expect(html).toContain("<title>Q&amp;A &lt;&quot;x&quot;&gt;</title>");
    expect(html).toContain("<h2>Plan</h2>");
    expect(lib.countCheckboxes(html)).toBe(2);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/BOARD STATUS|SESSION STATUS|weft-review/);
    expect(html).not.toContain("from <a");
  });

  it("names the site it came from when there's a link", () => {
    expect(lib.replyPage("t", "r", "https://x.dev/?a=1&b")).toContain(`from <a href="https://x.dev/?a=1&amp;b">https://x.dev/?a=1&amp;b</a>`);
  });
});

describe("withTicks", () => {
  it("puts the tick script before the last </body>, with the saved ticks and the item's PATCH url", () => {
    const html = lib.withTicks("<body><pre></body></pre></BODY>", { id: "abc", ticked: [1] });
    expect(html).toMatch(/<pre><\/body><\/pre><script>[\s\S]*<\/script><\/body>$/);
    expect(html).toContain("const saved = [1];");
    expect(html).toContain("fetch('/api/library/abc'");
  });

  it("appends the script to a page with no body tag, with null when nothing's ticked yet", () => {
    const html = lib.withTicks("<p>x</p>", { id: "abc" });
    expect(html.startsWith("<p>x</p><script>")).toBe(true);
    expect(html).toContain("const saved = null;");
  });
});

describe("blanks", () => {
  it("finds named blanks once each, trimmed, and skips code-like braces", () => {
    expect(lib.blanksIn("Pitch {product} to {audience } for {product}; obj = { a: 1 } {1x}")).toEqual(["product", "audience"]);
  });

  it("fills blanks it has values for and keeps the rest", () => {
    expect(lib.fillBlanks("Pitch {product} to { audience} by {date}", { product: " Weft ", audience: "  " })).toBe("Pitch Weft to { audience} by {date}");
    expect(lib.fillBlanks("{brand folder}!", { "brand folder": "~/b" })).toBe("~/b!");
  });
});

describe("skillsDir", () => {
  it("is ~/.claude/skills for mine and <folder>/.claude/skills for a project", () => {
    expect(lib.skillsDir("mine", "/p")).toBe(HOME_SKILLS);
    expect(lib.skillsDir("project", "/p")).toBe("/p/.claude/skills");
  });
});

describe("recipePrompt", () => {
  it("asks for JSON with the card's title, prompt and the reply without Weft's lines", () => {
    const text = lib.recipePrompt({ title: `A "quoted" title`, prompt: "Write a deck" }, "Made slides\nBOARD STATUS: done");
    expect(text).toContain(`The request (titled "A \\"quoted\\" title"):\nWrite a deck`);
    expect(text).toContain("What the thread made (for \"makes\"):\nMade slides");
    expect(text).not.toContain("BOARD STATUS");
  });
});

describe("parseRecipeDraft", () => {
  const src = { title: "Card title", prompt: "Original {thing}" };

  it("reads Haiku's JSON even around stray text, keeping only real blanks with their hints", () => {
    const answer = `Sure! {"name":"pitch-deck","title":"  Make a pitch  ","description":" Makes a deck ","prompt":" Pitch {product} to {audience} ",
      "blanks":[{"name":"product ","hint":" what you sell "},{"name":"audience"},{"name":"ghost","hint":"x"},{"hint":"nameless"},null],"makes":["deck",1,"notes","a","b","c","d"]} done`;
    expect(lib.parseRecipeDraft(answer, src)).toEqual({
      name: "pitch-deck",
      title: "Make a pitch",
      description: "Makes a deck",
      prompt: "Pitch {product} to {audience}",
      blanks: [{ name: "product", hint: "what you sell" }, { name: "audience" }],
      makes: ["deck", "notes", "a", "b", "c", "d"],
    });
  });

  it("falls back to the card's own title and prompt when the answer is missing or malformed", () => {
    const fallback = { name: "", title: "Card title", description: "", prompt: "Original {thing}", blanks: [{ name: "thing" }], makes: [] };
    expect(lib.parseRecipeDraft("", src)).toEqual(fallback);
    expect(lib.parseRecipeDraft("{oops", src)).toEqual(fallback);
    expect(lib.parseRecipeDraft(`{"name":3,"title":" ","prompt":"  ","description":2,"blanks":"x","makes":"y"}`, src)).toEqual(fallback);
  });

  it("caps the title at 80 characters", () => {
    expect(lib.parseRecipeDraft(JSON.stringify({ title: "x".repeat(100) }), src).title).toHaveLength(80);
  });
});

describe("skillName", () => {
  it("kebab-cases the wanted name, capped at 40 characters, or falls back to recipe", () => {
    const dir = path.join(root, "no-skills-here");
    expect(lib.skillName("  Make a Pitch Deck!! ", dir)).toBe("make-a-pitch-deck");
    expect(lib.skillName("a".repeat(60), dir)).toHaveLength(40);
    expect(lib.skillName("!!!", dir)).toBe("recipe");
  });

  it("adds a number until the name is free in that folder", () => {
    const dir = fs.mkdtempSync(path.join(root, "skills-"));
    fs.mkdirSync(path.join(dir, "deck"));
    fs.mkdirSync(path.join(dir, "deck-2"));
    expect(lib.skillName("deck", dir)).toBe("deck-3");
  });
});

describe("skillMarkdown", () => {
  const draft = { name: "", title: "Pitch it", description: "Makes a deck", prompt: "Pitch {product} to {audience}", blanks: [{ name: "product" }, { name: "audience" }], makes: [] };

  it("writes front matter with an argument hint, Weft's mark, the prompt and how to fill the blanks", () => {
    expect(lib.skillMarkdown("pitch", draft)).toBe(`---
name: pitch
description: "Makes a deck"
argument-hint: "<product> <audience>"
---
${lib.SKILL_MARK}

Pitch {product} to {audience}

Fill the blanks in {braces} from the arguments, in order: $ARGUMENTS. Ask for any that are missing.
`);
  });

  it("uses the title for a missing description and leaves out the blank parts when there are none", () => {
    const md = lib.skillMarkdown("x", { ...draft, description: "", prompt: "Just run", blanks: [] });
    expect(md).toBe(`---\nname: x\ndescription: "Pitch it"\n---\n${lib.SKILL_MARK}\n\nJust run\n`);
  });
});

describe("starCard", () => {
  const deps = (url?: string | Error, answer: string | Error = "") => ({
    paneUrl: vi.fn(() => (url instanceof Error ? Promise.reject(url) : Promise.resolve(url))),
    complete: vi.fn<(prompt: string) => Promise<string>>(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer))),
  });

  it("saves a recipe as a marked skill and stars the card with it", async () => {
    const c = card();
    db.cards = [c];
    db.threads.set("c1", [{ kind: "result", text: "Made a deck" }] as ThreadItem[]);
    const d = deps(undefined, JSON.stringify({ name: "Pitch Deck", title: "Pitch", description: "Deck", prompt: "Pitch {product}", blanks: [{ name: "product", hint: "what" }], makes: ["deck"] }));
    const item = await lib.starCard(c, "recipe", "mine", d);
    expect(d.complete.mock.calls[0]![0]).toContain("Made a deck");
    expect(item).toMatchObject({ kind: "recipe", scope: "mine", title: "Pitch", skill: "pitch-deck", prompt: "Pitch {product}", blanks: [{ name: "product", hint: "what" }], makes: ["deck"], cardId: "c1" });
    expect(item.skillPath).toBe(path.join(HOME_SKILLS, "pitch-deck"));
    expect(fs.readFileSync(path.join(item.skillPath!, "SKILL.md"), "utf8")).toContain(lib.SKILL_MARK);
    expect(c.libraryId).toBe(item.id);
  });

  it("falls back to the card's prompt when Haiku fails, naming the skill from the title", async () => {
    const c = card({ title: "Weekly Report", prompt: "Write it" });
    const item = await lib.starCard(c, "recipe", "project", deps(undefined, new Error("offline")));
    expect(item).toMatchObject({ title: "Weekly Report", skill: "weekly-report", prompt: "Write it", blanks: [] });
    expect(item.skillPath).toBe(path.join(c.cwd, ".claude", "skills", "weekly-report"));
    fs.rmSync(c.cwd, { recursive: true, force: true });
  });

  it("re-files a card already starred, replacing its old item", async () => {
    const old = lib.addItem(note({ title: "old" }), "old");
    const c = card({ libraryId: old.id });
    db.cards = [c];
    const item = await lib.starCard(c, "note", "mine", deps(""));
    expect(lib.getItem("old")).toBeUndefined();
    expect(c.libraryId).toBe(item.id);
  });

  it("ignores a stale libraryId", async () => {
    const c = card({ libraryId: "gone" });
    const item = await lib.starCard(c, "note", "mine", deps(""));
    expect(lib.listLibrary().map((i) => i.id)).toEqual([item.id]);
  });

  it("keeps the file page the pane shows, with its images and its checkboxes counted as steps", async () => {
    const pageDir = fs.mkdtempSync(path.join(root, "pane-"));
    fs.writeFileSync(path.join(pageDir, "shot.png"), "img");
    const page = path.join(pageDir, "page.html");
    fs.writeFileSync(page, `<body><img src="shot.png"><input type="checkbox"><input type="checkbox"></body>`);
    const item = await lib.starCard(card(), "todo", "project", deps(`${pathToFileURL(page).href}#top`));
    expect(item).toMatchObject({ kind: "todo", page: true, steps: 2, title: "Card" });
    expect(item.link).toBeUndefined();
    const saved = fs.readFileSync(path.join(lib.itemDir(item), "index.html"), "utf8");
    expect(saved).toContain(`src="files/1-shot.png"`);
    expect(fs.existsSync(path.join(lib.itemDir(item), "files", "1-shot.png"))).toBe(true);
  });

  it("saves the last answer instead when the pane's file is gone or too big", async () => {
    db.threads.set("c1", [{ kind: "assistant", text: "The answer" }] as ThreadItem[]);
    const missing = await lib.starCard(card(), "note", "mine", deps(pathToFileURL(path.join(root, "nope.html")).href));
    expect(fs.readFileSync(path.join(lib.itemDir(missing), "index.html"), "utf8")).toContain("The answer");
    const big = path.join(root, "big.html");
    fs.writeFileSync(big, "");
    fs.truncateSync(big, 25 * 1024 * 1024 + 1);
    const tooBig = await lib.starCard(card(), "note", "mine", deps(pathToFileURL(big).href));
    expect(fs.readFileSync(path.join(lib.itemDir(tooBig), "index.html"), "utf8")).toContain("The answer");
    expect(tooBig.steps).toBeUndefined();
  });

  it("keeps a live site as a link on a page of the last answer", async () => {
    const item = await lib.starCard(card(), "note", "mine", deps("https://example.com/x"));
    expect(item.link).toBe("https://example.com/x");
    const saved = fs.readFileSync(path.join(lib.itemDir(item), "index.html"), "utf8");
    expect(saved).toContain(`from <a href="https://example.com/x">`);
    expect(saved).toContain("Do the thing");
  });

  it("doesn't link Weft's own library page, or anything when the pane fails", async () => {
    const weft = await lib.starCard(card(), "note", "mine", deps("http://localhost:3457/api/library/abc/page"));
    expect(weft.link).toBeUndefined();
    const broken = await lib.starCard(card(), "note", "mine", deps(new Error("no app")));
    expect(broken.link).toBeUndefined();
    const nothing = await lib.starCard(card(), "note", "mine", deps(undefined));
    expect(fs.readFileSync(path.join(lib.itemDir(nothing), "index.html"), "utf8")).toContain("<h1>Card</h1>");
  });
});

describe("recipeRuns", () => {
  it("lists the cards run from a recipe, newest first, from the board by default", () => {
    db.cards = [card({ id: "a", recipeId: "r", createdAt: 1 }), card({ id: "b", recipeId: "x", createdAt: 3 }), card({ id: "c", recipeId: "r", createdAt: 2 })];
    expect(lib.recipeRuns("r").map((c) => c.id)).toEqual(["c", "a"]);
    expect(lib.recipeRuns("r", [db.cards[0]!]).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("recipePage", () => {
  const home = "/Users/me";
  const recipe = (over: Partial<LibraryItem> = {}): LibraryItem =>
    ({ id: "r", kind: "recipe", scope: "mine", title: "Pitch <it>", folder: "/dev/app", createdAt: 0, updatedAt: 0, ...over });
  const run = (over: Partial<Card>) => card({ title: "Run", column: "backlog", createdAt: 0, updatedAt: 0, ...over });

  it("shows a fresh recipe with no blanks, no runs and no stats", () => {
    const html = lib.recipePage(recipe(), [], home);
    expect(html).toContain("<title>Pitch &lt;it&gt;</title>");
    expect(html).toContain("↻ Recipe · mine · not run yet");
    expect(html).toContain("No blanks: it runs as written");
    expect(html).toContain("This is the first run.");
    expect(html).not.toContain(`class="d"`);
    expect(html).not.toContain("What you'll get");
    expect(html).toContain(`<div class="meta"></div>`);
  });

  it("shows blanks with hints, what it makes, its skill path from ~, and a project's folder name", () => {
    const html = lib.recipePage(
      recipe({ scope: "project", description: "Makes <b>", blanks: [{ name: "product", hint: "what" }, { name: "who" }], makes: ["deck", "a&b"], skill: "pitch", skillPath: `${home}/.claude/skills/pitch` }),
      [],
      home,
    );
    expect(html).toContain("↻ Recipe · app · not run yet");
    expect(html).toContain(`<p class="d">Makes &lt;b&gt;</p>`);
    expect(html).toContain("Fill in the blanks in the prompt");
    expect(html).toContain(`<b>{product}</b><span>what</span>`);
    expect(html).toContain(`<b>{who}</b><span></span>`);
    expect(html).toContain(`<span>deck</span><span>a&amp;b</span>`);
    expect(html).toContain("Saved as <code>/pitch</code> in <code>~/.claude/skills/pitch</code>");
    expect(lib.recipePage(recipe({ skill: "p", skillPath: "/opt/p" }), [], home)).toContain("<code>/opt/p</code>");
    expect(lib.recipePage(recipe({ skill: "p" }), [], home)).toContain("in <code></code>");
  });

  it("shows up to six runs with tinted tiles and the average time of finished runs, but no cost", () => {
    const runs = [
      run({ id: "r1", title: "<One>", column: "done", updatedAt: 30 * 60000, costUsd: 1 }),
      run({ id: "r2", column: "review", updatedAt: 10 * 60000, costUsd: 2 }),
      run({ id: "r3", column: "needs_you", costUsd: 0 }),
      ...["r4", "r5", "r6", "r7"].map((id) => run({ id })),
    ];
    const html = lib.recipePage(recipe(), runs, home);
    expect(html).toContain("used 7×");
    expect(html.match(/class="run"/g)).toHaveLength(6);
    expect(html).not.toContain("weft://card/r7");
    expect(html).toContain(`href="weft://card/r1"`);
    expect(html).toContain("&lt;One&gt;");
    expect(html).toContain("· done</div>");
    expect(html).toContain("· needs you</div>");
    // Five tints, so the sixth tile wraps back to the first.
    expect(html.match(/135deg,#2d5a4a,#6f8a6a/g)).toHaveLength(2);
    expect(html).toContain("⏱ ~20 min");
    expect(html).not.toContain("$");
  });

  it("reads quick runs as under a minute and long ones in hours", () => {
    expect(lib.recipePage(recipe(), [run({ column: "done", updatedAt: 1000 })], home)).toContain("⏱ ~<1 min");
    expect(lib.recipePage(recipe(), [run({ column: "done", updatedAt: 3 * 3600000 })], home)).toContain("⏱ ~3 h");
  });
});

describe("pageTitle", () => {
  it("reads the page's <title>, else its first heading, as plain text", () => {
    expect(lib.pageTitle("<html><head><title> Set up  DNS &amp; SSL </title></head><h1>Other</h1>")).toBe("Set up DNS & SSL");
    expect(lib.pageTitle("<title></title><h1 class=x>☑ <b>Try</b> it</h1>")).toBe("☑ Try it");
    expect(lib.pageTitle("<p>no title</p>")).toBeUndefined();
  });
});
