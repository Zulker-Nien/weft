// Pure unit tests for lib/runner.ts's switchBackend. These tests stub only what switchBackend
// touches directly (the store) and inject the global session map that isBusy reads from.
// They run without the SDK harness (lib/runner.harness) that lib/runner.test.ts depends on —
// each test stands alone. The busy-card path needs a session pre-injected; everything else
// is just store reads/writes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, ThreadItem } from "./types";

type StoreHandle = {
  cards: Map<string, Card>;
  threads: Map<string, ThreadItem[]>;
  updateCalls: Array<{ id: string; patch: Partial<Card> }>;
};

const store: StoreHandle = {
  cards: new Map(),
  threads: new Map(),
  updateCalls: [],
};

vi.mock("./store", () => ({
  DATA_DIR: "/nonexistent-weft-test-data",
  getCard: (id: string) => store.cards.get(id),
  updateCard: (id: string, patch: Partial<Card>) => {
    store.updateCalls.push({ id, patch });
    const card = store.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  },
  getThread: (id: string) => store.threads.get(id) ?? [],
}));

vi.mock("./runner", () => ({
  isBusy: vi.fn((id: string) => busyIds.has(id)),
  endSession: vi.fn(),
  sendMessage: vi.fn(),
  setModel: vi.fn((id: string, model: string) => Object.assign(store.cards.get(id)!, { model })),
}));

const busyIds = new Set<string>();
const runner = await import("./runner");
const { switchBackend } = await import("./backend-switch");

function addCard(over: Partial<Card> = {}): Card {
  const id = `card-${store.cards.size + 1}`;
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
    ...over,
  };
  store.cards.set(id, card);
  return card;
}

beforeEach(() => {
  store.cards.clear();
  store.threads.clear();
  store.updateCalls.length = 0;
  busyIds.clear();
  vi.clearAllMocks();
  vi.mocked(runner.isBusy).mockImplementation((id: string) => busyIds.has(id));
});

describe("switchBackend", () => {
  it("flips a claude card to puku, clearing sessionId and rateLimitHit", async () => {
    const card = addCard({ backend: "claude", sessionId: "old", rateLimitHit: true });
    await switchBackend(card.id, "puku");
    const after = store.cards.get(card.id)!;
    expect(after.backend).toBe("puku");
    expect(after.sessionId).toBeUndefined();
    expect(after.rateLimitHit).toBe(false);
  });

  it("is a no-op when the target is the same as the card's current backend", async () => {
    const card = addCard({ backend: "puku" });
    await switchBackend(card.id, "puku");
    expect(runner.endSession).not.toHaveBeenCalled();
    expect(store.updateCalls.length).toBe(0);
  });

  it("swaps a Claude model for puku's default on a switch to puku", async () => {
    const card = addCard({ backend: "claude", model: "claude-fable-5-1" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.model).toBe("opus-4.8");
  });

  it("takes the picked model with the switch", async () => {
    const card = addCard({ backend: "claude", model: "claude-fable-5-1" });
    await switchBackend(card.id, "puku", { model: "puku-ai-2.7" });
    expect(store.cards.get(card.id)!.model).toBe("puku-ai-2.7");
  });

  it("leaves a card with no model on the new CLI's own default", async () => {
    const card = addCard({ backend: "claude" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.model).toBeUndefined();
  });

  it("on the same CLI, only changes the model, busy or not", async () => {
    const card = addCard({ backend: "puku", model: "opus-4.8" });
    busyIds.add(card.id);
    await switchBackend(card.id, "puku", { model: "puku-ai-2.8" });
    expect(runner.setModel).toHaveBeenCalledWith(card.id, "puku-ai-2.8");
    expect(runner.endSession).not.toHaveBeenCalled();
    await switchBackend(card.id, "puku", { model: "puku-ai-2.8" });
    expect(runner.setModel).toHaveBeenCalledTimes(1);
  });

  it("refuses to switch a busy card", async () => {
    const card = addCard({ backend: "claude" });
    busyIds.add(card.id);
    await expect(switchBackend(card.id, "puku")).rejects.toThrow(/Stop the thread/);
    expect(runner.endSession).not.toHaveBeenCalled();
  });

  it("throws when the card does not exist", async () => {
    await expect(switchBackend("missing", "puku")).rejects.toThrow(/No such card/);
  });

  it("downgrades YOLO when switching to puku (puku-cli has no YOLO)", async () => {
    const card = addCard({ backend: "claude", permissionMode: "bypassPermissions" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.permissionMode).toBe("auto");
  });

  it("drops xhigh effort on a switch to puku (puku-cli only takes low/medium/high/max)", async () => {
    const card = addCard({ backend: "claude", effort: "xhigh" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.effort).toBe("high");
  });

  it("keeps max on a switch to puku (puku-cli accepts max)", async () => {
    const card = addCard({ backend: "claude", effort: "max" });
    await switchBackend(card.id, "puku");
    expect(store.cards.get(card.id)!.effort).toBe("max");
  });

  it("keeps the same effort on a switch to claude, including a value puku wouldn't take", async () => {
    // Simulates a card that was already on puku with effort dropped to high; switching back to
    // claude must not invent xhigh. (The picker is symmetric; xhigh stays xhigh if it was.)
    const card = addCard({ backend: "puku", effort: "high" });
    await switchBackend(card.id, "claude");
    expect(store.cards.get(card.id)!.effort).toBe("high");
  });

  it("keeps YOLO when switching between claude backends (claude→claude is a no-op, puku→claude is the only direction it stays)", async () => {
    const card = addCard({ backend: "puku", permissionMode: "auto" });
    await switchBackend(card.id, "claude");
    expect(store.cards.get(card.id)!.permissionMode).toBe("auto");
  });

  it("with replay=true, re-sends the last user message after the switch", async () => {
    const card = addCard({ backend: "claude" });
    store.threads.set(card.id, [
      { kind: "user", text: "first", at: 1 },
      { kind: "result", text: "ok", isError: false, at: 2 },
      { kind: "user", text: "retry me", at: 3 },
    ]);
    await switchBackend(card.id, "puku", { replay: true });
    expect(runner.sendMessage).toHaveBeenCalledWith(card.id, "retry me", { echo: false });
  });

  it("with replay=false, does not send any message", async () => {
    const card = addCard({ backend: "claude" });
    store.threads.set(card.id, [{ kind: "user", text: "hi", at: 1 }]);
    await switchBackend(card.id, "puku", { replay: false });
    expect(runner.sendMessage).not.toHaveBeenCalled();
  });
});