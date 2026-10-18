import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "@/lib/types";
import { THREAD_PAGE_SIZE, TOOL_RESULT_INLINE_MAX } from "@/lib/cloud-sync-types";

// The route handlers are plain functions, so these call them directly with a Request. Same setup
// as app/api/routes.test.ts: only the modules the routes pull in are mocked.

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, ThreadItem[]>() }));

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-thread-page-test-data",
  getCard: vi.fn((id: string) => db.cards.get(id)),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
}));

vi.mock("@/lib/import", () => ({ loadTranscript: vi.fn(() => Promise.resolve()) }));

const threadRoute = await import("./cards/[id]/thread/route");
const toolRoute = await import("./cards/[id]/thread/tool/[toolId]/route");

const READ = { host: "localhost:3457" } as const;

function req(url: string, headers: Record<string, string> = READ): Request {
  return new Request(`http://localhost:3457${url}`, { method: "GET", headers });
}

function addCard(patch: Partial<Card> = {}): Card {
  const id = patch.id ?? `card-${db.cards.size + 1}`;
  const card: Card = {
    id,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
  db.cards.set(id, card);
  return card;
}

const body = async (res: Response) => (await res.json()) as { items: ThreadItem[]; start: number; total: number; result?: string; error?: string };
const ctx = (id: string): { params: Promise<{ id: string }> } => ({ params: Promise.resolve({ id }) });
const toolCtx = (id: string, toolId: string): { params: Promise<{ id: string; toolId: string }> } => ({ params: Promise.resolve({ id, toolId }) });

beforeEach(() => {
  db.cards.clear();
  db.threads.clear();
  vi.clearAllMocks();
});

describe("GET /cards/:id/thread paging", () => {
  it("with no params returns the whole thread (back-compat) with start 0", async () => {
    const card = addCard();
    const items: ThreadItem[] = Array.from({ length: 5 }, (_, i) => ({ kind: "user", text: `m${i}`, at: i }));
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread`), ctx(card.id));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ items, start: 0, total: 5 });
  });

  it("returns the newest page (the last THREAD_PAGE_SIZE items) when limit alone is set", async () => {
    const card = addCard();
    const items: ThreadItem[] = Array.from({ length: THREAD_PAGE_SIZE * 2 }, (_, i) => ({ kind: "user", text: `m${i}`, at: i }));
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread?limit=20`), ctx(card.id));
    const data = await body(res);
    expect(data.start).toBe(THREAD_PAGE_SIZE * 2 - 20);
    expect(data.total).toBe(THREAD_PAGE_SIZE * 2);
    expect(data.items.length).toBe(20);
    const first = data.items[0]!;
    expect(first.kind).toBe("user");
    if (first.kind === "user") expect(first.text).toBe(`m${THREAD_PAGE_SIZE * 2 - 20}`);
  });

  it("walks back through older pages with before", async () => {
    const card = addCard();
    const items: ThreadItem[] = Array.from({ length: 100 }, (_, i) => ({ kind: "user", text: `m${i}`, at: i }));
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread?before=80&limit=20`), ctx(card.id));
    const data = await body(res);
    expect(data.start).toBe(60);
    expect(data.total).toBe(100);
    expect(data.items.length).toBe(20);
    const first = data.items[0]!;
    const last = data.items[19]!;
    if (first.kind === "user") expect(first.text).toBe("m60");
    if (last.kind === "user") expect(last.text).toBe("m79");
  });

  it("clamps before past the end of the thread to the newest page", async () => {
    const card = addCard();
    const items: ThreadItem[] = Array.from({ length: 50 }, (_, i) => ({ kind: "user", text: `m${i}`, at: i }));
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread?before=500&limit=20`), ctx(card.id));
    const data = await body(res);
    expect(data.start).toBe(30);
    expect(data.items.length).toBe(20);
  });

  it("ignores non-numeric before / limit and falls back to the whole thread", async () => {
    const card = addCard();
    const items: ThreadItem[] = Array.from({ length: 5 }, (_, i) => ({ kind: "user", text: `m${i}`, at: i }));
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread?before=abc&limit=xyz`), ctx(card.id));
    expect(await body(res)).toEqual({ items, start: 0, total: 5 });
  });

  it("still loads the transcript and 404s an unknown card", async () => {
    expect((await threadRoute.GET(req("/x"), ctx("ghost"))).status).toBe(404);
  });

  it("trims too-long tool results and sets resultBytes; the rest of the items are unchanged", async () => {
    const card = addCard();
    const big = "x".repeat(TOOL_RESULT_INLINE_MAX + 1);
    const items: ThreadItem[] = [
      { kind: "user", text: "go", at: 1 },
      { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: big, at: 2 },
      { kind: "tool", id: "t2", name: "Bash", summary: "ls", result: "ok", at: 3 },
    ];
    db.threads.set(card.id, items);
    const res = await threadRoute.GET(req(`/cards/${card.id}/thread`), ctx(card.id));
    const data = await body(res);
    expect(data.items.length).toBe(3);
    const t1 = data.items[1]!;
    const t2 = data.items[2]!;
    expect(t1.kind).toBe("tool");
    expect(t2.kind).toBe("tool");
    if (t1.kind === "tool") {
      expect(t1.result).toBeUndefined();
      expect(t1.resultBytes).toBe(big.length);
      expect(t1.id).toBe("t1");
    }
    if (t2.kind === "tool") {
      expect(t2.result).toBe("ok");
      expect(t2.resultBytes).toBeUndefined();
    }
    // total is the un-trimmed count, so the client knows what to load.
    expect(data.total).toBe(3);
  });
});

describe("GET /cards/:id/thread/tool/:toolId", () => {
  it("returns the tool result for a top-level tool item", async () => {
    const card = addCard();
    db.threads.set(card.id, [
      { kind: "user", text: "go", at: 1 },
      { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "out", at: 2 },
    ]);
    const res = await toolRoute.GET(req(`/cards/${card.id}/thread/tool/t1`), toolCtx(card.id, "t1"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ result: "out" });
  });

  it("returns the tool result from inside an `edited` fold", async () => {
    const card = addCard();
    db.threads.set(card.id, [
      {
        kind: "edited",
        items: [
          { kind: "user", text: "old", at: 1 },
          { kind: "tool", id: "tx", name: "Bash", summary: "ls", result: "deep", at: 2 },
        ],
        at: 3,
      },
    ]);
    const res = await toolRoute.GET(req(`/cards/${card.id}/thread/tool/tx`), toolCtx(card.id, "tx"));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ result: "deep" });
  });

  it("404s an unknown tool id and an unknown card", async () => {
    const card = addCard();
    db.threads.set(card.id, [{ kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "ok", at: 1 }]);
    const miss = await toolRoute.GET(req(`/cards/${card.id}/thread/tool/other`), toolCtx(card.id, "other"));
    expect(miss.status).toBe(404);
    expect((await body(miss)).error).toBe("No such tool result.");
    const ghost = await toolRoute.GET(req("/cards/ghost/thread/tool/t1"), toolCtx("ghost", "t1"));
    expect(ghost.status).toBe(404);
    expect((await body(ghost)).error).toBe("No such card.");
  });

  it("rejects a foreign host", async () => {
    const res = await toolRoute.GET(req("/x", { host: "evil.com" }), toolCtx("any", "any"));
    expect(res.status).toBe(403);
  });

  it("doesn't require the x-weft-token header on read", async () => {
    const card = addCard();
    db.threads.set(card.id, [{ kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "ok", at: 1 }]);
    const res = await toolRoute.GET(req(`/cards/${card.id}/thread/tool/t1`), toolCtx(card.id, "t1"));
    expect(res.status).toBe(200);
  });
});
