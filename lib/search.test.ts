import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

// search.ts keeps its index in DATA_DIR/search.db and reads session files from import.ts's list, so
// both point at a temp folder the tests fill with realistic session .jsonl and thread .json files.
const env = vi.hoisted(() => ({
  dir: "",
  sessions: new Map<string, string>(),
  cards: [] as Partial<Card>[],
}));

vi.mock("./import", () => ({ sessionFiles: vi.fn(() => env.sessions) }));
vi.mock("./store", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  env.dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-search-"));
  return { DATA_DIR: env.dir, listCards: () => env.cards };
});

const g = globalThis as unknown as {
  __weftSearchDb?: DatabaseSync;
  __weftSearchRefresh?: Promise<void>;
  __weftSearchTimer?: ReturnType<typeof setInterval>;
  __weftSearchReady?: boolean;
};
delete g.__weftSearchDb;
delete g.__weftSearchReady;
delete g.__weftSearchTimer;

const { MARK_END, MARK_START, searchPrompts, startSearchIndex } = await import("./search");
const { sessionFiles } = await import("./import");

let seq = 0;
let mtime = 1_700_000_000;

// A session's .jsonl line for a prompt the user typed.
const prompt = (text: string, at = "2026-10-01T10:00:00.000Z", extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", timestamp: at, message: { role: "user", content: text }, ...extra });
const reply = (text: string) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

// Writes a file and gives it a fresh mtime, so the indexer sees it changed even within one millisecond.
function write(file: string, text: string, append = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (append) fs.appendFileSync(file, text);
  else fs.writeFileSync(file, text);
  mtime += 10;
  fs.utimesSync(file, mtime, mtime);
}

// A session on disk and a card on the board for it.
function session(lines: string[], card: Partial<Card> = {}) {
  const id = `session-${++seq}`;
  const file = path.join(env.dir, "projects", "app", `${id}.jsonl`);
  write(file, lines.map((l) => `${l}\n`).join(""));
  env.sessions.set(id, file);
  const c = { id: `card-${seq}`, sessionId: id, ...card };
  env.cards.push(c);
  return { id, file, card: c };
}

function threadFile(cardId: string, items: unknown) {
  const file = path.join(env.dir, "threads", `${cardId}.json`);
  write(file, typeof items === "string" ? items : JSON.stringify(items));
  return file;
}

// Runs one full indexing pass and waits for it.
async function reindex() {
  clearInterval(g.__weftSearchTimer);
  g.__weftSearchTimer = undefined;
  startSearchIndex();
  await g.__weftSearchRefresh;
}

const cardsOf = (q: string) => searchPrompts(q).hits.map((h) => h.cardId);
const plain = (snippet: string) => snippet.replaceAll(MARK_START, "").replaceAll(MARK_END, "");

beforeEach(() => {
  env.sessions.clear();
  env.cards.length = 0;
  vi.restoreAllMocks();
});

afterAll(() => {
  clearInterval(g.__weftSearchTimer);
  g.__weftSearchDb?.close();
  delete g.__weftSearchDb;
  delete g.__weftSearchTimer;
  delete g.__weftSearchReady;
});

describe("searchPrompts", () => {
  it("says it's still indexing until the first pass is done, then finds prompts", async () => {
    const { card } = session([prompt("rename the zebra component")]);
    expect(searchPrompts("zebra")).toEqual({ hits: [], indexing: true });
    await g.__weftSearchRefresh;
    expect(searchPrompts("zebra")).toEqual({
      hits: [{ cardId: card.id, at: Date.parse("2026-10-01T10:00:00.000Z"), snippet: `rename the ${MARK_START}zebra${MARK_END} component` }],
      indexing: false,
    });
  });

  it("returns nothing for a query with no words", async () => {
    expect(searchPrompts("  ?! -- ")).toEqual({ hits: [], indexing: false });
  });

  it("needs every word to match, the last one as a prefix", async () => {
    const a = session([prompt("deploy the staging server")]).card;
    session([prompt("deploy production")]);
    await reindex();
    expect(cardsOf("deploy stag")).toEqual([a.id]);
    expect(cardsOf("stag deploy")).toEqual([]);
  });

  it("matches word forms through the porter stemmer", async () => {
    const { card } = session([prompt("the walrus tests are failing")]);
    await reindex();
    expect(cardsOf("walrus test")).toEqual([card.id]);
  });

  it("indexes only what the user typed, not replies, CLI text, or broken lines", async () => {
    const { card } = session([
      prompt("talk about the pelican"),
      reply("the flamingo answer"),
      prompt("<system-reminder>heron context</system-reminder>"),
      prompt("sidechain cormorant", undefined, { isSidechain: true }),
      '{"type":"user", broken json albatross',
    ]);
    await reindex();
    expect(cardsOf("pelican")).toEqual([card.id]);
    for (const word of ["flamingo", "heron", "cormorant", "albatross"]) expect(cardsOf(word)).toEqual([]);
  });

  it("uses 0 as the time of a prompt with no timestamp", async () => {
    session([JSON.stringify({ type: "user", message: { content: "no clock quokka" } })]);
    await reindex();
    expect(searchPrompts("quokka").hits[0].at).toBe(0);
  });

  it("only returns prompts from cards on the board, and never the copilot's", async () => {
    const onBoard = session([prompt("the narwhal plan")]).card;
    const gone = session([prompt("the narwhal plan, again")]).card;
    session([prompt("narwhal copilot chat")], { id: "copilot" });
    session([prompt("narwhal copilot by role")], { role: "copilot" });
    await reindex();
    env.cards.splice(env.cards.indexOf(gone), 1);
    expect(cardsOf("narwhal")).toEqual([onBoard.id]);
  });

  it("reads only the new lines a session appended, and a half-written line once it's finished", async () => {
    const { file, card } = session([prompt("first ocelot")]);
    await reindex();
    write(file, `${prompt("second ocelot")}\n${prompt("third ocelot").slice(0, 20)}`, true);
    await reindex();
    expect(searchPrompts("ocelot").hits.map((h) => plain(h.snippet)).sort()).toEqual(["first ocelot", "second ocelot"]);
    write(file, `${prompt("third ocelot").slice(20)}\n`, true);
    await reindex();
    // Two hits per card at most; the third is in the index all the same.
    expect(cardsOf("third ocelot")).toEqual([card.id]);
    const count = g.__weftSearchDb!.prepare("SELECT count(*) AS n FROM prompts WHERE key = ?").get(`session:${card.sessionId}`) as { n: number };
    expect(count.n).toBe(3);
  });

  it("doesn't index a file twice when it hasn't changed", async () => {
    const { card } = session([prompt("lonely axolotl")]);
    await reindex();
    await reindex();
    const count = g.__weftSearchDb!.prepare("SELECT count(*) AS n FROM prompts WHERE key = ?").get(`session:${card.sessionId}`) as { n: number };
    expect(count.n).toBe(1);
  });

  it("starts over when a session file got shorter", async () => {
    const { file } = session([prompt("old tapir notes"), prompt("more tapir notes")]);
    await reindex();
    write(file, `${prompt("new tapir")}\n`);
    await reindex();
    expect(searchPrompts("tapir").hits.map((h) => plain(h.snippet))).toEqual(["new tapir"]);
  });

  it("indexes the prompts of threads Weft runs, rewriting them when the file changes", async () => {
    const card = { id: "weft-card" };
    env.cards.push(card);
    threadFile(card.id, [
      { kind: "user", text: "make the gecko page", at: 42 },
      { kind: "assistant", text: "gecko page done" },
      { kind: "user", text: "   " },
      { kind: "user", text: "and a gecko logo" },
    ]);
    await reindex();
    expect(searchPrompts("gecko").hits).toEqual([
      expect.objectContaining({ cardId: card.id, at: 42 }),
      expect.objectContaining({ cardId: card.id, at: 0 }),
    ]);
    threadFile(card.id, [{ kind: "user", text: "only the iguana now" }]);
    await reindex();
    expect(cardsOf("gecko")).toEqual([]);
    expect(cardsOf("iguana")).toEqual([card.id]);
  });

  it("skips a thread file that isn't valid JSON", async () => {
    env.cards.push({ id: "broken-thread" });
    threadFile("broken-thread", "{ not json");
    await reindex();
    expect(cardsOf("json")).toEqual([]);
  });

  it("shows a prompt once per card when its session and thread both have it", async () => {
    const { card } = session([prompt("Ship  the   Lemur")]);
    threadFile(card.id!, [{ kind: "user", text: "ship the lemur" }]);
    await reindex();
    expect(cardsOf("lemur")).toEqual([card.id]);
  });

  it("returns at most two hits per card and twenty cards", async () => {
    const many = session([prompt("bison one"), prompt("bison two"), prompt("bison three")]).card;
    await reindex();
    expect(cardsOf("bison")).toEqual([many.id, many.id]);
    for (let i = 0; i < 22; i++) session([prompt(`yak number ${i}`)]);
    await reindex();
    expect(new Set(cardsOf("yak")).size).toBe(20);
  });

  it("clips a very long prompt to 8000 characters", async () => {
    const { card } = session([prompt(`okapi ${"x".repeat(9000)}`)]);
    await reindex();
    const row = g.__weftSearchDb!.prepare("SELECT length(text) AS n FROM prompts WHERE key = ?").get(`session:${card.sessionId}`) as { n: number };
    expect(row.n).toBe(8000);
  });

  it("reads a line that spans two read chunks", async () => {
    // The reader takes 8 MB at a time; a long reply pushes the next prompt across the boundary.
    const { card } = session([reply("y".repeat(8 * 1024 * 1024 - 30)), prompt("after the boundary, a manatee")]);
    await reindex();
    expect(cardsOf("manatee")).toEqual([card.id]);
  });

  it("stops at the end of a file that got shorter than it was when it started reading", async () => {
    const { file, card } = session([prompt("the shrinking dugong")]);
    const real = fs.statSync(file);
    vi.spyOn(fs.promises, "stat").mockResolvedValueOnce({ ...real, size: real.size + 500, mtimeMs: real.mtimeMs } as fs.Stats);
    await reindex();
    expect(cardsOf("dugong")).toEqual([card.id]);
  });

  it("logs a file it can't index and goes on with the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    env.sessions.set("missing", path.join(env.dir, "projects", "app", "missing.jsonl"));
    fs.mkdirSync(path.join(env.dir, "threads"), { recursive: true });
    fs.symlinkSync(path.join(env.dir, "nowhere.json"), path.join(env.dir, "threads", "dangling.json"));
    const { card } = session([prompt("the resilient wombat")]);
    await reindex();
    expect(cardsOf("wombat")).toEqual([card.id]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("missing.jsonl"), expect.anything());
    expect(error).toHaveBeenCalledWith("Couldn't index dangling.json:", expect.anything());
    fs.rmSync(path.join(env.dir, "threads", "dangling.json"));
  });

  it("rolls back a file's prompts when saving them fails, and tries again next pass", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = g.__weftSearchDb!;
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.startsWith("INSERT OR REPLACE INTO sources")) throw new Error("disk full");
      return prepare(sql);
    });
    const { card } = session([prompt("the unlucky pangolin")]);
    await reindex();
    expect(error).toHaveBeenCalledWith(expect.stringContaining(card.sessionId!), expect.objectContaining({ message: "disk full" }));
    expect(cardsOf("pangolin")).toEqual([]);
    vi.mocked(db.prepare).mockRestore();
    await reindex();
    expect(cardsOf("pangolin")).toEqual([card.id]);
  });
});

describe("startSearchIndex", () => {
  it("starts once, then refreshes every minute", async () => {
    clearInterval(g.__weftSearchTimer);
    g.__weftSearchTimer = undefined;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      startSearchIndex();
      const timer = g.__weftSearchTimer;
      startSearchIndex();
      expect(g.__weftSearchTimer).toBe(timer);
      await g.__weftSearchRefresh;
      const { card } = session([prompt("the minutely moose")]);
      vi.advanceTimersByTime(60_000);
      await g.__weftSearchRefresh;
      expect(cardsOf("moose")).toEqual([card.id]);
    } finally {
      clearInterval(g.__weftSearchTimer);
      g.__weftSearchTimer = undefined;
      vi.useRealTimers();
    }
  });

  it("logs a pass that fails outright", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sessionFiles).mockImplementationOnce(() => {
      throw new Error("EACCES: projects");
    });
    await expect(reindex()).rejects.toThrow("EACCES");
    expect(error).toHaveBeenCalledWith("Search indexing failed:", expect.objectContaining({ message: "EACCES: projects" }));
    clearInterval(g.__weftSearchTimer);
    g.__weftSearchTimer = undefined;
  });
});
