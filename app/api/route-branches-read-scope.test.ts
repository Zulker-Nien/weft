import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

// The read-scope PATCH on a card: the user picked "Read from <path>" on a question, the route
// persists the path on the card and queues a /add-dir slash command for the live session. Split
// from routes.test.ts to keep that file under its line cap.

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, unknown[]>(), seq: 0 }));

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-api-test-data",
  listCards: vi.fn(() => [...db.cards.values()]),
  getCard: vi.fn((id: string) => db.cards.get(id)),
  createCard: vi.fn((input: Omit<Card, "id" | "column" | "createdAt" | "updatedAt">) => {
    const card = { ...input, id: `card-${++db.seq}`, column: "backlog", createdAt: 1, updatedAt: 1 } as Card;
    db.cards.set(card.id, card);
    return card;
  }),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = db.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  }),
  deleteCard: vi.fn((id: string) => db.cards.delete(id)),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
}));

vi.mock("@/lib/runner", () => ({
  sendMessage: vi.fn(),
  sendUserMessage: vi.fn(),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  stop: vi.fn(() => Promise.resolve()),
  isBusy: vi.fn(() => false),
  setPermissionMode: vi.fn(),
  answerPermission: vi.fn(),
  warmUp: vi.fn(),
  ensureSpare: vi.fn(),
  retryAfterLogin: vi.fn(),
}));

vi.mock("@/lib/automations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/automations")>()),
  firstMessage: vi.fn((card: Card) => `first:${card.prompt}`),
  messagesForMove: vi.fn((_card: Card, column: string) => [`/move-${column}`]),
  doneOverrides: vi.fn(() => ({})),
}));

vi.mock("@/lib/copilot", () => ({
  prewarm: vi.fn(),
  sendToCopilot: vi.fn(),
  ensureCopilot: vi.fn(() => ({ id: "copilot", role: "copilot" })),
  resetCopilot: vi.fn(),
}));

const runner = await import("@/lib/runner");
const cardRoute = await import("./cards/[id]/route");

const WRITE = { host: "localhost:3457", "x-threadboard": "1", "content-type": "application/json" };
function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function addCard(patch: Partial<Card> = {}): Card {
  const card: Card = {
    id: `card-${++db.seq}`,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
  db.cards.set(card.id, card);
  return card;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-api-read-scope-"));

beforeEach(() => {
  db.cards.clear();
  db.threads.clear();
  vi.clearAllMocks();
});

const patch = (id: string, body: unknown) => cardRoute.PATCH(req(`/cards/${id}`, { method: "PATCH", body }), ctx(id));

describe("PATCH /cards/:id read scope", () => {
  it("persists and queues a /add-dir slash command when the turn is running", async () => {
    const card = addCard({ cwd: tmp });
    vi.mocked(runner.isBusy).mockReturnValue(true);
    const res = await patch(card.id, { readScope: "/tmp/outside" });
    expect(res.status).toBe(200);
    const after = db.cards.get(card.id)!;
    expect(after.readScope).toEqual(["/tmp/outside"]);
    // The /add-dir slash command goes on the scheduled queue, after the current turn, so the
    // in-flight session picks it up. The user can pull it back from the reply box's queue.
    expect(after.scheduled?.length).toBe(1);
    const scheduled = after.scheduled?.[0];
    expect(scheduled?.text).toBe("/add-dir /tmp/outside");
    expect(scheduled?.afterTurn).toBe(true);
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });

  it("grants read scope without scheduling when the card is idle", async () => {
    const card = addCard({ cwd: tmp });
    vi.mocked(runner.isBusy).mockReturnValue(false);
    const res = await patch(card.id, { readScope: "/tmp/outside" });
    expect(res.status).toBe(200);
    expect(db.cards.get(card.id)!.readScope).toEqual(["/tmp/outside"]);
    // No scheduled message when there's no turn to wait for: the next query() picks up
    // additionalDirectories from the card's readScope.
    expect(db.cards.get(card.id)!.scheduled).toBeUndefined();
  });

  it("dedupes when the path is already in the read scope", async () => {
    const card = addCard({ cwd: tmp, readScope: ["/tmp/outside"] });
    await patch(card.id, { readScope: "/tmp/outside" });
    expect(db.cards.get(card.id)!.readScope).toEqual(["/tmp/outside"]);
  });

  it("rejects the copilot and an empty read scope", async () => {
    const cop = addCard({ role: "copilot" });
    expect((await patch(cop.id, { readScope: "/tmp/outside" })).status).toBe(400);
    const card = addCard();
    expect((await patch(card.id, { readScope: "" })).status).toBe(400);
    expect((await patch(card.id, { readScope: 42 })).status).toBe(400);
  });
});
