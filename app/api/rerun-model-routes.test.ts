// Route-level tests for POST /api/cards/:id/rerun-model — the "first message failed" banner's
// one-click escape (components/FirstMessageErrorBanner.tsx). Mirrors the in-memory store +
// mocked runner pattern from switch-backend-routes.test.ts so the file stands on its own.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, unknown[]>(), seq: 0 }));
const busyIds = new Set<string>();

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-api-test-data",
  getCard: vi.fn((id: string) => db.cards.get(id)),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = db.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  }),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
}));

vi.mock("@/lib/runner", () => ({
  isBusy: vi.fn((id: string) => busyIds.has(id)),
  rerunOnModel: vi.fn((id: string, model: string) => {
    const card = db.cards.get(id);
    if (!card) return Promise.reject(new Error("No such card."));
    if (busyIds.has(id)) return Promise.reject(new Error("Stop the thread before rerunning it."));
    Object.assign(card, { model, sessionId: undefined, error: undefined, rateLimitHit: false });
    return Promise.resolve();
  }),
}));

const runner = await import("@/lib/runner");
const rerunRoute = await import("./cards/[id]/rerun-model/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, body: unknown) {
  return new Request(`http://localhost:3457/api${url}`, {
    method: "POST",
    headers: WRITE,
    body: typeof body === "string" ? body : JSON.stringify(body),
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
    permissionMode: "auto",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
  db.cards.set(card.id, card);
  return card;
}

beforeEach(() => {
  db.cards.clear();
  db.threads.clear();
  busyIds.clear();
  vi.clearAllMocks();
});

describe("POST /api/cards/:id/rerun-model", () => {
  const post = (id: string, body: unknown) => rerunRoute.POST(req(`/cards/${id}/rerun-model`, body), ctx(id));

  it("reruns on a Claude model for a Claude card", async () => {
    const card = addCard({ backend: "claude", model: "claude-opus-5-5", error: "rate limit", rateLimitHit: true });
    const res = await post(card.id, { model: "claude-sonnet-5-5" });
    expect(res.status).toBe(200);
    expect(runner.rerunOnModel).toHaveBeenCalledWith(card.id, "claude-sonnet-5-5");
    const json = (await res.json()) as { card: { id: string; model: string; error?: string; rateLimitHit: boolean } };
    expect(json.card.id).toBe(card.id);
    expect(json.card.model).toBe("claude-sonnet-5-5");
    expect(json.card.error).toBeUndefined();
    expect(json.card.rateLimitHit).toBe(false);
  });

  it("accepts a puku model id for the backup", async () => {
    const card = addCard({ backend: "claude" });
    const res = await post(card.id, { model: "puku-ai-2.8" });
    expect(res.status).toBe(200);
    expect(runner.rerunOnModel).toHaveBeenCalledWith(card.id, "puku-ai-2.8");
  });

  it("accepts a codex model id for the backup", async () => {
    const card = addCard({ backend: "claude" });
    const res = await post(card.id, { model: "codex-default" });
    expect(res.status).toBe(200);
    expect(runner.rerunOnModel).toHaveBeenCalledWith(card.id, "codex-default");
  });

  it("400s on a model no CLI serves", async () => {
    const card = addCard({ backend: "claude" });
    const res = await post(card.id, { model: "made-up-model" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/isn't a model/);
    expect(runner.rerunOnModel).not.toHaveBeenCalled();
  });

  it("400s on missing or non-string model", async () => {
    const card = addCard({ backend: "claude" });
    for (const payload of [{}, { model: "" }, { model: 7 }, { model: null }]) {
      const res = await post(card.id, payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
    }
    expect(runner.rerunOnModel).not.toHaveBeenCalled();
  });

  it("404s on an unknown card", async () => {
    const res = await post("ghost", { model: "claude-sonnet-5-5" });
    expect(res.status).toBe(404);
    expect(runner.rerunOnModel).not.toHaveBeenCalled();
  });

  it("propagates a busy-card refusal from the runner as a 400", async () => {
    const card = addCard({ backend: "claude" });
    busyIds.add(card.id);
    const res = await post(card.id, { model: "claude-sonnet-5-5" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/Stop the thread/);
  });

  it("400s on a JSON parse error", async () => {
    const card = addCard({ backend: "claude" });
    const res = await rerunRoute.POST(req(`/cards/${card.id}/rerun-model`, "{"), ctx(card.id));
    expect(res.status).toBe(400);
    expect(runner.rerunOnModel).not.toHaveBeenCalled();
  });
});
